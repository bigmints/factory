/**
 * Queue execution API — start processing the build queue.
 * 
 * Spawns builds as background processes so the API returns immediately.
 * Items are processed sequentially — each build updates the YAML queue on completion.
 * The UI polls /api/queue every 3s to pick up status changes.
 */
import { homedir } from 'node:os';
import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

import {
  isQueueRunning,
  setQueueRunning,
  loadQueue,
  updateItem,
  getQueueStats,
  QueueItem,
  dequeue
} from '@engine/queue';
import { getActiveProject } from '@engine/config';
import { logBuild } from '@engine/db';

const FACTORY_ROOT = resolve(homedir(), '.factory');
const LOG_FILE = resolve(FACTORY_ROOT, 'factory-build.log');

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Resolve a story/spec filename to its absolute path by checking the active project.
 */
function resolveStoryPath(storyFile: string, kind: string): string {
  if (storyFile.startsWith('/') && existsSync(storyFile)) return storyFile;

  try {
    const project = getActiveProject();
    if (project?.path) {
      const cleanFile = storyFile.replace(/^(apps|features)\//, '');
      const candidates = kind === 'FeatureStory'
        ? [
            join(project.path, '.factory', 'stories', 'features', cleanFile),
            join(project.path, '.factory', 'stories', storyFile),
            join(project.path, '.factory', 'specs', 'features', cleanFile),
            join(project.path, '.factory', 'specs', storyFile),
          ]
        : [
            join(project.path, '.factory', 'stories', 'apps', cleanFile),
            join(project.path, '.factory', 'stories', 'features', cleanFile),
            join(project.path, '.factory', 'stories', storyFile),
            join(project.path, '.factory', 'specs', 'apps', cleanFile),
            join(project.path, '.factory', 'specs', 'features', cleanFile),
            join(project.path, '.factory', 'specs', storyFile),
          ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch { /* fall through */ }

  const fallback = join(FACTORY_ROOT, 'stories', storyFile);
  if (existsSync(fallback)) return fallback;

  const oldFallback = join(FACTORY_ROOT, 'specs', storyFile);
  if (existsSync(oldFallback)) return oldFallback;

  return storyFile;
}


/**
 * Write queue blueprint for feature builds — what has been completed so far.
 */
function writeQueueBlueprint(item: QueueItem) {
  if (item.kind !== 'FeatureStory') return;

  try {
    const queue = loadQueue();
    const completed = queue
      .filter(c => c.status === 'completed')
      .sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''));

    if (completed.length === 0) return;

    const blueprint = completed.map(c => {
      const fileMatches = c.output?.match(/(?:src\/|lib\/|app\/|pages\/|components\/)[\w/.-]+\.(?:ts|tsx|js|jsx|json|css)/g) || [];
      return {
        storyFile: c.storyFile,
        specFile: c.storyFile,
        kind: c.kind,
        targetApp: c.targetApp || '',
        generatedFiles: [...new Set(fileMatches)].slice(0, 50),
      };
    });

    const bpPath = join(FACTORY_ROOT, 'queue-blueprint.json');
    writeFileSync(bpPath, JSON.stringify({ completedBuilds: blueprint }, null, 2));
  } catch { /* non-critical */ }
}

/** Extract real error messages from CLI output */
function extractRealError(stdout: string, stderr: string, code: number | null): string {
  const failLines = stdout.split('\n')
    .filter((l: string) => l.includes('✗'))
    .map((l: string) => stripAnsi(l).replace(/^.*✗\s*/, '').trim())
    .filter(Boolean);

  if (failLines.length > 0) return failLines.join('; ');

  const cleanStderr = stderr
    .split('\n')
    .filter((l: string) => !l.startsWith('npm warn'))
    .join('\n')
    .trim();

  return cleanStderr || `Process exited with code ${code}`;
}

/** Trigger logging a build to builds.yaml */
function triggerLogBuild(
  item: QueueItem,
  status: string,
  rawOutput: string,
  durationMs: number
) {
  const fileMatches = rawOutput.match(/✓\s+(.+)/g) || [];
  const filesGenerated = fileMatches.map((m: string) => m.replace(/^✓\s+/, '').trim());

  const dirCounts = new Map<string, number>();
  for (const f of filesGenerated) {
    const parts = f.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
  }
  const dirTable = Array.from(dirCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, count]) => `| ${dir} | ${count} |`)
    .join('\n');

  const file = item.storyFile;
  const specName = file?.split('/').pop()?.replace('.yaml', '') || file;
  const outcome = status === 'failed'
    ? 'Build failed — check queue output for details'
    : `Successfully generated ${filesGenerated.length} file(s)`;

  const summary = `# Build Debrief: ${specName}

> ${outcome}

## What Was Built
- **Story**: \`${file}\`
- **Type**: ${item.kind === 'FeatureStory' ? 'Feature' : 'App'}

## Files Generated

${filesGenerated.length} files across ${dirCounts.size} director${dirCounts.size === 1 ? 'y' : 'ies'}

| Directory | Files |
|---|---|
${dirTable || '| — | 0 |'}

## Duration

Built in ${(durationMs / 1000).toFixed(1)}s.
`;

  logBuild(
    item.storyFile,
    item.kind,
    status,
    summary,
    filesGenerated,
    durationMs,
    { engine: item.engine }
  );
}

/**
 * Process queue items sequentially in the background.
 */
function processQueueInBackground() {
  function processNext() {
    const item = dequeue();

    if (!item) {
      setQueueRunning(false);
      try {
        const bpPath = join(FACTORY_ROOT, 'queue-blueprint.json');
        if (existsSync(bpPath)) {
          writeFileSync(bpPath, '{}');
        }
        const ctxPath = join(FACTORY_ROOT, 'queue-context.json');
        if (existsSync(ctxPath)) {
          writeFileSync(ctxPath, '{}');
        }
      } catch {}
      return;
    }

    const startTime = Date.now();

    // Mark item as running
    updateItem(item.id, {
      status: 'running',
      startedAt: new Date().toISOString()
    });

    // Clear live log file and write header
    writeFileSync(LOG_FILE, `[build] ${item.storyFile} (${item.kind})\n`);

    // Write queue blueprint for feature builds
    writeQueueBlueprint(item);

    // Resolve the story/spec path
    const resolvedPath = resolveStoryPath(item.storyFile, item.kind);

    // Build the command
    const engineFlag = item.engine && item.engine !== 'factory' ? ['--engine', item.engine] : [];
    const cmdArgs = item.kind === 'FeatureStory'
      ? ['feature', 'build', resolvedPath, ...engineFlag]
      : ['build', resolvedPath, ...engineFlag];

    let projectPath: string | undefined;
    try {
      const p = getActiveProject();
      if (p?.path) projectPath = p.path;
    } catch {}

    // Spawn the build process using globally-linked factory CLI
    const child = spawn('factory', cmdArgs, {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_cache: '/tmp/factory-npm-cache', TMPDIR: '/tmp/factory-npm-cache' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      try { appendFileSync(LOG_FILE, chunk); } catch { /* ignore */ }
    });

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      try { appendFileSync(LOG_FILE, chunk); } catch { /* ignore */ }
    });

    child.on('close', (code: number | null) => {
      const durationMs = Date.now() - startTime;
      const output = stripAnsi(stdout + stderr);

      if (code === 0) {
        // Success
        updateItem(item.id, {
          status: 'completed',
          output,
          completedAt: new Date().toISOString(),
          durationMs
        });

        triggerLogBuild(item, 'completed', output, durationMs);
      } else {
        // Failed
        const realError = extractRealError(stdout, stderr, code);
        updateItem(item.id, {
          status: 'failed',
          output,
          error: stripAnsi(realError),
          completedAt: new Date().toISOString(),
          durationMs
        });

        triggerLogBuild(item, 'failed', output, durationMs);
      }

      processNext();
    });

    child.on('error', (err: Error) => {
      const durationMs = Date.now() - startTime;
      updateItem(item.id, {
        status: 'failed',
        output: '',
        error: err.message,
        completedAt: new Date().toISOString(),
        durationMs
      });

      triggerLogBuild(item, 'failed', '', durationMs);
      processNext();
    });
  }

  processNext();
}

/** POST — Start processing the queue (returns immediately) */
export async function POST() {
  try {
    // Check if already running
    if (isQueueRunning()) {
      const statsObj = getQueueStats();
      const pendingCount = statsObj.pending || 0;
      return NextResponse.json({
        success: true,
        message: 'Queue is already running. New items will be processed automatically.',
        alreadyRunning: true,
        pending: pendingCount,
      });
    }

    // Check for pending items
    const statsObj = getQueueStats();
    const pendingCount = statsObj.pending || 0;
    if (pendingCount === 0) {
      return NextResponse.json({ error: 'No pending items in queue' }, { status: 400 });
    }

    // Mark as running
    setQueueRunning(true);

    // Fire-and-forget: process queue in background
    processQueueInBackground();

    return NextResponse.json({
      success: true,
      message: 'Queue processing started',
      pending: pendingCount,
    });
  } catch (error) {
    try {
      setQueueRunning(false);
    } catch { /* ignore */ }

    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
