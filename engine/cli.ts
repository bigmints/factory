#!/usr/bin/env node

/**
 * Factory CLI — thin dispatcher.
 *
 * All handler implementations live in engine/cli/ modules.
 * This file handles argument parsing, the main switch, and shared utilities.
 */

import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { logError } from './log.ts';

// Handler modules
import { handleBuild, handleValidate, handleStatus } from './cli/build-handlers.ts';
import { handleStart, handleStop } from './cli/service-handlers.ts';
import {
    handlePulse, handleBtw, handleTask, handleBlueprint, handleCompress,
    handleWorker, handleHooks, handleRepl, handleChronicle, installGitHooks,
} from './cli/facade-handlers.ts';

// Clean process.env to avoid leaking Next.js internal variables from parent Next.js processes
for (const key of Object.keys(process.env)) {
    if (key.startsWith('__NEXT') || key.startsWith('NEXT_') || key === 'NODE_OPTIONS') {
        delete process.env[key];
    }
}

// ─── Shared State (exported for handler modules) ─────────

export const args = process.argv.slice(2);
export const command = args[0];
export const target = args[1];

// ─── Shared Utilities (exported for handler modules) ─────

/** Resolve a script path relative to factory/scripts/.
 * Scripts live at factory/factory/scripts/ because there is a factory/ subdir.
 */
export function resolveScript(scriptName: string): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return resolve(__dirname, '..', 'factory', 'scripts', scriptName);
}

/** Check if a resolved script exists and is executable */
export function hasScript(scriptName: string): boolean {
    return existsSync(resolveScript(scriptName));
}

export function requireTarget(cmd: string): void {
    if (!target) {
        console.error(`Usage: factory ${cmd} <story.yaml>`);
        process.exit(1);
    }
}

export function parseFlags(flagArgs: string[]): Record<string, string> {
    const flags: Record<string, string> = {};
    for (let i = 0; i < flagArgs.length; i += 2) {
        const key = flagArgs[i]?.replace(/^--/, '');
        const val = flagArgs[i + 1];
        if (key && val) flags[key] = val;
    }
    return flags;
}

/** Spawn a script with remaining CLI args, passing through stdout/stderr */
export function spawnScript(scriptPath: string, scriptArgs: string[]): void {
    if (!existsSync(scriptPath)) {
        logError(`Script not found: ${scriptPath}`);
        process.exit(1);
    }
    const child = spawn(scriptPath, scriptArgs, {
        stdio: 'inherit',
        env: {
            ...process.env,
            FACTORY_PROJECT_ROOT: process.env.FACTORY_PROJECT_ROOT || process.cwd(),
        },
    });
    child.on('close', (code: number | null) => {
        process.exit(code ?? 0);
    });
}

function printUsage(): void {
    console.log(`
Usage: factory <command> [options]

Commands:
  build <story.yaml> [--engine worker]   Full pipeline (or worker engine)
  validate <story.yaml>       Validate a story
  repl [<story.yaml>] [--auto] Start the beautiful interactive CLI terminal UI (REPL)
  status                     Show story statuses
  sync <repo-path>           Sync .factory from repo
  init-bridge <repo-path>    Init .factory bridge in repo

  start                      Start the Factory UI background service
  stop                       Stop the Factory UI background service
  restart                    Restart the Factory UI background service

  project add <repo-path-or-url> Connect a repo (supports git clone)
  project list               List connected repos
  project switch <id>        Switch active project
  project remove <id>        Disconnect a repo
  project reset [repo-path]  Reset project stories to draft & clear queue

  feature build <story.yaml> [--engine worker]  Build a feature
  feature validate <story.yaml>  Validate a feature story

   app sync [<yaml-path>]        Sync app roadmap and statuses with scaffold.yaml roadmap spec
  app list                      List all synced apps
  app status [<app-id>]         Show full hierarchical status tree and progress

  queue list                    List all queue items
  queue add <story.yaml> [--engine worker]  Add to queue
  queue start                   Process all pending items autonomously
  queue stats                   Show queue statistics
  queue clear                   Clear completed items
  queue retry <id>              Retry a failed item
  queue remove <id>             Remove an item from queue

  worker [options...]           Run task queue natively (formerly minions CLI)
`);
}

// ─── Main Dispatcher ─────────────────────────────────────

async function main(): Promise<void> {
    // Lazy-loaded handlers for less frequently used commands
    const lazyProject = () => import('./cli/project-handlers.ts');
    const lazyFeature = () => import('./cli/feature-handlers.ts');
    const lazyQueue = () => import('./cli/queue-handlers.ts');

    switch (command) {
        case 'build':
            return handleBuild(target);
        case 'validate':
            return handleValidate(target);
        case 'status':
            return handleStatus();
        case 'sync': {
            const { handleSync } = await lazyProject();
            return handleSync(target);
        }
        case 'init-bridge': {
            const { handleInitBridge } = await lazyProject();
            return handleInitBridge(target);
        }
        case 'project': {
            const { handleProject } = await lazyProject();
            return handleProject(target, args[2]);
        }
        case 'feature': {
            const { handleFeature } = await lazyFeature();
            return handleFeature(target, args[2]);
        }
        case 'queue': {
            const { handleQueue } = await lazyQueue();
            return handleQueue(target, args[2]);
        }
        case 'start':
            return handleStart();
        case 'stop':
            return handleStop();
        case 'restart':
            handleStop();
            return handleStart();
        case 'app': {
            const { handleAppCommand } = await lazyFeature();
            return handleAppCommand();
        }
        // ─── CLI Facade ─────────────────────────────
        case 'pulse':
            return handlePulse();
        case 'task':
            return handleTask();
        case 'blueprint':
        case 'context':
            return handleBlueprint();
        case 'compress':
            return handleCompress();
        case 'worker':
            return handleWorker();
        case 'hooks':
            return handleHooks();
        case 'repl':
            return handleRepl(target);
        case 'btw':
            return handleBtw(target, args.slice(2).join(' '));
        case 'chronicle':
            return handleChronicle(target, args[2]);

        default:
            printUsage();
            process.exit(command ? 1 : 0);
    }
}

// Re-export installGitHooks for use by project-handlers
export { installGitHooks };

// ─── Run ─────────────────────────────────────────────────

main().catch(err => {
    logError(err.message || String(err));
    process.exit(1);
});
