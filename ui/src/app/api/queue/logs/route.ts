import { NextResponse } from 'next/server';
import { getActiveProject } from '@engine/config';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const storyFile = searchParams.get('file');

        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ error: 'No active project' }, { status: 400 });
        }

        let logFile = path.join(project.path, '.factory', 'logs', 'queue.log');
        
        if (storyFile) {
            const basename = path.basename(storyFile);
            logFile = path.join(project.path, '.factory', 'logs', `cli-${basename}.log`);
        }

        if (!fs.existsSync(logFile)) {
            return NextResponse.json({ logs: 'No logs available yet.' });
        }

        // Read the last 100KB of logs to prevent sending huge files
        const stats = fs.statSync(logFile);
        const maxBytes = 100 * 1024; // 100KB
        let logs = '';

        if (stats.size > maxBytes) {
            const fd = fs.openSync(logFile, 'r');
            const buffer = Buffer.alloc(maxBytes);
            fs.readSync(fd, buffer, 0, maxBytes, stats.size - maxBytes);
            fs.closeSync(fd);
            logs = '... [truncated] ...\n' + buffer.toString('utf-8');
        } else {
            logs = fs.readFileSync(logFile, 'utf-8');
        }

        return NextResponse.json({ logs });
    } catch (e: any) {
        console.error('Error reading queue logs:', e);
        return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
    }
}
