/**
 * Live log streaming API — returns build output from a given byte offset.
 * 
 * GET /api/queue/log?offset=N
 * Returns { log: string, offset: number, done: boolean }
 */
import { NextResponse } from 'next/server';
import { resolve } from 'node:path';
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { isQueueRunning, loadQueue } from '@engine/queue';

const FACTORY_ROOT = resolve(homedir(), '.factory');
const LOG_FILE = resolve(FACTORY_ROOT, 'factory-build.log');

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Check if log file exists
    if (!existsSync(LOG_FILE)) {
        return NextResponse.json({ log: '', offset: 0, done: true });
    }

    try {
        const stat = statSync(LOG_FILE);
        const fileSize = stat.size;

        // Read new content from offset
        let log = '';
        if (offset < fileSize) {
            const buf = Buffer.alloc(fileSize - offset);
            const fd = openSync(LOG_FILE, 'r');
            readSync(fd, buf, 0, buf.length, offset);
            closeSync(fd);
            log = buf.toString('utf-8');
        }

        // Strip ANSI codes for clean display
        const cleanLog = log.replace(/\x1b\[[0-9;]*m/g, '');

        // Check if queue is still running in a database-free way
        let done = true;
        try {
            const isRunning = isQueueRunning();
            const queue = loadQueue();
            const runningCount = queue.filter(item => item.status === 'running').length;
            done = !isRunning && runningCount === 0;
        } catch { 
            /* assume done on errors */
        }

        return NextResponse.json({
            log: cleanLog,
            offset: fileSize,
            done,
        });
    } catch {
        return NextResponse.json({ log: '', offset: 0, done: true });
    }
}
