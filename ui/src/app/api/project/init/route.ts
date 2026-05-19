import { NextResponse } from 'next/server';
import { initBridge } from '@/../engine/init';

export async function POST(request: Request) {
    const { repoPath } = await request.json();
    const result = initBridge(repoPath);
    return NextResponse.json(result);
}
