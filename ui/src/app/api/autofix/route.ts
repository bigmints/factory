import { homedir } from 'node:os';
/**
 * POST /api/autofix — Use the LLM to fix a broken YAML story
 * Body: { storyFile: "features/foo.yaml", error: "YAML parse error..." }
 *
 * Returns { fixed: boolean, error?: string }
 */
import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const FACTORY_ROOT = resolve(homedir(), '.factory');

function resolveStoryFile(storyFile: string): string {
  try {
    const projectsPath = join(FACTORY_ROOT, 'projects.json');
    if (existsSync(projectsPath)) {
      const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
      if (config.activeProject) {
        const project = config.projects?.find(
          (p: any) => p.id === config.activeProject
        );
        if (project) {
          const isFeature = storyFile.startsWith('features/');
          const subdir = isFeature ? 'features' : 'apps';
          const cleanFile = isFeature ? storyFile.replace(/^features\//, '') : storyFile;
          const projectPath = join(project.path, '.factory', 'stories', subdir, cleanFile);
          if (existsSync(projectPath)) return projectPath;
        }
      }
    }
  } catch {}

  const factoryPath = join(FACTORY_ROOT, 'stories', storyFile);
  if (existsSync(factoryPath)) return factoryPath;

  if (storyFile.startsWith('/') && existsSync(storyFile)) return storyFile;

  throw new Error(`Story file not found: ${storyFile}`);
}

/**
 * Load the LLM settings from the factory's settings.json
 */
function loadLLMSettings(): { provider: string; model: string; apiKey?: string; baseUrl?: string; kind?: string } | null {
  try {
    const settingsPath = join(FACTORY_ROOT, 'settings.json');
    if (!existsSync(settingsPath)) return null;
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    const activeProvider = settings.activeProvider;
    const model = settings.buildModel;
    if (!activeProvider || !model) return null;

    const providerConfig = settings.providers?.find((p: any) => p.id === activeProvider && p.enabled);
    if (!providerConfig) return null;

    return {
      provider: activeProvider,
      model,
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      kind: providerConfig.kind,
    };
  } catch {
    return null;
  }
}

/**
 * Call the LLM to fix a broken YAML story.
 * Supports gemini, openai, ollama, and openai-compat providers.
 */
async function callLLMForFix(prompt: string, settings: NonNullable<ReturnType<typeof loadLLMSettings>>): Promise<string> {
  const { provider, model, apiKey, baseUrl, kind } = settings;

  if (provider === 'gemini') {
    if (!apiKey) throw new Error('Gemini API key not configured');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(`Gemini API error: ${JSON.stringify(data)}`);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider === 'openai' || kind === 'openai-compat') {
    const url = baseUrl ? baseUrl.replace(/\/+$/, '') + '/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 8192,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI-compatible API error: ${JSON.stringify(data)}`);
    return data.choices?.[0]?.message?.content || '';
  }

  if (provider === 'ollama') {
    const ollamaUrl = baseUrl || 'http://localhost:11434';
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.1 },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Ollama API error: ${JSON.stringify(data)}`);
    return data.response || '';
  }

  throw new Error(`Unknown provider: ${provider}`);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const storyFile = body.storyFile || body.specFile;
    const { error } = body;
    
    if (!storyFile) {
      return NextResponse.json({ error: 'storyFile is required' }, { status: 400 });
    }

    const storyPath = resolveStoryFile(storyFile);
    const errorMsg = error || 'Unknown YAML error';
    const rawYaml = readFileSync(storyPath, 'utf-8');

    const llmSettings = loadLLMSettings();
    if (!llmSettings) {
      return NextResponse.json(
        { fixed: false, error: 'No LLM provider configured. Set up a provider in Settings.' },
        { status: 500 }
      );
    }

    const prompt = `You are a YAML story fixer for an autonomous code factory.

The following YAML story file failed to parse. Fix the YAML so it parses correctly.
Keep ALL the original content and meaning — only fix syntax issues like:
- Unquoted strings containing special YAML characters ({ } [ ] : , # & * ? | - < > = ! % @ \`)
- Incorrect indentation
- Missing quotes around values
- Duplicate keys
- Invalid YAML constructs

IMPORTANT RULES:
1. Return ONLY the corrected YAML — no explanations, no markdown fences, no commentary
2. Preserve all original field names, values, and structure
3. If a string value contains special characters, wrap it in single quotes
4. Make sure all indentation is consistent (2 spaces)

## Error Message
${errorMsg}

## Broken YAML
${rawYaml}

Return the fixed YAML now:`;

    const response = await callLLMForFix(prompt, llmSettings);

    // Clean up LLM response — strip markdown fences if present
    let fixedYaml = response.trim();
    if (fixedYaml.startsWith('```')) {
      fixedYaml = fixedYaml.replace(/^```(?:ya?ml)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    // Validate the fixed YAML parses
    const parsed = parseYaml(fixedYaml);
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ fixed: false, error: 'LLM returned invalid YAML structure' });
    }

    // Basic sanity checks
    const isFeature = !!parsed.feature;
    if (isFeature && (!parsed.feature?.name || !parsed.target?.app)) {
      return NextResponse.json({ fixed: false, error: 'Fixed YAML missing required fields (feature.name or target.app)' });
    }
    if (!isFeature && !parsed.metadata?.name && !parsed.appName) {
      return NextResponse.json({ fixed: false, error: 'Fixed YAML missing metadata.name or appName' });
    }

    // Write the fixed YAML back
    writeFileSync(storyPath, fixedYaml + '\n', 'utf-8');

    return NextResponse.json({ fixed: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Autofix failed';
    return NextResponse.json({ fixed: false, error: message }, { status: 500 });
  }
}
