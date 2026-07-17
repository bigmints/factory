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

function normalizeProvider(provider: any) {
    const normalized = { ...provider };
    if (!normalized.kind || normalized.kind === 'builtin') {
        if (normalized.id === 'gemini') normalized.kind = 'gemini';
        else if (normalized.id === 'openai') normalized.kind = 'openai';
        else if (normalized.id === 'ollama') normalized.kind = 'ollama';
        else normalized.kind = 'openai-compat';
    }
    normalized.models = normalized.models || [];
    if (normalized.enabled === undefined) normalized.enabled = true;
    return normalized;
}

function normalizeSettings(settings: any) {
    const providers = (settings.providers || []).map(normalizeProvider);
    const activeProvider = providers.find((p: any) => p.id === settings.activeProvider && p.enabled);
    const activeHasModel = activeProvider && (
        activeProvider.defaultModel === settings.buildModel ||
        activeProvider.models?.some((m: any) => m.id === settings.buildModel)
    );

    if (activeHasModel) {
        return {
            ...settings,
            providers,
            activeProvider: settings.activeProvider || '',
            buildModel: settings.buildModel || '',
        };
    }

    const fallback = providers.find((p: any) => p.enabled && (p.defaultModel || p.models?.[0]?.id));
    return {
        ...settings,
        providers,
        activeProvider: fallback?.id || '',
        buildModel: fallback ? (fallback.defaultModel || fallback.models?.[0]?.id || '') : '',
    };
}

export async function GET() {
    try {
        if (!existsSync(SETTINGS_FILE)) {
            return NextResponse.json(defaultSettings());
        }
        const raw = readFileSync(SETTINGS_FILE, 'utf-8');
        const saved = JSON.parse(raw);
        
        const normalized = normalizeSettings(saved);

        return NextResponse.json({
            providers: normalized.providers,
            activeProvider: normalized.activeProvider || '',
            buildModel: normalized.buildModel || '',
            defaultCli: normalized.defaultCli || '',
            updatedAt: normalized.updatedAt,
        });
    } catch {
        return NextResponse.json(defaultSettings());
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const normalized = normalizeSettings(body);
        normalized.updatedAt = new Date().toISOString();
        const dir = dirname(SETTINGS_FILE);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(SETTINGS_FILE, JSON.stringify(normalized, null, 2) + '\n');
        return NextResponse.json({
            ok: true,
            activeProvider: normalized.activeProvider,
            buildModel: normalized.buildModel,
        });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
