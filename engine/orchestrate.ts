/**
 * Orchestrate — TPM-driven story delivery.
 *
 * The orchestrator is a Technical Program Manager (TPM).
 * Its job: write a complete brief, delegate to the CLI engineer, monitor
 * the session for dysfunction, intervene if needed, and make the go/no-go call.
 *
 * The TPM does NOT write code, run tests, or inspect files.
 * Tools: delegate_to_cli, intervene, mark_story_done, mark_story_failed, update_context.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, createWriteStream } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { log, logError } from './log.ts';
import { writeHeartbeat } from './toon.ts';
import { updateStoryStatus } from './story.ts';
import { loadSettings } from './config.ts';
import { loadQueue, saveQueue } from './queue.ts';
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
    threadId?: string;
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
        try {
            execSync(`which ${bin}`, { stdio: 'ignore' });
            log('→', `Auto-detected CLI: ${bin}`);
            return bin;
        } catch { /* not found, try next */ }
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
    // --no-session:    skip loading/saving session (avoids corrupted settings stall)
    // --no-extensions: skip MCP adapter init which blocks stdout for 30-60s
    // --no-skills:     skip toon-context skill which reads ALL project files before responding
    //                  (183 files = 300s stall on local models)
    pi:     ['--no-session', '--no-extensions', '--no-skills'],
};

// ─── Orchestrator Loop ───────────────────────────────────

const MAX_TURNS = 12;              // max LLM turns before giving up
const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

// ─── CLI Health Monitor Thresholds ──────────────────────
const STALL_TIMEOUT_MS  = 5 * 60_000;   // 5 min — local models need time to think + write files
const LOOP_WINDOW_BYTES = 500;      // bytes to compare for loop detection
const LOOP_CHECK_MS     = 15_000;   // how often to run loop check
const QUESTION_PATTERNS: RegExp[] = [
    /\?\s*$/m,              // line ending in ?
    /\[y\/n\]/i,            // [y/n] prompt
    /\(yes\/no\)/i,
    /press enter/i,
    /enter .{0,40}:/i,
    /provide .{0,40}:/i,
    /what (should|do you)/i,
    /please (specify|provide|enter|choose)/i,
];

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
        threadId: (story as any).threadId,
    };

    mkdirSync(targetDir, { recursive: true });

    const systemPrompt = buildSystemPrompt(story, blueprint, targetDir, cliName);

    const messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: 'You are the TPM. Write your brief now and call delegate_to_cli. The brief must be comprehensive enough that the CLI engineer never needs to ask a question. Include the full story, stack, conventions, target directory, and a self-sufficiency instruction.',
        },
    ];

    const sessionStart = Date.now();
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    // TPM loop guards
    const recentTools: string[] = [];  // track last N tool calls to detect orchestrator-level loops
    let delegationCount = 0;           // how many times we've called delegate_to_cli or intervene
    let lastCliErrorSig = '';          // signature of last CLI error (to detect repeated failures)

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

            // Track delegation count
            if (toolName === 'delegate_to_cli' || toolName === 'intervene') {
                delegationCount++;
                if (delegationCount > 2) {
                    // TPM tried twice — force escalation
                    const msg = 'MANAGER OVERRIDE: You have delegated twice and the CLI has not succeeded. You must now call mark_story_failed with a clear reason. Do not delegate again.';
                    log('⚠', 'Max delegations reached — forcing escalation');
                    messages.push({ role: 'tool', content: msg, tool_call_id: tc.id });
                    messages.push({ role: 'user', content: msg });
                    ctx.logs.push({ level: 'error', message: msg });
                    continue;
                }
            }

            const result = await executeOrchestratorTool(toolName, args, ctx);

            // Duplicate error guard
            if ((toolName === 'delegate_to_cli' || toolName === 'intervene') && result.isError) {
                const sig = result.content.slice(0, 150);
                if (lastCliErrorSig && sig === lastCliErrorSig) {
                    const intervention = '⚠️ MANAGER ALERT: Same error returned twice. Changing the prompt will not help. Call mark_story_failed now.';
                    log('⚠', 'Duplicate CLI error — injecting escalation directive');
                    messages.push({ role: 'tool', content: result.content, tool_call_id: tc.id });
                    messages.push({ role: 'user', content: intervention });
                    ctx.logs.push({ level: 'error', message: intervention });
                    continue;
                }
                lastCliErrorSig = sig;
            }

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

            recentTools.push(toolName);
        }

        // Orchestrator-level loop guard: same tool called 3 turns in a row
        if (recentTools.length >= 3) {
            const last3 = recentTools.slice(-3);
            if (last3.every(t => t === last3[0]) && last3[0] !== 'mark_story_done' && last3[0] !== 'mark_story_failed') {
                const loopMsg = `⚠️ MANAGER ALERT: You have called '${last3[0]}' three turns in a row. This is a loop. You must now call mark_story_done or mark_story_failed immediately.`;
                log('⚠', `Orchestrator loop detected on tool: ${last3[0]}`);
                messages.push({ role: 'user', content: loopMsg });
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
    targetDir: string,
    cliName: string,
): string {
    const sections: string[] = [];

    // ── TPM Identity ──
    sections.push(`You are the Factory TPM — Technical Program Manager.

Your ONLY responsibility is delivery: ensure the story below is built correctly by the CLI engineer.

You do NOT write code. You do NOT run tests. You do NOT inspect files.
You write briefs, monitor delivery health, and make go/no-go calls.

## Your Tools
- **delegate_to_cli(prompt)** — Hand the story to the CLI engineer with a complete brief. The tool streams the session and returns a structured delivery report.
- **intervene(reason, new_instructions)** — The CLI got stuck or failed. Re-brief with corrected direction.
- **create_fix_task(issue, fix_instructions)** — When a story fails, create a targeted fix task and re-queue it with high priority. This is your primary recovery action — prefer this over mark_story_failed.
- **create_qa_task(scope, test_instructions)** — After an epic or feature set completes, queue a QA task to verify the app works end-to-end.
- **mark_story_done(summary)** — Delivery accepted. Called when the report shows success.
- **mark_story_failed(reason)** — Last resort only. Use create_fix_task first.
- **update_context(message)** — Log a note to the project worklog.

## Delivery Reports (what delegate_to_cli returns)
The tool monitors the CLI session and returns one of:
- \`DELIVERED\` — CLI completed successfully. Call mark_story_done.
- \`FAILED (exit N)\` — CLI exited with an error. Use create_fix_task to re-queue a targeted fix.
- \`INTERVENTION [STALL]\` — CLI stopped producing output for 2+ minutes. It is stuck.
- \`INTERVENTION [LOOP]\` — CLI is repeating the same output. It is looping.
- \`INTERVENTION [ASKING]\` — CLI asked a question and is blocked waiting for input.

## Rules
1. **Turn 1 is always delegate_to_cli.** Never start with anything else.
2. **Maximum 2 delegations per story.** After 2 failed delegations, call create_fix_task.
3. **If report shows DELIVERED, call mark_story_done immediately.** Do not second-guess.
4. **If report shows FAILED, call create_fix_task with the specific issue and corrected instructions.** This re-queues the story so it will be retried automatically.
5. **After completing a group of related features (an epic), call create_qa_task** to verify the app runs and the features work.
6. **mark_story_failed is last resort.** Only call it if the story is fundamentally broken and no fix is possible without human input.
7. **Never ask for help.** Make a decision and act.`);

    // ── Target Directory ──
    sections.push(`## Target Directory
\`${targetDir}\`
The CLI engineer's working directory. All work happens here.`);

    // ── Configured CLI ──
    sections.push(`## CLI Engineer: ${cliName}
This is the user's configured CLI agent. It has full filesystem access and handles everything: scaffolding, coding, npm install, type errors, lint errors, build verification.`);

    // ── Story ──
    const storyBlock = isAppStory(story)
        ? `appName: ${story.appName}\ndescription: ${story.description}\nstack: ${JSON.stringify(story.stack)}\n${toYaml(story)}`
        : toYaml(story);
    sections.push(`## Story to Deliver\n\`\`\`yaml\n${storyBlock}\n\`\`\``);

    // ── Project Context (TOON state) ──
    if (blueprint.toonSnapshot) {
        sections.push(`## Project State\n${blueprint.toonSnapshot}`);
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

    // ── Brief Template ──
    const stackStr = isAppStory(story) ? JSON.stringify((story as AppStory).stack, null, 2) : 'see story';
    sections.push(`## What Your Brief Must Include

When you call delegate_to_cli, your prompt must contain ALL of the following:

1. **Story acceptance criteria** (copy them verbatim from the story above)
2. **Stack**: ${stackStr}
3. **Target directory**: \`${targetDir}\`
4. **Conventions**: summarise the key rules from the Conventions section above
5. **Self-sufficiency instruction**: 
   > "Complete the full implementation without asking questions. Run npm install, fix any TypeScript or lint errors, verify the build passes. When done, print DELIVERY COMPLETE and a summary of what was built."
6. **What NOT to do** (from knowledgebase — e.g. no Tailwind, specific patterns to avoid)`);

    if ((story as any).btw && Array.isArray((story as any).btw) && (story as any).btw.length > 0) {
        sections.push(`## PRIORITIZED ADDITIONAL DETAILS (By the Way)
The user has added these urgent, high-priority instructions/constraints. You MUST prioritize these above all else, inject them into your brief, and ensure the CLI engineer implements them perfectly:
${(story as any).btw.map((b: string) => `- ${b}`).join('\n')}`);
    }

    return sections.join('\n\n');
}

// ─── Tool Definitions ────────────────────────────────────

export const ORCHESTRATOR_TOOL_DEFINITIONS = [
    {
        name: 'delegate_to_cli',
        description: 'Hand the story brief to the CLI engineer. The tool streams the session and monitors for stalls, loops, and questions. Returns a structured delivery report: DELIVERED, FAILED, or INTERVENTION [STALL|LOOP|ASKING]. You write the brief; the CLI does everything else.',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'Complete self-contained brief for the CLI engineer. Must include: acceptance criteria, stack, target directory, conventions, and a self-sufficiency instruction (do not ask questions, complete everything, verify the build).'
                },
            },
            required: ['prompt'],
        },
    },
    {
        name: 'intervene',
        description: 'Re-brief the CLI engineer after a failed or stuck delivery. Use when delegate_to_cli returned FAILED or INTERVENTION. Maximum 1 intervention per story.',
        parameters: {
            type: 'object',
            properties: {
                reason: {
                    type: 'string',
                    description: 'What went wrong in the previous attempt (STALL, LOOP, ASKING, FAILED). Be specific.'
                },
                new_instructions: {
                    type: 'string',
                    description: 'Revised brief for the CLI engineer. Must address the specific failure. If ASKING, embed the answer. If LOOP, tell it what to stop doing and what to do instead. If STALL, try a different approach.'
                },
            },
            required: ['reason', 'new_instructions'],
        },
    },
    {
        name: 'update_context',
        description: 'Log a note to the project worklog. Use to record key delivery decisions.',
        parameters: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'What happened or was decided.' },
            },
            required: ['message'],
        },
    },
    {
        name: 'mark_story_done',
        description: 'Confirm delivery. Call when the delivery report shows DELIVERED. Updates story status to done and writes a build receipt.',
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'What was delivered. Copied to the build receipt.' },
            },
            required: ['summary'],
        },
    },
    {
        name: 'mark_story_failed',
        description: 'Last resort escalation. Call ONLY when no fix is possible without human intervention. Prefer create_fix_task for recoverable failures.',
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Why delivery cannot proceed and what a human needs to fix.' },
            },
            required: ['reason'],
        },
    },
    {
        name: 'create_fix_task',
        description: 'When a story fails, create a targeted fix story and re-queue it automatically. Use this instead of mark_story_failed for recoverable errors. The fix story gets high priority and runs next.',
        parameters: {
            type: 'object',
            properties: {
                issue: { type: 'string', description: 'Concise description of what failed and why.' },
                fix_instructions: { type: 'string', description: 'Detailed instructions for the CLI to fix the issue. Be specific about what to change, which files, and what the correct output should look like.' },
            },
            required: ['issue', 'fix_instructions'],
        },
    },
    {
        name: 'create_qa_task',
        description: 'After completing an epic or a set of related features, create a QA task to verify the app runs and features work. Queued at phase 99 so it runs after all features.',
        parameters: {
            type: 'object',
            properties: {
                scope: { type: 'string', description: 'What to test (e.g. "Auth & App Shell epic", "login screen and navigation").' },
                test_instructions: { type: 'string', description: 'Step-by-step instructions: what to run, what to check, what success looks like.' },
            },
            required: ['scope', 'test_instructions'],
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
            case 'delegate_to_cli':  return toolDelegateToCli(args, ctx);
            case 'intervene':        return toolIntervene(args, ctx);
            case 'create_fix_task':  return toolCreateFixTask(args, ctx);
            case 'create_qa_task':   return toolCreateQaTask(args, ctx);
            case 'update_context':   return toolUpdateContext(args, ctx);
            case 'mark_story_done':  return toolMarkStoryDone(args, ctx);
            case 'mark_story_failed':return toolMarkStoryFailed(args, ctx);
            // Legacy tool names — redirect gracefully
            case 'read_output':      return { content: 'read_output is not available. Call mark_story_done if DELIVERED, or create_fix_task if failed.', isError: true };
            case 'run_check':        return { content: 'run_check is not available. You are the TPM — read the delivery report and call create_fix_task or mark_story_done.', isError: true };
            case 'update_knowledge': return toolUpdateKnowledge(args, ctx);
            default:
                return { content: `Unknown tool: ${name}. Available: delegate_to_cli, intervene, create_fix_task, create_qa_task, mark_story_done, mark_story_failed, update_context.`, isError: true };
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Tool ${name} threw: ${msg}`, isError: true };
    }
}

// ── delegate_to_cli ──────────────────────────────────────
// Streams the CLI session. Monitors for stalls, loops, and questions.
// Returns a structured delivery report to the TPM.

async function toolDelegateToCli(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): Promise<ToolResult> {
    const prompt = String(args.prompt || '');
    if (!prompt) return { content: 'prompt is required', isError: true };

    const cwd = String(args.cwd || ctx.targetDir);
    const resolvedCwd = resolve(cwd);
    if (!existsSync(resolvedCwd)) mkdirSync(resolvedCwd, { recursive: true });

    const yoloFlags = CLI_YOLO_FLAGS[ctx.cliName] || [];
    const cliArgs = ['-p', prompt, ...yoloFlags];
    if (ctx.cliName === 'agy' && ctx.threadId) {
        cliArgs.push('--conversation', ctx.threadId);
    }

    log('→', `Running: ${ctx.cliName} in ${resolvedCwd}`);
    log('→', `Prompt (${prompt.length} chars): ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);

    // ── Live log file (tail -f .factory/logs/cli-<slug>.log) ──────────
    const logsDir = join(ctx.repoPath, '.factory', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const storySlug = ctx.storyFile.split('/').pop()?.replace(/\.ya?ml$/, '') || 'build';
    const cliLogPath = join(logsDir, `cli-${storySlug}.log`);
    const logStream = createWriteStream(cliLogPath, { flags: 'a' });
    logStream.write(`\n${'='.repeat(60)}\n[${new Date().toISOString()}] delegate_to_cli → ${ctx.cliName}\nCWD: ${resolvedCwd}\n${'='.repeat(60)}\n`);
    log('→', `CLI log: tail -f ${cliLogPath}`);

    return new Promise<ToolResult>((resolve: (r: ToolResult) => void) => {
        const child = spawn(ctx.cliName, cliArgs, {
            cwd: resolvedCwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                // Ensure nvm-installed CLIs (pi, claude) and locally installed CLIs
                // (gemini at ~/.local/bin) are on PATH when Node.js spawns the child process.
                PATH: [
                    `/home/${process.env.USER || 'bigmints'}/.local/bin`,
                    `/home/${process.env.USER || 'bigmints'}/.nvm/versions/node/v22.22.2/bin`,
                    `/home/${process.env.USER || 'bigmints'}/.nvm/versions/node/v20.20.2/bin`,
                    `/usr/local/bin`,
                    process.env.PATH || '',
                ].join(':'),
            },
        });

        let buffer = '';
        let lastActivityAt = Date.now();
        let interventionReason: string | null = null;
        let killed = false;

        // ── kill helper ────────────────────────────
        function killChild(reason: string) {
            if (killed) return;
            killed = true;
            interventionReason = reason;
            log('⚠', `CLI intervention: ${reason}`);
            child.kill('SIGTERM');
            setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
        }

        // ── stall detector ─────────────────────────
        const stallTimer = setInterval(() => {
            if (killed) return;
            const silentMs = Date.now() - lastActivityAt;
            if (silentMs >= STALL_TIMEOUT_MS) {
                killChild(`STALL: No output for ${Math.round(silentMs / 1000)}s`);
            }
        }, 10_000);

        // ── loop detector ──────────────────────────
        let prevTail = '';
        let loopRepeatCount = 0;
        const loopTimer = setInterval(() => {
            if (killed) return;
            const tail = buffer.slice(-LOOP_WINDOW_BYTES);
            if (tail.length >= LOOP_WINDOW_BYTES && tail === prevTail) {
                loopRepeatCount++;
                if (loopRepeatCount >= 3) {
                    killChild(`LOOP: Output unchanged for ${LOOP_CHECK_MS * 3 / 1000}s — CLI is repeating itself`);
                }
            } else {
                loopRepeatCount = 0;
            }
            prevTail = tail;
        }, LOOP_CHECK_MS);

        // ── data handler (questions & thread ID detected here) ──
        function onData(chunk: Buffer) {
            const text = chunk.toString();
            buffer += text;
            lastActivityAt = Date.now();
            // Stream to log file in real-time
            try { logStream.write(text); } catch { /* non-fatal */ }

            // Extract Conversation ID from agy CLI output
            const match = text.match(/Conversation ID:\s*([a-f0-9-]+)/i);
            if (match && match[1]) {
                const threadId = match[1];
                if (ctx.threadId !== threadId) {
                    ctx.threadId = threadId;
                    log('→', `Captured agy conversation thread ID: ${threadId}`);
                    
                    // Write/update the threadId in the story file in-place!
                    try {
                        const storyPath = join(ctx.repoPath, '.factory', 'stories', ctx.storyFile);
                        if (existsSync(storyPath)) {
                            const raw = readFileSync(storyPath, 'utf-8');
                            const parsed = parseYaml(raw) as any;
                            if (parsed && parsed.threadId !== threadId) {
                                parsed.threadId = threadId;
                                writeFileSync(storyPath, toYaml(parsed), 'utf-8');
                            }
                        }
                    } catch (e) {
                        // Ignore write errors
                    }

                    // Also update the queue item in-place if it is in the queue!
                    try {
                        const queue = loadQueue();
                        const item = queue.find((q: any) => q.storyFile === ctx.storyFile && ['pending', 'running'].includes(q.status));
                        if (item && item.threadId !== threadId) {
                            item.threadId = threadId;
                            saveQueue(queue);
                        }
                    } catch {
                        // Ignore queue update errors
                    }
                }
            }

            if (!killed) {
                for (const pattern of QUESTION_PATTERNS) {
                    if (pattern.test(text)) {
                        killChild(`ASKING: CLI asked for input — "${text.trim().slice(0, 200)}"`);
                        break;
                    }
                }
            }
        }

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);

        child.on('close', (code: number | null) => {
            clearInterval(stallTimer);
            clearInterval(loopTimer);
            try { logStream.write(`\n[${new Date().toISOString()}] CLI exited with code ${code}\n`); logStream.end(); } catch { /* non-fatal */ }

            const tail = buffer.slice(-3000);
            const fileTree = scanDirTree(resolvedCwd);
            ctx.files = fileTree;
            const fileCount = fileTree.length;
            const fileSummary = fileCount > 0
                ? `\n\nFiles in target directory: ${fileCount}\n${fileTree.slice(0, 30).map(f => `  ${f.filename}`).join('\n')}${fileCount > 30 ? `\n  ... and ${fileCount - 30} more` : ''}`
                : '\n\nNo files detected in target directory.';

            if (interventionReason) {
                resolve({
                    content: `INTERVENTION [${interventionReason}]\n\nLast output from CLI:\n${tail}${fileSummary}`,
                    isError: true,
                });
                return;
            }

            log(code === 0 ? '✓' : '!', `CLI exited with code ${code}`);

            resolve({
                content: code === 0
                    ? `DELIVERED\n\n${tail}${fileSummary}`
                    : `FAILED (exit ${code})\n\n${tail}${fileSummary}`,
                isError: code !== 0,
            });
        });

        child.on('error', (err: Error) => {
            clearInterval(stallTimer);
            clearInterval(loopTimer);
            resolve({ content: `CLI spawn error: ${err.message}`, isError: true });
        });
    });
}

// ── intervene ────────────────────────────────────────────
// Re-brief the CLI with corrected instructions after a failed delivery.

async function toolIntervene(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): Promise<ToolResult> {
    const reason = String(args.reason || 'unknown');
    const newInstructions = String(args.new_instructions || '');
    if (!newInstructions) return { content: 'new_instructions is required', isError: true };

    log('⚠', `TPM intervening: ${reason.slice(0, 100)}`);

    const revisedPrompt = `PREVIOUS ATTEMPT FAILED.\nReason: ${reason}\n\nRevised instructions:\n${newInstructions}`;
    return toolDelegateToCli({ prompt: revisedPrompt, cwd: args.cwd }, ctx);
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

    // Auto-create a fix task so humans can see what broke and re-queue
    try {
        const fixPath = createFixStoryFile(ctx, reason, '');
        if (fixPath) log('→', `Fix story created: ${fixPath}`);
    } catch (e) {
        log('!', `Could not auto-create fix story: ${e}`);
    }

    ctx.success = false;
    ctx.terminal = true;
    ctx.logs.push({ level: 'error', message: reason });

    logError(`Story marked failed: ${reason.slice(0, 200)}`);
    return { content: `Story marked failed. Reason: ${reason}\n\nA fix story has been written to .factory/stories/features/ for review.`, isError: false };
}

// ── create_fix_task ──────────────────────────────────────
// TPM's recovery tool: creates a targeted fix story and re-queues it.

async function toolCreateFixTask(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): Promise<ToolResult> {
    const issue = String(args.issue || 'Unknown issue');
    const fixInstructions = String(args.fix_instructions || '');
    if (!fixInstructions) return { content: 'fix_instructions is required', isError: true };

    log('→', `TPM creating fix task: ${issue.slice(0, 80)}`);

    const fixPath = createFixStoryFile(ctx, issue, fixInstructions);
    if (!fixPath) return { content: 'Failed to write fix story file', isError: true };

    // Re-enqueue the original story with the fix brief injected into its YAML
    try {
        const { enqueue } = await import('./queue.ts');
        const slug = ctx.storyFile.split('/').pop()?.replace(/\.ya?ml$/, '') || 'fix';
        const fixStoryFile = `features/fix-${slug}.yaml`;
        enqueue(fixStoryFile, 'FeatureStory', { phase: 0, dependsOn: [], engine: 'factory' });
        log('✓', `Fix story enqueued with high priority: ${fixStoryFile}`);
    } catch (e) {
        log('!', `Could not enqueue fix story: ${e}`);
    }

    ctx.success = false;
    ctx.terminal = true;

    return {
        content: `Fix task created and queued.\n\nIssue: ${issue}\nFix story: ${fixPath}\n\nThe story will be retried automatically when the queue runs.`,
        isError: false,
    };
}

// ── create_qa_task ───────────────────────────────────────
// TPM creates a QA verification task after features complete.

async function toolCreateQaTask(
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): Promise<ToolResult> {
    const scope = String(args.scope || 'recent features');
    const testInstructions = String(args.test_instructions || '');
    if (!testInstructions) return { content: 'test_instructions is required', isError: true };

    log('→', `TPM creating QA task for: ${scope.slice(0, 80)}`);

    const storiesDir = join(ctx.repoPath, '.factory', 'stories', 'features');
    mkdirSync(storiesDir, { recursive: true });

    const slug = `qa-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${Date.now()}`;
    const qaPath = join(storiesDir, `${slug}.yaml`);

    const qaStory = {
        name: `QA: Verify ${scope}`,
        description: `Quality assurance task to verify that ${scope} works correctly end-to-end.`,
        status: 'ready',
        feature: { name: 'QA & Testing', slug: 'qa-testing' },
        target: { app: ctx.repoPath.split('/').pop() || 'app' },
        acceptance_criteria: [
            'App starts without errors (npm run dev)',
            'No TypeScript errors (npx tsc --noEmit)',
            'All acceptance criteria for the tested features pass',
        ],
        qa_scope: scope,
        test_instructions: testInstructions,
        phase: 99,  // QA always runs last
        dependsOn: [],
        createdBy: 'factory-tpm',
        createdAt: new Date().toISOString(),
    };

    writeFileSync(qaPath, toYaml(qaStory));

    // Enqueue with lowest priority so it runs after all features
    try {
        const { enqueue } = await import('./queue.ts');
        enqueue(`features/${slug}.yaml`, 'FeatureStory', { phase: 99, dependsOn: [], engine: 'factory' });
        log('✓', `QA task queued: features/${slug}.yaml`);
    } catch (e) {
        log('!', `Could not enqueue QA task: ${e}`);
    }

    return {
        content: `QA task created and queued (phase 99 — runs after all features).\n\nScope: ${scope}\nFile: ${qaPath}`,
        isError: false,
    };
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

/** Write a fix story YAML into .factory/stories/features/ for re-queuing. */
function createFixStoryFile(ctx: OrchestratorContext, issue: string, fixInstructions: string): string | null {
    try {
        const slug = ctx.storyFile.split('/').pop()?.replace(/\.ya?ml$/, '') || 'story';
        const fixSlug = `fix-${slug}`;
        const storiesDir = join(ctx.repoPath, '.factory', 'stories', 'features');
        mkdirSync(storiesDir, { recursive: true });
        const fixPath = join(storiesDir, `${fixSlug}.yaml`);

        // Load original story for context
        let originalStory: any = {};
        try {
            const originalPath = join(ctx.repoPath, '.factory', 'stories', ctx.storyFile);
            if (existsSync(originalPath)) {
                originalStory = parseYaml(readFileSync(originalPath, 'utf-8')) || {};
            }
        } catch { /* use empty */ }

        const fixStory = {
            name: `Fix: ${originalStory.name || slug}`,
            description: `Automated fix task created by Factory TPM.\n\nOriginal story: ${ctx.storyFile}\nIssue: ${issue}`,
            status: 'ready',
            feature: originalStory.feature || { name: 'Fix', slug: 'fix' },
            target: originalStory.target || {},
            stack: originalStory.stack || {},
            acceptance_criteria: originalStory.acceptance_criteria || [],
            fix_instructions: fixInstructions || issue,
            original_story: ctx.storyFile,
            phase: 0,
            dependsOn: [],
            createdBy: 'factory-tpm',
            createdAt: new Date().toISOString(),
        };

        writeFileSync(fixPath, toYaml(fixStory));
        log('✓', `Fix story written: ${fixPath}`);
        return `features/${fixSlug}.yaml`;
    } catch (e) {
        logError(`createFixStoryFile failed: ${e}`);
        return null;
    }
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
