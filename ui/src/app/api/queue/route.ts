import { NextResponse } from 'next/server';
import { resolve } from 'path';
import { listStories, loadStory } from '@engine/story';
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
        
        for (const file of all) {
            try {
                const story = loadStory(resolve(project.path, '.factory', 'stories', file));
                const status = story.status || 'draft';
                if (['pending', 'building', 'failed', 'done'].includes(status)) {
                    // Match UI expectations
                    const uiStatus = status === 'building' ? 'running' : status;
                    items.push({
                        id: file,
                        status: uiStatus,
                        storyFile: file,
                        title: story.name || file
                    });
                    if (status === 'building') {
                        isRunning = true;
                    }
                }
            } catch { /* ignore */ }
        }
        
        return NextResponse.json({ items, isRunning });
    } catch (e) {
        console.error('Error fetching queue:', e);
        return NextResponse.json({ items: [], isRunning: false }, { status: 500 });
    }
}
