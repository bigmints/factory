/**
 * cli-adapter.ts — Unified CLI invocation adapter.
 *
 * Single source of truth for how each agentic CLI is invoked.
 * Fixes:
 *  - pi uses positional args, not -p
 *  - gemini uses -p <prompt> + --yolo
 *  - agy uses -p <prompt> + --dangerously-skip-permissions
 *  - claude uses -p <prompt> + --dangerously-skip-permissions
 *  - PATH is built dynamically from the actual system (macOS + Linux aware)
 *
 * Usage:
 *   import { buildCliInvocation, buildSpawnEnv, resolveCliBinary } from './cli-adapter.ts';
 *
 *   const { binary, args } = buildCliInvocation('pi', 'do the thing');
 *   spawn(binary, args, { cwd, env: buildSpawnEnv() });
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── Supported CLIs ──────────────────────────────────────

export type CliName = 'agy' | 'gemini' | 'pi' | 'claude';

export const SUPPORTED_CLIS: CliName[] = ['pi', 'gemini', 'claude', 'agy'];

// ─── Per-CLI Profiles ────────────────────────────────────

/**
 * Everything that differs between CLIs:
 *   - how to pass the prompt (flag vs positional)
 *   - flags that suppress interactive confirmation ("yolo" mode)
 *   - optional extra flags for headless/non-interactive operation
 */
interface CliProfile {
    /**
     * How to pass the prompt:
     *   'flag'       → CLI_BIN -p <prompt>   (agy, gemini, claude)
     *   'positional' → CLI_BIN <prompt>       (pi)
     */
    promptMode: 'flag' | 'positional';

    /**
     * Flags inserted BEFORE the prompt (or after for 'positional').
     * These disable interactive confirmation dialogs.
     */
    yoloFlags: string[];

    /**
     * Extra flags appended after the prompt / yolo flags.
     * Used for things like suppressing sessions, extensions, etc.
     */
    extraFlags: string[];
}

const CLI_PROFILES: Record<CliName, CliProfile> = {
    /**
     * agy (Antigravity CLI)
     * Non-interactive: -p <prompt> --dangerously-skip-permissions
     * Thread continuity: --conversation <id>
     */
    agy: {
        promptMode: 'flag',
        yoloFlags: ['--dangerously-skip-permissions'],
        extraFlags: [],
    },

    /**
     * gemini (Gemini CLI)
     * Non-interactive: -p <prompt> --yolo
     * --yolo is equivalent to --approval-mode yolo
     */
    gemini: {
        promptMode: 'flag',
        yoloFlags: ['--yolo'],
        extraFlags: [],
    },

    /**
     * pi (Pi Coding Agent by earendil-works)
     * Non-interactive: pi "<prompt>" (positional — NO -p flag!)
     * --no-session     : skip loading/saving session (avoids corrupted settings stall)
     * --no-extensions  : skip MCP adapter init which blocks stdout for 30-60s
     * --no-skills      : skip toon-context skill which reads ALL project files before responding
     *                    (183 files = 300s stall on local models)
     */
    pi: {
        promptMode: 'positional',
        yoloFlags: [],
        extraFlags: ['--no-session', '--no-extensions', '--no-skills'],
    },

    /**
     * claude (Anthropic Claude CLI)
     * Non-interactive: -p <prompt> --dangerously-skip-permissions
     */
    claude: {
        promptMode: 'flag',
        yoloFlags: ['--dangerously-skip-permissions'],
        extraFlags: [],
    },
};

// ─── Binary Resolution ───────────────────────────────────

/** Cached binary paths (resolved once per process). */
const binaryCache: Record<string, string> = {};

/**
 * Resolve the absolute path of a CLI binary.
 * Uses `which` so we never rely on the ambient PATH being correct at spawn time.
 * Falls back to the bare name if `which` fails (PATH may still work at spawn).
 */
export function resolveCliBinary(cliName: string): string {
    if (binaryCache[cliName]) return binaryCache[cliName];

    // Try `which` with a maximal PATH so we find everything
    const env = buildSpawnEnv();
    try {
        const result = spawnSync('which', [cliName], {
            encoding: 'utf8',
            env,
        });
        if (result.status === 0 && result.stdout.trim()) {
            const resolved = result.stdout.trim();
            binaryCache[cliName] = resolved;
            return resolved;
        }
    } catch { /* fall through */ }

    // Fallback: bare name (hope the system PATH covers it)
    binaryCache[cliName] = cliName;
    return cliName;
}

// ─── PATH Builder ────────────────────────────────────────

/**
 * Build a macOS + Linux aware PATH string that finds all known CLIs.
 *
 * Locations:
 *   agy    → ~/.local/bin           (macOS & Linux)
 *   claude → ~/.local/bin           (macOS & Linux)
 *   gemini → /opt/homebrew/bin      (macOS Homebrew) or ~/.local/bin (Linux npm)
 *   pi     → /opt/homebrew/bin      (macOS Homebrew) or /usr/local/bin
 *   node   → ~/.nvm/versions/node/vX.Y.Z/bin (if using nvm)
 */
export function buildSpawnEnv(): NodeJS.ProcessEnv {
    const home = homedir();
    const parts: string[] = [];

    // User-local bin (agy, claude, and pip-installed tools)
    parts.push(`${home}/.local/bin`);

    // Homebrew (macOS) — gemini, pi
    if (existsSync('/opt/homebrew/bin')) {
        parts.push('/opt/homebrew/bin');
    }
    if (existsSync('/usr/local/bin')) {
        parts.push('/usr/local/bin');
    }

    // NVM node bin — find the most recent version directory
    const nvmDir = join(home, '.nvm', 'versions', 'node');
    if (existsSync(nvmDir)) {
        try {
            const versions = readdirSync(nvmDir)
                .filter(v => v.startsWith('v'))
                .sort((a, b) => {
                    // Sort semantically: v22 > v20 > v18
                    const [, aMaj = 0, aMin = 0, aPatch = 0] = a.match(/v(\d+)\.(\d+)\.(\d+)/) || [];
                    const [, bMaj = 0, bMin = 0, bPatch = 0] = b.match(/v(\d+)\.(\d+)\.(\d+)/) || [];
                    return (+bMaj - +aMaj) || (+bMin - +aMin) || (+bPatch - +aPatch);
                });
            for (const v of versions.slice(0, 3)) {
                parts.push(join(nvmDir, v, 'bin'));
            }
        } catch { /* ignore */ }
    }

    // Inherit the existing PATH last (so our additions take precedence)
    if (process.env.PATH) {
        parts.push(process.env.PATH);
    }

    return {
        ...process.env,
        PATH: parts.join(':'),
    };
}

// ─── Invocation Builder ──────────────────────────────────

export interface CliInvocation {
    /** Absolute (or bare) binary path */
    binary: string;
    /** Full argument list to pass to spawn/spawnSync */
    args: string[];
}

export interface CliInvocationOptions {
    /** Optional model name (supported by gemini and claude via --model) */
    model?: string | null;
    /** For agy: resume a previous conversation thread */
    conversationId?: string | null;
}

/**
 * Build the binary + args for a non-interactive CLI invocation.
 *
 * Examples:
 *   agy:    ['<path>/agy',    ['-p', '<prompt>', '--dangerously-skip-permissions']]
 *   gemini: ['<path>/gemini', ['-p', '<prompt>', '--yolo']]
 *   pi:     ['<path>/pi',     ['<prompt>', '--no-session', '--no-extensions', '--no-skills']]
 *   claude: ['<path>/claude', ['-p', '<prompt>', '--dangerously-skip-permissions']]
 */
export function buildCliInvocation(
    cliName: CliName | string,
    prompt: string,
    options: CliInvocationOptions = {},
): CliInvocation {
    const profile = CLI_PROFILES[cliName as CliName];
    const binary = resolveCliBinary(cliName);

    if (!profile) {
        // Unknown CLI — fall back to -p <prompt> convention
        return { binary, args: ['-p', prompt] };
    }

    const args: string[] = [];

    if (profile.promptMode === 'flag') {
        // Flag-based: -p <prompt> [yoloFlags] [extraFlags]
        args.push('-p', prompt);
        args.push(...profile.yoloFlags);
        args.push(...profile.extraFlags);
    } else {
        // Positional: [extraFlags] <prompt>
        // Note: pi's extra flags come BEFORE the prompt positional argument
        args.push(...profile.extraFlags);
        args.push(prompt);
    }

    // Optional: model selection (only gemini and claude support --model)
    if (options.model && (cliName === 'gemini' || cliName === 'claude')) {
        args.push('--model', options.model);
    }

    // agy: resume a conversation thread
    if (options.conversationId && cliName === 'agy') {
        args.push('--conversation', options.conversationId);
    }

    return { binary, args };
}

// ─── Detection ───────────────────────────────────────────

/**
 * Auto-detect an available CLI from the supported list.
 * Returns the first one found on PATH (with the enriched PATH).
 */
export function detectAvailableCli(): CliName {
    const env = buildSpawnEnv();
    for (const cli of SUPPORTED_CLIS) {
        const result = spawnSync('which', [cli], { encoding: 'utf8', env });
        if (result.status === 0 && result.stdout.trim()) {
            return cli;
        }
    }
    throw new Error(
        'No compatible CLI found. Please install one of: pi, gemini, claude, or agy.\n' +
        '  gemini: brew install gemini-cli  (or npm install -g @google/generative-ai)\n' +
        '  pi:     brew install pi\n' +
        '  agy:    see https://antigravity.ai\n' +
        '  claude: npm install -g @anthropic-ai/claude-code',
    );
}

/**
 * Verify a specific CLI is installed and on PATH.
 * Returns the resolved binary path or throws a descriptive error.
 */
export function verifyCli(cliName: string): string {
    const env = buildSpawnEnv();
    const result = spawnSync('which', [cliName], { encoding: 'utf8', env });
    if (result.status !== 0 || !result.stdout.trim()) {
        throw new Error(
            `CLI "${cliName}" is not installed or not in PATH.\n` +
            `Run: factory worker default-cli <pi|gemini|claude|agy>`,
        );
    }
    return result.stdout.trim();
}

/**
 * Check if a CLI is available without throwing.
 */
export function isCliAvailable(cliName: string): boolean {
    try {
        verifyCli(cliName);
        return true;
    } catch {
        return false;
    }
}
