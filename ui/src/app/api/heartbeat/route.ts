import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export async function GET() {
    const projects: Array<{ project: string; last_seen: string; task: string; status: string }> = [];
    const projectsDir = join(process.cwd(), '.factory');
    
    if (existsSync(projectsDir)) {
        const yamlPath = join(projectsDir, 'context', 'heartbeat.yaml');
        const toonPath = join(projectsDir, 'context', 'heartbeat.toon');
        
        let data: any = null;
        if (existsSync(yamlPath)) {
            try {
                data = parse(readFileSync(yamlPath, 'utf-8'));
            } catch { /* ignore */ }
        }
        
        if (!data && existsSync(toonPath)) {
            try {
                data = JSON.parse(readFileSync(toonPath, 'utf-8'));
            } catch { /* ignore */ }
        }
        
        if (data) {
            projects.push({
                project: data.heartbeat?.project || 'factory',
                last_seen: data.heartbeat?.last_seen || '',
                task: data.heartbeat?.task || '',
                status: data.heartbeat?.status || 'idle',
            });
        }
    }
    return NextResponse.json(projects);
}

