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
            const yamlPath = join(process.cwd(), '.factory', 'context', 'heartbeat.yaml');
            const toonPath = join(process.cwd(), '.factory', 'context', 'heartbeat.toon');

            const getHeartbeatData = () => {
                if (existsSync(yamlPath)) {
                    try {
                        return parse(readFileSync(yamlPath, 'utf-8'));
                    } catch {}
                }
                if (existsSync(toonPath)) {
                    try {
                        return JSON.parse(readFileSync(toonPath, 'utf-8'));
                    } catch {}
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
