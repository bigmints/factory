import { NextResponse } from 'next/server';
import { detectStack } from '@/../engine/init';

export async function POST(request: Request) {
    const { repoPath } = await request.json();
    const stack = detectStack(repoPath);
    return NextResponse.json({ stack: stack || {} });
}
