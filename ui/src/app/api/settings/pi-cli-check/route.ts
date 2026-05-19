import { NextResponse } from 'next/server';
import { execSync } from 'node:child_process';

export async function GET() {
    try {
        const result = execSync('pi --version 2>&1', {
            timeout: 10_000,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: '/bin/bash',
        });
        const version = result.toString().trim();
        return NextResponse.json({ available: true, version });
    } catch (err: any) {
        const isNotFound = err.message?.includes('not found') || err.message?.includes('ENOENT');
        return NextResponse.json({
            available: false,
            error: isNotFound
                ? 'pi CLI is not installed'
                : `pi CLI check failed: ${err.message?.slice(0, 200)}`,
        });
    }
}
