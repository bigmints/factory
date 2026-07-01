import { NextResponse } from 'next/server';
import cp from 'child_process';
import { getActiveProject } from '@engine/config';

export async function POST() {
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ error: 'No active project' }, { status: 400 });
        }
        const fs = require('fs');
        const path = require('path');
        const devBin = path.join(process.cwd(), '..', 'bin', 'factory');
        const factoryBin = fs.existsSync(devBin) ? devBin : 'factory';
        const logsDir = path.join(project.path, '.factory', 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        const logFile = path.join(logsDir, 'knowledge-build.log');
        const out = fs.openSync(logFile, 'a');
        const err = fs.openSync(logFile, 'a');

        // Run in background detached
        const child = cp.spawn(factoryBin, ['build-knowledge', project.path], {
            detached: true,
            stdio: ['ignore', out, err]
        });
        
        child.unref();

        return NextResponse.json({ success: true, message: 'Knowledge build started in background. Logs at .factory/logs/knowledge-build.log' });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
    }
}
