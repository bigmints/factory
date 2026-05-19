import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export async function GET() {
    const projects: Array<{ project: string; last_seen: string; task: string; status: string }> = [];
    const projectsDir = join(process.cwd(), '.factory');
    if (existsSync(projectsDir)) {
        const heartbeatPath = join(projectsDir, 'context', 'heartbeat.toon');
        if (existsSync(heartbeatPath)) {
            try {
                const data = JSON.parse(readFileSync(heartbeatPath, 'utf-8'));
                projects.push({
                    project: data.heartbeat?.project || 'factory',
                    last_seen: data.heartbeat?.last_seen || '',
                    task: data.heartbeat?.task || '',
                    status: data.heartbeat?.status || 'idle',
                });
            } catch { /* ignore */ }
        }
    }
    return NextResponse.json(projects);
}
