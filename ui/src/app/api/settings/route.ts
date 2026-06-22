import { NextResponse } from 'next/server';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { homedir } from 'node:os';

const FACTORY_ROOT = resolve(homedir(), '.factory');
const SETTINGS_FILE = resolve(FACTORY_ROOT, 'settings.json');

function defaultSettings() {
    return {
        providers: [],
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
        
        // Ensure legacy providers have a valid kind and default values
        const mappedProviders = (saved.providers || []).map((p: any) => {
            if (!p.kind || p.kind === 'builtin') {
                if (p.id === 'gemini') p.kind = 'gemini';
                else if (p.id === 'openai') p.kind = 'openai';
                else if (p.id === 'ollama') p.kind = 'ollama';
                else p.kind = 'openai-compat';
            }
            p.models = p.models || [];
            if (p.enabled === undefined) p.enabled = true;
            return p;
        });

        return NextResponse.json({
            providers: mappedProviders,
            activeProvider: saved.activeProvider || '',
            buildModel: saved.buildModel || '',
            defaultCli: saved.defaultCli || '',
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
