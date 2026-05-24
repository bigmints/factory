/**
 * Orchestrate — LLM-driven story delivery.
 *
 * The LLM receives the story + full context (TOON state, knowledgebase,
 * conventions, factory.yaml) and uses tools to:
 *   1. Delegate to the user-configured CLI (pi, claude, gemini, agy)
 *   2. Read what was produced
 *   3. Run checks (tsc, lint, etc.)
 *   4. Update the knowledgebase
 *   5. Update context / heartbeat
 *   6. Mark the story done or failed
 *
 * The engine drives zero logic. The LLM decides everything.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { log, logError } from './log.ts';
import { writeHeartbeat } from './toon.ts';
import { updateStoryStatus } from './story.ts';
import { loadSettings } from './config.ts';
import type {
    AppStory, FeatureStory, ProjectBlueprint,
    BuildResult, GeneratedFile, FactorySettings, LLMProvider,
} from './types.ts';

// ─── Types ───────────────────────────────────────────────

export interface OrchestratorContext {
    targetDir: string;
    storyFile: string;
    repoPath: string;
    cliName: string;
    terminal: boolean;
    success: boolean;
    files: GeneratedFile[];
    logs: Array<{ level: 'info' | 'error'; message: string }>;
}

interface ToolResult {
    content: string;
    isError: boolean;
}

// ─── Public Entry Points ─────────────────────────────────

/**
 * Orchestrate an AppStory build.
 * The LLM receives the full context and uses tools to deliver the story.
 */
export async function orchestrateStory(
    story: AppStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
): Promise<BuildResult> {
    const settings = loadSettings();
    const cliName = resolveCliName(settings);
    log('●', `Orchestrating story: ${story.appName} via CLI: ${cliName}`);
    return runOrchestratorLoop(story, blueprint, targetDir, storyFile, cliName, settings);
}

/**
 * Orchestrate a FeatureStory build.
 */
export async function orchestrateFeatureStory(
    story: FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
): Promise<BuildResult> {
    const settings = loadSettings();
    const cliName = resolveCliName(settings);
    log('●', `Orchestrating feature: ${story.feature.name} via CLI: ${cliName}`);
    return runOrchestratorLoop(story, blueprint, targetDir, storyFile, cliName, settings);
}

// ─── CLI Resolution ──────────────────────────────────────

/**
 * Resolve the CLI to use from user settings.
 * Order: settings.defaultCli → auto-detect.
 * The LLM does NOT choose — the user configured it.
 */
function resolveCliName(settings: FactorySettings): string {
    if (settings.defaultCli) {
        log('→', `Using configured CLI: ${settings.defaultCli}`);
        return settings.defaultCli;
    }
    // Auto-detect
    for (const bin of ['pi', 'gemini', 'claude', 'agy']) {
        const result = spawnSync('which', [bin], { encoding: 'utf8' });
        if (result.status === 0) {
            log('→', `Auto-detected CLI: ${bin}`);
            return bin;
        }
    }
    throw new Error(
        'No CLI configured. Run: factory worker default-cli <pi|gemini|claude|agy>\n' +
        'Or install one of: pi, gemini, claude, agy'
    );
}

/** Non-interactive (yolo) flags per CLI */
const CLI_YOLO_FLAGS: Record<string, string[]> = {
    gemini: ['--yolo'],
    claude: ['--dangerously-skip-permissions'],
    agy:    ['--dangerously-skip-permissions'],
    pi:     [],
};

// ─── Orchestrator Loop ───────────────────────────────────

const MAX_TURNS = 8;   // max LLM turns before giving up
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

async function runOrchestratorLoop(
    story: AppStory | FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
    cliName: string,
    settings: FactorySettings,
): Promise<BuildResult> {
    const provider = resolveOrchestratorProvider(settings);
    const model = resolveModel(provider, settings);

    const ctx: OrchestratorContext = {
        targetDir,
        storyFile,
        repoPath: blueprint.repoPath,
        cliName,
        terminal: false,
        success: false,
        files: [],
        logs: [],
    };

    mkdirSync(targetDir, { recursive: true });

    const systemPrompt = buildSystemPrompt(story, blueprint, cliName);

    const messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: 'Begin. The story is ready. Start by calling delegate_to_cli with a precise, context-rich prompt for the CLI agent.',
        },
    ];

    const sessionStart = Date.now();
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    for (let turn = 0; turn < MAX_TURNS && !ctx.terminal; turn++) {
        if (Date.now() - sessionStart > SESSION_TIMEOUT_MS) {
            logError(`Orchestrator timed out after ${Math.round((Date.now() - sessionStart) / 60_000)} min`);
            ctx.logs.push({ level: 'error', message: 'Session timed out' });
            break;
        }

        log('●', `Orchestrator turn ${turn + 1}/${MAX_TURNS}...`);

        // Write heartbeat each turn so the UI knows we're alive
        try { writeHeartbeat(blueprint.repoPath, `orchestrating turn ${turn + 1}`); } catch { /* non-fatal */ }

        const response = await callOrchestratorLLM(provider, model, messages);
        totalTokensIn += response.tokensIn;
        totalTokensOut += response.tokensOut;

        const toolCalls = response.toolCalls || [];

        if (toolCalls.length === 0) {
            // LLM responded with text — nudge it back to tool usage
            messages.push({ role: 'assistant', content: response.text });
            messages.push({
                role: 'user',
                content: 'Please call a tool to proceed. Available tools: delegate_to_cli, read_output, run_check, update_knowledge, update_context, mark_story_done, mark_story_failed.',
            });
            log('!', 'LLM returned no tool calls — nudging');
            continue;
        }

        messages.push({ role: 'assistant', content: response.text, tool_calls: toolCalls });

        for (const tc of toolCalls) {
            const toolName = tc.function?.name || tc.name || 'unknown';
            const args = tc.function?.arguments || tc.arguments || {};
            log('→', `Tool: ${toolName}`);

            const result = await executeOrchestratorTool(toolName, args, ctx);
            messages.push({
                role: 'tool',
                content: result.content,
                tool_call_id: tc.id,
            });

            if (result.isError) {
                ctx.logs.push({ level: 'error', message: `[${toolName}] ${result.content}` });
                log('✗', `Tool error — ${toolName}: ${result.content.slice(0, 200)}`);
            } else {
                ctx.logs.push({ level: 'info', message: result.content });
            }
        }

        if (ctx.terminal) break;
    }

    if (!ctx.terminal) {
        logError(`Orchestrator exhausted ${MAX_TURNS} turns without calling mark_story_done or mark_story_failed`);
        ctx.logs.push({ level: 'error', message: `Exceeded max turns (${MAX_TURNS})` });
    }

    const errors = ctx.logs.filter(l => l.level === 'error').map(l => l.message);

    return {
        success: ctx.success,
        files: ctx.files,
        plan: {
            files: ctx.files.map(f => f.filename),
            architecture: isAppStory(story) ? story.appName : (story as FeatureStory).feature.name,
            decisions: ['engine:orchestrator', `cli:${cliName}`],
        },
        iterations: 1,
        errors: errors.length > 0 ? errors : undefined,
        tokenUsage: { promptTokens: totalTokensIn, completionTokens: totalTokensOut },
        model,
        provider: provider.id,
        engine: 'orchestrator',
    };
}

// ─── System Prompt ───────────────────────────────────────

/**
 * Build the orchestrator system prompt with full context injection:
 * story, TOON state, knowledgebase, conventions, factory.yaml, CLI name.
 */
function buildSystemPrompt(
    story: AppStory | FeatureStory,
    blueprint: ProjectBlueprint,
    cliName: string,
): string {
    const sections: string[] = [];

    sections.push(`You are Factory, an autonomous build orchestrator.
Your job: deliver the story below by delegating to the configured CLI agent.
You do NOT write code yourself. You write prompts for the CLI agent and verify its work.`);

    // ── Configured CLI ──
    sections.push(`## Configured CLI
${cliName}
This is the user's choice. Do not question it. Always use delegate_to_cli with this CLI.
The CLI runs with full filesystem access in the target directory and will do the actual coding.`);

    // ── Story ──
    const storyBlock = isAppStory(story)
        ? `appName: ${story.appName}\ndescription: ${story.description}\nstack: ${JSON.stringify(story.stack)}\n${toYaml(story)}`
        : toYaml(story);
    sections.push(`## Story\n\`\`\`yaml\n${storyBlock}\n\`\`\``);

    // ── Project Context (TOON state) ──
    if (blueprint.toonSnapshot) {
        sections.push(`## Project Context (TOON State)\n${blueprint.toonSnapshot}`);
    }

    // ── Knowledgebase ──
    const knowledgeFiles = loadKnowledgeFiles(blueprint.repoPath);
    if (knowledgeFiles.length > 0) {
        const kb = knowledgeFiles.map(k => `### ${k.name}\n${k.content}`).join('\n\n');
        sections.push(`## Knowledgebase (past builds & decisions)\n${kb}`);
    }

    // ── Conventions ──
    if (blueprint.conventions.length > 0) {
        sections.push(`## Conventions\n${blueprint.conventions.join('\n\n---\n\n')}`);
    }

    // ── Knowledge files (AGENTS.md etc.) ──
    if (blueprint.knowledgeFiles.length > 0) {
        const kf = blueprint.knowledgeFiles.map(k => `### ${k.app} / ${k.filename}\n${k.content}`).join('\n\n');
        sections.push(`## App Knowledge Files\n${kf}`);
    }

    // ── Your workflow ──
    sections.push(`## Your Workflow

1. Call **delegate_to_cli** with a precise, context-rich prompt. Include:
   - Exactly what to build (reference the story)
   - The stack (framework, language, package manager)
   - Relevant conventions from the knowledgebase
   - Where to write files (the target directory)
   - That the CLI should run tsc/lint/tests itself if the story requires it

2. Call **read_output** to inspect what was produced.

3. Call **run_check** if you need to verify compilation or tests independently.
   Only run checks appropriate to the story's stack. Config-only stories need no checks.

4. If something is wrong, call **delegate_to_cli** again with:
   - The specific errors found
   - What needs to be fixed

5. When satisfied, call **update_knowledge** with what was built and any key decisions.

6. Call **update_context** to log completion to the worklog.

7. Call **mark_story_done** with a summary.

If you cannot recover after re-delegation, call **mark_story_failed** with the reason.

## Rules
- Never call mark_story_done unless you have verified the output is correct.
- Never call run_check with commands that compile the whole world — scope to the target directory.
- Keep delegation prompts precise and context-rich. A vague prompt produces vague code.
- Include stack information in every delegation prompt — the CLI agent needs to know the tech.`);

    return sections.join('\n\n');
}

// ─── Tool Definitions ────────────────────────────────────

export const ORCHESTRATOR_TOOL_DEFINITIONS = [
    {
        name: 'delegate_to_cli',
        description: 'Run the configured CLI agent with a prompt in the target directory. The CLI agent writes files, runs installs, etc. Returns combined stdout/stderr.',
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'The full prompt to send to the CLI agent. Be precise and context-rich.' },
                cwd: { type: 'string', description: 'Working directory for the CLI. Defaults to the target build directory.' },
            },
            required: ['prompt'],
        },
    },
    {
        name: 'read_output',
        description: 'List files in the target directory and optionally read specific file contents. Use to inspect what the CLI agent produced.',
        parameters: {
            type: 'object',
            properties: {
                files: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional list of specific file paths (relative to target dir) to read contents of.',
                },
            },
            required: [],
        },
    },
    {
        name: 'run_check',
        description: 'Run a validation command in the target directory (e.g. tsc --noEmit, npm test, npx eslint .). Returns stdout/stderr and exit code.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The command to run, e.g. "npx tsc --noEmit" or "npm test".' },
                cwd: { type: 'string', description: 'Working directory. Defaults to the target build directory.' },
            },
            required: ['command'],
        },
    },
    {
        name: 'update_knowledge',
        description: 'Write a knowledge entry to .factory/knowledge/<slug>.md. Record what was built, key decisions, and what to avoid next time.',
        parameters: {
            type: 'object',
            properties: {
                slug: { type: 'string', description: 'Short identifier for this knowledge entry, e.g. "greeting-app" or "auth-feature".' },
                content: { type: 'string', description: 'Markdown content. Include: what was built, stack decisions, known issues, conventions used.' },
            },
            required: ['slug', 'content'],
        },
    },
    {
        name: 'update_context',
        description: 'Append a message to the project worklog (.factory/logs/worklog.yaml) and update the heartbeat.',
        parameters: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'What just happened or was decided.' },
            },
            required: ['message'],
        },
    },
    {
        name: 'mark_story_done',
        description: 'Mark the story as done. Call this ONLY when you have verified the output is correct. Updates story YAML status to done.',
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'What was delivered. Will be written to the build receipt.' },
            },
            required: ['summary'],
        },
    },
    {
        name: 'mark_story_failed',
        description: 'Mark the story as failed/needs review. Call when you cannot recover from errors.',
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Why the build failed and what would be needed to fix it.' },
            },
            required: ['reason'],
        },
    },
] as const;

// ─── Tool Execution ──────────────────────────────────────

async function executeOrchestratorTool(
    name: string,
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): Promise<ToolResult> {
    try {
        switch (name) {
            case 'delegate_to_cli':      return toolDelegateToCli(args, ctx);
            case 'read_output':          return toolReadOutput(args, ctx);
            case 'run_check':            return toolRunCheck(args, ctx);
            case 'update_knowledge':     return toolUpdateKnowledge(args, ctx);
            case 'update_context':       return toolUpdateContext(args, ctx);
            case 'mark_story_done':      return toolMarkStoryDone(args, ctx);
            case 'mark_story_failed':    return toolMarkStoryFailed(args, ctx);
            default:
                return { content: `Unknown tool: ${name}`, isError: true };
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Tool ${name} threw: ${msg}`, isError: true };
    }
}

// ── delegate_to_cli ──────────────────────────────────────

function toolDelegateToCli(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): ToolResult {
    const prompt = String(args.prompt || '');
    if (!prompt) return { content: 'prompt is required', isError: true };

    const cwd = args.cwd ? resolve(String(args.cwd)) : ctx.targetDir;
    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });

    const yoloFlags = CLI_YOLO_FLAGS[ctx.cliName] || [];
    const cliArgs = ['-p', prompt, ...yoloFlags];

    log('→', `Running: ${ctx.cliName} in ${cwd}`);
    log('→', `Prompt (${prompt.length} chars): ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);

    const result = spawnSync(ctx.cliName, cliArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 20 * 60 * 1000, // 20 minutes per CLI invocation
        maxBuffer: 50 * 1024 * 1024,
    });

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    const exitCode = result.status ?? -1;

    log(exitCode === 0 ? '✓' : '!', `CLI exited with code ${exitCode}`);

    // Scan what was written to give the LLM a file manifest
    const fileTree = scanDirTree(cwd);
    ctx.files = fileTree;

    const fileList = fileTree.length > 0
        ? `\nFiles written:\n${fileTree.map(f => `  ${f.filename}`).join('\n')}`
        : '\nNo files detected in output directory.';

    return {
        content: `Exit code: ${exitCode}\n${combined.slice(0, 8000)}${combined.length > 8000 ? '\n[truncated]' : ''}${fileList}`,
        isError: exitCode !== 0,
    };
}

// ── read_output ──────────────────────────────────────────

function toolReadOutput(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): ToolResult {
    const fileTree = scanDirTree(ctx.targetDir);
    ctx.files = fileTree;

    const requestedFiles = Array.isArray(args.files) ? (args.files as string[]) : [];
    const lines: string[] = [`Directory: ${ctx.targetDir}`, ''];

    // File tree
    lines.push('File tree:');
    if (fileTree.length === 0) {
        lines.push('  (empty)');
    } else {
        for (const f of fileTree) {
            lines.push(`  ${f.filename}`);
        }
    }

    // Read requested file contents
    if (requestedFiles.length > 0) {
        lines.push('');
        lines.push('File contents:');
        for (const relPath of requestedFiles) {
            const absPath = join(ctx.targetDir, relPath);
            if (existsSync(absPath)) {
                const content = readFileSync(absPath, 'utf-8');
                lines.push(`\n### ${relPath}\n\`\`\`\n${content.slice(0, 4000)}${content.length > 4000 ? '\n[truncated]' : ''}\n\`\`\``);
            } else {
                lines.push(`\n### ${relPath}\n(file not found)`);
            }
        }
    }

    return { content: lines.join('\n'), isError: false };
}

// ── run_check ────────────────────────────────────────────

function toolRunCheck(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): ToolResult {
    const command = String(args.command || '');
    if (!command) return { content: 'command is required', isError: true };

    const cwd = args.cwd ? resolve(String(args.cwd)) : ctx.targetDir;
    log('→', `Check: ${command} in ${cwd}`);

    try {
        const output = execSync(command, {
            cwd,
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: 5 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024,
        });
        return {
            content: `Exit 0 (OK)\n${output.slice(0, 4000)}`,
            isError: false,
        };
    } catch (err: any) {
        const stderr = err?.stderr?.toString() || '';
        const stdout = err?.stdout?.toString() || '';
        const combined = [stdout, stderr].filter(Boolean).join('\n');
        return {
            content: `Exit ${err?.status ?? 1} (FAILED)\n${combined.slice(0, 4000)}`,
            isError: true,
        };
    }
}

// ── update_knowledge ─────────────────────────────────────

function toolUpdateKnowledge(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): ToolResult {
    const slug = String(args.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '');
    const content = String(args.content || '');

    if (!slug || !content) return { content: 'slug and content are required', isError: true };

    const knowledgeDir = join(ctx.repoPath, '.factory', 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });

    const filePath = join(knowledgeDir, `${slug}.md`);
    const timestamp = new Date().toISOString();
    const fileContent = `# ${slug}\n\n> Written by Factory orchestrator at ${timestamp}\n\n${content}\n`;

    writeFileSync(filePath, fileContent);
    log('✓', `Knowledge written: .factory/knowledge/${slug}.md`);

    return { content: `Knowledge entry written to .factory/knowledge/${slug}.md`, isError: false };
}

// ── update_context ───────────────────────────────────────

function toolUpdateContext(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): ToolResult {
    const message = String(args.message || '');
    if (!message) return { content: 'message is required', isError: true };

    // Append to worklog
    const worklogPath = join(ctx.repoPath, '.factory', 'logs', 'worklog.yaml');
    mkdirSync(dirname(worklogPath), { recursive: true });

    let worklog: any = { entries: [] };
    if (existsSync(worklogPath)) {
        try { worklog = parseYaml(readFileSync(worklogPath, 'utf-8')) || { entries: [] }; } catch { /* fresh */ }
    }
    if (!Array.isArray(worklog.entries)) worklog.entries = [];

    worklog.entries.push({
        timestamp: new Date().toISOString(),
        message,
        agent: 'factory-orchestrator',
    });

    // Keep last 50 entries
    if (worklog.entries.length > 50) {
        worklog.entries = worklog.entries.slice(-50);
    }

    writeFileSync(worklogPath, toYaml(worklog));

    // Update heartbeat
    try { writeHeartbeat(ctx.repoPath, message); } catch { /* non-fatal */ }

    log('✓', `Context updated: ${message.slice(0, 80)}`);
    return { content: `Worklog updated and heartbeat written`, isError: false };
}

// ── mark_story_done ──────────────────────────────────────

function toolMarkStoryDone(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): ToolResult {
    const summary = String(args.summary || 'Story delivered');

    // Update story YAML status
    try {
        updateStoryStatus(ctx.storyFile, 'done');
        log('✓', `Story status → done: ${ctx.storyFile}`);
    } catch (e) {
        log('!', `Could not update story status: ${e}`);
    }

    // Write build receipt
    writeBuildReceipt(ctx, summary, true);

    ctx.success = true;
    ctx.terminal = true;

    log('✓', `Story marked done: ${summary.slice(0, 100)}`);
    return { content: `Story marked done. ${summary}`, isError: false };
}

// ── mark_story_failed ────────────────────────────────────

function toolMarkStoryFailed(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): ToolResult {
    const reason = String(args.reason || 'Unknown failure');

    try {
        updateStoryStatus(ctx.storyFile, 'review');
        log('!', `Story status → review: ${ctx.storyFile}`);
    } catch { /* non-fatal */ }

    writeBuildReceipt(ctx, reason, false);

    ctx.success = false;
    ctx.terminal = true;
    ctx.logs.push({ level: 'error', message: reason });

    logError(`Story marked failed: ${reason.slice(0, 200)}`);
    return { content: `Story marked failed. Reason: ${reason}`, isError: false };
}

// ─── Helpers ─────────────────────────────────────────────

function writeBuildReceipt(ctx: OrchestratorContext, summary: string, success: boolean): void {
    const receiptDir = join(ctx.repoPath, '.factory', 'logs', success ? 'builds' : 'failures');
    mkdirSync(receiptDir, { recursive: true });

    const slug = ctx.storyFile
        .split('/')
        .pop()
        ?.replace(/\.ya?ml$/, '')
        ?.replace(/[^a-z0-9-]/gi, '-') || 'story';

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const receiptPath = join(receiptDir, `${slug}-${timestamp}.md`);

    const content = [
        `# ${success ? 'Build' : 'Failure'}: ${slug}`,
        '',
        `**Date**: ${new Date().toISOString()}`,
        `**Story**: ${ctx.storyFile}`,
        `**CLI**: ${ctx.cliName}`,
        `**Files**: ${ctx.files.length}`,
        '',
        `## ${success ? 'Summary' : 'Failure Reason'}`,
        summary,
        '',
        '## Files Written',
        ...ctx.files.slice(0, 50).map(f => `- ${f.filename}`),
        ctx.files.length > 50 ? `...and ${ctx.files.length - 50} more` : '',
    ].join('\n');

    writeFileSync(receiptPath, content);
    log('✓', `Build receipt: ${receiptDir}/${slug}-${timestamp}.md`);
}

function loadKnowledgeFiles(repoPath: string): Array<{ name: string; content: string }> {
    const knowledgeDir = join(repoPath, '.factory', 'knowledge');
    if (!existsSync(knowledgeDir)) return [];

    try {
        return readdirSync(knowledgeDir)
            .filter(f => f.endsWith('.md'))
            .sort()
            .map(f => ({
                name: f.replace(/\.md$/, ''),
                content: readFileSync(join(knowledgeDir, f), 'utf-8').slice(0, 3000),
            }));
    } catch {
        return [];
    }
}

function scanDirTree(dir: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    if (!existsSync(dir)) return files;

    const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.DS_Store']);

    function walk(absDir: string) {
        let entries;
        try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (SKIP.has(entry.name)) continue;
            const full = join(absDir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else {
                const rel = relative(dir, full);
                try {
                    const content = readFileSync(full, 'utf-8');
                    files.push({ filename: rel, content });
                } catch {
                    // Skip binary files
                }
            }
        }
    }
    walk(dir);
    return files;
}

function isAppStory(story: AppStory | FeatureStory): story is AppStory {
    return 'appName' in story;
}

// ─── LLM Integration ─────────────────────────────────────

/**
 * Resolve which provider to use for the orchestrator (the "thinking" LLM).
 * Must be an API provider — the orchestrator cannot be a CLI (circular).
 */
function resolveOrchestratorProvider(settings: FactorySettings): LLMProvider {
    // Prefer the active provider if it's API-based
    const active = settings.providers.find(p => p.id === settings.activeProvider && p.enabled);
    if (active && active.kind !== 'cli') return active;

    // Fallback: any enabled API provider
    const fallback = settings.providers.find(p => p.enabled && p.kind !== 'cli');
    if (fallback) {
        log('!', `Active provider is CLI-type; using ${fallback.name} for orchestrator`);
        return fallback;
    }

    throw new Error(
        'No API-based LLM provider configured for the orchestrator.\n' +
        'The orchestrator needs an API provider (Gemini, OpenAI, etc.).\n' +
        'Configure one in the Factory UI Settings.'
    );
}

function resolveModel(provider: LLMProvider, settings: FactorySettings): string {
    return settings.buildModel
        || provider.defaultModel
        || provider.models[0]?.id
        || 'gemini-2.5-flash';
}

interface OrchestratorLLMResponse {
    text: string;
    toolCalls: Array<{ id: string; name?: string; function?: { name: string; arguments: Record<string, unknown> }; arguments?: Record<string, unknown> }>;
    tokensIn: number;
    tokensOut: number;
}

async function callOrchestratorLLM(
    provider: LLMProvider,
    model: string,
    messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }>,
): Promise<OrchestratorLLMResponse> {
    // Import generate.ts's callProviderWithTools — it already handles Gemini/OpenAI/Ollama
    // We reuse the LLM call infrastructure, just with our own tool definitions
    const { callProviderWithTools } = await import('./generate.ts');

    // Convert our tool defs to the format callProviderWithTools expects
    const toolDefs = ORCHESTRATOR_TOOL_DEFINITIONS.map(t => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        },
    }));

    const response = await callProviderWithTools(provider, model, messages, toolDefs);

    // Normalize tool call format (Gemini vs OpenAI differ slightly)
    const toolCalls = (response.toolCalls || []).map((tc: any) => ({
        id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
        name: tc.function?.name || tc.name,
        function: tc.function || { name: tc.name, arguments: tc.arguments || {} },
        arguments: tc.function?.arguments || tc.arguments || {},
    }));

    return {
        text: response.text,
        toolCalls,
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
    };
}
