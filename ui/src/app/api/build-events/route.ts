import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { homedir } from 'node:os';

const FACTORY_ROOT = resolve(homedir(), '.factory');

function getProjectPath(projectParam: string | null): string {
    try {
        const projectsPath = join(FACTORY_ROOT, 'projects.json');
        if (existsSync(projectsPath)) {
            const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
            const targetId = projectParam || config.activeProject;
            if (targetId) {
                const p = config.projects?.find((p: any) => p.id === targetId);
                if (p && existsSync(p.path)) {
                    return p.path;
                }
            }
        }
    } catch {}
    return process.cwd();
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project');
    if (!project) return NextResponse.json({ error: 'Missing project param' }, { status: 400 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            const projectRoot = getProjectPath(project);
            const bpYaml = join(projectRoot, '.factory', 'blueprint', 'heartbeat.yaml');
            const bpToon = join(projectRoot, '.factory', 'blueprint', 'heartbeat.toon');
            const ctxYaml = join(projectRoot, '.factory', 'context', 'heartbeat.yaml');
            const ctxToon = join(projectRoot, '.factory', 'context', 'heartbeat.toon');

            const getHeartbeatData = () => {
                const candidates = [bpYaml, bpToon, ctxYaml, ctxToon];
                for (const p of candidates) {
                    if (existsSync(p)) {
                        try {
                            const content = readFileSync(p, 'utf-8');
                            return p.endsWith('.yaml') ? parse(content) : JSON.parse(content);
                        } catch {}
                    }
                }
                return null;
            };

            // Send initial state
            const initialData = getHeartbeatData();
            if (initialData) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', data: initialData })}\n\n`));
            }

            // Poll for updates every 2 seconds
            const interval = setInterval(() => {
                try {
                    const data = getHeartbeatData();
                    if (data) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'update', data: data })}\n\n`));
                    }
                } catch {
                    // Ignore read errors
                }
            }, 2000);

            // Cleanup on disconnect
            return () => clearInterval(interval);
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
