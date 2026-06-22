import { NextResponse } from 'next/server';
import cp from 'child_process';
import { getActiveProject } from '../../../../../../engine/config';

export async function POST() {
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            return NextResponse.json({ error: 'No active project' }, { status: 400 });
        }
        const parts = ['..', 'bin', 'factory'];
        const factoryBin = [process.cwd(), ...parts].join('/');
        
        // Run in background detached
        const child = cp.spawn(factoryBin, ['build-knowledge', project.path], {
            detached: true,
            stdio: 'ignore'
        });
        
        child.unref();

        return NextResponse.json({ success: true, message: 'Knowledge build started in background' });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
    }
}
