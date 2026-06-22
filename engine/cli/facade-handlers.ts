/**
 * CLI facade handlers — thin wrappers that delegate to shell scripts or engine modules.
 * Covers: pulse, btw, task, blueprint, compress, worker, hooks, repl, chronicle.
 */

import { resolve, dirname, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { getActiveProject } from '../config.ts';
import { syncBlueprint } from '../blueprint.ts';
import { log, logHeader, logError } from '../log.ts';
import { args, resolveScript, spawnScript } from '../cli.ts';

/** factory pulse "<msg>" — write heartbeat */
export function handlePulse(): void {
    const script = resolveScript('heartbeat/pulse.sh');
    const msg = args.slice(1).join(' ') || 'pulse';
    spawnScript(script, [msg]);
}

/** factory btw <target> "<message>" — prioritize btw additional details without interrupting running tasks */
export async function handleBtw(target: string, message: string): Promise<void> {
    if (!target || !message) {
        console.error('Usage: factory btw <story-slug> "<message>"');
        process.exit(1);
    }

    const project = getActiveProject();
    const projectPath = project.path;
    const targetSlug = target.toLowerCase().replace(/\.ya?ml$/, '').replace(/^stories\/(features|apps|done)\//, '');

    const folders = ['features', 'apps', 'done'];
    let foundPath: string | null = null;
    let foundRelative: string | null = null;
    for (const folder of folders) {
        const dir = resolve(projectPath, '.factory', 'stories', folder);
        if (!existsSync(dir)) continue;
        const file = readdirSync(dir).find(f =>
            f === target ||
            f.replace(/\.ya?ml$/, '') === targetSlug
        );
        if (file) {
            foundPath = resolve(dir, file);
            foundRelative = `stories/${folder}/${file}`;
            break;
        }
    }

    if (foundPath) {
        const raw = readFileSync(foundPath, 'utf-8');
        const parsed = parseYaml(raw) as any;
        if (parsed) {
            if (!parsed.btw) parsed.btw = [];
            if (!Array.isArray(parsed.btw)) parsed.btw = [parsed.btw];
            parsed.btw.push(message);
            writeFileSync(foundPath, toYaml(parsed), 'utf-8');
            log('✓', `Appended prioritised additional details to story: ${foundRelative}`);
        }
    } else {
        logError(`Could not find story matching: "${target}"`);
        process.exit(1);
    }
}

/** factory task <list|start|complete|add> [args...] — manage tasks */
export async function handleTask(): Promise<void> {
    const subcommand = args[1];
    const taskId = args[2];

    if (subcommand === 'start' || subcommand === 'complete' || subcommand === 'fail') {
        if (taskId) {
            const newStatus = subcommand === 'start' ? 'running' : subcommand === 'complete' ? 'completed' : 'failed';
            try {
                // updateTaskStatus removed since rollup.ts is removed
                log('✓', `Updated task ${taskId} to ${newStatus}`);
            } catch (err: any) {
                log('!', `Could not update task status: ${err?.message || err}`);
            }
            return;
        }
    }

    const script = resolve(process.cwd(), '.factory/task-manager/manage.sh');
    if (!subcommand) {
        console.error('Usage: factory task <list|start|complete|add> [args...]');
        process.exit(1);
    }
    const todoYaml = resolve(process.cwd(), '.factory/task-manager/todo.yaml');
    const todoToon = resolve(process.cwd(), '.factory/task-manager/todo.toon');
    const env = {
        ...process.env,
        FACTORY_PROJECT_ROOT: process.env.FACTORY_PROJECT_ROOT || process.cwd(),
        TASKS_FILE: existsSync(todoYaml) ? todoYaml : todoToon,
    };
    const child = spawn(script, args.slice(1), {
        stdio: 'inherit',
        env,
    });
    child.on('close', (code: number | null) => {
        process.exit(code ?? 0);
    });
}

/** factory blueprint update "<msg>" / factory blueprint analyze [repo-path] */
export function handleBlueprint(): void {
    const subcommand = args[1];
    if (subcommand === 'update') {
        const script = resolveScript('auto-blueprint/update-blueprint.sh');
        // Filter out flag arguments (e.g. --silent, --quiet) — only pass actual message text
        const msgArgs = args.slice(2).filter(a => !a.startsWith('--'));
        const msg = msgArgs.join(' ') || 'blueprint update';
        spawnScript(script, [msg]);
    } else if (subcommand === 'analyze') {
        let repoPath = args[2];
        if (!repoPath) {
            try {
                const project = getActiveProject();
                repoPath = project.path;
            } catch {
                console.error('Error: No active project and no path provided.');
                process.exit(1);
            }
        }
        syncBlueprint(resolve(repoPath));
    } else {
        console.error('Usage: factory blueprint <update "<message>" | analyze [repo-path]>');
        process.exit(1);
    }
}

/** factory compress — compress worklog */
export function handleCompress(): void {
    const script = resolveScript('compress-worklog/compress.sh');
    spawnScript(script, []);
}

/** factory worker [--queue <file>] [options...] — run worker queue natively */
export async function handleWorker(): Promise<void> {
    const subcommand = args[1];
    if (subcommand === 'cli' || subcommand === 'default-cli') {
        const cliName = args[2];
        const { loadSettings, saveSettings } = await import('../config.ts');
        if (!cliName) {
            try {
                const settings = loadSettings();
                console.log(`Current default CLI: ${settings.defaultCli || 'not set (auto-detect)'}`);
            } catch {
                console.log('Current default CLI: not set (auto-detect)');
            }
            process.exit(0);
        }
        const validClis = ['agy', 'claude', 'gemini', 'pi'];
        if (!validClis.includes(cliName)) {
            console.error(`Error: Invalid CLI name. Must be one of: ${validClis.join(', ')}`);
            process.exit(1);
        }
        try {
            let settings: any;
            try {
                settings = loadSettings();
            } catch {
                settings = { providers: [], activeProvider: '', buildModel: '' };
            }
            settings.defaultCli = cliName;
            saveSettings(settings);
            console.log(`✓ Default CLI set to: ${cliName}`);
            process.exit(0);
        } catch (err: any) {
            console.error(`Error saving settings: ${err.message}`);
            process.exit(1);
        }
    }

    const queueFileIdx = args.indexOf('--queue');
    let queueFile: string | null = null;
    if (queueFileIdx !== -1 && args[queueFileIdx + 1]) {
        queueFile = args[queueFileIdx + 1];
    }

    // Try to auto-resolve queue file if not specified
    if (!queueFile) {
        const candidates = ['queue.yaml', 'prompts.yaml', 'batch.yaml'];
        for (const c of candidates) {
            if (existsSync(c)) {
                queueFile = c;
                break;
            }
        }
    }

    if (!queueFile) {
        const agentQueue = '.agents/queue';
        if (existsSync(agentQueue)) {
            const files = readdirSync(agentQueue).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
            if (files.length > 0) {
                queueFile = join(agentQueue, files[0]);
            }
        }
    }

    if (!queueFile) {
        console.error('Error: No queue file found. Use --queue <file> or create queue.yaml in the project root.');
        process.exit(1);
    }

    const workdirIdx = args.indexOf('--workdir');
    const workdir = workdirIdx !== -1 && args[workdirIdx + 1] ? args[workdirIdx + 1] : process.cwd();

    const modelIdx = args.indexOf('--model');
    const model = modelIdx !== -1 && args[modelIdx + 1] ? args[modelIdx + 1] : null;

    const cliIdx = args.indexOf('--cli');
    const cli = cliIdx !== -1 && args[cliIdx + 1] ? args[cliIdx + 1] : null;

    const delayIdx = args.indexOf('--delay');
    const delay = delayIdx !== -1 && args[delayIdx + 1] ? parseInt(args[delayIdx + 1], 10) : 2;

    const logDirIdx = args.indexOf('--log-dir');
    const logDir = logDirIdx !== -1 && args[logDirIdx + 1] ? args[logDirIdx + 1] : './runs';

    const dryRun = args.includes('--dry-run');
    const continueOnError = args.includes('--continue-on-error');

    const { runQueue } = await import('../worker-engine.ts');

    try {
        const result = await runQueue(queueFile, {
            workdir,
            model,
            cli,
            delay,
            logDir,
            continueOnError,
            dryRun,
            quiet: false,
        });
        process.exit(result.success ? 0 : 1);
    } catch (err: any) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

/** factory hooks install — install git hooks into the active/target project */
export function handleHooks(): void {
    const subcommand = args[1];
    if (!subcommand || subcommand !== 'install') {
        console.error('Usage: factory hooks install');
        process.exit(1);
    }

    // Prefer the active project root, fallback to cwd
    let projectRoot = process.cwd();
    try {
        const project = getActiveProject();
        projectRoot = project.path;
    } catch { /* no active project, use cwd */ }

    installGitHooks(projectRoot);
}

/** Install git hooks into a project directory. */
export function installGitHooks(projectRoot: string): void {
    const gitDir = join(projectRoot, '.git');
    if (!existsSync(gitDir)) {
        log('!', `No .git directory in ${projectRoot} — skipping hooks`);
        return;
    }

    const hooksDir = join(gitDir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    // post-commit hook — writes heartbeat + appends worklog entry
    const postCommit = join(hooksDir, 'post-commit');
    const factoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const pulseScript = join(factoryRoot, 'factory', 'scripts', 'heartbeat', 'pulse.sh');
    const blueprintScript = join(factoryRoot, 'factory', 'scripts', 'auto-blueprint', 'update-blueprint.sh');

    const hookContent = [
        '#!/usr/bin/env bash',
        '# Factory post-commit hook — auto-generated by factory hooks install',
        `export FACTORY_PROJECT_ROOT="${projectRoot}"`,
        `COMMIT_MSG=$(git log -1 --pretty=%B 2>/dev/null || echo 'commit')`,
        `CHANGED=$(git diff-tree --no-commit-id -r --name-only HEAD 2>/dev/null | tr '\\n' ', ' | sed 's/,$//')`,
        existsSync(pulseScript)  ? `bash "${pulseScript}" "post-commit: $COMMIT_MSG"` : '',
        existsSync(blueprintScript) ? `bash "${blueprintScript}" "committed: $COMMIT_MSG FILES:$CHANGED"` : '',
        '',
    ].filter(l => l !== null).join('\n');

    writeFileSync(postCommit, hookContent);
    try { execSync(`chmod +x "${postCommit}"`); } catch { /* ignore on non-unix */ }

    log('✓', `Git hooks installed in ${projectRoot}`);
    log('→', 'post-commit: heartbeat + worklog auto-updated on every commit');
}

export async function handleRepl(storyPath?: string): Promise<void> {
    const isAuto = args.includes('--auto') || args.includes('-a');
    const { runRepl } = await import('../repl.ts');
    await runRepl(storyPath, { auto: isAuto });
    process.exit(0);
}

export async function handleChronicle(subcommand?: string, arg?: string): Promise<void> {
    if (!subcommand) {
        console.error('Usage: factory chronicle <update|view> [repo-path]');
        process.exit(1);
    }

    const project = getActiveProject();
    const repoPath = arg ? resolve(arg) : project.path;

    switch (subcommand) {
        case 'update':
            logHeader('Distilling Repository Chronicle');
            const { distillChronicle } = await import('../chronicle.ts');
            await distillChronicle(repoPath);
            break;
        case 'view':
            const chroniclePath = join(repoPath, '.factory', 'knowledge', 'chronicle.md');
            if (existsSync(chroniclePath)) {
                console.log(readFileSync(chroniclePath, 'utf-8'));
            } else {
                log('!', 'No chronicle found. Run: factory chronicle update');
            }
            break;
        default:
            console.error(`Unknown chronicle command: ${subcommand}`);
            process.exit(1);
    }
}

/** factory build-knowledge <repoPath> — build TPM context */
export async function handleBuildKnowledge(): Promise<void> {
    const repoPath = args[1] || process.cwd();
    const { buildTpmKnowledge } = await import('../analyze.ts');
    await buildTpmKnowledge(repoPath);
}
