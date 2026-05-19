import { NextResponse } from 'next/server';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { homedir } from 'node:os';

const FACTORY_ROOT = resolve(homedir(), '.factory');
const SETTINGS_FILE = resolve(FACTORY_ROOT, 'settings.json');

function defaultSettings() {
    return {
        providers: [
            {
                id: 'gemini',
                name: 'Google Gemini',
                kind: 'builtin',
                enabled: false,
                apiKey: '',
                models: [
                    { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro' },
                    { id: 'gemini-2.5-flash-preview-04-17', name: 'Gemini 2.5 Flash' },
                    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
                ],
                defaultModel: 'gemini-2.5-flash-preview-04-17',
            },
            {
                id: 'openai',
                name: 'OpenAI',
                kind: 'builtin',
                enabled: false,
                apiKey: '',
                models: [
                    { id: 'gpt-4o', name: 'GPT-4o' },
                    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
                    { id: 'o3-mini', name: 'o3-mini' },
                ],
                defaultModel: 'gpt-4o-mini',
            },
            {
                id: 'ollama',
                name: 'Ollama (Local)',
                kind: 'builtin',
                enabled: false,
                baseUrl: 'http://localhost:11434',
                models: [],
                defaultModel: '',
            },
        ],
        activeProvider: '',
        buildModel: '',
    };
}

export async function GET() {
    try {
        if (!existsSync(SETTINGS_FILE)) {
            return NextResponse.json(defaultSettings());
        }
        const raw = readFileSync(SETTINGS_FILE, 'utf-8');
        const saved = JSON.parse(raw);
        const defaults = defaultSettings();
        // Merge defaults with saved values for built-in providers
        const merged = defaults.providers.map((def: any) => {
            // Match by id — saved providers might have kind unset (legacy) or 'builtin'
            const s = saved.providers?.find((p: any) => p.id === def.id && (!p.kind || p.kind === 'builtin'));
            if (!s) return def;
            // Carry forward the saved enabled/apiKey/baseUrl/defaultModel, but keep the default kind
            return {
                ...def,
                ...s,
                kind: 'builtin' as const,
                models: s.models?.length ? s.models : def.models,
            };
        });
        // Append any custom openai-compat providers from saved file
        const savedCustom = (saved.providers || []).filter((p: any) => p.kind !== 'builtin');
        for (const cp of savedCustom) {
            if (!merged.find((m: any) => m.id === cp.id)) {
                merged.push(cp);
            }
        }
        return NextResponse.json({
            providers: merged,
            activeProvider: saved.activeProvider || '',
            buildModel: saved.buildModel || '',
            updatedAt: saved.updatedAt,
        });
    } catch {
        return NextResponse.json(defaultSettings());
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        body.updatedAt = new Date().toISOString();
        const dir = dirname(SETTINGS_FILE);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(SETTINGS_FILE, JSON.stringify(body, null, 2) + '\n');
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
