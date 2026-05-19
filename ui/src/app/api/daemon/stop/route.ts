import { NextResponse } from 'next/server';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export async function POST() {
    const pidFile = join(process.cwd(), '.factory', 'daemon.pid');
    if (!existsSync(pidFile)) return NextResponse.json({ error: 'No daemon running' }, { status: 400 });
    const pid = parseInt(readFileSync(pidFile, 'utf-8'));
    try {
        process.kill(pid, 'SIGTERM');
        unlinkSync(pidFile);
        return NextResponse.json({ status: 'stopped' });
    } catch {
        return NextResponse.json({ error: 'Failed to stop daemon' }, { status: 500 });
    }
}
