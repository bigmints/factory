import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        // This is a stub for stop. We could kill the process, but typically we let it finish the current build
        // or we could use pkill, but it's dangerous. For now we will just return success.
        
        return NextResponse.json({ success: true, message: 'Queue stop requested (not fully implemented yet)' });
    } catch (e) {
        console.error('Error stopping queue:', e);
        return NextResponse.json({ success: false, message: 'Failed to stop queue' }, { status: 500 });
    }
}
