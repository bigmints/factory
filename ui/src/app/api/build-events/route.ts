import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const FACTORY_ROOT = resolve(homedir(), '.factory');

function getProjectPath(projectParam: string | null): string {
  try {
    const projectsPath = join(FACTORY_ROOT, 'projects.json');
    if (existsSync(projectsPath)) {
      const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
      const targetId = projectParam || config.activeProject;
      if (targetId) {
        const p = config.projects?.find((p: any) => p.id === targetId);
        if (p && existsSync(p.path)) return p.path;
      }
    }
  } catch {}
  return process.cwd();
}

// ─── LLM Settings ─────────────────────────────────────────────────────────────

interface ProviderConfig {
  id: string;
  kind: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

function loadLLMConfig(): { baseUrl: string; apiKey: string; model: string } | null {
  try {
    // Always read from the canonical global settings path: ~/.factory/settings.json
    // Do NOT use relative paths from process.cwd() — those point to the wrong file.
    const globalSettings = join(FACTORY_ROOT, 'settings.json');
    if (!existsSync(globalSettings)) return null;

    const settings = JSON.parse(readFileSync(globalSettings, 'utf-8'));
    const activeId  = settings.activeProvider;
    const providers: ProviderConfig[] = settings.providers || [];

    // Prefer active provider, fall back to first enabled one
    const provider = providers.find(p => p.id === activeId && p.enabled) || providers.find(p => p.enabled);
    if (!provider) return null;

    const model = settings.buildModel || provider.defaultModel || 'gpt-4o-mini';

    if (provider.kind === 'openai-compat' && provider.baseUrl) {
      return { baseUrl: provider.baseUrl, apiKey: provider.apiKey || 'none', model };
    }
    if (provider.id === 'gemini' && provider.apiKey && provider.apiKey !== 'YOUR_GEMINI_API_KEY') {
      return {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: provider.apiKey,
        model,
      };
    }
    if (provider.id === 'openai' && provider.apiKey) {
      return { baseUrl: 'https://api.openai.com/v1', apiKey: provider.apiKey, model };
    }
    if (provider.id === 'ollama') {
      return { baseUrl: provider.baseUrl || 'http://localhost:11434/v1', apiKey: 'ollama', model };
    }
  } catch {}
  return null;
}

// ─── Summarize via LLM ────────────────────────────────────────────────────────

const SUMMARIZE_PROMPT = `You are a build status reporter for an AI coding pipeline.
Given raw CLI output from a coding agent (gemini, agy, pi, claude, or codex), produce a concise human-readable status update.

Rules:
- 2-4 bullet points MAX. No fluff.
- Lead with what is CURRENTLY happening (present tense).
- Mention specific files written, commands run, errors found (if any).
- If there are errors, quote the key error line.
- If it says "DELIVERY COMPLETE" or similar, say so clearly.
- Use emoji sparingly: ✅ done, 🔨 building, 🐛 fixing, ⚠️ warning, ❌ error.
- Keep each bullet under 80 chars.
- Output ONLY the bullets, nothing else.`;

async function summarizeLog(logTail: string, llm: { baseUrl: string; apiKey: string; model: string }): Promise<string | null> {
  if (!logTail.trim()) return null;
  try {
    const res = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model,
        messages: [
          { role: 'system', content: SUMMARIZE_PROMPT },
          { role: 'user',   content: `CLI output (last ~3000 chars):\n\n${logTail.slice(-3000)}` },
        ],
        max_tokens: 200,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

// ─── SSE Route ────────────────────────────────────────────────────────────────

/**
 * GET /api/build-events?slug=<story-slug>&project=<id>
 *
 * Server-Sent Events stream that:
 *   - Tails `.factory/logs/cli-<slug>.log` every 750ms  → `log` events
 *   - Summarizes the log via LLM every 8s               → `summary` events
 *
 * Works with any CLI: gemini, agy, pi, claude, codex.
 * The log file is written by orchestrate.ts at the spawn() level.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug    = searchParams.get('slug');
  const project = searchParams.get('project');

  if (!slug) return new Response('Missing slug param', { status: 400 });

  const projectRoot   = getProjectPath(project);
  const logsDir       = join(projectRoot, '.factory', 'logs');
  const cliLogPath    = join(logsDir, `cli-${slug}.log`);

  const llmConfig = loadLLMConfig();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let fileOffset        = 0;
      let fullLogBuffer     = '';   // accumulates the whole log for summarization
      let lastSummarizeAt   = 0;
      let summarizing       = false;
      let bytesWrittenSinceLastSummarize = 0;  // only summarize when log is growing
      const SUMMARIZE_EVERY = 8_000; // ms

      function send(event: string, data: unknown) {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch { /* client disconnected */ }
      }

      // ── Initial snapshot ──────────────────────────────────────────────────
      if (existsSync(cliLogPath)) {
        try {
          const content = readFileSync(cliLogPath, 'utf-8');
          fileOffset     = Buffer.byteLength(content, 'utf-8');
          fullLogBuffer  = content;
          send('log', { text: content, offset: fileOffset });
        } catch {}
      } else {
        send('log', { text: `Waiting for CLI to start...\n(log: ${cliLogPath})\n`, offset: 0 });
      }

      // ── Poll 750ms ────────────────────────────────────────────────────────
      const interval = setInterval(async () => {
        // Tail new bytes
        if (existsSync(cliLogPath)) {
          try {
            const size = statSync(cliLogPath).size;
            if (size > fileOffset) {
              const buf = Buffer.alloc(size - fileOffset);
              const fd  = openSync(cliLogPath, 'r');
              readSync(fd, buf, 0, buf.length, fileOffset);
              closeSync(fd);
              const newText = buf.toString('utf-8');
              fileOffset    = size;
              fullLogBuffer += newText;
              bytesWrittenSinceLastSummarize += newText.length;
              send('log', { text: newText, offset: fileOffset });
            } else if (size < fileOffset) {
              // Rotated
              fileOffset    = 0;
              fullLogBuffer = readFileSync(cliLogPath, 'utf-8');
              fileOffset    = Buffer.byteLength(fullLogBuffer, 'utf-8');
              send('log', { text: fullLogBuffer, offset: fileOffset, reset: true });
            }
          } catch {}
        }

        // LLM summary (every 8s, non-blocking, ONLY when log is actively growing)
        // Guard: bytesWrittenSinceLastSummarize > 0 prevents firing when no build is running.
        // Without this every open browser tab hammers GX10 indefinitely.
        const now = Date.now();
        if (
          llmConfig &&
          !summarizing &&
          bytesWrittenSinceLastSummarize > 0 &&
          fullLogBuffer.trim().length > 100 &&
          now - lastSummarizeAt > SUMMARIZE_EVERY
        ) {
          summarizing    = true;
          lastSummarizeAt = now;
          bytesWrittenSinceLastSummarize = 0;  // reset — next summarize needs fresh bytes
          summarizeLog(fullLogBuffer, llmConfig)
            .then(summary => {
              if (summary) send('summary', { text: summary, ts: new Date().toISOString() });
            })
            .catch(() => {})
            .finally(() => { summarizing = false; });
        }
      }, 750);

      return () => clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-store',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
