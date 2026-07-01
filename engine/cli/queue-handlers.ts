import { resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { getActiveProject } from '../config.ts';
import { listStories, loadStory, updateStoryStatus, sortStoriesTopologically } from '../story.ts';
import { logHeader, log, logError } from '../log.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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
    const stories = listStories(project.path);
    const all = [...stories.apps, ...stories.features];
    const pending: string[] = [];
    const building: string[] = [];
    
    for (const file of all) {
        try {
            const path = resolve(project.path, '.factory', 'stories', file);
            const story = loadStory(path);
            if ((story.status as any) === 'pending' || story.status === 'ready-to-build') pending.push(file);
            if (story.status === 'building') building.push(file);
        } catch { /* ignore */ }
    }
    
    if (building.length > 0) {
        log('→', 'Currently Building:');
        for (const file of building) log('  ', `  🔄 ${file}`);
    }
    if (pending.length > 0) {
        log('→', 'Pending in Queue:');
        for (const file of pending) log('  ', `  ⏳ ${file}`);
    }
    if (building.length === 0 && pending.length === 0) {
        log('✓', 'Queue is empty.');
    }
}

export function handleQueueAdd(storyPath: string): void {
    if (!storyPath) {
        logError('Usage: factory queue add <story.md>');
        process.exit(1);
    }
    updateStoryStatus(storyPath, 'ready-to-build');
    log('✓', `Added ${storyPath} to queue (status = ready-to-build)`);
}

export function handleQueueStart(): void {
    logHeader('Starting Queue Processor');
    const project = getActiveProject();
    if (!project || !project.path) {
        logError('No active project found.');
        return;
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
        const pending: Array<{ path: string, story: any }> = [];
        
        for (const file of all) {
            try {
                const pathStr = resolve(project.path, '.factory', 'stories', file);
                const story = loadStory(pathStr);
                if ((story.status as any) === 'pending' || story.status === 'ready-to-build') {
                    pending.push({ path: pathStr, story });
                }
            } catch { /* ignore */ }
        }

        if (pending.length === 0) {
            log('✓', 'No pending items in queue.');
            if (existsSync(pidFile)) unlinkSync(pidFile);
            return;
        }

        const orderedPending = sortStoriesTopologically(pending);

        log('→', `Found ${orderedPending.length} pending stories. Starting sequential build...`);
        for (const item of orderedPending) {
            const file = item.path;
            
            try {
                const currentStory = loadStory(file);
                if ((currentStory.status as any) !== 'pending' && currentStory.status !== 'ready-to-build') {
                    log('→', `Skipping ${file} because status changed to ${currentStory.status}`);
                    continue;
                }
            } catch { /* ignore */ }

            updateStoryStatus(file, 'building');
            try {
                log('→', `Building ${file}...`);
                const result = spawnSync('npx', ['tsx', cliTsPath, 'build', file], {
                    cwd: project.path,
                    stdio: 'inherit'
                });
                if (result.status === 0) {
                    log('✓', `Successfully built ${file}`);
                } else {
                    updateStoryStatus(file, 'failed');
                    logError(`Failed to build ${file} (exit code ${result.status})`);
                }
            } catch (e) {
                logError(`Error processing ${file}: ${e}`);
                updateStoryStatus(file, 'failed');
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

export function handleQueueClear(): void {
    log('✓', 'Completed items are automatically archived during the build process.');
}
