import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export async function GET() {
    const projects: Array<{ project: string; last_seen: string; task: string; status: string }> = [];
    const projectsDir = join(process.cwd(), '.factory');
    
    if (existsSync(projectsDir)) {
        const bpYaml = join(projectsDir, 'blueprint', 'heartbeat.yaml');
        const bpToon = join(projectsDir, 'blueprint', 'heartbeat.toon');
        const ctxYaml = join(projectsDir, 'context', 'heartbeat.yaml');
        const ctxToon = join(projectsDir, 'context', 'heartbeat.toon');
        
        let data: any = null;
        const candidates = [bpYaml, bpToon, ctxYaml, ctxToon];
        for (const p of candidates) {
            if (existsSync(p)) {
                try {
                    const content = readFileSync(p, 'utf-8');
                    data = p.endsWith('.yaml') ? parse(content) : JSON.parse(content);
                    if (data) break;
                } catch { /* ignore */ }
            }
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

