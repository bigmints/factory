import { NextResponse } from 'next/server';
import { getActiveProject } from '@engine/config';
import { listStories, loadStory, updateStoryStatus } from '@engine/story';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ error: 'No active project' }, { status: 400 });
        }

        // 1. Kill the queue processor process group if we have the PID
        const pidFile = path.join(project.path, '.factory', 'queue.pid');
        if (fs.existsSync(pidFile)) {
            const pidStr = fs.readFileSync(pidFile, 'utf-8').trim();
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid)) {
                try {
                    // Kill process group (negative PID)
                    process.kill(-pid, 'SIGTERM');
                } catch {
                    try {
                        process.kill(pid, 'SIGTERM');
                    } catch {
                        /* ignore */
                    }
                }
            }
            try {
                fs.unlinkSync(pidFile);
            } catch {}
        }

        // 2. Reset status of any building/running stories back to ready-to-build
        const stories = listStories(project.path);
        const all = [...stories.apps, ...stories.features];
        for (const file of all) {
            try {
                const pathStr = path.resolve(project.path, '.factory', 'stories', file);
                const story = loadStory(pathStr);
                if (story.status === 'building') {
                    updateStoryStatus(pathStr, 'ready-to-build');
                }
            } catch {}
        }

        return NextResponse.json({ success: true, message: 'Queue stopped successfully' });
    } catch (e: any) {
        console.error('Error stopping queue:', e);
        return NextResponse.json({ success: false, error: e.message || String(e) }, { status: 500 });
    }
}
