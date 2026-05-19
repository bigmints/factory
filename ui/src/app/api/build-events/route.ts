import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project');
    if (!project) return NextResponse.json({ error: 'Missing project param' }, { status: 400 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            const heartbeatPath = join(process.cwd(), '.factory', 'context', 'heartbeat.toon');

            // Send initial state
            if (existsSync(heartbeatPath)) {
                const data = readFileSync(heartbeatPath, 'utf-8');
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', data: JSON.parse(data) })}\n\n`));
            }

            // Poll for updates every 2 seconds
            const interval = setInterval(() => {
                try {
                    if (existsSync(heartbeatPath)) {
                        const data = readFileSync(heartbeatPath, 'utf-8');
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'update', data: JSON.parse(data) })}\n\n`));
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
