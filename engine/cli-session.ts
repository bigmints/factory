/**
 * cli-session.ts — CLI session spawner, monitor, and result parser.
 *
 * This is the one well-engineered piece of the engine: a clean,
 * self-contained module that spawns a CLI agent process, monitors its
 * health (stall, loop, rate-limit, interactive prompt), detects
 * delivery completion, captures conversation thread IDs, and returns
 * a structured result.
 *
 * No orchestrator logic, no LLM calls, no knowledge updates.
 * Pure CLI session management.
 *
 * Usage:
 *   import { runCliSession } from './cli-session.ts';
 *
 *   const result = await runCliSession({
 *       cliName: 'agy',
 *       prompt: 'Build the app...',
 *       cwd: '/path/to/target',
 *       repoPath: '/path/to/repo',
 *       storyFile: 'apps/my-app.yaml',
 *   });
 *
 *   if (result.status === 'delivered') { ... }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, createWriteStream } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { log } from './log.ts';
import { buildCliInvocation, buildSpawnEnv } from './cli-adapter.ts';
import { getActiveProvider } from './config.ts';
import type { GeneratedFile, PiSettings } from './types.ts';

// ─── Types ───────────────────────────────────────────────

export interface CliSessionResult {
    /** Outcome of the CLI session. */
    status: 'delivered' | 'failed' | 'intervention';
    /** Process exit code, or null if the process was killed / never exited cleanly. */
    exitCode: number | null;
    /** When status is 'intervention', the reason the session was killed. */
    interventionReason?: string; // STALL, LOOP, ASKING, RATE_LIMIT
    /** Last ~3 000 characters of combined stdout + stderr. */
    output: string;
    /** Agent's pure text output for summary generation */
    textOutput?: string;
    /** Captured conversation ID (agy-specific thread continuity). */
    threadId?: string;
    /** Files detected in the target directory after the session. */
    files: GeneratedFile[];
}

export interface CliSessionOptions {
    /** Which CLI binary to invoke (agy, gemini, pi, claude). */
    cliName: string;
    /** Complete prompt to pass to the CLI. */
    prompt: string;
    /** Working directory for the spawned CLI process. */
    cwd: string;
    /** Root of the Factory project (for log files, story files, queue). */
    repoPath: string;
    /** The story file being processed (e.g. apps/my-app.md). */
    storyFile: string;
    /** The model ID to use (e.g. openai/gpt-4o), overriding settings */
    model?: string;
    /** Optional thread ID for agy conversation continuity. */
    threadId?: string;
    /** Project-specific Pi configuration (thinking level, skills, etc.) */
    piConfig?: PiSettings;
}

// ─── Detection Constants ─────────────────────────────────

/** Kill after 10 minutes with zero output — agy/claude have 2-3 min silent planning phases. */
const STALL_TIMEOUT_MS = 10 * 60_000;

/** Bytes of trailing output compared each loop-check cycle. */
const LOOP_WINDOW_BYTES = 500;

/** How often to run the loop detector (ms). */
const LOOP_CHECK_MS = 15_000;

/** Maximum allowed tool calls per session to prevent infinite loops. */
const MAX_TOOL_CALLS = 150;

/** Maximum allowed buffer size (in bytes) to prevent infinite loops generating massive logs (5MB). */
const MAX_BUFFER_SIZE_BYTES = 5 * 1024 * 1024;

/** Patterns that indicate the CLI is waiting for interactive user input. */
const QUESTION_PATTERNS: RegExp[] = [
    /\?\s*$/m,                               // line ending in ?
    /\[y\/n\]/i,                              // [y/n] prompt
    /\(yes\/no\)/i,
    /press enter/i,
    /enter .{0,40}:/i,
    /provide .{0,40}:/i,
    /what (should|do you)/i,
    /please (specify|provide|enter|choose)/i,
];

/**
 * Patterns that indicate the CLI is rate-limited / quota-exhausted.
 * When seen RATE_LIMIT_REPEAT_THRESHOLD times in a row we kill immediately
 * rather than waiting the full STALL_TIMEOUT_MS.
 */
const RATE_LIMIT_PATTERNS: RegExp[] = [
    /exhausted your (capacity|quota)/i,
    /rate.?limit(ed)?/i,
    /quota.*(exceeded|exhausted|reset)/i,
    /too many requests/i,
    /429/,
    /retrying after \d+ms/i,              // gemini CLI retry noise
];

/** Kill after this many consecutive rate-limit hits. */
const RATE_LIMIT_REPEAT_THRESHOLD = 5;

/** Regex to extract agy Conversation ID from CLI output. */
const THREAD_ID_RE = /Conversation ID:\s*([a-f0-9-]+)/i;

// ─── Main Entry Point ────────────────────────────────────

/**
 * Spawn a CLI agent session, monitor it for health issues, and return a
 * structured result once the session completes (or is killed).
 *
 * The function resolves in one of three ways:
 *  1. "DELIVERY COMPLETE" appears in the output → immediate resolve as 'delivered',
 *     then the process group is killed after a 1 s grace period.
 *  2. A health monitor kills the process (stall, loop, rate-limit, question) →
 *     resolve as 'intervention' with the reason.
 *  3. The process exits on its own → resolve based on exit code:
 *     - 0 → 'delivered'
 *     - non-0 → 'failed'
 */
export function runCliSession(options: CliSessionOptions): Promise<CliSessionResult> {
    if (options.cliName === 'pi') {
        return runPiSessionViaSdk(options);
    }

    const { cliName, prompt, cwd, repoPath, storyFile, threadId } = options;

    // Ensure the target directory exists
    const resolvedCwd = resolve(cwd);
    if (!existsSync(resolvedCwd)) mkdirSync(resolvedCwd, { recursive: true });

    // Build the correct invocation for this CLI
    const invocation = buildCliInvocation(cliName, prompt, {
        conversationId: threadId,
    });

    log('→', `Running: ${cliName} in ${resolvedCwd}`);
    log('→', `Args: ${invocation.binary} ${invocation.args.slice(0, 3).join(' ')}${invocation.args.length > 3 ? ' …' : ''}`);
    log('→', `Prompt (${prompt.length} chars): ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);

    // ── Live log file (tail -f .factory/logs/cli-<slug>.log) ──────────
    const logsDir = join(repoPath, '.factory', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const storySlug = storyFile.split('/').pop()?.replace(/\.ya?ml$/, '') || 'build';
    const cliLogPath = join(logsDir, `cli-${storySlug}.log`);
    const logStream = createWriteStream(cliLogPath, { flags: 'a' });
    logStream.on('error', () => { /* ignore stream errors to prevent crash */ });
    logStream.write(
        `\n${'='.repeat(60)}\n[${new Date().toISOString()}] cli-session → ${cliName}\nCWD: ${resolvedCwd}\n${'='.repeat(60)}\n`,
    );
    log('→', `CLI log: tail -f ${cliLogPath}`);

    return new Promise<CliSessionResult>((promiseResolve) => {
        const child = spawn(invocation.binary, invocation.args, {
            cwd: resolvedCwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: buildSpawnEnv(),
            detached: true,
        });
        child.stdin?.end();

        // ── Mutable session state ────────────────────────
        let buffer = '';
        let lastActivityAt = Date.now();
        let interventionReason: string | null = null;
        let killed = false;
        let resolved = false;
        let rateLimitHits = 0;
        let deliveryDetected = false;
        let capturedThreadId: string | undefined = threadId;

        // ── Helper: resolve once and clean up ────────────
        function resolveOnce(result: CliSessionResult) {
            if (resolved) return;
            resolved = true;
            clearTimers();
            try {
                logStream.write(`\n[${new Date().toISOString()}] cli-session resolved: ${result.status}\n`);
                logStream.end();
            } catch { /* non-fatal */ }
            promiseResolve(result);
        }

        // ── Timer management ─────────────────────────────
        function clearTimers() {
            clearInterval(stallTimer);
            clearInterval(loopTimer);
        }

        // ── Kill helper: SIGKILL entire process group ────
        function killProcessGroup(reason: string) {
            if (killed) return;
            killed = true;
            interventionReason = reason;
            log('⚠', `CLI intervention: ${reason}`);
            const pid = child.pid;
            if (pid) {
                try {
                    process.kill(-pid, 'SIGKILL');
                } catch {
                    // Fall back to direct kill if process group kill fails
                    try { child.kill('SIGKILL'); } catch { /* already dead */ }
                }
            }
        }

        // ── Stall detector (10 min no output) ────────────
        const stallTimer = setInterval(() => {
            if (killed || deliveryDetected) return;
            const silentMs = Date.now() - lastActivityAt;
            if (silentMs >= STALL_TIMEOUT_MS) {
                killProcessGroup(`STALL: No output for ${Math.round(silentMs / 1000)}s`);
            }
        }, 10_000);

        // ── Loop detector (same tail 3× in a row) ───────
        let prevTail = '';
        let loopRepeatCount = 0;
        const loopTimer = setInterval(() => {
            if (killed || deliveryDetected) return;

            // Check for runaway buffer size
            if (buffer.length > MAX_BUFFER_SIZE_BYTES) {
                killProcessGroup(
                    `LOOP: Output exceeded maximum allowed size (5MB) — CLI is likely stuck in an infinite loop`,
                );
                return;
            }

            // Check for runaway tool calls
            const toolCallMatches = buffer.match(/\*\*🛠️ Tool Call:\*\*/g);
            if (toolCallMatches && toolCallMatches.length > MAX_TOOL_CALLS) {
                killProcessGroup(
                    `LOOP: Exceeded maximum allowed tool calls (${MAX_TOOL_CALLS}) — CLI is likely stuck in an infinite loop`,
                );
                return;
            }

            const tail = buffer.slice(-LOOP_WINDOW_BYTES);
            if (tail.length >= LOOP_WINDOW_BYTES && tail === prevTail) {
                loopRepeatCount++;
                if (loopRepeatCount >= 3) {
                    killProcessGroup(
                        `LOOP: Output unchanged for ${(LOOP_CHECK_MS * 3) / 1000}s — CLI is repeating itself`,
                    );
                }
            } else {
                loopRepeatCount = 0;
            }
            prevTail = tail;
        }, LOOP_CHECK_MS);

        // ── Data handler ─────────────────────────────────
        function onData(chunk: Buffer) {
            const text = chunk.toString();
            buffer += text;
            lastActivityAt = Date.now();

            // Stream to log file in real-time
            try {
                if (!logStream.writableEnded && !logStream.destroyed) logStream.write(text);
            } catch { /* non-fatal */ }

            // ── Extract Conversation ID (agy thread continuity) ──
            const threadMatch = text.match(THREAD_ID_RE);
            if (threadMatch?.[1]) {
                const newThreadId = threadMatch[1];
                if (capturedThreadId !== newThreadId) {
                    capturedThreadId = newThreadId;
                    log('→', `Captured agy conversation thread ID: ${newThreadId}`);
                    persistThreadId(repoPath, storyFile, newThreadId);
                }
            }

            if (killed) return;

            // ── DELIVERY COMPLETE fast-exit ──────────────────
            // Resolve the Promise immediately — do NOT wait for the process to
            // exit. agy/pi/claude may stay alive in interactive mode indefinitely.
            // After resolving, kill the entire process group so no orphan
            // workers linger.
            if (!deliveryDetected && buffer.includes('DELIVERY COMPLETE')) {
                deliveryDetected = true;
                clearTimers();
                const deliveryTail = buffer.slice(-3000);
                const fileTree = scanDirTree(resolvedCwd);
                log('✓', 'DELIVERY COMPLETE — resolving immediately and killing process group');
                resolveOnce({
                    status: 'delivered',
                    exitCode: null,
                    output: deliveryTail,
                    threadId: capturedThreadId,
                    files: fileTree,
                });
                // Kill the entire process group after a 1 s grace for final writes
                const pid = child.pid;
                if (pid) {
                    setTimeout(() => {
                        try {
                            process.kill(-pid, 'SIGKILL');
                        } catch {
                            try { child.kill('SIGKILL'); } catch { /* already dead */ }
                        }
                    }, 1_000);
                }
            }

            // ── Rate-limit / quota-exhausted fast kill ───────
            const isRateLimited = RATE_LIMIT_PATTERNS.some((p) => p.test(text));
            if (isRateLimited) {
                rateLimitHits++;
                if (rateLimitHits >= RATE_LIMIT_REPEAT_THRESHOLD) {
                    killProcessGroup(
                        `RATE_LIMIT: CLI is quota-exhausted (hit ${rateLimitHits}×). ` +
                        `Switch CLI with: factory worker default-cli <agy|pi|claude>`,
                    );
                }
            } else {
                rateLimitHits = 0;
            }

            // ── Question / blocking prompt detection ────────
            for (const pattern of QUESTION_PATTERNS) {
                if (pattern.test(text)) {
                    killProcessGroup(
                        `ASKING: CLI asked for input — "${text.trim().slice(0, 200)}"`,
                    );
                    break;
                }
            }
        }

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);

        // ── Process exit handler ─────────────────────────
        child.on('close', (code: number | null) => {
            if (resolved) return; // already resolved on DELIVERY COMPLETE
            clearTimers();
            try {
                logStream.write(`\n[${new Date().toISOString()}] CLI exited with code ${code}\n`);
                logStream.end();
            } catch { /* non-fatal */ }

            const tail = buffer.slice(-3000);
            const fileTree = scanDirTree(resolvedCwd);

            if (interventionReason) {
                resolveOnce({
                    status: 'intervention',
                    exitCode: code,
                    interventionReason,
                    output: tail,
                    threadId: capturedThreadId,
                    files: fileTree,
                });
                return;
            }

            log(code === 0 ? '✓' : '!', `CLI exited with code ${code}`);

            resolveOnce({
                status: code === 0 ? 'delivered' : 'failed',
                exitCode: code,
                output: tail,
                threadId: capturedThreadId,
                files: fileTree,
            });
        });

        // ── Spawn error handler ──────────────────────────
        child.on('error', (err: Error) => {
            clearTimers();
            resolveOnce({
                status: 'failed',
                exitCode: null,
                output: `CLI spawn error: ${err.message}`,
                threadId: capturedThreadId,
                files: [],
            });
        });
    });
}

// ─── Helpers ─────────────────────────────────────────────

/**
 * Persist a captured threadId to the story YAML file so that subsequent
 * sessions can resume the conversation.
 */
function persistThreadId(repoPath: string, storyFile: string, threadId: string): void {
    // Update story YAML
    try {
        const storyPath = join(repoPath, '.factory', 'stories', storyFile);
        if (existsSync(storyPath)) {
            const raw = readFileSync(storyPath, 'utf-8');
            const parsed = parseYaml(raw) as Record<string, unknown> | null;
            if (parsed && parsed.threadId !== threadId) {
                parsed.threadId = threadId;
                writeFileSync(storyPath, toYaml(parsed), 'utf-8');
            }
        }
    } catch {
        // Ignore write errors — non-critical
    }
}

/**
 * Walk a directory tree and return a flat list of GeneratedFile entries.
 * Skips common non-source directories (node_modules, .git, etc.).
 *
 * Only filenames are collected — content is left empty to avoid blocking
 * the event loop for repos with hundreds of files.
 */
export function scanDirTree(dir: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    if (!existsSync(dir)) return files;

    const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.DS_Store']);

    function walk(absDir: string) {
        let entries;
        try {
            entries = readdirSync(absDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (SKIP.has(entry.name)) continue;
            const full = join(absDir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else {
                const rel = relative(dir, full);
                files.push({ filename: rel, content: '' });
            }
        }
    }

    walk(dir);
    return files;
}

// ─── Native SDK Implementation ───────────────────────────

async function runPiSessionViaSdk(options: CliSessionOptions): Promise<CliSessionResult> {
    const { prompt, cwd, repoPath, storyFile } = options;
    const resolvedCwd = resolve(cwd);
    if (!existsSync(resolvedCwd)) mkdirSync(resolvedCwd, { recursive: true });

    log('→', `Running: pi (via SDK) in ${resolvedCwd}`);
    log('→', `Prompt (${prompt.length} chars): ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);

    const logsDir = join(repoPath, '.factory', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const storySlug = storyFile.split('/').pop()?.replace(/\.ya?ml$/, '') || 'build';
    const cliLogPath = join(logsDir, `cli-${storySlug}.log`);
    const logStream = createWriteStream(cliLogPath, { flags: 'a' });
    logStream.on('error', () => { /* ignore */ });
    logStream.write(
        `\n${'='.repeat(60)}\n[${new Date().toISOString()}] sdk-session → pi\nCWD: ${resolvedCwd}\n${'='.repeat(60)}\n`,
    );
    log('→', `SDK log: tail -f ${cliLogPath}`);

    let outputBuffer = '';
    let textBuffer = '';

    try {
        const { AuthStorage, createAgentSession, SessionManager, ModelRegistry } = await import('@earendil-works/pi-coding-agent');

        // Setup Auth using our existing config logic
        const authStorage = AuthStorage.create();
        const registry = ModelRegistry.create(authStorage);
        const provider = getActiveProvider();
        if (provider?.apiKey) {
            const kindStr = provider.kind as string;
            if (kindStr === 'openai-compat' || kindStr === 'openai') {
                authStorage.setRuntimeApiKey('openai', provider.apiKey);
                process.env.OPENAI_API_KEY = provider.apiKey;
                if (provider.baseUrl?.includes('openrouter') || provider.name?.toLowerCase().includes('openrouter')) {
                    process.env.OPENROUTER_API_KEY = provider.apiKey;
                }
            } else if (kindStr === 'anthropic') {
                authStorage.setRuntimeApiKey('anthropic', provider.apiKey);
            } else if (kindStr === 'google') {
                authStorage.setRuntimeApiKey('google', provider.apiKey);
            }
        }
        if (provider?.baseUrl) {
            process.env.OPENAI_BASE_URL = provider.baseUrl;
        }

        registry.refresh();
        let agentModel;
        
        // 1. If options.model is explicitly passed (e.g. from the story file), use that
        if (options.model) {
            const [providerName, modelId] = options.model.split('/');
            if (providerName && modelId) {
                agentModel = registry.find(providerName, modelId);
            }
        } 
        // 2. Otherwise, unify with TPM by defaulting to the global activeProvider model
        if (!agentModel && provider?.defaultModel) {
            agentModel = registry.find(provider.kind, provider.defaultModel);
        }

        const { session } = await createAgentSession({
            cwd: resolvedCwd,
            authStorage,
            modelRegistry: registry,
            model: agentModel,
            sessionManager: SessionManager.inMemory(),
            thinkingLevel: options.piConfig?.thinkingLevel || 'low',
        });

        session.subscribe((event) => {
            if (event.type === 'message_update') {
                const subEvent = event.assistantMessageEvent;
                if (subEvent.type === 'text_delta') {
                    outputBuffer += subEvent.delta;
                    textBuffer += subEvent.delta;
                    logStream.write(subEvent.delta);
                } else if (subEvent.type === 'thinking_start') {
                    const msg = `\n> _Thinking..._\n> `;
                    outputBuffer += msg;
                    logStream.write(msg);
                } else if (subEvent.type === 'thinking_delta') {
                    outputBuffer += subEvent.delta;
                    logStream.write(subEvent.delta);
                } else if (subEvent.type === 'thinking_end') {
                    logStream.write(`\n\n`);
                } else if (subEvent.type === 'toolcall_start') {
                    const tc = subEvent.partial.content[subEvent.contentIndex] as any;
                    const msg = `\n\n**🛠️ Tool Call:** \`${tc?.name || 'unknown'}\`\n\`\`\`json\n`;
                    outputBuffer += msg;
                    logStream.write(msg);
                } else if (subEvent.type === 'toolcall_delta') {
                    outputBuffer += subEvent.delta;
                    logStream.write(subEvent.delta);
                } else if (subEvent.type === 'toolcall_end') {
                    const msg = `\n\`\`\`\n\n`;
                    outputBuffer += msg;
                    logStream.write(msg);
                }
            } else if (event.type === 'tool_execution_end') {
                const resStr = event.result?.content?.[0]?.text || '';
                const lines = resStr.split('\n');
                const truncated = lines.length > 50 ? lines.slice(0, 50).join('\n') + `\n... (truncated ${lines.length - 50} lines)` : resStr;
                const msg = `**Result:**\n\`\`\`\n${truncated}\n\`\`\`\n\n`;
                outputBuffer += msg;
                logStream.write(msg);
            }
        });

        await session.prompt(prompt);

        logStream.write(`\n[${new Date().toISOString()}] SDK session complete\n`);
        logStream.end();
        log('✓', 'SDK DELIVERY COMPLETE');

        return {
            status: 'delivered',
            exitCode: 0,
            output: outputBuffer.slice(-3000),
            textOutput: textBuffer.trim(),
            files: scanDirTree(resolvedCwd),
        };
    } catch (err: any) {
        logStream.write(`\n[${new Date().toISOString()}] SDK session failed: ${err.message}\n`);
        logStream.end();
        log('!', `SDK session failed: ${err.message}`);
        
        return {
            status: 'failed',
            exitCode: 1,
            output: outputBuffer.slice(-3000) + `\nError: ${err.message}`,
            textOutput: textBuffer.trim(),
            files: scanDirTree(resolvedCwd),
        };
    }
}

