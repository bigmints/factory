import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function POST() {
    const pidFile = join(process.cwd(), '.factory', 'daemon.pid');
    if (existsSync(pidFile)) {
        const pid = parseInt(readFileSync(pidFile, 'utf-8'));
        try { process.kill(pid, 'SIGTERM'); } catch {}
        unlinkSync(pidFile);
    }
    const child = spawn('npx', ['tsx', 'engine/cli.ts', 'queue', 'daemon'], {
        detached: true,
        stdio: 'ignore',
    });
    writeFileSync(pidFile, String(child.pid));
    child.unref();
    return NextResponse.json({ status: 'restarted', pid: child.pid });
}
