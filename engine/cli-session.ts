/**
 * cli-session.ts — execution session boundary and result parser.
 *
 * This is the one well-engineered piece of the engine: a clean,
 * self-contained module that spawns a CLI agent process, monitors its
 * health (stall, loop, rate-limit, interactive prompt), detects
 * delivery completion, captures conversation thread IDs, and returns
 * a structured result.
 *
 * No orchestrator logic, no LLM calls, no knowledge updates.
 * Pi runs through the SDK worker. Other executors use CLI spawning.
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

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, createWriteStream, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { log } from './log.ts';
import { buildCliInvocation, buildSpawnEnv } from './cli-adapter.ts';
import { getActiveProvider, loadSettings } from './config.ts';
import type { DeliveryVerification, GeneratedFile, LLMProvider, PiSettings } from './types.ts';

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
    /** Which executor to invoke. `pi` runs the Pi CLI with its normal capabilities. */
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
    /** Explicit local provider for Pi SDK. Never inferred from the TPM provider. */
    providerId?: string;
    /** Optional thread ID for agy conversation continuity. */
    threadId?: string;
    /** Project-specific Pi configuration (thinking level, skills, etc.) */
    piConfig?: PiSettings;
    limits?: {
        maxRuntimeMinutes?: number;
        maxToolCalls?: number;
    };
}

export interface PiVerificationOptions {
    prompt: string;
    cwd: string;
    repoPath: string;
    storyFile: string;
    model?: string;
    providerId?: string;
    piConfig?: PiSettings;
    productFilesChanged: boolean;
}

export type PiVerificationResult = DeliveryVerification & {
    output: string;
    textOutput?: string;
};

// ─── Detection Constants ─────────────────────────────────

/** Kill after 10 minutes with zero output — agy/claude have 2-3 min silent planning phases. */
const STALL_TIMEOUT_MS = 10 * 60_000;

/** Bytes of trailing output compared each loop-check cycle. */
const LOOP_WINDOW_BYTES = 500;

/** How often to run the loop detector (ms). */
const LOOP_CHECK_MS = 15_000;

/** Maximum allowed tool calls per session to prevent infinite loops. */
const MAX_TOOL_CALLS = 150;

/** Maximum Pi SDK turns when the agent stops without a delivery marker. */
const MAX_PI_CONTINUATION_TURNS = 3;

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
    const { cliName, prompt, cwd, repoPath, storyFile, threadId } = options;
    if (cliName === 'pi') {
        return _runPiSessionViaWorker(options);
    }

    // Ensure the target directory exists
    const resolvedCwd = resolve(cwd);
    if (!existsSync(resolvedCwd)) mkdirSync(resolvedCwd, { recursive: true });

    // Build the correct invocation for this CLI
    const invocation = buildCliInvocation(cliName, prompt, {
        conversationId: threadId,
        model: options.model,
    });

    log('→', `Running: ${cliName} in ${resolvedCwd}`);
    log('→', `Args: ${invocation.binary} ${invocation.args.slice(0, 3).join(' ')}${invocation.args.length > 3 ? ' …' : ''}`);
    log('→', `Prompt (${prompt.length} chars): ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);

    // ── Live log file (tail -f .factory/logs/cli-<slug>.log) ──────────
    const logsDir = join(repoPath, '.factory', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const storySlug = storyFile.split('/').pop()?.replace(/\.(?:md|ya?ml)$/, '') || 'build';
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
        let lastChangedFilesSignature = changedFilesSignature(resolvedCwd);

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
            const currentChangedFilesSignature = changedFilesSignature(resolvedCwd);
            if (currentChangedFilesSignature !== lastChangedFilesSignature) {
                lastChangedFilesSignature = currentChangedFilesSignature;
                lastActivityAt = Date.now();
                try {
                    logStream.write(`\n[${new Date().toISOString()}] file changes detected\n`);
                } catch { /* ignore */ }
            }
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
                const fileTree = scanChangedFiles(resolvedCwd);
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
            const fileTree = scanChangedFiles(resolvedCwd);

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

function _runPiSessionViaWorker(options: CliSessionOptions): Promise<CliSessionResult> {
    const resolvedCwd = resolve(options.cwd);
    if (!existsSync(resolvedCwd)) mkdirSync(resolvedCwd, { recursive: true });

    const logsDir = join(options.repoPath, '.factory', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const storySlug = options.storyFile.split('/').pop()?.replace(/\.(?:md|ya?ml)$/, '') || 'build';
    const cliLogPath = join(logsDir, `cli-${storySlug}.log`);
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const inputPath = join(logsDir, `pi-worker-${storySlug}-${nonce}.input.json`);
    const resultPath = join(logsDir, `pi-worker-${storySlug}-${nonce}.result.json`);
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'pi-sdk-worker.ts');
    const factoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

    writeFileSync(inputPath, JSON.stringify({ options, resultPath }), 'utf-8');

    log('→', `Running: pi (SDK worker) in ${resolvedCwd}`);
    log('→', `SDK log: tail -f ${cliLogPath}`);

    return new Promise<CliSessionResult>((promiseResolve) => {
        const child = spawn('npx', ['tsx', workerPath, inputPath], {
            cwd: factoryRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: buildSpawnEnv(),
            detached: true,
        });

        let buffer = '';
        let resolved = false;
        let interventionReason: string | undefined;
        let lastLogActivityAt = Date.now();
        let lastLogSize = -1;

        const resolveOnce = (result: CliSessionResult) => {
            if (resolved) return;
            resolved = true;
            clearInterval(logWatchdog);
            promiseResolve(result);
        };

        const killWorker = (reason: string) => {
            if (interventionReason) return;
            interventionReason = reason;
            log('⚠', `Pi SDK worker intervention: ${reason}`);
            if (child.pid) {
                try {
                    process.kill(-child.pid, 'SIGKILL');
                } catch {
                    try { child.kill('SIGKILL'); } catch { /* already dead */ }
                }
            }
            spawnSync('pkill', ['-f', inputPath], { stdio: 'ignore' });
        };

        const logWatchdog = setInterval(() => {
            try {
                const stat = statSync(cliLogPath);
                if (stat.size !== lastLogSize) {
                    lastLogSize = stat.size;
                    lastLogActivityAt = Date.now();
                }
            } catch {
                // The SDK log may not exist during early startup.
            }

            const silentMs = Date.now() - lastLogActivityAt;
            if (silentMs > 90_000) {
                killWorker(`SDK_WORKER_STALL: no SDK log progress for ${Math.round(silentMs / 1000)}s`);
            }
        }, 10_000);

        const onData = (chunk: Buffer) => {
            buffer += chunk.toString();
            if (buffer.length > MAX_BUFFER_SIZE_BYTES) {
                buffer = buffer.slice(-MAX_BUFFER_SIZE_BYTES);
            }
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);

        child.on('close', (code: number | null) => {
            if (resolved) return;
            clearInterval(logWatchdog);

            if (existsSync(resultPath)) {
                try {
                    const parsed = JSON.parse(readFileSync(resultPath, 'utf-8')) as CliSessionResult;
                    resolveOnce(parsed);
                    return;
                } catch (err: any) {
                    resolveOnce({
                        status: 'failed',
                        exitCode: code,
                        output: `Could not parse Pi SDK worker result: ${err.message}\n${buffer.slice(-3000)}`,
                        files: scanChangedFiles(resolvedCwd),
                    });
                    return;
                }
            }

            resolveOnce({
                status: interventionReason ? 'intervention' : 'failed',
                exitCode: code,
                interventionReason,
                output: `${interventionReason || 'Pi SDK worker exited without result'}\n${buffer.slice(-3000)}`,
                files: scanChangedFiles(resolvedCwd),
            });
        });

        child.on('error', (err: Error) => {
            resolveOnce({
                status: 'failed',
                exitCode: null,
                output: `Pi SDK worker spawn error: ${err.message}`,
                files: scanChangedFiles(resolvedCwd),
            });
        });
    });
}

export function runPiVerificationViaWorker(options: PiVerificationOptions): Promise<PiVerificationResult> {
    const resolvedCwd = resolve(options.cwd);
    if (!existsSync(resolvedCwd)) mkdirSync(resolvedCwd, { recursive: true });

    const logsDir = join(options.repoPath, '.factory', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const storySlug = options.storyFile.split('/').pop()?.replace(/\.(?:md|ya?ml)$/, '') || 'build';
    const verifyLogPath = join(logsDir, `verify-${storySlug}.log`);
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const inputPath = join(logsDir, `pi-verifier-${storySlug}-${nonce}.input.json`);
    const resultPath = join(logsDir, `pi-verifier-${storySlug}-${nonce}.result.json`);
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'pi-sdk-worker.ts');
    const factoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

    writeFileSync(inputPath, JSON.stringify({ mode: 'verify', verificationOptions: options, resultPath }), 'utf-8');

    log('→', `Running: pi verifier (SDK worker) in ${resolvedCwd}`);
    log('→', `Verifier log: tail -f ${verifyLogPath}`);

    return new Promise<PiVerificationResult>((promiseResolve) => {
        const child = spawn('npx', ['tsx', workerPath, inputPath], {
            cwd: factoryRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: buildSpawnEnv(),
            detached: true,
        });

        let buffer = '';
        let resolved = false;
        let interventionReason: string | undefined;
        let lastLogActivityAt = Date.now();
        let lastLogSize = -1;

        const fallback = (summary: string): PiVerificationResult => ({
            status: 'review',
            summary,
            evidence: [],
            missing: [summary],
            productFilesChanged: options.productFilesChanged,
            userReachable: false,
            output: buffer.slice(-3000),
        });

        const resolveOnce = (result: PiVerificationResult) => {
            if (resolved) return;
            resolved = true;
            clearInterval(logWatchdog);
            promiseResolve(result);
        };

        const killWorker = (reason: string) => {
            if (interventionReason) return;
            interventionReason = reason;
            log('⚠', `Pi verifier intervention: ${reason}`);
            if (child.pid) {
                try {
                    process.kill(-child.pid, 'SIGKILL');
                } catch {
                    try { child.kill('SIGKILL'); } catch { /* already dead */ }
                }
            }
            spawnSync('pkill', ['-f', inputPath], { stdio: 'ignore' });
        };

        const logWatchdog = setInterval(() => {
            try {
                const stat = statSync(verifyLogPath);
                if (stat.size !== lastLogSize) {
                    lastLogSize = stat.size;
                    lastLogActivityAt = Date.now();
                }
            } catch { /* verifier log may not exist yet */ }

            const silentMs = Date.now() - lastLogActivityAt;
            if (silentMs > 90_000) {
                killWorker(`SDK_VERIFIER_STALL: no verifier log progress for ${Math.round(silentMs / 1000)}s`);
            }
        }, 10_000);

        const onData = (chunk: Buffer) => {
            buffer += chunk.toString();
            if (buffer.length > MAX_BUFFER_SIZE_BYTES) buffer = buffer.slice(-MAX_BUFFER_SIZE_BYTES);
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);

        child.on('close', () => {
            if (resolved) return;
            if (existsSync(resultPath)) {
                try {
                    resolveOnce(JSON.parse(readFileSync(resultPath, 'utf-8')) as PiVerificationResult);
                    return;
                } catch (err: any) {
                    resolveOnce(fallback(`Could not parse Pi verifier result: ${err.message}`));
                    return;
                }
            }
            resolveOnce(fallback(interventionReason || 'Pi verifier exited without returning factory_verdict.'));
        });

        child.on('error', (err: Error) => {
            resolveOnce(fallback(`Pi verifier spawn error: ${err.message}`));
        });
    });
}

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

function scanChangedFiles(dir: string): GeneratedFile[] {
    const res = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: dir,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
    });
    if (res.status !== 0) return scanDirTree(dir);

    const files = res.stdout
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean)
        .map(line => {
            const rawPath = line.slice(3).trim();
            return rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()!.trim() : rawPath;
        })
        .filter(path => path && !path.startsWith('.factory/') && path !== '.factory');

    return files.map(filename => ({ filename, content: '' }));
}

function changedFilesSignature(dir: string): string {
    return scanChangedFiles(dir)
        .map(file => file.filename)
        .sort()
        .join('\n');
}

// ─── Native SDK Implementation ───────────────────────────

export async function runPiSessionViaSdk(options: CliSessionOptions): Promise<CliSessionResult> {
    const { prompt, cwd, repoPath, storyFile } = options;
    const resolvedCwd = resolve(cwd);
    if (!existsSync(resolvedCwd)) mkdirSync(resolvedCwd, { recursive: true });

    log('→', `Running: pi (via SDK) in ${resolvedCwd}`);
    log('→', `Prompt (${prompt.length} chars): ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);

    const logsDir = join(repoPath, '.factory', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const storySlug = storyFile.split('/').pop()?.replace(/\.(?:md|ya?ml)$/, '') || 'build';
    const cliLogPath = join(logsDir, `cli-${storySlug}.log`);
    const logStream = createWriteStream(cliLogPath, { flags: 'a' });
    logStream.on('error', () => { /* ignore */ });
    logStream.write(
        `\n${'='.repeat(60)}\n[${new Date().toISOString()}] sdk-session → pi\nCWD: ${resolvedCwd}\n${'='.repeat(60)}\n`,
    );
    log('→', `SDK log: tail -f ${cliLogPath}`);

    let outputBuffer = '';
    let textBuffer = '';
    let toolCallCount = 0;
    let toolFailureCount = 0;
    let repeatedWriteValidationFailures = 0;
    let repeatedLengthTurnsWithoutNewChanges = 0;
    const turnStopReasons: string[] = [];
    const validationFailureCounts = new Map<string, number>();
    let sawDeliveryMarker = false;
    let sdkAbortReason: string | undefined;
    let lastSdkActivityAt = Date.now();
    let sdkWatchdog: NodeJS.Timeout | undefined;
    const sessionStartedAt = Date.now();
    const maxToolCalls = options.limits?.maxToolCalls || MAX_TOOL_CALLS;
    const maxRuntimeMs = (options.limits?.maxRuntimeMinutes || 30) * 60_000;
    const initialChangedFiles = new Set(scanChangedFiles(resolvedCwd).map(file => file.filename));

    let activeSession: any | undefined;

    try {
        const { AuthStorage, createAgentSession, SessionManager, ModelRegistry } = await import('@earendil-works/pi-coding-agent');

        // Setup Auth using our existing config logic
        const authStorage = AuthStorage.create();
        const registry = ModelRegistry.create(authStorage);
        const settings = loadSettings();
        const provider = options.providerId
            ? settings.providers.find(candidate => candidate.id === options.providerId && candidate.enabled) || null
            : getActiveProvider(settings);
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
        registerFactoryProviderForPi(registry, provider);
        let agentModel;
        
        // 1. If options.model is explicitly passed (e.g. from the story file), use that
        if (options.model) {
            agentModel = resolvePiAgentModel(registry, provider, options.model);
        }
        // 2. Otherwise, unify with TPM by defaulting to the global activeProvider model
        if (!agentModel && provider?.defaultModel) {
            agentModel = resolvePiAgentModel(registry, provider, provider.defaultModel);
        }
        if (agentModel) {
            logStream.write(
                `[${new Date().toISOString()}] selected model: ${agentModel.provider}/${agentModel.id} api=${agentModel.api} compat=${JSON.stringify(agentModel.compat || {})}\n`,
            );
        } else {
            logStream.write(
                `[${new Date().toISOString()}] selected model: SDK default (Factory requested ${options.model || provider?.defaultModel || 'none'})\n`,
            );
        }
        const toolAllowlist = provider?.kind === 'openai-compat'
            ? ['read', 'bash', 'grep', 'find', 'ls']
            : undefined;
        if (toolAllowlist) {
            logStream.write(`[${new Date().toISOString()}] tools: ${toolAllowlist.join(', ')}\n`);
        }

        const { session } = await createAgentSession({
            cwd: resolvedCwd,
            authStorage,
            modelRegistry: registry,
            model: agentModel,
            sessionManager: SessionManager.inMemory(),
            thinkingLevel: provider?.kind === 'openai-compat'
                ? 'minimal'
                : options.piConfig?.thinkingLevel || 'low',
            tools: toolAllowlist,
        });
        activeSession = session;

        const abortSdkSession = (reason: string) => {
            if (sdkAbortReason) return;
            sdkAbortReason = reason;
            const msg = `\n[${new Date().toISOString()}] SDK session abort requested: ${reason}\n`;
            outputBuffer += msg;
            logStream.write(msg);
            try { void session.abort().catch(() => { /* best effort */ }); } catch { /* best effort */ }
        };

        sdkWatchdog = setInterval(() => {
            if (sdkAbortReason || sawDeliveryMarker) return;
            const silentMs = Date.now() - lastSdkActivityAt;
            if (Date.now() - sessionStartedAt > maxRuntimeMs) {
                abortSdkSession(`SDK_RUNTIME_LIMIT: exceeded ${Math.round(maxRuntimeMs / 60_000)} minutes`);
                return;
            }
            if (silentMs > 180_000) {
                abortSdkSession(`SDK_STALL: no SDK events for ${Math.round(silentMs / 1000)}s`);
            }
        }, 10_000);

        session.subscribe((event) => {
            lastSdkActivityAt = Date.now();
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
                    toolCallCount++;
                    if (toolCallCount > maxToolCalls) {
                        abortSdkSession(`TOOL_LOOP: exceeded ${maxToolCalls} tool calls`);
                    }
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
                if (/(error|failed|exception)/i.test(resStr)) {
                    toolFailureCount++;
                }
                const validationFailure = getToolValidationFailureKey(resStr);
                if (validationFailure) {
                    const count = (validationFailureCounts.get(validationFailure) || 0) + 1;
                    validationFailureCounts.set(validationFailure, count);
                    if (count >= 3) {
                        abortSdkSession(`TOOL_SCHEMA_LOOP: repeated ${validationFailure}`);
                    }
                }
                if (/Validation failed for tool "write"[\s\S]*content: must have required properties content/i.test(resStr)) {
                    repeatedWriteValidationFailures++;
                    if (repeatedWriteValidationFailures >= 3) {
                        abortSdkSession('TOOL_SCHEMA_LOOP: write called repeatedly without required content');
                    }
                } else if (!/Validation failed for tool "write"/i.test(resStr)) {
                    repeatedWriteValidationFailures = 0;
                }
                const lines = resStr.split('\n');
                const truncated = lines.length > 50 ? lines.slice(0, 50).join('\n') + `\n... (truncated ${lines.length - 50} lines)` : resStr;
                const msg = `**Result:**\n\`\`\`\n${truncated}\n\`\`\`\n\n`;
                outputBuffer += msg;
                logStream.write(msg);
            } else if (event.type === 'turn_end') {
                const message = (event as any).message;
                const stopReason = message?.stopReason;
                const errorMessage = message?.errorMessage;
                const msg = stopReason
                    ? `\n[turn_end: ${stopReason}${errorMessage ? ` — ${errorMessage}` : ''}]\n`
                    : `\n[turn_end]\n`;
                if (stopReason) turnStopReasons.push(String(stopReason));
                outputBuffer += msg;
                logStream.write(msg);
                if (stopReason === 'error') {
                    abortSdkSession(`SDK_TURN_ERROR: ${errorMessage || 'unknown error'}`);
                }
            } else if (event.type === 'agent_end') {
                const msg = `\n[agent_end]\n`;
                outputBuffer += msg;
                logStream.write(msg);
            }
        });

        await session.prompt(prompt);

        for (let turn = 1; !sdkAbortReason && !hasDeliveryMarker(outputBuffer, textBuffer) && turn <= MAX_PI_CONTINUATION_TURNS; turn++) {
            const beforeLength = outputBuffer.length;
            const noToolsYet = toolCallCount === 0;
            const noNewProductChanges = !scanChangedFiles(resolvedCwd).some(file => !initialChangedFiles.has(file.filename));
            const continuationPrompt = [
                'Continue the Factory story execution.',
                'You stopped before delivery.',
                noToolsYet
                    ? 'You have not made any tool calls yet. Your next assistant action must be a tool call, not another plan.'
                    : 'Use tools now to finish the implementation and validation. Do not restate the plan.',
                noNewProductChanges
                    ? 'No new product files have been created yet. Your next action must be a bash tool call that writes or edits at least one source file.'
                    : 'Keep making concrete code changes and validation progress.',
                'Do not re-read the same files unless needed.',
                'Do not describe the route tree or file list in prose. Create or edit the files.',
                'Implement the required code changes, run validation, and print `DELIVERY COMPLETE` only when the story is actually delivered.',
                `Continuation turn ${turn}/${MAX_PI_CONTINUATION_TURNS}.`,
            ].join('\n');
            logStream.write(`\n[${new Date().toISOString()}] continuation ${turn}/${MAX_PI_CONTINUATION_TURNS}\n`);
            await session.prompt(continuationPrompt);
            const lastStopReason = turnStopReasons.at(-1);
            const stillNoNewProductChanges = !scanChangedFiles(resolvedCwd).some(file => !initialChangedFiles.has(file.filename));
            if (lastStopReason === 'length' && stillNoNewProductChanges) {
                repeatedLengthTurnsWithoutNewChanges++;
                if (repeatedLengthTurnsWithoutNewChanges >= 2) {
                    abortSdkSession('PLANNING_LOOP: repeated length stops without new product files');
                    break;
                }
            } else if (lastStopReason !== 'length') {
                repeatedLengthTurnsWithoutNewChanges = 0;
            }
            if (outputBuffer.length === beforeLength) {
                break;
            }
        }

        if (sdkAbortReason) {
            if (sdkWatchdog) clearInterval(sdkWatchdog);
            logStream.write(`\n[${new Date().toISOString()}] SDK session failed: ${sdkAbortReason}\n`);
            logStream.end();
            try { session.dispose(); } catch { /* best effort */ }
            log('!', `SDK session failed: ${sdkAbortReason}`);
            return {
                status: 'failed',
                exitCode: 1,
                output: outputBuffer.slice(-3000),
                textOutput: textBuffer.trim(),
                files: scanChangedFiles(resolvedCwd),
            };
        }

        sawDeliveryMarker = hasDeliveryMarker(outputBuffer, textBuffer);
        const finalStatus: CliSessionResult['status'] = sawDeliveryMarker ? 'delivered' : 'failed';
        const finalExitCode = finalStatus === 'delivered' ? 0 : 1;
        const failureDiagnostic = [
            'Pi SDK session ended before delivery.',
            `Delivery marker seen: ${sawDeliveryMarker ? 'yes' : 'no'}`,
            `Tool calls: ${toolCallCount}`,
            `Tool failures: ${toolFailureCount}`,
            turnStopReasons.length > 0 ? `Turn stop reasons: ${turnStopReasons.join(', ')}` : 'Turn stop reasons: none reported',
            `Continuation turns allowed: ${MAX_PI_CONTINUATION_TURNS}`,
            `Runtime limit: ${Math.round(maxRuntimeMs / 60_000)} minutes`,
            `Tool-call limit: ${maxToolCalls}`,
        ].join('\n');
        const finalOutput = finalStatus === 'failed'
            ? `${failureDiagnostic}\n\n${outputBuffer.slice(-3000)}`
            : outputBuffer.slice(-3000);
        const summary = {
            status: finalStatus,
            toolCalls: toolCallCount,
            toolFailures: toolFailureCount,
            model: options.model || provider?.defaultModel || null,
        };

        logStream.write(`\n[${new Date().toISOString()}] SDK session complete\n`);
        logStream.write(`${JSON.stringify(summary)}\n`);
        logStream.end();
        if (sdkWatchdog) clearInterval(sdkWatchdog);
        try { session.dispose(); } catch { /* best effort */ }
        log(finalStatus === 'delivered' ? '✓' : '✗', `Pi SDK session ${finalStatus}`);

        return {
            status: finalStatus,
            exitCode: finalExitCode,
            output: finalOutput,
            textOutput: textBuffer.trim(),
            files: scanChangedFiles(resolvedCwd),
        };
    } catch (err: any) {
        if (sdkWatchdog) clearInterval(sdkWatchdog);
        try { activeSession?.dispose?.(); } catch { /* best effort */ }
        logStream.write(`\n[${new Date().toISOString()}] SDK session failed: ${err.message}\n`);
        logStream.end();
        log('!', `SDK session failed: ${err.message}`);
        
        return {
            status: 'failed',
            exitCode: 1,
            output: outputBuffer.slice(-3000) + `\nError: ${err.message}`,
            textOutput: textBuffer.trim(),
            files: scanChangedFiles(resolvedCwd),
        };
    }
}

export async function runPiVerificationViaSdk(options: PiVerificationOptions): Promise<PiVerificationResult> {
    const { prompt, cwd, repoPath, storyFile } = options;
    const resolvedCwd = resolve(cwd);

    if (!options.productFilesChanged) {
        return {
            status: 'review',
            summary: 'No product-code changes were detected; only Factory/log/story state changed.',
            evidence: [],
            missing: ['Make a product-code change that implements or wires the story into the app.'],
            productFilesChanged: false,
            userReachable: false,
            output: 'Verification skipped because productFilesChanged=false.',
        };
    }

    const logsDir = join(repoPath, '.factory', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const storySlug = storyFile.split('/').pop()?.replace(/\.(?:md|ya?ml)$/, '') || 'build';
    const verifyLogPath = join(logsDir, `verify-${storySlug}.log`);
    const logStream = createWriteStream(verifyLogPath, { flags: 'a' });
    logStream.on('error', () => { /* ignore */ });
    logStream.write(
        `\n${'='.repeat(60)}\n[${new Date().toISOString()}] sdk-verifier → pi\nCWD: ${resolvedCwd}\n${'='.repeat(60)}\n`,
    );

    let outputBuffer = '';
    let textBuffer = '';
    let verdict: PiVerificationResult | undefined;
    let activeSession: any | undefined;

    try {
        const { AuthStorage, createAgentSession, defineTool, SessionManager, ModelRegistry } = await import('@earendil-works/pi-coding-agent');

        const authStorage = AuthStorage.create();
        const registry = ModelRegistry.create(authStorage);
        const settings = loadSettings();
        const provider = options.providerId
            ? settings.providers.find(candidate => candidate.id === options.providerId && candidate.enabled) || null
            : getActiveProvider(settings);
        if (provider?.apiKey) {
            const kindStr = provider.kind as string;
            if (kindStr === 'openai-compat' || kindStr === 'openai') {
                authStorage.setRuntimeApiKey('openai', provider.apiKey);
                process.env.OPENAI_API_KEY = provider.apiKey;
            } else if (kindStr === 'anthropic') {
                authStorage.setRuntimeApiKey('anthropic', provider.apiKey);
            } else if (kindStr === 'google') {
                authStorage.setRuntimeApiKey('google', provider.apiKey);
            }
        }
        if (provider?.baseUrl) process.env.OPENAI_BASE_URL = provider.baseUrl;

        registry.refresh();
        registerFactoryProviderForPi(registry, provider);
        const requestedModel = options.model || provider?.defaultModel;
        const agentModel = requestedModel ? resolvePiAgentModel(registry, provider, requestedModel) : undefined;

        const verdictTool = defineTool({
            name: 'factory_verdict',
            label: 'Factory Verdict',
            description: 'Return the required Factory delivery verification verdict with concrete product evidence.',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['verified', 'review', 'failed'] },
                    summary: { type: 'string' },
                    evidence: { type: 'array', items: { type: 'string' } },
                    missing: { type: 'array', items: { type: 'string' } },
                    productFilesChanged: { type: 'boolean' },
                    userReachable: { type: 'boolean' },
                },
                required: ['status', 'summary', 'evidence', 'missing', 'productFilesChanged', 'userReachable'],
                additionalProperties: false,
            } as any,
            execute: async (_toolCallId: string, params: any) => {
                const evidence = Array.isArray(params.evidence) ? params.evidence.map(String).filter(Boolean) : [];
                const missing = Array.isArray(params.missing) ? params.missing.map(String).filter(Boolean) : [];
                const productFilesChanged = params.productFilesChanged === true && options.productFilesChanged;
                const userReachable = params.userReachable === true;
                const requestedStatus = params.status === 'failed' ? 'failed' : params.status === 'verified' ? 'verified' : 'review';
                const status = requestedStatus === 'verified' && productFilesChanged && userReachable && evidence.length > 0
                    ? 'verified'
                    : requestedStatus === 'failed'
                        ? 'failed'
                        : 'review';

                verdict = {
                    status,
                    summary: String(params.summary || (status === 'verified' ? 'Delivery verified.' : 'Delivery needs review.')),
                    evidence,
                    missing: status === 'verified' ? missing : (missing.length > 0 ? missing : ['Verifier did not provide enough proof for done.']),
                    productFilesChanged,
                    userReachable,
                    output: outputBuffer.slice(-3000),
                    textOutput: textBuffer.trim(),
                };

                return {
                    content: [{ type: 'text', text: `Factory verdict recorded: ${verdict.status}` }],
                    details: verdict,
                };
            },
        });

        const { session } = await createAgentSession({
            cwd: resolvedCwd,
            authStorage,
            modelRegistry: registry,
            model: agentModel,
            sessionManager: SessionManager.inMemory(),
            thinkingLevel: provider?.kind === 'openai-compat'
                ? 'minimal'
                : options.piConfig?.thinkingLevel || 'low',
            tools: ['read', 'grep', 'find', 'ls', 'factory_verdict'],
            customTools: [verdictTool],
        });
        activeSession = session;

        session.subscribe((event) => {
            if (event.type === 'message_update') {
                const subEvent = event.assistantMessageEvent;
                if (subEvent.type === 'text_delta') {
                    outputBuffer += subEvent.delta;
                    textBuffer += subEvent.delta;
                    logStream.write(subEvent.delta);
                } else if (subEvent.type === 'thinking_delta') {
                    outputBuffer += subEvent.delta;
                    logStream.write(subEvent.delta);
                } else if (subEvent.type === 'toolcall_start') {
                    const tc = subEvent.partial.content[subEvent.contentIndex] as any;
                    const msg = `\n\n**🛠️ Verifier Tool:** \`${tc?.name || 'unknown'}\`\n`;
                    outputBuffer += msg;
                    logStream.write(msg);
                }
            } else if (event.type === 'tool_execution_end') {
                const resStr = event.result?.content?.[0]?.text || '';
                const msg = `\n**Verifier Result:** ${resStr}\n`;
                outputBuffer += msg;
                logStream.write(msg);
            } else if (event.type === 'turn_end') {
                logStream.write(`\n[turn_end]\n`);
            }
        });

        await session.prompt(prompt);
        if (!verdict) {
            await session.prompt('You must now call factory_verdict. Do not answer in prose. Return review if proof is missing.');
        }

        try { session.dispose(); } catch { /* best effort */ }
        logStream.write(`\n[${new Date().toISOString()}] verifier complete: ${verdict?.status || 'missing-verdict'}\n`);
        logStream.end();

        return verdict || {
            status: 'review',
            summary: 'Pi verifier finished without calling factory_verdict.',
            evidence: [],
            missing: ['Verifier did not return the required structured verdict.'],
            productFilesChanged: options.productFilesChanged,
            userReachable: false,
            output: outputBuffer.slice(-3000),
            textOutput: textBuffer.trim(),
        };
    } catch (err: any) {
        try { activeSession?.dispose?.(); } catch { /* best effort */ }
        logStream.write(`\n[${new Date().toISOString()}] verifier failed: ${err.message}\n`);
        logStream.end();
        return {
            status: 'review',
            summary: `Pi verifier failed: ${err.message}`,
            evidence: [],
            missing: ['Run verification again after fixing the Pi verifier failure.'],
            productFilesChanged: options.productFilesChanged,
            userReachable: false,
            output: outputBuffer.slice(-3000) + `\nError: ${err.message}`,
            textOutput: textBuffer.trim(),
        };
    }
}

function hasDeliveryMarker(outputBuffer: string, textBuffer: string): boolean {
    return outputBuffer.includes('DELIVERY COMPLETE') || textBuffer.includes('DELIVERY COMPLETE');
}

function getToolValidationFailureKey(resultText: string): string | undefined {
    const match = resultText.match(/Validation failed for tool "([^"]+)"[\s\S]*?-\s*([^:\n]+): must have required properties ([^\n]+)/i);
    if (!match) return undefined;
    const toolName = match[1].trim();
    const fieldName = match[2].trim();
    const required = match[3].trim();
    return `${toolName}.${fieldName}.${required}`;
}

export function resolvePiAgentModel(registry: any, provider: any, requestedModel: string) {
    const providerAliases: Record<string, string> = {
        'openai-compat': 'openai',
        openai: 'openai',
        anthropic: 'anthropic',
        google: 'google',
        builtin: 'google',
    };

    if (provider?.kind === 'openai-compat') {
        const factoryProviderName = getPiProviderName(provider);
        const resolved = registry.find(factoryProviderName, requestedModel);
        if (resolved) return resolved;
    }

    const directMatch = requestedModel.split('/');
    if (directMatch.length === 2) {
        const [providerName, modelId] = directMatch;
        const normalizedProvider = providerAliases[providerName] || providerName;
        const resolved = registry.find(normalizedProvider, modelId);
        if (resolved) return resolved;
    }

    const fallbackProvider = providerAliases[provider?.kind as string] || provider?.kind;
    if (fallbackProvider) {
        const resolved = registry.find(fallbackProvider, requestedModel);
        if (resolved) return resolved;
    }

    if (typeof registry.getAll === 'function') {
        const exact = registry.getAll().find((model: any) => model.id === requestedModel);
        if (exact) return exact;
    }

    return null;
}

export function registerFactoryProviderForPi(registry: any, provider: LLMProvider | null): void {
    if (!provider || !provider.enabled || provider.kind !== 'openai-compat' || !provider.baseUrl) return;

    const models = (provider.models?.length ? provider.models : provider.defaultModel ? [{ id: provider.defaultModel, name: provider.defaultModel }] : [])
        .filter((model) => model.id)
        .map((model) => ({
            id: model.id,
            name: model.name || model.id,
            api: 'openai-completions',
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 16384,
            compat: {
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
                supportsStrictMode: false,
            },
        }));

    if (models.length === 0) return;

    try {
        registry.registerProvider(getPiProviderName(provider), {
            name: provider.name || provider.id,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey || 'factory-local',
            api: 'openai-completions',
            models,
        });
    } catch (err: any) {
        log('!', `Could not register Factory provider with Pi SDK: ${err.message}`);
    }
}

export function getPiProviderName(provider: LLMProvider): string {
    return `factory-${provider.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
