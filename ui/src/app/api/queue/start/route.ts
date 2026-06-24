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

        const parts = ['..', 'bin', 'factory'];
        const factoryBin = [process.cwd(), ...parts].join('/');
        
        // Spawn factory queue start detached and pipe output to log file
        const child = spawn(factoryBin, ['queue', 'start'], {
            detached: true,
            stdio: ['ignore', out, err],
        });
        
        // Save the PID so we can stop the queue later
        const pidFile = path.join(project.path, '.factory', 'queue.pid');
        fs.writeFileSync(pidFile, String(child.pid));
        
        child.unref(); // Let it run in background

        return NextResponse.json({ success: true, message: 'Queue started. Logs at .factory/logs/queue.log' });
    } catch (e: any) {
        console.error('Error starting queue:', e);
        return NextResponse.json({ success: false, error: e.message || String(e) }, { status: 500 });
    }
}
