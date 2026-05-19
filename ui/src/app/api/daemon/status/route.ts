import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function GET() {
    const pidFile = join(process.cwd(), '.factory', 'daemon.pid');
    if (!existsSync(pidFile)) {
        return NextResponse.json({ status: 'stopped', pid: null, pending: 0 });
    }
    const pid = parseInt(readFileSync(pidFile, 'utf-8'));
    try {
        process.kill(pid, 0);
        return NextResponse.json({ status: 'running', pid, pending: 0 });
    } catch {
        return NextResponse.json({ status: 'stalled', pid, pending: 0 });
    }
}
