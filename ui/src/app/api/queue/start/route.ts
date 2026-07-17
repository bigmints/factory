import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { getActiveProject } from '@engine/config';
import { listStories, loadStory, updateStoryStatus } from '@engine/story';
import { readLifecycleStatus } from '@engine/schemas';
import { buildSpawnEnv } from '@engine/cli-adapter';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ error: 'No active project' }, { status: 400 });
        }

        const logsDir = path.join(project.path, '.factory', 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        const logFile = path.join(logsDir, 'queue.log');
        const out = fs.openSync(logFile, 'a');
        const err = fs.openSync(logFile, 'a');

        const devBin = path.join(process.cwd(), '..', 'bin', 'factory');
        const factoryBin = fs.existsSync(devBin) ? devBin : 'factory';
        
        const pidFile = path.join(project.path, '.factory', 'queue.pid');
        if (fs.existsSync(pidFile)) {
            try {
                const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
                process.kill(pid, 0);
                return NextResponse.json({ error: 'Queue is already running' }, { status: 400 });
            } catch {
                // Not running, safe to start
            }
        }

        const stories = listStories(project.path);
        const allStories = [...stories.apps, ...stories.features];
        let queuedCount = 0;

        for (const storyFile of allStories) {
            const storyPath = path.resolve(project.path, '.factory', 'stories', storyFile);
            try {
                if (isGeneratedFixStory(storyFile)) {
                    continue;
                }
                const story = loadStory(storyPath);
                const status = readLifecycleStatus(story.status);
                if (status === 'running') {
                    updateStoryStatus(storyPath, 'queued');
                    queuedCount++;
                    continue;
                }
                if (status === 'queued') {
                    queuedCount++;
                    continue;
                }
                // Draft, failed, review, and done stories are intentional non-queue states.
                // Do not promote them implicitly when the user starts the queue.
            } catch {
                // Ignore malformed stories and let the queue process surface real build issues later.
            }
        }
        
        // Spawn factory queue start detached and pipe output to log file
        const child = spawn(factoryBin, ['queue', 'start'], {
            cwd: project.path,
            detached: true,
            stdio: ['ignore', out, err],
            env: {
                ...buildSpawnEnv(),
                npm_config_cache: '/tmp/factory-npm-cache',
                TMPDIR: '/tmp/factory-npm-cache',
            },
        });
        
        // The detached process will write its own PID in handleQueueStart()
        
        child.unref(); // Let it run in background

        return NextResponse.json({
            success: true,
            message: queuedCount > 0
                ? `Queue started and promoted ${queuedCount} buildable stor${queuedCount === 1 ? 'y' : 'ies'} to queued. Logs at .factory/logs/queue.log`
                : 'Queue started. Logs at .factory/logs/queue.log'
        });
    } catch (e: any) {
        console.error('Error starting queue:', e);
        return NextResponse.json({ success: false, error: e.message || String(e) }, { status: 500 });
    }
}

function isGeneratedFixStory(storyFile: string): boolean {
    return path.basename(storyFile).startsWith('fix-');
}
