/**
 * Queue Clear API — delete ALL queue items regardless of status
 */
import { NextResponse } from 'next/server';
import { execSync } from 'node:child_process';
import { saveQueue, setQueueRunning, loadQueue } from '@engine/queue';

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

    // Direct atomic YAML write of empty array
    saveQueue([]);
    setQueueRunning(false);

    return NextResponse.json({
      cleared: count,
      message: `Cleared ${count} item(s) from queue`,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
