import { NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

import { getActiveProject } from '@engine/config';
import { listQueue, getQueueStats, isQueueRunning, enqueue } from '@engine/queue';
import { getBuildLogs } from '@engine/db';

const FACTORY_ROOT = resolve(homedir(), '.factory');

// ─── TPM Tool Definitions ───
export const TPM_TOOLS = [
  {
    name: 'get_project_status',
    description: 'Fetch the active project progress: scaffold.yaml epics, build queue status, recent heartbeats, and session worklogs.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'decompose_requirements',
    description: 'Decompose user requirements into modular feature stories in Factory YAML format. Use when user wants to plan new features.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The exact user requirement to plan and decompose.' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'apply_story',
    description: 'Write a proposed YAML story to disk (.factory/stories/features/) and automatically enqueue it in the SQLite build queue.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The feature or app story name.' },
        content: { type: 'string', description: 'The clean, schema-compliant YAML story content.' },
        kind: { type: 'string', enum: ['app', 'feature'], description: 'Whether it is an app story or a feature story.' },
        phase: { type: 'number', description: 'Phase number (1 = foundation, 2 = core, 3 = polish).' },
        dependsOn: { type: 'array', items: { type: 'string' }, description: 'Slugs of feature stories this story depends on.' }
      },
      required: ['name', 'content', 'kind']
    }
  },
  {
    name: 'add_adr_decision',
    description: 'Write an Architectural Decision Record (ADR) or key decision to the project knowledgebase (.factory/knowledge/) for future context.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'A unique kebab-case slug for the ADR file.' },
        content: { type: 'string', description: 'Detailed markdown describing the architectural decision.' }
      },
      required: ['slug', 'content']
    }
  }
];

function getSettings() {
  const file = resolve(FACTORY_ROOT, 'settings.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── Tool Implementations ───

async function handleGetProjectStatus(projectPath: string) {
  let scaffoldInfo = "No scaffold.yaml found. Please generate stories first.";
  const scaffoldPath = join(projectPath, '.factory', 'scaffold.yaml');
  if (existsSync(scaffoldPath)) {
    try {
      const raw = readFileSync(scaffoldPath, 'utf-8');
      const parsed = parseYaml(raw) as any;
      const features = parsed.features || [];
      let totalStories = 0;
      let completedStories = 0;
      let inProgressStories = 0;
      let draftStories = 0;

      for (const feature of features) {
        const stories = feature.stories || [];
        totalStories += stories.length;
        for (const story of stories) {
          const status = story.status || 'draft';
          if (['done', 'completed'].includes(status)) completedStories++;
          else if (status === 'in-progress') inProgressStories++;
          else draftStories++;
        }
      }
      scaffoldInfo = `Project: ${parsed.name || 'factory-app'}
Features Epic Count: ${features.length}
Total Stories: ${totalStories}
- Completed: ${completedStories}
- In Progress: ${inProgressStories}
- Draft/Ready: ${draftStories}
Progress: ${parsed.progressPercent || 0}%`;
    } catch (e: any) {
      scaffoldInfo = `Error reading scaffold.yaml: ${e.message}`;
    }
  }

  // Load queue status
  const queueStats = getQueueStats();
  const queueInfo = `Build Queue Status:
- Total Queue Items: ${queueStats.total}
- Pending: ${queueStats.pending}
- Running: ${queueStats.running}
- Completed: ${queueStats.completed}
- Failed: ${queueStats.failed}`;

  // Recent Heartbeats and Worklog
  let heartbeatMsg = "No heartbeat registered yet.";
  const heartbeatPath = join(projectPath, '.factory', 'logs', 'heartbeat.yaml');
  if (existsSync(heartbeatPath)) {
    try {
      const raw = readFileSync(heartbeatPath, 'utf-8');
      const parsed = parseYaml(raw) as any;
      heartbeatMsg = `Last Heartbeat: [${parsed.timestamp || 'N/A'}] ${parsed.message || 'No message'}`;
    } catch {}
  }

  let worklogSnippet = "No worklog history.";
  const worklogPath = join(projectPath, '.factory', 'logs', 'worklog.yaml');
  if (existsSync(worklogPath)) {
    try {
      const raw = readFileSync(worklogPath, 'utf-8');
      const parsed = parseYaml(raw) as any;
      const entries = parsed.entries || [];
      const last5 = entries.slice(-5).reverse();
      worklogSnippet = "Recent Session Logs:\n" + last5.map((e: any) => `- [${e.timestamp || ''}] ${e.message || ''}`).join('\n');
    } catch {}
  }

  return JSON.stringify({
    scaffold: scaffoldInfo,
    queue: queueInfo,
    heartbeat: heartbeatMsg,
    worklog: worklogSnippet
  }, null, 2);
}

async function handleDecomposeRequirements(prompt: string, projectPath: string, provider: any, model: string) {
  // Call LLM recursively with the spec decomposition prompt.
  const appName = projectPath.split(/[\\/]/).pop() || 'app';
  const systemPrompt = `You are an expert software architect for Factory.
The user wants to plan new feature requirements. Decompose their request into clean, schema-compliant FEATURE STORIES.

Use this EXACT output format with delimiters:

=== FEATURE_STORY: feature-slug.yaml ===
\`\`\`yaml
name: "Build feature-slug feature"
description: "Detailed description of feature"
status: draft
feature:
  name: "Feature Name"
  slug: "feature-slug"
target:
  app: "${appName}"
phase: 1
dependsOn: []
dependencies: []
acceptance_criteria:
  - "Core: happy path criterion"
  - "Edge: invalid scenario handling"
  - "UI: UI state representation"
  - "State: state/data boundary"
\`\`\`
=== END_STORY ===

RULES:
- Keep stories focused and small.
- Return between 1 to 4 story blocks.
- Set phase logically (1=foundational, 2=core).
- Always quote dependency list array items.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ];

  let resultText = "";
  if (provider.id === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.apiKey}`;
    const body = {
      contents: messages.map(m => ({
        role: m.role === 'system' ? 'user' : (m.role === 'assistant' ? 'model' : 'user'),
        parts: [{ text: m.content }]
      })),
      generationConfig: { temperature: 0.2 }
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const data = await res.json();
      resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
  } else {
    // OpenAI or custom compatibility fallback
    const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { 'Authorization': `Bearer ${provider.apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2
      })
    });
    if (res.ok) {
      const data = await res.json();
      resultText = data.choices?.[0]?.message?.content || "";
    }
  }

  return resultText || "Failed to generate spec decomposition.";
}

async function handleApplyStory(name: string, content: string, kind: string, phase: number, dependsOn: string[], projectPath: string) {
  try {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const folder = kind === 'app' ? 'apps' : 'features';
    const relativePath = `stories/${folder}/${slug}.yaml`;
    const fullPath = join(projectPath, '.factory', relativePath);

    mkdirSync(join(projectPath, '.factory', 'stories', folder), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');

    // Add to SQLite queue if feature
    if (kind === 'feature') {
      try {
        enqueue(relativePath, 'FeatureStory', {
          phase: phase || 1,
          dependsOn: dependsOn || [],
          engine: 'factory'
        });
      } catch (e: any) {
        return `Story saved to ${relativePath} but failed to auto-enqueue: ${e.message}`;
      }
    }

    return `Successfully saved story to .factory/${relativePath} and enqueued in build queue.`;
  } catch (err: any) {
    return `Error saving story: ${err.message}`;
  }
}

async function handleAddAdrDecision(slug: string, content: string, projectPath: string) {
  try {
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '');
    const dir = join(projectPath, '.factory', 'knowledge');
    mkdirSync(dir, { recursive: true });
    const fullPath = join(dir, `${cleanSlug}.md`);
    const timestamp = new Date().toISOString();
    const formatted = `# ADR: ${slug}
> Registered via Ask TPM Chat on ${timestamp}

${content}
`;
    writeFileSync(fullPath, formatted, 'utf-8');
    return `Architectural Decision Record saved successfully to .factory/knowledge/${cleanSlug}.md`;
  } catch (err: any) {
    return `Failed to save ADR: ${err.message}`;
  }
}

// ─── POST Handler ───

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages list required' }, { status: 400 });
    }

    const settings = getSettings();
    const activeProject = getActiveProject();

    if (!activeProject) {
      return NextResponse.json({ error: 'No active project selected. Configure one in Projects tab.' }, { status: 400 });
    }

    if (!settings?.activeProvider) {
      return NextResponse.json({ error: 'No active LLM provider configured. Go to Settings.' }, { status: 400 });
    }

    const provider = settings.providers?.find((p: any) => p.id === settings.activeProvider);
    if (!provider?.enabled) {
      return NextResponse.json({ error: `LLM provider "${settings.activeProvider}" is not enabled.` }, { status: 400 });
    }

    const model = settings.buildModel || provider.defaultModel || 'gemini-2.5-flash';

    // Establish the SSE response stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendSSE = (type: string, data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
        };

        try {
          const tpmSystemPrompt = `You are the Factory Technical Program Manager (TPM) agent.
Your primary role is to communicate with the user, coordinate story planning/customization, ADR decisions, and report active build pipeline statuses.

You are equipped with the following tools to execute actions directly on the backend:
- get_project_status(): Use this whenever the user asks about how the project is doing, stories status, queue lengths, heartbeats, or recent session logs.
- decompose_requirements(prompt): Use this when the user requests a new feature, widget, or page. Decomposes the prompt into complete YAML spec stories.
- apply_story(name, content, kind, phase, dependsOn): Save a generated YAML story spec to disk and auto-enqueue features in the build queue.
- add_adr_decision(slug, content): Register an Architectural Decision Record in the knowledgebase.

RULES:
- Call tools proactively whenever the user asks for status, feature plans, enqueuing, or saving stories.
- When calling decompose_requirements, explain the decomposition strategy to the user.
- If a tool completes successfully, summarize its result clearly and list any acceptances or queue IDs.
- Speak professionally, clearly, and serve as the intelligent orchestrator.`;

          const localMessages = [
            { role: 'system', content: tpmSystemPrompt },
            ...messages.map((m: any) => ({ role: m.role, content: m.content, tool_calls: m.toolCalls }))
          ];

          let loopCount = 0;
          const MAX_AGENT_LOOPS = 6;
          let shouldContinue = true;

          while (shouldContinue && loopCount < MAX_AGENT_LOOPS) {
            loopCount++;
            
            // Format messages for active LLM provider
            let responseText = "";
            let toolCalls: any[] = [];

            if (provider.id === 'gemini') {
              // GEMINI call with native function calling
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.apiKey}`;
              const contentsFormatted = localMessages
                .filter(m => m.role !== 'system')
                .map(m => {
                  const parts: any[] = [];
                  if (m.content) parts.push({ text: m.content });
                  if (m.tool_calls) {
                    for (const tc of m.tool_calls) {
                      parts.push({
                        functionCall: {
                          name: tc.name,
                          args: tc.arguments
                        }
                      });
                    }
                  }
                  if (m.role === 'tool') {
                    // For tool role, map back to functionResponse
                    parts.push({
                      functionResponse: {
                        name: m.tool_calls?.[0]?.name || 'unknown',
                        response: { content: m.content }
                      }
                    });
                  }
                  return {
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts
                  };
                });

              const systemMessage = localMessages.find(m => m.role === 'system');

              const body = {
                contents: contentsFormatted,
                systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
                tools: [{
                  functionDeclarations: TPM_TOOLS
                }],
                toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
              };

              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
              });

              if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Gemini LLM Call failed: ${txt}`);
              }

              const data = await res.json();
              const candidate = data.candidates?.[0];
              const parts = candidate?.content?.parts || [];
              
              responseText = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
              const geminiCalls = parts.filter((p: any) => p.functionCall);
              if (geminiCalls.length > 0) {
                toolCalls = geminiCalls.map((p: any, idx: number) => ({
                  id: `call_${Date.now()}_${idx}`,
                  name: p.functionCall.name,
                  arguments: p.functionCall.args || {}
                }));
              }
            } else {
              // OpenAI compat call with tools
              const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
              const apiMessages = localMessages.map(m => ({
                role: m.role,
                content: m.content,
                tool_calls: m.tool_calls ? m.tool_calls.map((tc: any) => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
                })) : undefined,
                tool_call_id: m.role === 'tool' ? m.tool_calls?.[0]?.id : undefined
              }));

              const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(provider.apiKey ? { 'Authorization': `Bearer ${provider.apiKey}` } : {})
                },
                body: JSON.stringify({
                  model,
                  messages: apiMessages,
                  tools: TPM_TOOLS.map(t => ({
                    type: 'function',
                    function: t
                  })),
                  temperature: 0.2
                })
              });

              if (!res.ok) {
                const txt = await res.text();
                throw new Error(`OpenAI LLM Call failed: ${txt}`);
              }

              const data = await res.json();
              const choice = data.choices?.[0]?.message;
              responseText = choice?.content || "";
              if (choice?.tool_calls) {
                toolCalls = choice.tool_calls.map((tc: any) => {
                  let args = {};
                  try { args = JSON.parse(tc.function.arguments); } catch {}
                  return {
                    id: tc.id,
                    name: tc.function.name,
                    arguments: args
                  };
                });
              }
            }

            if (toolCalls.length > 0) {
              // LLM chose to call a tool!
              // Append to thread
              localMessages.push({ role: 'assistant', content: responseText || null as any, tool_calls: toolCalls });

              for (const tc of toolCalls) {
                sendSSE('tool_start', { id: tc.id, name: tc.name, arguments: tc.arguments });

                let result = "";
                try {
                  if (tc.name === 'get_project_status') {
                    result = await handleGetProjectStatus(activeProject.path);
                  } else if (tc.name === 'decompose_requirements') {
                    result = await handleDecomposeRequirements(tc.arguments.prompt, activeProject.path, provider, model);
                  } else if (tc.name === 'apply_story') {
                    result = await handleApplyStory(
                      tc.arguments.name,
                      tc.arguments.content,
                      tc.arguments.kind,
                      tc.arguments.phase || 1,
                      tc.arguments.dependsOn || [],
                      activeProject.path
                    );
                  } else if (tc.name === 'add_adr_decision') {
                    result = await handleAddAdrDecision(tc.arguments.slug, tc.arguments.content, activeProject.path);
                  } else {
                    result = `Tool "${tc.name}" is not implemented on the server.`;
                  }
                  sendSSE('tool_end', { id: tc.id, name: tc.name, status: 'success', result });
                } catch (err: any) {
                  result = `Tool execution failed: ${err.message}`;
                  sendSSE('tool_end', { id: tc.id, name: tc.name, status: 'failed', result });
                }

                // Append the tool execution result back to the messages thread
                localMessages.push({
                  role: 'tool',
                  content: result,
                  tool_calls: [tc]
                });
              }
            } else {
              // LLM returned normal text response
              sendSSE('text', { content: responseText });
              shouldContinue = false;
            }
          }

          sendSSE('done', {});
        } catch (e: any) {
          sendSSE('error', { error: e.message || 'TPM Chat Error occurred' });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to process TPM request' }, { status: 500 });
  }
}
