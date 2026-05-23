import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';

const FACTORY_ROOT = resolve(homedir(), '.factory');

export async function GET() {
    const projects: Array<{ project: string; last_seen: string; task: string; status: string }> = [];
    
    try {
        const projectsPath = join(FACTORY_ROOT, 'projects.json');
        if (existsSync(projectsPath)) {
            const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
            for (const proj of config.projects || []) {
                const projectDir = join(proj.path, '.factory');
                if (existsSync(projectDir)) {
                    const logsYaml = join(projectDir, 'logs', 'heartbeat.yaml');
                    const logsToon = join(projectDir, 'logs', 'heartbeat.toon');
                    const bpYaml = join(projectDir, 'blueprint', 'heartbeat.yaml');
                    const bpToon = join(projectDir, 'blueprint', 'heartbeat.toon');
                    const ctxYaml = join(projectDir, 'context', 'heartbeat.yaml');
                    const ctxToon = join(projectDir, 'context', 'heartbeat.toon');
                    
                    let data: any = null;
                    const candidates = [logsYaml, logsToon, bpYaml, bpToon, ctxYaml, ctxToon];
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
                            project: proj.name || data.heartbeat?.project || 'factory',
                            last_seen: data.heartbeat?.last_seen || '',
                            task: data.heartbeat?.task || '',
                            status: data.heartbeat?.status || 'idle',
                        });
                    }
                }
            }
        }
    } catch {
        // Fallback to process.cwd()
    }
    
    // Fallback if no projects found or error
    if (projects.length === 0) {
        const projectsDir = join(process.cwd(), '.factory');
        if (existsSync(projectsDir)) {
            const logsYaml = join(projectsDir, 'logs', 'heartbeat.yaml');
            const logsToon = join(projectsDir, 'logs', 'heartbeat.toon');
            const bpYaml = join(projectsDir, 'blueprint', 'heartbeat.yaml');
            const bpToon = join(projectsDir, 'blueprint', 'heartbeat.toon');
            const ctxYaml = join(projectsDir, 'context', 'heartbeat.yaml');
            const ctxToon = join(projectsDir, 'context', 'heartbeat.toon');
            
            let data: any = null;
            const candidates = [logsYaml, logsToon, bpYaml, bpToon, ctxYaml, ctxToon];
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
    }
    
    return NextResponse.json(projects);
}

