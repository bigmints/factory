import { NextResponse } from 'next/server';
import { resolve, join } from 'path';
import { existsSync, readFileSync } from 'node:fs';
import { listStories, loadStory, updateStoryStatus, sortStoriesForExecution } from '@engine/story';
import { getActiveProject, loadBridgeConfig, loadSettings } from '@engine/config';
import { readLifecycleStatus } from '@engine/schemas';
import { preflightDgx, resolvePiDgxProvider } from '@engine/dgx';

export const dynamic = 'force-dynamic';

let dgxCache: { expiresAt: number; value: any } | null = null;

async function getDgxStatus(project: any) {
    if (dgxCache && dgxCache.expiresAt > Date.now()) return dgxCache.value;
    try {
        const settings = loadSettings();
        const selection = resolvePiDgxProvider(settings, project.piConfig);
        const ready = await preflightDgx(selection.provider, selection.model);
        dgxCache = { expiresAt: Date.now() + 15_000, value: { state: 'ready', ...ready } };
    } catch (error) {
        const message = error instanceof Error ? error.message.replace(/^DGX_PREFLIGHT_FAILED:\s*/, '') : String(error);
        dgxCache = { expiresAt: Date.now() + 15_000, value: { state: 'unavailable', error: message } };
    }
    return dgxCache.value;
}

export async function GET() {
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ items: [], isRunning: false });
        }
        
        const stories = listStories(project.path);
        const bridge = loadBridgeConfig(project.path);
        const all = [...stories.apps, ...stories.features];
        const items: any[] = [];
        let isRunning = isLiveQueueProcess(project.path);
        
        const activeForSort: Array<{ path: string, story: any }> = [];
        for (const file of all) {
            try {
                const pathStr = resolve(project.path, '.factory', 'stories', file);
                const story = loadStory(pathStr);
                const status = readLifecycleStatus(story.status);
                if (['queued', 'running', 'review', 'failed'].includes(status)) {
                    story.status = status;
                    activeForSort.push({ path: file, story });
                }
            } catch { /* ignore */ }
        }

        const sorted = sortStoriesForExecution(activeForSort);

        for (const item of sorted) {
            const status = readLifecycleStatus(item.story.status);
            items.push({
                id: item.path,
                status,
                storyFile: item.path,
                title: item.story.name || item.path,
                dependsOn: item.story.dependsOn || [],
                phase: item.story.phase || 1,
                error: item.story.failureReason || item.story.error || null,
                kind: item.story.kind === 'feature' ? 'FeatureStory' : 'AppStory',
                execution: item.story.execution || null,
            });
            if (status === 'running') {
                isRunning = true;
            }
        }
        
        return NextResponse.json({
            items,
            isRunning,
            dgx: await getDgxStatus(project),
            capacity: {
                maxWorkers: 1,
                activeWorkers: items.filter(item => item.status === 'running').length,
                unattendedEnabled: bridge.delivery?.unattended?.enabled === true,
                humanMergeRequired: bridge.delivery?.requireHumanMerge !== false,
            },
        });
    } catch (e) {
        console.error('Error fetching queue:', e);
        return NextResponse.json({ items: [], isRunning: false }, { status: 500 });
    }
}

function isLiveQueueProcess(projectPath: string): boolean {
    const pidFile = join(projectPath, '.factory', 'queue.pid');
    if (!existsSync(pidFile)) return false;
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export async function POST(request: Request) {
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ error: 'No active project' }, { status: 400 });
        }

        const body = await request.json();
        const { storyFile } = body;

        if (!storyFile) {
            return NextResponse.json(
                { error: 'Missing required field: storyFile' },
                { status: 400 }
            );
        }

        updateStoryStatus(storyFile, 'queued');

        return NextResponse.json({
            success: true,
            message: `Successfully queued story ${storyFile} for build.`
        });
    } catch (e: any) {
        console.error('Error queuing story:', e);
        return NextResponse.json(
            { error: e.message || 'Failed to queue story' },
            { status: 500 }
        );
    }
}
