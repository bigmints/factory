import { resolve, join, basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { getActiveProject } from '../config.ts';
import { listStories, loadStory, updateStoryStatus, sortStoriesForExecution } from '../story.ts';
import { logHeader, log, logError } from '../log.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readLifecycleStatus } from '../schemas.ts';
import { storySlug } from '../types.ts';
import { reconcileProjectDeliveries } from '../delivery.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliTsPath = resolve(__dirname, '..', 'cli.ts');

export function handleQueueList(): void {
    logHeader('Queue Status');
    const project = getActiveProject();
    if (!project || !project.path) {
        logError('No active project found.');
        return;
    }

    const initialDirtyProductFiles = getUncommittedProductChanges(project.path);
    if (initialDirtyProductFiles.length > 0) {
        logError('Queue cannot start because product files are already dirty.');
        logError('Resolve, commit, or intentionally discard these files before queue execution:');
        for (const file of initialDirtyProductFiles.slice(0, 20)) logError(`  - ${file}`);
        if (initialDirtyProductFiles.length > 20) logError(`  ...and ${initialDirtyProductFiles.length - 20} more`);
        process.exitCode = 1;
        return;
    }
    const stories = listStories(project.path);
    const all = [...stories.apps, ...stories.features];
    const queued: string[] = [];
    const running: string[] = [];
    
    for (const file of all) {
        try {
            const path = resolve(project.path, '.factory', 'stories', file);
            const story = loadStory(path);
            const status = readLifecycleStatus(story.status);
            if (status === 'queued') queued.push(file);
            if (status === 'running') running.push(file);
        } catch { /* ignore */ }
    }
    
    if (running.length > 0) {
        log('→', 'Running:');
        for (const file of running) log('  ', `  🔄 ${file}`);
    }
    if (queued.length > 0) {
        log('→', 'Queued:');
        for (const file of queued) log('  ', `  ⏳ ${file}`);
    }
    if (running.length === 0 && queued.length === 0) {
        log('✓', 'Queue is empty.');
    }
}

export function handleQueueAdd(storyPath: string): void {
    if (!storyPath) {
        logError('Usage: factory queue add <story.md>');
        process.exit(1);
    }
    updateStoryStatus(storyPath, 'queued');
    log('✓', `Added ${storyPath} to queue (status = queued)`);
}

export function handleQueueStart(): void {
    logHeader('Starting Queue Processor');
    const project = getActiveProject();
    if (!project || !project.path) {
        logError('No active project found.');
        return;
    }

    for (const result of reconcileProjectDeliveries(project.path).filter(item => item.action !== 'none')) {
        log('→', `Delivery reconciliation: ${result.action} — ${result.detail}`);
    }

    const pidFile = join(project.path, '.factory', 'queue.pid');
    if (existsSync(pidFile)) {
        try {
            const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
            process.kill(pid, 0);
            if (pid !== process.pid) {
                logError(`Queue is already running (PID: ${pid}). Exiting.`);
                process.exit(1);
            }
        } catch {
            // Process not alive, safe to continue
        }
    }
    // Write our own PID
    writeFileSync(pidFile, String(process.pid));

    try {
        const stories = listStories(project.path);
        const all = [...stories.apps, ...stories.features];
        const queuedStories: Array<{ path: string, story: any }> = [];
        const completedSlugs = new Set<string>();
        
        for (const file of all) {
            try {
                const pathStr = resolve(project.path, '.factory', 'stories', file);
                const story = loadStory(pathStr);
                const status = readLifecycleStatus(story.status);
                if (status === 'done') {
                    completedSlugs.add(storySlug(story));
                }
                if (status === 'queued') {
                    story.status = 'queued';
                    queuedStories.push({ path: pathStr, story });
                }
            } catch { /* ignore */ }
        }

        if (queuedStories.length === 0) {
            log('✓', 'No queued stories.');
            if (existsSync(pidFile)) unlinkSync(pidFile);
            return;
        }

        const orderedStories = sortStoriesForExecution(queuedStories);

        const blockedSlugs = new Set<string>();
        log('→', `Found ${orderedStories.length} queued stories. Starting sequential build...`);
        for (const item of orderedStories) {
            const file = item.path;
            
            try {
                const currentStory = loadStory(file);
                const status = readLifecycleStatus(currentStory.status);
                if (status !== 'queued') {
                    log('→', `Skipping ${file} because status changed to ${status}`);
                    continue;
                }

                const blockedDeps = (currentStory.dependsOn || []).filter((dep: string) => blockedSlugs.has(dep));
                if (blockedDeps.length > 0) {
                    const summary = `Blocked because dependenc${blockedDeps.length === 1 ? 'y' : 'ies'} failed or need review: ${blockedDeps.join(', ')}`;
                    updateStoryStatus(file, 'failed', summary);
                    blockedSlugs.add(storySlug(currentStory));
                    logError(`Blocked ${file}: ${summary}`);
                    continue;
                }

                const missingDeps = (currentStory.dependsOn || []).filter((dep: string) => !completedSlugs.has(dep));
                if (missingDeps.length > 0) {
                    log('→', `Skipping ${file}; waiting on dependencies: ${missingDeps.join(', ')}`);
                    continue;
                }
            } catch { /* ignore */ }

            updateStoryStatus(file, 'running');
            try {
                const storyBeforeBuild = loadStory(file);
                const slug = storySlug(storyBeforeBuild);
                log('→', `Building ${file}...`);
                const result = spawnSync('npx', ['tsx', cliTsPath, 'build', file], {
                    cwd: project.path,
                    stdio: 'inherit'
                });
                if (result.status === 0) {
                    const submittedStory = loadStory(file);
                    if (readLifecycleStatus(submittedStory.status) === 'review') {
                        log('✓', `Submitted ${file} for human review`);
                        if (slug) blockedSlugs.add(slug);
                    } else {
                        log('✓', `Successfully built ${file}`);
                        if (slug) completedSlugs.add(slug);
                    }
                } else {
                    const postBuildStory = loadStory(file);
                    const postBuildStatus = readLifecycleStatus(postBuildStory.status);
                    if (postBuildStatus === 'queued') {
                        logError(`Executor infrastructure unavailable while building ${file}; leaving it queued and stopping the queue.`);
                        process.exitCode = 1;
                        return;
                    }
                    if (postBuildStatus === 'review') {
                        logError(`Build needs review: ${file}`);
                        if (stopIfDirtyProductFiles(project.path, file)) return;
                        logError('Continuing with independent queued stories; dependent stories will be blocked.');
                        if (slug) blockedSlugs.add(slug);
                        continue;
                    }
                    const failureSummary = summarizeQueueFailure(project.path, file, result.status, result.signal);
                    if (isExecutorInfrastructureFailure(failureSummary)) {
                        updateStoryStatus(file, 'queued', [
                            'Queue paused because the executor infrastructure failed.',
                            '',
                            'The story was returned to queued so it can be retried after the executor is fixed.',
                            '',
                            failureSummary,
                        ].join('\n'));
                        logError(`Executor infrastructure failure while building ${file}; leaving it queued and stopping the queue.`);
                        process.exitCode = 1;
                        return;
                    }
                    updateStoryStatus(file, 'failed', failureSummary);
                    logError(`Failed to build ${file} (exit code ${result.status ?? 'unknown'})`);
                    if (stopIfDirtyProductFiles(project.path, file)) return;
                    logError('Continuing with independent queued stories; dependent stories will be blocked.');
                    if (slug) blockedSlugs.add(slug);
                    continue;
                }
            } catch (e) {
                logError(`Error processing ${file}: ${e}`);
                updateStoryStatus(file, 'failed', `Queue processing error: ${e instanceof Error ? e.message : String(e)}`);
                if (stopIfDirtyProductFiles(project.path, file)) return;
                logError('Continuing with independent queued stories; dependent stories will be blocked.');
                try {
                    const failedStory = loadStory(file);
                    blockedSlugs.add(storySlug(failedStory));
                } catch { /* ignore */ }
                continue;
            }
        }
        log('✓', 'Queue processing complete.');
    } finally {
        // Always clean up PID file on exit
        if (existsSync(pidFile)) {
            unlinkSync(pidFile);
        }
    }
}

function summarizeQueueFailure(repoPath: string, storyPath: string, exitCode: number | null, signal: string | null): string {
    const logPath = join(repoPath, '.factory', 'logs', `cli-${basename(storyPath)}.log`);
    const header = `Factory queue build failed for ${basename(storyPath)} with exit ${exitCode ?? 'unknown'}${signal ? ` (${signal})` : ''}.`;
    if (!existsSync(logPath)) {
        return `${header}\n\nNo per-story execution log was found. Check .factory/logs/queue.log for the worker output.`;
    }

    const raw = readFileSync(logPath, 'utf-8');
    const tail = raw.slice(-3000).trim();
    return `${header}\n\nLast execution log lines:\n\n\`\`\`\n${tail || 'Log file was empty.'}\n\`\`\``;
}

function isExecutorInfrastructureFailure(output: string): boolean {
    return [
        /TOOL_SCHEMA_LOOP/i,
        /SDK_TURN_ERROR/i,
        /SDK_STALL/i,
        /SDK_WORKER_STALL/i,
        /PI_PATCH_NO_PATCH/i,
        /PI_PATCH_EXECUTOR_ERROR/i,
        /PI_PATCH_EMPTY_PATCH/i,
        /PI_PATCH_EMPTY_PATCH_LOOP/i,
        /PI_WRITE_FILES_EMPTY/i,
        /PI_WRITE_FILES_EMPTY_LOOP/i,
        /TEXT_PATCH_FALLBACK_(?:PROVIDER_ERROR|NO_DIFF|INVALID_PATCH|APPLY_FAILED)/i,
        /\bSIGTERM\b/i,
        /502[\s\S]{0,80}upstream error/i,
        /No API key found for openai/i,
        /Model "[^"]+" not found for provider "openai"/i,
        /Use \/login to log into a provider/i,
        /Validation failed for tool "bash"[\s\S]*command: must have required properties command/i,
    ].some(pattern => pattern.test(output));
}

function stopIfDirtyProductFiles(repoPath: string, storyPath: string): boolean {
    const dirtyProductFiles = getUncommittedProductChanges(repoPath);
    if (dirtyProductFiles.length === 0) return false;

    logError(`Stopping queue because ${basename(storyPath)} left uncommitted product changes after a non-successful build.`);
    logError('Continuing would contaminate the next story. Resolve this diff first:');
    for (const file of dirtyProductFiles.slice(0, 20)) logError(`  - ${file}`);
    if (dirtyProductFiles.length > 20) logError(`  ...and ${dirtyProductFiles.length - 20} more`);
    process.exitCode = 1;
    return true;
}

function getUncommittedProductChanges(repoPath: string): string[] {
    const res = spawnSync('git', ['status', '--porcelain'], {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
    });
    if (res.status !== 0) return [];

    return res.stdout
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean)
        .map(line => {
            const rawPath = line.slice(3).trim();
            return rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()!.trim() : rawPath;
        })
        .filter(path => path && !path.startsWith('.factory/') && path !== '.factory');
}

export function handleQueueClear(): void {
    const project = getActiveProject();
    const stories = listStories(project.path);
    const all = [...stories.apps, ...stories.features];
    let resetCount = 0;

    for (const file of all) {
        try {
            const path = resolve(project.path, '.factory', 'stories', file);
            const story = loadStory(path);
            if (story.status === 'running') {
                updateStoryStatus(path, 'queued');
                resetCount++;
            }
        } catch {
            // ignore malformed stories
        }
    }

    log('✓', resetCount > 0
        ? `Reset ${resetCount} running item(s) back to queued.`
        : 'No running items needed to be reset.');
}
