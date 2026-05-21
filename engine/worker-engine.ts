/**
 * Worker Engine — delegates code generation to the worker YAML prompt queue runner.
 * Consolidates the former minions engine and script queue runner into a unified,
 * native TypeScript module inside the Factory engine.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import type { AppStory, FeatureStory, ProjectBlueprint, BuildResult, GeneratedFile } from './types.ts';
import { storySlug } from './types.ts';
import { log, logError } from './log.ts';

// ─── Types ───────────────────────────────────────────────

export interface WorkerTask {
    name: string;
    prompt: string;
    workdir?: string;
    model?: string;
    approval_mode?: string;
}

export interface WorkerQueueOptions {
    workdir?: string;
    model?: string | null;
    cli?: string | null;
    delay?: number;
    logDir?: string;
    continueOnError?: boolean;
    dryRun?: boolean;
    quiet?: boolean;
}

// ─── Queue Generator ─────────────────────────────────────

/**
 * Convert an AppStory to a list of worker tasks.
 */
function storyToTasks(story: AppStory): WorkerTask[] {
    return [
        {
            name: 'Setup project',
            prompt: `Create package.json and tsconfig.json for ${story.appName}. Framework: ${story.stack.framework}. Package manager: ${story.stack.packageManager || 'npm'}.`,
        },
        {
            name: 'Scaffold structure',
            prompt: `Create the directory structure and base files for ${story.appName}. Framework: ${story.stack.framework}. Include layout, routing, and configuration files.`,
        },
        {
            name: 'Generate core code',
            prompt: `Generate the core application code for ${story.appName}. Description: ${story.description}. Stack: ${story.stack.framework}, ${story.stack.database || 'no database'}.`,
        },
        {
            name: 'Test and validate',
            prompt: `Run tests and validate the build for ${story.appName}. Run tsc --noEmit, lint, and any configured tests. Fix any errors found.`,
        },
        {
            name: 'Finalize',
            prompt: `Finalize the build for ${story.appName}. Ensure all files are complete, run a final validation, and mark the build as complete.`,
        },
    ];
}

/**
 * Convert a FeatureStory to a list of worker tasks.
 */
function featureStoryToTasks(story: FeatureStory): WorkerTask[] {
    return [
        {
            name: 'Analyze target app',
            prompt: `Analyze the target app ${story.target.app}. Read its structure, dependencies, and conventions. Understand where this feature fits.`,
        },
        {
            name: 'Plan feature',
            prompt: `Plan the feature ${story.feature.name} for app ${story.target.app}. Determine which files need to be created or modified.`,
        },
        {
            name: 'Generate feature code',
            prompt: `Generate the feature code for ${story.feature.name}. Target app: ${story.target.app}. Phase: ${story.phase || 'unspecified'}.`,
        },
        {
            name: 'Integrate with app',
            prompt: `Integrate the feature ${story.feature.name} with the existing app ${story.target.app}. Update routes, imports, and configuration as needed.`,
        },
        {
            name: 'Test feature',
            prompt: `Test the feature ${story.feature.name}. Run tsc, lint, and any tests. Fix errors.`,
        },
        {
            name: 'Finalize feature',
            prompt: `Finalize the feature ${story.feature.name}. Ensure everything is complete and mark as done.`,
        },
    ];
}

// ─── CLI Detector ────────────────────────────────────────

/**
 * Detect a compatible CLI binary ('agy', 'claude', 'gemini', or 'pi').
 */
export function detectCLI(): string {
    for (const bin of ['pi', 'gemini', 'claude', 'agy']) {
        const result = spawnSync('which', [bin], { encoding: 'utf8' });
        if (result.status === 0) return bin;
    }
    throw new Error("No compatible CLI found. Please install one of: pi, gemini, claude, or agy.");
}

// ─── Queue Runner ────────────────────────────────────────

/**
 * Run a list of worker tasks sequentially.
 */
export async function runQueueTasks(
    tasks: WorkerTask[],
    options: WorkerQueueOptions = {}
): Promise<{ success: boolean; passed: number; failed: number; logPath?: string }> {
    const workdir = options.workdir ? resolve(options.workdir) : process.cwd();
    const delay = options.delay ?? 2;
    const logDir = options.logDir ? resolve(options.logDir) : resolve('./runs');
    const continueOnError = options.continueOnError ?? false;
    const dryRun = options.dryRun ?? false;
    const quiet = options.quiet ?? false;

    let cli = options.cli;
    if (!cli) {
        try {
            const { loadSettings } = await import('./config.ts');
            const settings = loadSettings();
            if (settings.defaultCli) {
                cli = settings.defaultCli;
            }
        } catch {
            // Ignore settings if not configured
        }
    }

    if (!cli && !dryRun) {
        try {
            cli = detectCLI();
        } catch (err) {
            if (err instanceof Error) {
                logError(err.message);
            }
            return { success: false, passed: 0, failed: tasks.length };
        }
    }

    // Default fallback
    if (!cli) {
        cli = 'pi';
    }

    // Verify the selected/detected CLI is actually installed
    if (!dryRun) {
        const checkResult = spawnSync('which', [cli], { encoding: 'utf8' });
        if (checkResult.status !== 0) {
            logError(`Selected CLI "${cli}" is not installed or not in PATH.`);
            return { success: false, passed: 0, failed: tasks.length };
        }
    }

    if (!quiet) {
        log('▶', `worker — ${tasks.length} task(s) — CLI: ${cli}${dryRun ? ' [DRY-RUN]' : ''}`);
        log('→', `Working directory: ${workdir}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `run-${timestamp}.log`);

    const runLog: any[] = [];
    let failed = 0;
    let passed = 0;

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        if (!task.name || !task.prompt) {
            log('⚠', `Skipping task ${i + 1}: missing 'name' or 'prompt'.`);
            continue;
        }

        const taskWorkdir = task.workdir ? resolve(task.workdir) : workdir;
        const taskModel = task.model ?? options.model;
        const taskMode = task.approval_mode ?? 'yolo';

        const cliArgs = ['-p', task.prompt];
        if (taskModel) cliArgs.push('--model', taskModel);

        if (!quiet) {
            console.log(`\n[${i + 1}/${tasks.length}] ${task.name}`);
            console.log(`  workdir: ${taskWorkdir}`);
            console.log(`  mode: ${taskMode}`);
            if (taskModel) console.log(`  model: ${taskModel}`);
            console.log(`  prompt: ${task.prompt.slice(0, 120)}${task.prompt.length > 120 ? '…' : ''}`);
        }

        if (dryRun) {
            if (!quiet) console.log('  [DRY-RUN — skipping execution]');
            runLog.push({ name: task.name, status: 'dry-run', skipped: true });
            passed++;
            continue;
        }

        const start = Date.now();
        const result = spawnSync(cli, cliArgs, {
            cwd: taskWorkdir,
            stdio: quiet ? 'ignore' : 'inherit',
            encoding: 'utf8',
        });
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const success = result.status === 0;

        runLog.push({
            name: task.name,
            status: success ? 'ok' : 'failed',
            exitCode: result.status,
            elapsed: `${elapsed}s`,
        });

        if (!success) {
            failed++;
            if (!quiet) logError(`Task failed (exit ${result.status}) after ${elapsed}s`);
            if (!continueOnError) {
                if (!quiet) logError('Aborting queue due to failure. Use --continue-on-error to skip failed tasks.');
                break;
            }
        } else {
            passed++;
            if (!quiet) log('✓', `Done in ${elapsed}s`);
        }

        if (i < tasks.length - 1 && !dryRun && delay > 0) {
            await new Promise((r) => setTimeout(r, delay * 1000));
        }
    }

    const summary = {
        ran: runLog.length,
        failed,
        passed,
        tasks: runLog,
    };

    try {
        writeFileSync(logPath, JSON.stringify(summary, null, 2));
        if (!quiet) {
            log('✓', `Run log written to: ${logPath}`);
            log('→', `Summary: ${passed} passed, ${failed} failed`);
        }
    } catch (e) {
        if (!quiet) log('⚠', `Could not write run log: ${e}`);
    }

    return { success: failed === 0, passed, failed, logPath };
}

/**
 * Load, parse, and run a YAML queue file.
 */
export async function runQueue(
    queueFilePath: string,
    options: WorkerQueueOptions = {}
): Promise<{ success: boolean; passed: number; failed: number }> {
    const absPath = resolve(queueFilePath);
    if (!existsSync(absPath)) {
        throw new Error(`Queue file not found: ${absPath}`);
    }

    const content = readFileSync(absPath, 'utf8');
    let parsed: any;
    try {
        parsed = parseYaml(content);
    } catch (e) {
        throw new Error(`Failed to parse YAML queue file: ${e}`);
    }

    const queue: WorkerTask[] = parsed?.queue ?? [];
    if (!queue.length) {
        throw new Error('YAML queue is empty.');
    }

    return runQueueTasks(queue, options);
}

// ─── Engine Integration ──────────────────────────────────

/**
 * Run the worker engine natively against a story in memory.
 */
async function runWorkerEngine(
    story: AppStory | FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
): Promise<BuildResult> {
    const isApp = 'appName' in story;
    const tasks = isApp ? storyToTasks(story as AppStory) : featureStoryToTasks(story as FeatureStory);

    // Create the target directory
    mkdirSync(targetDir, { recursive: true });

    log('→', `Running worker engine natively for: ${isApp ? (story as AppStory).appName : (story as FeatureStory).feature.name}`);

    const result = await runQueueTasks(tasks, {
        workdir: targetDir,
        quiet: false,
    });

    const files = scanGeneratedFiles(targetDir);
    const name = isApp ? (story as AppStory).appName : (story as FeatureStory).feature.name;

    if (result.success) {
        return {
            success: true,
            files,
            plan: {
                files: files.map(f => f.filename),
                architecture: `worker: ${name}`,
                decisions: ['engine:worker'],
            },
            iterations: 1,
            engine: 'worker',
        };
    } else {
        return {
            success: false,
            files,
            plan: { files: [], architecture: 'worker', decisions: [] },
            iterations: 1,
            errors: [`Worker tasks failed: ${result.failed} task(s) failed during execution`],
            engine: 'worker',
        };
    }
}

// ─── File Scanning ───────────────────────────────────────

function scanGeneratedFiles(dir: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    if (!existsSync(dir)) return files;
    scanDir(dir, '', files);
    return files;
}

function scanDir(dir: string, prefix: string, files: GeneratedFile[]): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === '.factory' ||
            entry.name === '.DS_Store'
        ) {
            continue;
        }
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            scanDir(join(dir, entry.name), relPath, files);
        } else {
            try {
                const content = readFileSync(join(dir, entry.name), 'utf-8');
                files.push({ filename: relPath, content });
            } catch {
                // Skip binary files
            }
        }
    }
}

// ─── Public Builders ─────────────────────────────────────

/** Build using worker engine */
export async function runWorkerBuild(
    story: AppStory,
    blueprint: ProjectBlueprint,
): Promise<BuildResult> {
    const slug = storySlug(story);
    const targetDir = resolve(process.cwd(), slug);
    return runWorkerEngine(story, blueprint, targetDir);
}

/** Feature build using worker engine */
export async function runWorkerFeatureBuild(
    story: FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
): Promise<BuildResult> {
    return runWorkerEngine(story, blueprint, targetDir);
}
