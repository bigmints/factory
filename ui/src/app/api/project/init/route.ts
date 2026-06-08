/**
 * POST /api/project/init — SSE stream of initBridge() file creation events.
 *
 * Streams each file action as a Server-Sent Event so the UI wizard can show
 * real-time checkmarks as files are created.
 *
 * Events:
 *   data: {"file": ".factory/factory.yaml", "action": "created"}
 *   data: {"file": ".factory/blueprint/blueprint.yaml", "action": "skipped"}
 *   ...
 *   data: {"done": true, "success": true, "total": 9, "created": 7}
 */
import { initBridge } from '@engine/init';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
    const { repoPath } = await request.json();

    if (!repoPath) {
        return new Response(JSON.stringify({ success: false, error: 'repoPath required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (data: object) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            try {
                // Run initBridge — it returns a list of {path, action} synchronously
                const result = await initBridge(repoPath);

                // Stream each file event with a small delay for UX
                for (const file of result.files) {
                    send({ file: file.path, action: file.action });
                    // Small yield so events flush in realtime
                    await new Promise(r => setTimeout(r, 60));
                }

                const created = result.files.filter(f => f.action === 'created').length;
                const skipped = result.files.filter(f => f.action === 'skipped').length;
                send({ done: true, success: true, total: result.files.length, created, skipped });
            } catch (error) {
                send({ done: true, success: false, error: String(error) });
            } finally {
                controller.close();
            }
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
