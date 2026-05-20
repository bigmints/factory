import { homedir } from 'node:os';
/**
 * POST /api/chat — Streaming LLM chat for story generation
 *
 * Reads the active provider + API key from settings.json,
 * sends a system prompt instructing the LLM to generate Factory-compatible YAML stories,
 * and returns a streaming response.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FACTORY_ROOT = resolve(homedir(), '.factory');

/**
 * Read the active project's bridge config (factory.yaml) inline,
 * since importing from the engine is outside Next.js's module boundary.
 */
function getActiveBridgeConfig(): { stack?: Record<string, string> } | null {
  try {
    const projectsPath = join(FACTORY_ROOT, 'projects.json');
    if (!existsSync(projectsPath)) return null;
    const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
    if (!config.activeProject) return null;
    const project = config.projects?.find((p: any) => p.id === config.activeProject);
    if (!project) return null;

    // Read factory.yaml from the project's .factory dir
    const factoryYaml = join(project.path, '.factory', 'factory.yaml');
    if (existsSync(factoryYaml)) {
      const bridge = parseYaml(readFileSync(factoryYaml, 'utf-8'));
      return { stack: { ...project.stack, ...bridge?.stack } };
    }
    return { stack: project.stack };
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT_NEW_APP = `You are an expert software architect for Factory.
Your task is to DECOMPOSE user requirements into modular, buildable stories.

When the user describes an application, you MUST output:
1. ONE app story (the core project definition with data model)
2. MULTIPLE feature stories (each a focused, independently buildable module)

Use this EXACT output format with delimiters:

=== APP_STORY: app-name.yaml ===
\`\`\`yaml
appName: "App Name"
description: "Brief description of the overall application"

stack:
  framework: next.js
  packageManager: pnpm
  language: typescript
  linter: eslint
  testing: vitest

dependencies:
  - express
  - dotenv
  - cors

data:
  tables:
    - name: table_name
      fields:
        fieldName: { type: string, required: true }
        anotherField: { type: number, default: 0 }

deployment:
  port: 3050

status: draft
\`\`\`
=== END_STORY ===

=== FEATURE_STORY: feature-slug.yaml ===
\`\`\`yaml
feature:
  name: "Feature Name"
  slug: feature-slug

target:
  app: app-name

phase: 1

dependsOn: []

description: >
  What this feature does and why it exists.

dependencies:
  - "npm-package-name"

modules:
  - name: ModuleName
    path: src/path/to/module.ts
    description: >
      What this module does. Key functions and interfaces it exposes.

behavior:
  - How the feature behaves in specific scenarios
  - Edge cases and important rules

config:
  settingName: defaultValue

status: draft
\`\`\`
=== END_STORY ===

RULES:
- Break down the app into SMALL, FOCUSED features. Each feature should be independently buildable.
- Assign phases logically: Phase 1 = core/foundational, Phase 2 = extended capabilities, Phase 3 = polish/optional.
- Each feature story must include: description, modules (with file paths), behavior rules, and config.
- Use meaningful names and slugs (kebab-case for slugs).
- The app story contains the data model (tables) and stack config. Features reference the app via target.app.
- Include 3-8 feature stories depending on complexity. Don't make features too large.
- After all story blocks, write a brief summary explaining the decomposition rationale and phase strategy.
- Data types for fields: string, number, boolean, array.
- Set deployment port between 3050-3099.
- IMPORTANT: Use \`dependsOn\` to list the slugs of other feature stories that MUST be built BEFORE this one. If a feature has no dependencies, use an empty array \`[]\`. The engine enforces this ordering — a story will NOT build until all its dependencies are completed.
- Example: A "dashboard" feature (phase 2) that needs auth and data-models would have: \`dependsOn: [auth-system, data-models]\`
- CRITICAL — PACKAGE DECLARATIONS: Every app story and feature story MUST include a \`dependencies\` array listing ALL npm packages that the generated code will need. Think carefully about what imports the code will use. For example:
  - If the feature uses a database ORM, include \`drizzle-orm\`, \`better-sqlite3\`, etc.
  - If it sends emails, include \`nodemailer\`, \`@types/nodemailer\`
  - If it uses web scraping, include \`puppeteer\`
  - If it uses environment variables, include \`dotenv\`
  - If it generates unique IDs, include \`uuid\` or \`@paralleldrive/cuid2\`
  - Always include \`@types/\` packages for any untyped dependencies
  - Do NOT include version numbers — just the package name. The engine resolves versions automatically.

Be thorough, creative, and production-ready.`;

const SYSTEM_PROMPT_EXISTING_APP = `You are an expert software architect for Factory.
The user has an EXISTING application. Your task is to DECOMPOSE their new requirements into modular FEATURE STORIES that integrate with the existing app.

Do NOT generate an app story — one already exists. Only generate feature stories.

Use this EXACT output format with delimiters:

=== FEATURE_STORY: feature-slug.yaml ===
\`\`\`yaml
feature:
  name: "Feature Name"
  slug: feature-slug

target:
  app: EXISTING_APP_NAME

phase: 1

dependsOn: []

description: >
  What this feature does and why it exists.

dependencies:
  - "npm-package-name"

modules:
  - name: ModuleName
    path: src/path/to/module.ts
    description: >
      What this module does. Key functions and interfaces it exposes.

behavior:
  - How the feature behaves in specific scenarios
  - Edge cases and important rules

config:
  settingName: defaultValue

status: draft
\`\`\`
=== END_STORY ===

RULES:
- Break down requirements into SMALL, FOCUSED features. Each feature should be independently buildable.
- Assign phases logically: Phase 1 = core/foundational, Phase 2 = extended capabilities, Phase 3 = polish/optional.
- Each feature story must include: description, modules (with file paths), behavior rules, and config.
- Use meaningful names and slugs (kebab-case for slugs).
- Reference the existing app name in target.app for every feature story.
- Include 2-8 feature stories depending on complexity
- After all story blocks, write a brief summary explaining the decomposition rationale and phase strategy.
- IMPORTANT: Use \`dependsOn\` to list the slugs of other feature stories that MUST be built BEFORE this one. If a feature has no dependencies, use an empty array \`[]\`. The engine enforces this ordering — a story will NOT build until all its dependencies are completed.
- Example: A "dashboard" feature (phase 2) that needs auth would have: \`dependsOn: [auth-system]\`
- CRITICAL — PACKAGE DECLARATIONS: Every feature story MUST include a \`dependencies\` array listing ALL npm packages that the generated code will need. Think carefully about what imports the code will use:
  - If the feature sends emails, include \`nodemailer\`, \`@types/nodemailer\`
  - If it uses web scraping, include \`puppeteer\`
  - If it uses environment variables, include \`dotenv\`
  - If it needs unique IDs, include \`uuid\` or \`@paralleldrive/cuid2\`
  - Always include \`@types/\` packages for any untyped dependencies
  - Do NOT include version numbers — just the package name. The engine resolves versions automatically.

Be thorough, creative, and production-ready.`;

/**
 * Format repo scan results into a structured context block for the system prompt.
 */
function formatRepoContext(ctx: any): string {
  const lines: string[] = ['\n\nREPO CONTEXT (from scanning the actual project codebase):'];

  // Agent instructions (mandatory — project architecture and conventions)
  if (ctx.agentInstructions) {
    lines.push(`\n=== PROJECT INSTRUCTIONS (from agents.md) ===`);
    lines.push(ctx.agentInstructions);
    lines.push(`=== END PROJECT INSTRUCTIONS ===`);
  } else {
    lines.push(`\n⚠️ WARNING: No agents.md found in the project. Generated stories may not align with project conventions.`);
  }

  // Stack
  if (ctx.stack) {
    lines.push(`\nDetected Stack:`);
    lines.push(`- Framework: ${ctx.stack.framework}`);
    lines.push(`- Package Manager: ${ctx.stack.packageManager}`);
    lines.push(`- Language: ${ctx.stack.language}`);
    if (ctx.stack.linter) lines.push(`- Linter: ${ctx.stack.linter}`);
    if (ctx.stack.testing) lines.push(`- Testing: ${ctx.stack.testing}`);
    if (ctx.stack.database) lines.push(`- Database: ${ctx.stack.database}`);
    if (ctx.stack.cloud) lines.push(`- Cloud: ${ctx.stack.cloud}`);
  }

  // Dependencies
  if (ctx.dependencies && Object.keys(ctx.dependencies).length > 0) {
    const deps = Object.entries(ctx.dependencies)
      .map(([name, ver]) => `${name}@${ver}`)
      .join(', ');
    lines.push(`\nInstalled Dependencies (${Object.keys(ctx.dependencies).length}):\n${deps}`);
  }

  if (ctx.devDependencies && Object.keys(ctx.devDependencies).length > 0) {
    const devDeps = Object.entries(ctx.devDependencies)
      .map(([name, ver]) => `${name}@${ver}`)
      .join(', ');
    lines.push(`\nDev Dependencies (${Object.keys(ctx.devDependencies).length}):\n${devDeps}`);
  }

  // Scripts
  if (ctx.scripts && Object.keys(ctx.scripts).length > 0) {
    const scriptList = Object.entries(ctx.scripts)
      .map(([name, cmd]) => `  ${name}: ${cmd}`)
      .join('\n');
    lines.push(`\nNPM Scripts:\n${scriptList}`);
  }

  // TSConfig highlights
  if (ctx.tsconfig?.compilerOptions) {
    const opts = ctx.tsconfig.compilerOptions;
    const highlights: string[] = [];
    if (opts.target) highlights.push(`target: ${opts.target}`);
    if (opts.module) highlights.push(`module: ${opts.module}`);
    if (opts.jsx) highlights.push(`jsx: ${opts.jsx}`);
    if (opts.paths) highlights.push(`paths: ${JSON.stringify(opts.paths)}`);
    if (highlights.length > 0) {
      lines.push(`\nTSConfig: ${highlights.join(', ')}`);
    }
  }

  // File tree (truncated)
  if (ctx.fileTree && ctx.fileTree.length > 0) {
    const displayTree = ctx.fileTree.slice(0, 100);
    lines.push(`\nExisting Files (${ctx.fileTree.length} total, showing first ${displayTree.length}):`);
    lines.push(displayTree.join('\n'));
  }

  // Existing stories — full YAML content so the LLM sees exactly what's defined
  if (ctx.existingStories || ctx.existingSpecs) {
    const activeStories = ctx.existingStories || ctx.existingSpecs;
    if (activeStories.apps?.length > 0) {
      lines.push(`\n=== EXISTING APP STORIES (${activeStories.apps.length}) ===`);
      for (const story of activeStories.apps) {
        lines.push(`\n--- ${story.name} ---`);
        if (story.yaml) lines.push(story.yaml);
      }
      lines.push(`=== END EXISTING APP STORIES ===`);
    }
    if (activeStories.features?.length > 0) {
      lines.push(`\n=== EXISTING FEATURE STORIES (${activeStories.features.length}) ===`);
      for (const story of activeStories.features) {
        lines.push(`\n--- ${story.name} ---`);
        if (story.yaml) lines.push(story.yaml);
      }
      lines.push(`=== END EXISTING FEATURE STORIES ===`);
    }
  }

  // Conventions and knowledge
  if (ctx.conventions?.length > 0) {
    lines.push(`\n=== PROJECT CONVENTIONS ===`);
    for (const conv of ctx.conventions) {
      lines.push(conv);
    }
    lines.push(`=== END CONVENTIONS ===`);
  }

  if (ctx.knowledgeFiles?.length > 0) {
    lines.push(`\n=== BUILD KNOWLEDGE (from previous builds) ===`);
    for (const kf of ctx.knowledgeFiles) {
      lines.push(kf);
    }
    lines.push(`=== END BUILD KNOWLEDGE ===`);
  }

  lines.push(`\nIMPORTANT CONSTRAINTS based on repo scan:
- Do NOT include packages already listed in dependencies or devDependencies above — they are already installed.
- Use the SAME framework, package manager, and language as detected above.
- Align new file paths with the EXISTING file structure shown above.
- Do NOT duplicate functionality covered by existing feature stories listed above.
- If agents.md specifies conventions (naming, structure, shared packages), follow them strictly.
- If the database is not Firestore, do not mention Firestore-specific IDs.
- Tailor module paths (src/path/to/module.ts) to match the existing project's directory conventions.
- YAML QUOTING: Always quote @-scoped package names in dependency lists (e.g. \`- "@types/node"\` not \`- @types/node\`). The @ character is reserved in YAML.`);

  return lines.join('\n');
}

function getSettings() {
  const file = resolve(FACTORY_ROOT, 'settings.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages, isExistingApp, existingAppName, repoContext } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const settings = getSettings();
    if (!settings?.activeProvider) {
      return new Response(
        JSON.stringify({ error: 'No LLM provider configured. Go to Settings to set one up.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const provider = settings.providers?.find(
      (p: any) => p.id === settings.activeProvider
    );
    if (!provider?.enabled) {
      return new Response(
        JSON.stringify({ error: `Provider "${settings.activeProvider}" is not enabled.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const model = settings.buildModel || provider.defaultModel;

    // Build repo context block from scan results or fall back to bridge config
    let repoContextBlock = '';
    if (repoContext && typeof repoContext === 'object') {
      repoContextBlock = formatRepoContext(repoContext);
    } else {
      // Fallback: basic stack info from factory.yaml
      const bridge = getActiveBridgeConfig();
      if (bridge?.stack) {
        repoContextBlock = `\n\nThe target project uses the following stack:\n- Framework: ${bridge.stack.framework}\n- Database: ${bridge.stack.database || 'Not specified'}\n- Cloud: ${bridge.stack.cloud || 'Not specified'}\n\nTailor your YAML and explanations accordingly. If the database is not Firestore, do not mention Firestore specific IDs.`;
      }
    }

    // Choose the right system prompt based on whether this is a new or existing app
    let systemPrompt: string;
    if (isExistingApp && existingAppName) {
      systemPrompt = SYSTEM_PROMPT_EXISTING_APP.replace(/EXISTING_APP_NAME/g, existingAppName) + repoContextBlock;
    } else {
      systemPrompt = SYSTEM_PROMPT_NEW_APP + repoContextBlock;
    }

    // Build the full message list with system prompt
    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    // Route to the right provider
    if (provider.id === 'ollama') {
      return streamOllama(provider, model, fullMessages);
    } else if (provider.id === 'openai' || provider.kind === 'openai-compat') {
      return streamOpenAI(provider, model, fullMessages);
    } else if (provider.id === 'gemini') {
      return streamGemini(provider, model, fullMessages);
    }

    return new Response(
      JSON.stringify({ error: `Unsupported provider: ${provider.id}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Chat failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ─── Ollama ────────────────────────────────────────────────────────

async function streamOllama(
  provider: any,
  model: string,
  messages: any[]
) {
  const baseUrl = provider.baseUrl || 'http://localhost:11434';

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    return new Response(
      JSON.stringify({ error: `Ollama error: ${text}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.message?.content) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ content: parsed.message.content })}\n\n`
                  )
                );
              }
              if (parsed.done) {
                controller.enqueue(
                  new TextEncoder().encode('data: [DONE]\n\n')
                );
              }
            } catch {
              // Skip
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ─── OpenAI ────────────────────────────────────────────────────────

async function streamOpenAI(
  provider: any,
  model: string,
  messages: any[]
) {
  const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    return new Response(
      JSON.stringify({ error: `OpenAI error: ${text}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              controller.enqueue(
                new TextEncoder().encode('data: [DONE]\n\n')
              );
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ content })}\n\n`
                  )
                );
              }
            } catch {
              // Skip
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ─── Gemini ────────────────────────────────────────────────────────

async function streamGemini(
  provider: any,
  model: string,
  messages: any[]
) {
  const systemInstruction = messages.find((m: any) => m.role === 'system');
  const chatMessages = messages
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: any = {
    contents: chatMessages,
  };
  if (systemInstruction) {
    body.system_instruction = {
      parts: [{ text: systemInstruction.content }],
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${provider.apiKey}&alt=sse`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    return new Response(
      JSON.stringify({ error: `Gemini error: ${text}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(
              new TextEncoder().encode('data: [DONE]\n\n')
            );
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            try {
              const parsed = JSON.parse(data);
              const content =
                parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (content) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ content })}\n\n`
                  )
                );
              }
            } catch {
              // skip
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
