import { NextResponse } from 'next/server';
import { updateStoryStatus, archiveStory, restoreStory } from '@engine/story';
import { updateStoryStatusInApp } from '@engine/rollup';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { file, status } = body;

    if (!file || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: file, status' },
        { status: 400 }
      );
    }

    const validStatuses = ['draft', 'ready', 'in-progress', 'validation', 'review', 'done'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // 1. Move file between physical directories if moving to/from completed column
    let currentFile = file;
    if (status === 'done') {
      const archivedPath = archiveStory(file);
      if (archivedPath) {
        // Extract new relative file key (e.g. done/greeting-app.yaml)
        const filename = archivedPath.split('/').pop();
        currentFile = `done/${filename}`;
      }
    } else {
      const restoredPath = restoreStory(file);
      if (restoredPath) {
        const filename = restoredPath.split('/').pop();
        const isFeature = restoredPath.includes('/stories/features/');
        currentFile = isFeature ? `features/${filename}` : filename;
      }
    }

    // 2. Update physical story YAML file status
    updateStoryStatus(currentFile, status);

    // 3. Update status inside app.yaml & calculate rollups
    await updateStoryStatusInApp(currentFile, status);

    return NextResponse.json({
      success: true,
      file: currentFile,
      status,
      message: `Successfully moved story and updated status to "${status}"`
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update story status' },
      { status: 500 }
    );
  }
}
