import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { getActiveProject } from '@engine/config';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ error: 'No active project' }, { status: 400 });
        }

        const logsDir = path.join(project.path, '.factory', 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        const logFile = path.join(logsDir, 'queue.log');
        const out = fs.openSync(logFile, 'a');
        const err = fs.openSync(logFile, 'a');

        const devBin = path.join(process.cwd(), '..', 'bin', 'factory');
        const factoryBin = fs.existsSync(devBin) ? devBin : 'factory';
        
        const pidFile = path.join(project.path, '.factory', 'queue.pid');
        if (fs.existsSync(pidFile)) {
            try {
                const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
                process.kill(pid, 0);
                return NextResponse.json({ error: 'Queue is already running' }, { status: 400 });
            } catch {
                // Not running, safe to start
            }
        }
        
        // Spawn factory queue start detached and pipe output to log file
        const child = spawn(factoryBin, ['queue', 'start'], {
            detached: true,
            stdio: ['ignore', out, err],
        });
        
        // The detached process will write its own PID in handleQueueStart()
        
        child.unref(); // Let it run in background

        return NextResponse.json({ success: true, message: 'Queue started. Logs at .factory/logs/queue.log' });
    } catch (e: any) {
        console.error('Error starting queue:', e);
        return NextResponse.json({ success: false, error: e.message || String(e) }, { status: 500 });
    }
}
