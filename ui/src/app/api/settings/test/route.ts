import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const { provider, apiKey, baseUrl, kind } = await request.json();

        // Custom openai-compat providers: call their /v1/models endpoint
        if (kind === 'openai-compat') {
            if (!baseUrl) return NextResponse.json({ ok: false, message: 'Base URL is required' });
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
                const modelsUrl = baseUrl.replace(/\/+$/, '') + '/models';
                const res = await fetch(modelsUrl, {
                    signal: controller.signal,
                    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
                });
                clearTimeout(timeout);
                if (!res.ok) {
                    const body = await res.text();
                    return NextResponse.json({ ok: false, message: `API error (${res.status}): ${body.slice(0, 200)}` });
                }
                const data = await res.json();
                const modelList = (data.data || data.models || [])
                    .slice(0, 50)
                    .map((m: any) => ({
                        id: m.id || m.name,
                        name: m.name || m.id || m.model || 'unknown',
                    }));
                modelList.sort((a: any, b: any) => a.id.localeCompare(b.id));
                return NextResponse.json({
                    ok: true,
                    message: `Connected — ${modelList.length} models available`,
                    models: modelList,
                });
            } catch (err: any) {
                clearTimeout(timeout);
                const msg = err.name === 'AbortError'
                    ? 'Connection timed out'
                    : err.code === 'ECONNREFUSED'
                        ? 'Connection refused'
                        : err.message || 'Connection failed';
                return NextResponse.json({ ok: false, message: msg });
            }
        }

        switch (provider) {
            case 'gemini': {
                if (!apiKey) return NextResponse.json({ ok: false, message: 'API key is required' });
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
                );
                if (!res.ok) {
                    const body = await res.text();
                    return NextResponse.json({ ok: false, message: `API error (${res.status}): ${body.slice(0, 200)}` });
                }
                const data = await res.json();
                const models = (data.models || [])
                    .filter((m: any) => m.name?.includes('gemini'))
                    .slice(0, 15)
                    .map((m: any) => ({
                        id: m.name?.replace('models/', '') || m.name,
                        name: m.displayName || m.name,
                    }));
                return NextResponse.json({ ok: true, message: `Connected — ${models.length} Gemini models available`, models });
            }

            case 'openai': {
                if (!apiKey) return NextResponse.json({ ok: false, message: 'API key is required' });
                const res = await fetch('https://api.openai.com/v1/models', {
                    headers: { Authorization: `Bearer ${apiKey}` },
                });
                if (!res.ok) {
                    const body = await res.text();
                    return NextResponse.json({ ok: false, message: `API error (${res.status}): ${body.slice(0, 200)}` });
                }
                const data = await res.json();
                const models = (data.data || [])
                    .filter((m: any) => m.id?.startsWith('gpt-') || m.id?.startsWith('o1') || m.id?.startsWith('o3'))
                    .sort((a: any, b: any) => a.id.localeCompare(b.id))
                    .slice(0, 20)
                    .map((m: any) => ({
                        id: m.id,
                        name: m.id,
                    }));
                return NextResponse.json({ ok: true, message: `Connected — ${models.length} models available`, models });
            }

            case 'ollama': {
                const url = baseUrl || 'http://localhost:11434';
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                try {
                    const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
                    clearTimeout(timeout);
                    if (!res.ok) {
                        return NextResponse.json({ ok: false, message: `Ollama responded with ${res.status}` });
                    }
                    const data = await res.json();
                    const models = (data.models || []).map((m: any) => ({
                        id: m.name || m.model,
                        name: m.name || m.model,
                    }));
                    return NextResponse.json({ ok: true, message: `Connected — ${models.length} models pulled`, models });
                } catch (err: any) {
                    clearTimeout(timeout);
                    const msg = err.name === 'AbortError'
                        ? 'Connection timed out — is Ollama running?'
                        : err.code === 'ECONNREFUSED'
                            ? 'Connection refused — is Ollama running?'
                            : err.message || 'Connection failed';
                    return NextResponse.json({ ok: false, message: msg });
                }
            }

            default:
                return NextResponse.json({ ok: false, message: `Unknown provider: ${provider}` });
        }
    } catch (err: any) {
        return NextResponse.json({ ok: false, message: err.message || 'Unexpected error' }, { status: 500 });
    }
}
