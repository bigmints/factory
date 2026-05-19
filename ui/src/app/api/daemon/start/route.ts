import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function POST() {
    const pidFile = join(process.cwd(), '.factory', 'daemon.pid');
    if (existsSync(pidFile)) {
        const oldPid = parseInt(readFileSync(pidFile, 'utf-8'));
        try {
            process.kill(oldPid, 0);
            return NextResponse.json({ status: 'already-running', pid: oldPid });
        } catch {
            // Old PID is stale, continue
        }
    }
    const child = spawn('npx', ['tsx', 'engine/cli.ts', 'queue', 'daemon'], {
        detached: true,
        stdio: 'ignore',
    });
    writeFileSync(pidFile, String(child.pid));
    child.unref();
    return NextResponse.json({ status: 'started', pid: child.pid });
}
