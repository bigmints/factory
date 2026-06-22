import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const enginePath = resolve(dirname(__filename), '../../../../../../../engine');
        
        // Use npx tsx to run the factory CLI queue start command
        const child = spawn('npx', ['tsx', 'cli.ts', 'queue', 'start'], {
            cwd: enginePath,
            detached: true,
            stdio: 'ignore', // Don't wait for it
        });
        
        child.unref(); // Let it run in background

        return NextResponse.json({ success: true, message: 'Queue started' });
    } catch (e) {
        console.error('Error starting queue:', e);
        return NextResponse.json({ success: false, message: 'Failed to start queue' }, { status: 500 });
    }
}
