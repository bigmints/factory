import { NextResponse } from 'next/server';
import { getActiveProject } from '@engine/config';
import { listStories, loadStory, updateStoryStatus } from '@engine/story';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ error: 'No active project' }, { status: 400 });
        }

        // 1. Kill the queue processor process group if we have the PID
        const pidFile = path.join(project.path, '.factory', 'queue.pid');
        let queuePid: number | null = null;
        if (fs.existsSync(pidFile)) {
            const pidStr = fs.readFileSync(pidFile, 'utf-8').trim();
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid)) {
                queuePid = pid;
                terminatePid(pid, 'SIGTERM');
            }
        }
        terminateKnownQueueParents('SIGTERM');
        terminateProjectWorkers(project.path, 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 750));
        if (queuePid !== null && isPidAlive(queuePid)) {
            terminatePid(queuePid, 'SIGKILL');
        }
        terminateKnownQueueParents('SIGKILL');
        terminateProjectWorkers(project.path, 'SIGKILL');
        if (fs.existsSync(pidFile)) {
            try {
                fs.unlinkSync(pidFile);
            } catch {}
        }

        // 2. Reset status of any running stories back to queued
        const stories = listStories(project.path);
        const all = [...stories.apps, ...stories.features];
        for (const file of all) {
            try {
                const pathStr = path.resolve(project.path, '.factory', 'stories', file);
                const story = loadStory(pathStr);
                if (story.status === 'running') {
                    updateStoryStatus(pathStr, 'queued');
                }
            } catch {}
        }

        return NextResponse.json({ success: true, message: 'Queue stopped successfully' });
    } catch (e: any) {
        console.error('Error stopping queue:', e);
        return NextResponse.json({ success: false, error: e.message || String(e) }, { status: 500 });
    }
}

function terminatePid(pid: number, signal: NodeJS.Signals) {
    try {
        process.kill(-pid, signal);
    } catch {
        try {
            process.kill(pid, signal);
        } catch {
            /* process already gone */
        }
    }
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function terminateKnownQueueParents(signal: NodeJS.Signals) {
    for (const { pid, command } of listProcesses()) {
        if (pid === process.pid) continue;
        if (!/(^|\s)(factory|node|npx|tsx)(\s|$)/.test(command)) continue;
        if (!/(^|\s)queue start(\s|$)|engine\/cli\.ts\s+queue\s+start/.test(command)) continue;
        terminatePid(pid, signal);
    }
}

function terminateProjectWorkers(projectPath: string, signal: NodeJS.Signals) {
    const needle = `${path.resolve(projectPath)}${path.sep}.factory${path.sep}`;
    for (const { pid, command } of listProcesses()) {
        if (pid === process.pid || !command.includes(needle)) continue;
        if (!/(engine\/cli\.ts|engine\/pi-sdk-worker\.ts|factory queue|tsx)/.test(command)) continue;
        terminatePid(pid, signal);
    }
}

function listProcesses(): Array<{ pid: number; command: string }> {
    let output = '';
    try {
        output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf-8' });
    } catch {
        return [];
    }
    return output
        .split('\n')
        .map(line => line.trim().match(/^(\d+)\s+(.+)$/))
        .filter((match): match is RegExpMatchArray => Boolean(match))
        .map(match => ({ pid: Number(match[1]), command: match[2] }));
}
