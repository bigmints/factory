/**
 * Queue Stop API — pause the queue runner without changing item statuses.
 * Stopping is not failure. Running items continue until they finish or are
 * individually stopped via the item-level PATCH endpoint.
 */
import { NextResponse } from 'next/server';
import { setQueueRunning } from '@engine/queue';

/** POST — pause the queue runner (does NOT kill builds or change statuses) */
export async function POST() {
  try {
    setQueueRunning(false);

    return NextResponse.json({
      message: 'Queue paused. Running builds will finish normally. Pending items are preserved.',
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
