/**
 * Queue Clear API — delete ALL queue items regardless of status.
 * Before clearing, persists 'done' status and archives story YAML files for
 * any completed items so they don't bounce back to Ready to Build.
 */
import { NextResponse } from 'next/server';
import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import { saveQueue, setQueueRunning, loadQueue } from '@engine/queue';
import { updateStoryStatus, archiveStory } from '@engine/story';
import { updateStoryStatusInApp } from '@engine/rollup';

/** POST — clear entire queue */
export async function POST() {
  try {
    // Kill any running build processes
    try {
      execSync('pkill -f "engine/cli.ts build" 2>/dev/null || true', { stdio: 'ignore' });
      execSync('pkill -f "engine/cli.ts feature" 2>/dev/null || true', { stdio: 'ignore' });
    } catch {
      // pkill returns non-zero if no processes found
    }

    const queue = loadQueue();
    const count = queue.length;

    // Before clearing: persist 'done' status + archive story files for completed items.
    // This prevents completed stories from bouncing back to "Ready to Build" when
    // their queueStatus entry is removed from the queue.
    const completedItems = queue.filter(item => item.status === 'completed');
    let patched = 0;
    for (const item of completedItems) {
      try {
        // Update status in YAML file
        updateStoryStatus(item.storyFile, 'done');

        // Move to done/ directory so board detects it via file path check
        const archivedPath = archiveStory(item.storyFile);
        const canonicalFile = archivedPath
          ? `done/${basename(archivedPath)}`
          : item.storyFile;

        // Update scaffold.yaml rollup
        await updateStoryStatusInApp(canonicalFile, 'done');
        patched++;
      } catch {
        // Non-fatal — continue clearing even if one YAML update fails
      }
    }

    // Direct atomic YAML write of empty array
    saveQueue([]);
    setQueueRunning(false);

    return NextResponse.json({
      cleared: count,
      patched,
      message: `Cleared ${count} item(s) from queue (${patched} archived to done/)`,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
