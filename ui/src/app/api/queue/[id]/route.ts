/**
 * Queue item detail API — get details, retry, update priority.
 */
import { NextResponse } from 'next/server';
import { getItem, retryItem, updateItem } from '@engine/queue';

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
