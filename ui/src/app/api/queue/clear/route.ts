import { NextResponse } from 'next/server';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const enginePath = resolve(dirname(__filename), '../../../../../../../engine');
        
        spawnSync('npx', ['tsx', 'cli.ts', 'queue', 'clear'], {
            cwd: enginePath,
            stdio: 'ignore'
        });

        return NextResponse.json({ success: true, message: 'Queue cleared' });
    } catch (e) {
        console.error('Error clearing queue:', e);
        return NextResponse.json({ success: false, message: 'Failed to clear queue' }, { status: 500 });
    }
}
