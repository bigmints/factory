import { NextResponse } from 'next/server';
import { updateStoryStatus, archiveStory, restoreStory } from '@engine/story';


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

    // Allow user-settable statuses. Engine manages in-progress/validation automatically.
    const userAllowedStatuses = ['draft', 'ready-to-build', 'building', 'paused', 'failed', 'done'];
    if (!userAllowedStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status "${status}". Use: draft, ready-to-build, building, paused, failed, or done.` },
        { status: 400 }
      );
    }

    // 1. Move file between physical directories if moving to/from completed column
    let currentFile = file;
    if (status === 'done') {
      const archivedPath = archiveStory(file);
      if (archivedPath) {
        // Extract new relative file key (e.g. done/greeting-scaffold.yaml)
        const filename = archivedPath.split('/').pop();
        currentFile = `done/${filename}`;
      }
    } else {
      const restoredPath = restoreStory(file);
      if (restoredPath) {
        const filename = restoredPath.split('/').pop();
        currentFile = filename;
      }
    }

    // 2. Update physical story YAML file status
    updateStoryStatus(currentFile, status);

    // 3. If cancelling/failing a currently running build, kill its specific process
    if (['draft', 'paused', 'failed'].includes(status)) {
      const { exec } = require('node:child_process');
      const escapedFile = currentFile.split('/').pop()?.replace(/["'$]/g, '') || '';
      if (escapedFile) {
        // Find and kill the specific `tsx engine/cli.ts build` process for this file
        exec(`pkill -f "cli.ts build .*${escapedFile}"`, () => {});
      }
    }

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
