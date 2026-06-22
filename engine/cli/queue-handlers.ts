import { resolve } from 'node:path';
import { getActiveProject } from '../config.ts';
import { listStories, loadStory, updateStoryStatus } from '../story.ts';
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
    const stories = listStories(project.path);
    const all = [...stories.apps, ...stories.features];
    const pending: string[] = [];
    
    for (const file of all) {
        try {
            const path = resolve(project.path, '.factory', 'stories', file);
            const story = loadStory(path);
            if ((story.status as any) === 'pending' || story.status === 'ready-to-build') pending.push(path);
        } catch { /* ignore */ }
    }

    if (pending.length === 0) {
        log('✓', 'No pending items in queue.');
        return;
    }

    log('→', `Found ${pending.length} pending stories. Starting sequential build...`);
    for (const file of pending) {
        updateStoryStatus(file, 'building');
        try {
            log('→', `Building ${file}...`);
            const result = spawnSync('npx', ['tsx', cliTsPath, 'build', file], {
                cwd: project.path,
                stdio: 'inherit'
            });
            if (result.status === 0) {
                // handleBuild archives the file automatically on success
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
}

export function handleQueueClear(): void {
    log('✓', 'Completed items are automatically archived during the build process.');
}
