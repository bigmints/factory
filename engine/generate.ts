/**
 * generate.ts — LLM provider infrastructure.
 *
 * This file now contains ONLY:
 *   1. runPipeline / runFeaturePipeline  — thin wrappers to the orchestrator
 *   2. callProviderWithTools             — LLM API dispatch (Gemini / OpenAI-compat / Ollama)
 *   3. requireActiveProvider             — settings helper used by repl.ts and orchestrate.ts
 *   4. buildToolSystemPrompt             — kept for repl.ts backward-compat (returns basic prompt)
 *
 * The old 3,400-line plan→build→test→iterate pipeline is gone.
 * The orchestrator (orchestrate.ts) is the new engine.
 */

import { loadSettings, getActiveProvider } from './config.ts';
import { orchestrateStory, orchestrateFeatureStory } from './orchestrate.ts';
import type {
    Story, ProjectBlueprint,
    BuildResult, LLMProvider, AppIntegrationBlueprint,
} from './types.ts';

// ─── Re-exported types (used by repl.ts) ─────────────────

export interface LLMResponse {
    text: string;
    tokensIn: number;
    tokensOut: number;
}

export type ToolCallResult = Array<{
    id: string;
    function: { name: string; arguments: Record<string, unknown> };
}>;

export type ToolResponse = LLMResponse & { toolCalls?: ToolCallResult };

export type ToolMessages = Array<{
    role: string;
    content: string;
    tool_calls?: any[];
    tool_call_id?: string;
}>;

// ─── Pipeline Entry Points ───────────────────────────────

/**
 * Run the orchestrator for an app story.
 * The LLM receives full context (TOON, knowledgebase, conventions)
 * and delegates code generation to the user-configured CLI.
 */
export async function runPipeline(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
): Promise<BuildResult> {
    return orchestrateStory(story, blueprint, targetDir, storyFile);
}

/**
 * Run the orchestrator for a feature story.
 */
export async function runFeaturePipeline(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
): Promise<BuildResult> {
    return orchestrateFeatureStory(story, blueprint, targetDir, storyFile);
}

// ─── Provider Helper ─────────────────────────────────────

/**
 * Require an active LLM provider from settings.
 * Used by repl.ts and orchestrate.ts.
 */
export function requireActiveProvider(): { provider: LLMProvider; model: string } {
    const settings = loadSettings();
    const provider = getActiveProvider(settings);
    if (!provider) {
        throw new Error(
            'No active LLM provider configured.\n' +
            'Go to Settings in the Factory UI to configure a provider.'
        );
    }
    const model = settings.buildModel || provider.defaultModel || provider.models[0]?.id || 'gemini-2.5-flash';
    return { provider, model };
}

// ─── Backward-compat stub for repl.ts ───────────────────

/**
 * Build a basic system prompt for the REPL interactive mode.
 * The REPL uses its own tool set (build-tools.ts), not the orchestrator tools.
 */
export function buildToolSystemPrompt(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    _appBlueprint?: AppIntegrationBlueprint,
    _storyFile?: string,
): string {
    const storyName = story.name;

    const conventions = blueprint.conventions.length > 0
        ? `\n## Conventions\n${blueprint.conventions.join('\n\n')}`
        : '';

    const knowledge = blueprint.knowledgeFiles.length > 0
        ? `\n## Knowledge\n${blueprint.knowledgeFiles.map(k => `### ${k.app}\n${k.content}`).join('\n\n')}`
        : '';

    return `You are an autonomous build engine for Factory.
Your task: build "${storyName}" in ${targetDir}.
Use the available tools (read_file, write_file, run_command, etc.) to complete the build.
Call mark_complete when done or mark_failed if you cannot proceed.
${conventions}${knowledge}`;
}

// ─── LLM Provider Dispatch ───────────────────────────────

/**
 * Route a tool-calling turn to the correct provider.
 * Supports: Gemini (native function calling), Ollama, OpenAI-compat.
 */
export async function callProviderWithTools(
    provider: LLMProvider,
    model: string,
    messages: ToolMessages,
    tools: readonly any[],
): Promise<ToolResponse> {
    const kind = provider.kind || 'builtin';

    if (kind === 'builtin') {
        if (provider.id === 'gemini') {
            if (!provider.apiKey) throw new Error('Gemini API key not configured');
            return callGeminiWithTools(provider.apiKey, model, messages, tools);
        }
        if (provider.id === 'ollama') {
            return callOllamaWithTools(provider.baseUrl || 'http://localhost:11434', model, messages, tools);
        }
        // 'openai' built-in falls through to OpenAI-compat
    }

    if (kind === 'cli') {
        throw new Error(
            `CLI provider "${provider.id}" cannot be used as the orchestrator LLM.\n` +
            'Configure an API-based provider (Gemini, OpenAI, Ollama) in Factory Settings.'
        );
    }

    const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
    return callOpenAICompatWithTools(provider.apiKey || '', model, messages, tools, baseUrl);
}

// ─── Gemini ──────────────────────────────────────────────

async function callGeminiWithTools(
    apiKey: string,
    model: string,
    messages: ToolMessages,
    tools: readonly any[],
): Promise<ToolResponse> {
    const toolCallNameMap = new Map<string, string>(); // tool_call_id → function name
    let systemInstruction: string | undefined;
    const contents: Array<{ role: 'user' | 'model'; parts: any[] }> = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction = msg.content;
            continue;
        }
        if (msg.role === 'user') {
            const prev = contents[contents.length - 1];
            if (prev?.role === 'user' && prev.parts.every((p: any) => p.text !== undefined)) {
                prev.parts.push({ text: msg.content });
            } else {
                contents.push({ role: 'user', parts: [{ text: msg.content }] });
            }
            continue;
        }
        if (msg.role === 'assistant') {
            const parts: any[] = [];
            if (msg.content) parts.push({ text: msg.content });
            for (const tc of (msg.tool_calls || [])) {
                toolCallNameMap.set(tc.id, tc.function.name);
                parts.push({ functionCall: { name: tc.function.name, args: tc.function.arguments } });
            }
            if (parts.length > 0) contents.push({ role: 'model', parts });
            continue;
        }
        if (msg.role === 'tool') {
            const funcName = toolCallNameMap.get(msg.tool_call_id || '') || 'unknown_function';
            const responsePart = {
                functionResponse: { name: funcName, response: { content: msg.content } },
            };
            const prev = contents[contents.length - 1];
            if (prev?.role === 'user' && prev.parts.some((p: any) => p.functionResponse)) {
                prev.parts.push(responsePart);
            } else {
                contents.push({ role: 'user', parts: [responsePart] });
            }
            continue;
        }
    }

    const body: Record<string, unknown> = {
        contents,
        tools: [{
            functionDeclarations: tools.map(t => ({
                name: t.name || t.function?.name,
                description: t.description || t.function?.description,
                parameters: t.parameters || t.function?.parameters,
            })),
        }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
    };
    if (systemInstruction) {
        body.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    const MAX_RETRIES = 3;
    let res: Response | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
            );

            if (!res.ok) {
                if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    continue;
                }
                const txt = await res.text();
                throw new Error(`Gemini error (${res.status}): ${txt.slice(0, 400)}`);
            }
            break;
        } catch (e: any) {
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, attempt * 2000));
                continue;
            }
            throw e;
        }
    }

    if (!res) throw new Error('Gemini fetch failed completely');

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('Gemini returned no candidates');

    const parts: any[] = candidate.content?.parts || [];
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text as string).join('');
    const toolCalls: ToolCallResult = parts
        .filter((p: any) => p.functionCall)
        .map((p: any, i: number) => ({
            id: `gemini-${Date.now()}-${i}`,
            function: {
                name: p.functionCall.name as string,
                arguments: (p.functionCall.args || {}) as Record<string, unknown>,
            },
        }));

    return {
        text,
        tokensIn: data.usageMetadata?.promptTokenCount || 0,
        tokensOut: data.usageMetadata?.candidatesTokenCount || 0,
        toolCalls,
    };
}

// ─── OpenAI-compat ───────────────────────────────────────

async function callOpenAICompatWithTools(
    apiKey: string,
    model: string,
    messages: ToolMessages,
    tools: readonly any[],
    baseUrl: string,
): Promise<ToolResponse> {
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const apiMessages = messages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
            ...(m.tool_calls ? {
                tool_calls: m.tool_calls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.function.name,
                        arguments: typeof tc.function.arguments === 'string'
                            ? tc.function.arguments
                            : JSON.stringify(tc.function.arguments),
                    },
                }))
            } : {}),
        }));

        let res: Response;
        try {
            res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
                },
                body: JSON.stringify({
                    model,
                    messages: apiMessages,
                    tools: tools.map(t => ({
                        type: 'function',
                        function: {
                            name: t.name || t.function?.name,
                            description: t.description || t.function?.description,
                            parameters: t.parameters || t.function?.parameters,
                        },
                    })),
                    temperature: 0.2,
                    max_tokens: 16384,
                }),
            });
        } catch (networkErr) {
            if (attempt < MAX_RETRIES) { await sleep(attempt * 2000); continue; }
            throw networkErr;
        }

        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
            const wait = parseInt(res.headers.get('retry-after') || '0') * 1000 || attempt * 2000;
            await sleep(wait);
            continue;
        }

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Provider error (${res.status}) on ${baseUrl}/chat/completions: ${body.slice(0, 300)}`);
        }

        const data = await res.json();
        const choice = data.choices?.[0];
        if (!choice) throw new Error('Provider returned no choices');

        const text = choice.message?.content || '';
        const toolCalls: ToolCallResult = (choice.message?.tool_calls || []).map((tc: any) => {
            let parsedArgs: Record<string, unknown> = {};
            try {
                const raw = tc.function?.arguments;
                parsedArgs = typeof raw === 'object' && raw !== null ? raw : JSON.parse(raw || '{}');
            } catch { parsedArgs = {}; }
            return {
                id: tc.id || `tc-${Date.now()}`,
                function: { name: tc.function?.name || '', arguments: parsedArgs },
            };
        });

        return {
            text,
            tokensIn: data.usage?.prompt_tokens || 0,
            tokensOut: data.usage?.completion_tokens || 0,
            toolCalls,
        };
    }

    throw new Error(`Provider: all ${MAX_RETRIES} retry attempts exhausted`);
}

// ─── Ollama ──────────────────────────────────────────────

async function callOllamaWithTools(
    baseUrl: string,
    model: string,
    messages: ToolMessages,
    tools: readonly any[],
): Promise<ToolResponse> {
    const apiMessages = messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls ? {
            tool_calls: m.tool_calls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.function.name,
                    arguments: typeof tc.function.arguments === 'string'
                        ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return tc.function.arguments; } })()
                        : tc.function.arguments,
                },
            }))
        } : {}),
    }));

    const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: apiMessages,
            tools: tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name || t.function?.name,
                    description: t.description || t.function?.description,
                    parameters: t.parameters || t.function?.parameters,
                },
            })),
            stream: false,
            options: { temperature: 0.2 },
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Ollama error (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const message = data.message;
    const text = message?.content || '';
    const toolCalls: ToolCallResult = (message?.tool_calls || []).map((tc: any, i: number) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
            const raw = tc.function?.arguments;
            parsedArgs = typeof raw === 'object' && raw !== null ? raw : JSON.parse(raw || '{}');
        } catch { parsedArgs = {}; }
        return {
            id: tc.id || `ollama-${Date.now()}-${i}`,
            function: { name: tc.function?.name || '', arguments: parsedArgs },
        };
    });

    return {
        text,
        tokensIn: data.prompt_eval_count || 0,
        tokensOut: data.eval_count || 0,
        toolCalls,
    };
}

// ─── Text-Only LLM Dispatch ──────────────────────────────

export async function callProviderTextOnly(
    provider: LLMProvider,
    model: string,
    systemInstruction: string,
    prompt: string,
): Promise<string> {
    const kind = provider.kind || 'builtin';

    if (kind === 'builtin') {
        if (provider.id === 'gemini') {
            if (!provider.apiKey) throw new Error('Gemini API key not configured');
            
            const body: Record<string, unknown> = {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
            };
            if (systemInstruction) {
                body.system_instruction = { parts: [{ text: systemInstruction }] };
            }

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.apiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
            );

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Gemini error (${res.status}): ${txt.slice(0, 400)}`);
            }

            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return text;
        }

        if (provider.id === 'ollama') {
            const baseUrl = provider.baseUrl || 'http://localhost:11434';
            const res = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemInstruction },
                        { role: 'user', content: prompt }
                    ],
                    stream: false,
                    options: { temperature: 0.2 },
                }),
            });

            if (!res.ok) {
                const body = await res.text();
                throw new Error(`Ollama error (${res.status}): ${body.slice(0, 300)}`);
            }

            const data = await res.json();
            return data.message?.content || '';
        }
    }

    if (kind === 'cli') {
        throw new Error(`CLI provider "${provider.id}" cannot be used for text calls.`);
    }

    // OpenAI-compat
    const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(provider.apiKey ? { 'Authorization': `Bearer ${provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 16384,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI error (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
}

// ─── Util ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}
