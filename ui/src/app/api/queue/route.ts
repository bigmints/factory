import { NextResponse } from 'next/server';
import { resolve } from 'path';
import { listStories, loadStory, updateStoryStatus, sortStoriesTopologically } from '@engine/story';
import { getActiveProject } from '@engine/config';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ items: [], isRunning: false });
        }
        
        const stories = listStories(project.path);
        const all = [...stories.apps, ...stories.features];
        const items: any[] = [];
        let isRunning = false;
        
        const pendingForSort: Array<{ path: string, story: any }> = [];
        for (const file of all) {
            try {
                const pathStr = resolve(project.path, '.factory', 'stories', file);
                const story = loadStory(pathStr);
                const status = story.status || 'draft';
                if (['pending', 'ready-to-build', 'building', 'failed', 'done'].includes(status)) {
                    pendingForSort.push({ path: file, story });
                }
            } catch { /* ignore */ }
        }

        const sorted = sortStoriesTopologically(pendingForSort);

        for (const item of sorted) {
            const status = item.story.status || 'draft';
            const uiStatus = status === 'building' ? 'running' : (status === 'ready-to-build' ? 'pending' : status);
            items.push({
                id: item.path,
                status: uiStatus,
                storyFile: item.path,
                title: item.story.name || item.path,
                dependsOn: item.story.dependsOn || [],
                phase: item.story.phase || 1
            });
            if (status === 'building') {
                isRunning = true;
            }
        }
        
        return NextResponse.json({ items, isRunning });
    } catch (e) {
        console.error('Error fetching queue:', e);
        return NextResponse.json({ items: [], isRunning: false }, { status: 500 });
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

        // Update the story's status to 'ready-to-build' to queue it for the engine
        updateStoryStatus(storyFile, 'ready-to-build');

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
