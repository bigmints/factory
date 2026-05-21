import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project');
    if (!project) return NextResponse.json({ error: 'Missing project param' }, { status: 400 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            const bpYaml = join(process.cwd(), '.factory', 'blueprint', 'heartbeat.yaml');
            const bpToon = join(process.cwd(), '.factory', 'blueprint', 'heartbeat.toon');
            const ctxYaml = join(process.cwd(), '.factory', 'context', 'heartbeat.yaml');
            const ctxToon = join(process.cwd(), '.factory', 'context', 'heartbeat.toon');

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
