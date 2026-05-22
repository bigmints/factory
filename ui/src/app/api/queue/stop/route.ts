/**
 * Queue Stop API — stop all running builds and delete pending items
 */
import { NextResponse } from 'next/server';
import { execSync } from 'node:child_process';
import { loadQueue, updateItem, setQueueRunning } from '@engine/queue';

/** POST — stop queue, kill builds, delete pending */
export async function POST() {
  try {
    // 1. Kill any running build processes
    try {
      execSync('pkill -f "engine/cli.ts build" 2>/dev/null || true', { stdio: 'ignore' });
      execSync('pkill -f "engine/cli.ts feature" 2>/dev/null || true', { stdio: 'ignore' });
    } catch {
      // pkill returns non-zero if no processes found — that's fine
    }

    // 2. Mark any running items as failed
    const queue = loadQueue();
    const runningItems = queue.filter(item => item.status === 'running');

    if (runningItems.length > 0) {
      const now = new Date().toISOString();
      for (const item of runningItems) {
        updateItem(item.id, {
          status: 'failed',
          error: 'Stopped by user',
          completedAt: now
        });
      }
    }

    // 3. Reset queue running state (pending items are preserved)
    setQueueRunning(false);

    return NextResponse.json({
      stopped: runningItems.length,
      message: `Stopped ${runningItems.length} running build(s). Pending items preserved.`,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
