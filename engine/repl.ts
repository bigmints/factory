/**
 * Factory CLI REPL — beautiful interactive terminal UI.
 * Supports chatting with the agent (turn-by-turn verification)
 * and manually running/grouping any of the 12 build tools.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getActiveProject, loadBridgeConfig } from './config.ts';
import { gatherContext, gatherAppContext } from './context.ts';
import { loadStory, loadFeatureStory, listStories } from './story.ts';
import { log, logError } from './log.ts';
import { TOOL_DEFINITIONS, executeTool, type BuildToolContext } from './build-tools.ts';
import { buildToolSystemPrompt, callProviderWithTools, requireActiveProvider, type ToolMessages } from './generate.ts';
import { storySlug, type AppStory, type FeatureStory } from './types.ts';

// ─── ANSI Terminal Styles ────────────────────────────────

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',

    // Colors
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',

    // Bright Colors
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m',
} as const;

const BANNER = `
${C.brightCyan}${C.bold}███████╗ █████╗  ██████╗████████╗ ██████╗ ██████╗ ██╗   ██╗
██╔════╝██╔══██╗██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗╚██╗ ██╔╝
█████╗  ███████║██║        ██║   ██║   ██║██████╔╝ ╚████╔╝ 
██╔══╝  ██╔══██║██║        ██║   ██║   ██║██╔══██╗  ╚██╔╝  
██║     ██║  ██║╚██████╗   ██║   ╚██████╔╝██║  ██║   ██║   
╚═╝     ╚═╝  ╚═╝ ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ${C.reset}
                     ${C.italic}${C.brightYellow}Interactive Build REPL v1.0.0${C.reset}
`;

// ─── Entry Point ─────────────────────────────────────────

export async function runRepl(storyPath?: string, options: { auto?: boolean } = {}): Promise<void> {
    console.log(BANNER);

    const project = getActiveProject();
    const bridge = loadBridgeConfig(project.path);
    const context = gatherContext(project.path, bridge);

    let activeStory: AppStory | FeatureStory | undefined;
    let actualStoryPath = storyPath;

    // Load or select build story
    if (actualStoryPath) {
        activeStory = loadStoryOrFeature(resolve(actualStoryPath));
    } else {
        const stories = listStories(project.path);
        const storyOptions: Array<{ name: string; file: string; type: 'app' | 'feature' }> = [];

        for (const file of stories.apps) {
            storyOptions.push({
                name: file.replace(/\.yaml$/, ''),
                file: resolve(project.path, '.factory', 'stories', 'apps', file),
                type: 'app',
            });
        }
        for (const file of stories.features) {
            storyOptions.push({
                name: file.replace(/\.yaml$/, ''),
                file: resolve(project.path, '.factory', 'stories', 'features', file),
                type: 'feature',
            });
        }

        if (storyOptions.length === 0) {
            log('!', 'No stories found in this project repo. Working in project root context.');
        } else {
            console.log(`${C.bold}🏭 Available Build Stories:${C.reset}`);
            storyOptions.forEach((opt, idx) => {
                const typeLabel = opt.type === 'app' ? `${C.brightGreen}[App]` : `${C.brightBlue}[Feature]`;
                console.log(`  [${idx + 1}] ${typeLabel}${C.reset} ${opt.name}`);
            });
            console.log(`  [${storyOptions.length + 1}] ${C.dim}Blank Slate (work directly in project root)${C.reset}`);
            console.log('');

            const rlSelect = readline.createInterface({ input, output });
            const selection = await rlSelect.question(`${C.bold}Select a build story [1-${storyOptions.length + 1}]: ${C.reset}`);
            rlSelect.close();

            const idx = parseInt(selection.trim(), 10) - 1;
            if (idx >= 0 && idx < storyOptions.length) {
                const opt = storyOptions[idx];
                actualStoryPath = opt.file;
                activeStory = loadStoryOrFeature(opt.file);
            }
        }
    }

    // Set up target directory
    let targetDir = project.path;
    let slug = 'root';
    if (activeStory) {
        slug = 'appName' in activeStory ? storySlug(activeStory as AppStory) : activeStory.feature.slug;
        targetDir = bridge.apps_dir
            ? resolve(project.path, bridge.apps_dir, slug)
            : resolve(project.path, slug);
    }

    // Gather existing app integration context if this is a feature build
    let appContext;
    if (activeStory && !('appName' in activeStory)) {
        appContext = gatherAppContext(project.path, bridge, (activeStory as FeatureStory).target.app);
    }

    // ─── Initialize Tool Context ────────────────────────────

    const ctx: BuildToolContext = {
        targetDir,
        storyFile: actualStoryPath || '',
        terminal: false,
        success: false,
        generatedFiles: new Map(),
        logs: [],
        contextData: {
            conventions: context.conventions.length > 0 ? context.conventions.join('\n\n') : undefined,
            knowledge: context.knowledgeFiles.length > 0
                ? context.knowledgeFiles.map(k => `### ${k.app} (${k.filename})\n${k.content}`).join('\n\n')
                : undefined,
        },
    };

    // Print session metadata panel
    console.log('\n┌' + '─'.repeat(60) + '┐');
    console.log(`│ ${C.bold}SESSION PANEL${C.reset}${' '.repeat(47)}│`);
    console.log(`│ • ${C.bold}Active Project:${C.reset} ${project.name}${' '.repeat(Math.max(0, 42 - project.name.length))}│`);
    console.log(`│ • ${C.bold}Target Dir:${C.reset} ${targetDir.replace(project.path, '.')}${' '.repeat(Math.max(0, 46 - targetDir.replace(project.path, '.').length))}│`);
    if (activeStory) {
        const storyName = 'appName' in activeStory ? (activeStory as AppStory).appName : (activeStory as FeatureStory).feature.name;
        console.log(`│ • ${C.bold}Build Story:${C.reset} ${storyName}${' '.repeat(Math.max(0, 45 - storyName.length))}│`);
    } else {
        console.log(`│ • ${C.bold}Build Story:${C.reset} ${C.dim}None (Blank Slate)${C.reset}${' '.repeat(27)}│`);
    }
    try {
        const { provider, model } = requireActiveProvider();
        console.log(`│ • ${C.bold}LLM Provider:${C.reset} ${provider.id} (${model})${' '.repeat(Math.max(0, 41 - provider.id.length - model.length))}│`);
    } catch {
        console.log(`│ • ${C.bold}LLM Provider:${C.reset} ${C.brightRed}Not Configured${C.reset}${' '.repeat(30)}│`);
    }
    console.log(`│ • ${C.bold}Auto-Approve Tool Calls:${C.reset} ${options.auto ? `${C.brightGreen}ON` : `${C.brightYellow}OFF`}${C.reset}${' '.repeat(options.auto ? 23 : 22)}│`);
    console.log('└' + '─'.repeat(60) + '┘\n');

    console.log(`Type ${C.brightYellow}/help${C.reset} to see commands, ${C.brightYellow}/tools${C.reset} to view all grouped tools, or type your message to chat.\n`);

    // Interactive prompt loop
    const rl = readline.createInterface({ input, output });

    // Prepopulate tool message history
    const systemPrompt = activeStory
        ? buildToolSystemPrompt(activeStory, context, targetDir, appContext)
        : `You are an autonomous code generation engine with access to tools in the directory: ${targetDir}. Always complete with mark_complete.`;

    const messages: ToolMessages = [
        { role: 'system', content: systemPrompt },
    ];

    while (true) {
        const rawInput = await rl.question(`${C.brightGreen}${C.bold}factory ❯ ${C.reset}`);
        const trimmed = rawInput.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('/')) {
            // Handle Slash Command
            const { cmd, argStr, argsList } = parseCommandArgs(trimmed);

            if (cmd === '/exit' || cmd === '/quit') {
                log('✓', 'Exiting interactive REPL session.');
                break;
            } else if (cmd === '/help') {
                printHelp();
            } else if (cmd === '/tools') {
                printGroupedTools();
            } else if (cmd === '/clear') {
                console.clear();
            } else if (cmd === '/status') {
                printStatus(ctx);
            } else {
                // Try executing the tool manually
                const toolName = cmd.slice(1);
                const hasTool = TOOL_DEFINITIONS.some(t => t.name === toolName);
                if (hasTool) {
                    await handleManualToolCall(toolName, argsList, argStr, ctx, rl);
                } else {
                    console.log(`\n${C.brightRed}Unknown command or tool: "${cmd}". Type ${C.brightYellow}/help${C.brightRed} for available options.${C.reset}\n`);
                }
            }
        } else {
            // Plain text is treated as chat input for the LLM
            await handleAgentChatTurn(trimmed, messages, ctx, options.auto || false, rl);
        }
    }

    rl.close();
}

// ─── Slash Commands & Visualizers ─────────────────────────

function printHelp(): void {
    console.log(`
${C.bold}🏭 REPL Slash Commands:${C.reset}
  ${C.brightYellow}/help${C.reset}                   Show this interactive help menu.
  ${C.brightYellow}/tools${C.reset}                  View all 12 build tools grouped by categories.
  ${C.brightYellow}/status${C.reset}                 Check current staged changes, logs, and target directory.
  ${C.brightYellow}/clear${C.reset}                  Clear the terminal screen.
  ${C.brightYellow}/exit${C.reset} or ${C.brightYellow}/quit${C.reset}       Exit the interactive shell cleanly.

${C.bold}🛠️ Direct Tool Execution:${C.reset}
  You can call any tool manually by typing ${C.brightCyan}/<tool_name> [args]${C.reset}.
  If you omit required arguments, the shell will prompt you interactively!
  Example: ${C.brightCyan}/read_file package.json${C.reset} or ${C.brightCyan}/run_command npm test${C.reset}
`);
}

function printGroupedTools(): void {
    console.log(`
${C.bold}🛠️ FACTORY BUILD ENGINE TOOLS (GROUPED):${C.reset}

  📁 ${C.brightBlue}${C.bold}FILE MANIPULATION${C.reset}
    ${C.brightCyan}/read_file${C.reset} <path>               Read a file's content (capped at 100KB)
    ${C.brightCyan}/write_file${C.reset} <path>              Create or overwrite a file (prompts for multi-line content)
    ${C.brightCyan}/patch_file${C.reset} <path>              Surgically replace content block (prompts for old/new blocks)
    ${C.brightCyan}/delete_file${C.reset} <path>             Delete a file from the filesystem safely

  🔍 ${C.brightMagenta}${C.bold}SEARCH & EXPLORATION${C.reset}
    ${C.brightCyan}/list_dir${C.reset} [path] [--recursive]    List directory contents (shallow by default)
    ${C.brightCyan}/search_files${C.reset} <pattern>          Recursive text grep across target directory with globs

  💻 ${C.brightGreen}${C.bold}SHELL & EXECUTION${C.reset}
    ${C.brightCyan}/run_command${C.reset} <command>           Run shell command in target directory

  ℹ️ ${C.brightYellow}${C.bold}CONTEXT & METADATA${C.reset}
    ${C.brightCyan}/read_story${C.reset}                   Display the currently active story YAML
    ${C.brightCyan}/read_context${C.reset} <type>            Read project package.json, tsconfig, file_tree, conventions, knowledge
    ${C.brightCyan}/log_step${C.reset} <message>               Record progress to the build logs

  🛑 ${C.brightRed}${C.bold}SESSION CONTROL${C.reset}
    ${C.brightCyan}/mark_complete${C.reset} [summary]       Complete build session and stage for commit
    ${C.brightCyan}/mark_failed${C.reset} <reason>           Abort build session and mark failure
`);
}

function printStatus(ctx: BuildToolContext): void {
    console.log(`\n${C.bold}📊 Session Status Profile:${C.reset}`);
    console.log(` • ${C.bold}Target Directory:${C.reset} ${ctx.targetDir}`);
    console.log(` • ${C.bold}Active Story File:${C.reset} ${ctx.storyFile || '(none)'}`);
    console.log(` • ${C.bold}Completed Successfully:${C.reset} ${ctx.success ? `${C.brightGreen}Yes` : `${C.brightRed}No`}${C.reset}`);
    console.log(` • ${C.bold}Terminal Triggered:${C.reset} ${ctx.terminal ? `${C.brightRed}Yes` : `${C.brightGreen}No`}${C.reset}`);

    console.log(`\n📁 ${C.bold}Staged / Generated Files (${ctx.generatedFiles.size}):${C.reset}`);
    if (ctx.generatedFiles.size === 0) {
        console.log(`  ${C.dim}(No files written in this session yet)${C.reset}`);
    } else {
        for (const [absPath, content] of ctx.generatedFiles.entries()) {
            const rel = absPath.replace(ctx.targetDir + '/', '');
            console.log(`  • ${C.brightGreen}${rel}${C.reset} (${content.length} bytes)`);
        }
    }

    console.log(`\n📝 ${C.bold}Recent Logs (${ctx.logs.length}):${C.reset}`);
    if (ctx.logs.length === 0) {
        console.log(`  ${C.dim}(No logs recorded yet)${C.reset}`);
    } else {
        const lastLogs = ctx.logs.slice(-10);
        for (const l of lastLogs) {
            const sym = l.level === 'error' ? '✗' : l.level === 'warn' ? '!' : '✓';
            const color = l.level === 'error' ? C.brightRed : l.level === 'warn' ? C.brightYellow : C.brightGreen;
            console.log(`  ${color}${sym}${C.reset} ${l.message}`);
        }
    }
    console.log('');
}

// ─── Manual Tool Execution ───────────────────────────────

async function handleManualToolCall(
    name: string,
    argsList: string[],
    argStr: string,
    ctx: BuildToolContext,
    rl: readline.Interface,
): Promise<void> {
    console.log(`\n${C.dim}⚡ Executing "${name}"...${C.reset}`);
    const resolvedArgs: Record<string, unknown> = {};

    try {
        switch (name) {
            case 'read_file': {
                resolvedArgs.path = argsList[0] || (await rl.question(`${C.bold}Path to read: ${C.reset}`));
                break;
            }
            case 'write_file': {
                resolvedArgs.path = argsList[0] || (await rl.question(`${C.bold}File path to write: ${C.reset}`));
                resolvedArgs.content = await readMultiLineInput(rl, 'File content');
                break;
            }
            case 'patch_file': {
                resolvedArgs.path = argsList[0] || (await rl.question(`${C.bold}File path to patch: ${C.reset}`));
                resolvedArgs.old_content = await readMultiLineInput(rl, 'Exact old content block to find');
                resolvedArgs.new_content = await readMultiLineInput(rl, 'New replacement content block');
                break;
            }
            case 'delete_file': {
                resolvedArgs.path = argsList[0] || (await rl.question(`${C.bold}File path to delete: ${C.reset}`));
                break;
            }
            case 'list_dir': {
                resolvedArgs.path = argsList[0] || '.';
                resolvedArgs.recursive = argStr.includes('--recursive') || argStr.includes('-r');
                break;
            }
            case 'search_files': {
                resolvedArgs.pattern = argsList[0] || (await rl.question(`${C.bold}Search pattern: ${C.reset}`));
                resolvedArgs.path = '.';
                // Simple parser for --glob
                const gIdx = argsList.indexOf('--glob');
                if (gIdx !== -1 && argsList[gIdx + 1]) {
                    resolvedArgs.glob = argsList[gIdx + 1];
                }
                resolvedArgs.case_insensitive = argStr.includes('--case-insensitive') || argStr.includes('-i');
                break;
            }
            case 'run_command': {
                resolvedArgs.command = argStr || (await rl.question(`${C.bold}Command to run: ${C.reset}`));
                break;
            }
            case 'read_story': {
                break;
            }
            case 'read_context': {
                const type = argsList[0];
                if (type && ['package_json', 'tsconfig', 'file_tree', 'conventions', 'knowledge'].includes(type)) {
                    resolvedArgs.type = type;
                } else {
                    console.log(`Available Types: package_json, tsconfig, file_tree, conventions, knowledge`);
                    resolvedArgs.type = await rl.question(`${C.bold}Select context type: ${C.reset}`);
                }
                break;
            }
            case 'log_step': {
                resolvedArgs.message = argStr || (await rl.question(`${C.bold}Log Message: ${C.reset}`));
                resolvedArgs.level = 'info';
                break;
            }
            case 'mark_complete': {
                resolvedArgs.summary = argStr || (await rl.question(`${C.bold}Build Summary: ${C.reset}`));
                break;
            }
            case 'mark_failed': {
                resolvedArgs.reason = argStr || (await rl.question(`${C.bold}Reason for failure: ${C.reset}`));
                break;
            }
        }

        const res = await executeTool(name, resolvedArgs, ctx);
        console.log('');
        if (res.isError) {
            console.log(`${C.brightRed}❌ Tool Execution Error:${C.reset}`);
            console.log(C.brightRed + res.content + C.reset);
        } else {
            console.log(`${C.brightGreen}✓ Tool Output:${C.reset}`);
            console.log(res.content);
        }
        console.log('');
    } catch (err) {
        console.log(`\n${C.brightRed}Failed to execute manual tool: ${err instanceof Error ? err.message : String(err)}${C.reset}\n`);
    }
}

// ─── Agent Loop ──────────────────────────────────────────

async function handleAgentChatTurn(
    userInput: string,
    messages: ToolMessages,
    ctx: BuildToolContext,
    auto: boolean,
    rl: readline.Interface,
): Promise<void> {
    messages.push({ role: 'user', content: userInput });

    const active = requireActiveProvider();

    let turns = 0;
    const MAX_TURNS = 10; // Keep REPL interactive runs short

    while (turns < MAX_TURNS && !ctx.terminal) {
        turns++;
        console.log(`\n${C.dim}🤖 calling agent (${active.provider.id}:${active.model})...${C.reset}`);

        try {
            const response = await callProviderWithTools(active.provider, active.model, messages, TOOL_DEFINITIONS);

            if (response.text) {
                console.log(`\n${C.brightCyan}${C.bold}🤖 Agent Response:${C.reset}`);
                console.log(response.text);
            }

            const toolCalls = response.toolCalls || [];
            if (toolCalls.length === 0) {
                // Done with this turn
                messages.push({ role: 'assistant', content: response.text });
                break;
            }

            messages.push({ role: 'assistant', content: response.text, tool_calls: toolCalls });

            // Process tool calls
            for (const tc of toolCalls) {
                console.log(`\n🤖 ${C.bold}Agent requests tool call:${C.reset}`);
                console.log(`   • ${C.bold}Tool:${C.reset} ${C.brightCyan}${tc.function.name}${C.reset}`);
                console.log(`   • ${C.bold}Arguments:${C.reset} ${JSON.stringify(tc.function.arguments, null, 2)}`);

                let approve = auto;
                if (!approve) {
                    const ans = await rl.question(`\n${C.bold}Authorize execution? [Y/n/exit] (default Y): ${C.reset}`);
                    const val = ans.trim().toLowerCase();
                    if (val === 'exit' || val === 'e') {
                        ctx.terminal = true;
                        log('!', 'Aborting agent tool loop.');
                        break;
                    }
                    approve = val === '' || val === 'y' || val === 'yes';
                }

                if (approve) {
                    console.log(`${C.dim}⚡ Running tool...${C.reset}`);
                    const result = await executeTool(tc.function.name, tc.function.arguments, ctx);

                    if (result.isError) {
                        console.log(`${C.brightRed}❌ Tool returned error:${C.reset}\n${result.content}`);
                        ctx.logs.push({ level: 'error', message: `[${tc.function.name}] ${result.content}` });
                    } else {
                        console.log(`${C.brightGreen}✓ Tool returned output (truncated):${C.reset}`);
                        const trunc = result.content.length > 500 ? result.content.slice(0, 500) + '\n... (truncated)' : result.content;
                        console.log(trunc);
                        ctx.logs.push({ level: 'info', message: result.content });
                    }

                    messages.push({
                        role: 'tool',
                        content: result.content,
                        tool_call_id: tc.id,
                    });
                } else {
                    console.log(`${C.brightRed}✗ Execution Refused${C.reset}`);
                    messages.push({
                        role: 'tool',
                        content: 'Error: Execution refused by user.',
                        tool_call_id: tc.id,
                    });
                }
            }

            if (ctx.terminal) {
                break;
            }

        } catch (err) {
            logError(`Agent Call Failed: ${err instanceof Error ? err.message : String(err)}`);
            break;
        }
    }

    if (ctx.terminal) {
        console.log(`\n${C.bold}🛑 SESSION TERMINATED:${C.reset}`);
        if (ctx.success) {
            console.log(`${C.brightGreen}✓ Session completed successfully!${C.reset}`);
        } else {
            console.log(`${C.brightRed}✗ Session failed / cancelled.${C.reset}`);
        }
        console.log('');
    }
}

// ─── Helpers ─────────────────────────────────────────────

function loadStoryOrFeature(filePath: string): AppStory | FeatureStory {
    const content = readFileSync(filePath, 'utf-8');
    if (content.includes('appName:')) {
        return loadStory(filePath);
    }
    return loadFeatureStory(filePath);
}

function parseCommandArgs(input: string): { cmd: string; argStr: string; argsList: string[] } {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0];
    const argStr = input.trim().slice(cmd.length).trim();

    const argsList: string[] = [];
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    let match;
    while ((match = regex.exec(argStr)) !== null) {
        argsList.push(match[1] || match[2] || match[0]);
    }

    return { cmd, argStr, argsList };
}

async function readMultiLineInput(rl: readline.Interface, fieldName: string): Promise<string> {
    console.log(`\n${C.bold}📄 Enter multiline ${fieldName} (type /end on a new line to finish):${C.reset}`);
    const lines: string[] = [];
    while (true) {
        const line = await rl.question(`${C.dim}> ${C.reset}`);
        if (line.trim() === '/end') break;
        lines.push(line);
    }
    return lines.join('\n');
}
