/**
 * Queue item detail API — get details, retry, update priority.
 */
import { NextResponse } from 'next/server';
import { getItem, retryItem, updateItem, loadQueue } from '@engine/queue';
import { execSync } from 'node:child_process';

/** GET — get a specific queue item */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const item = getItem(id);

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** PATCH — retry a failed item or update priority */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const item = getItem(id);
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    let updated = item;

    // Start: reset failed/needs-attention/blocked/completed/pending to pending, and boost priority
    if (body.action === 'start') {
      const queue = loadQueue();
      const maxPriority = queue.reduce((max, i) => i.priority > max ? i.priority : max, 0);
      const res = updateItem(id, {
        status: 'pending',
        priority: maxPriority + 1,
        error: null,
        output: '',
        startedAt: null,
        completedAt: null,
        durationMs: null,
      });
      if (res) {
        updated = res;
      }
    }

    // Stop: kill the process of a running task, and mark failed
    if (body.action === 'stop') {
      if (item.status !== 'running') {
        return NextResponse.json({ error: 'Only active running items can be stopped' }, { status: 400 });
      }

      // Kill process cleanly using pkill by matching the unique story file path and basename
      try {
        execSync(`pkill -f "${item.storyFile}" 2>/dev/null || true`);
      } catch {}

      const cleanFile = item.storyFile.replace(/^(apps|features|done)\//, '');
      try {
        execSync(`pkill -f "${cleanFile}" 2>/dev/null || true`);
      } catch {}

      const res = updateItem(id, {
        status: 'failed',
        error: 'Stopped by user',
        completedAt: new Date().toISOString(),
      });
      if (res) {
        updated = res;
      }
    }

    // Retry: reset failed/needs-attention to pending
    if (body.action === 'retry') {
      if (!['failed', 'needs-attention'].includes(item.status)) {
        return NextResponse.json({ error: 'Can only retry failed items' }, { status: 400 });
      }

      const res = retryItem(id);
      if (res) {
        updated = res;
      }
    }

    // Update priority
    if (body.priority !== undefined) {
      const res = updateItem(id, { priority: Number(body.priority) });
      if (res) {
        updated = res;
      }
    }

    return NextResponse.json({ item: updated });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
