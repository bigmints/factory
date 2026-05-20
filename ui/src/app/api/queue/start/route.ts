import { homedir } from 'node:os';
/**
 * Queue execution API — start processing the build queue.
 * 
 * Spawns builds as background processes so the API returns immediately.
 * Items are processed sequentially — each build updates the DB on completion.
 * The UI polls /api/queue every 3s to pick up status changes.
 */

import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const DB_PATH = resolve(homedir(), '.factory', 'factory.db');
const FACTORY_ROOT = resolve(homedir(), '.factory');
const LOG_FILE = resolve(FACTORY_ROOT, 'factory-build.log');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Resolve a story/spec filename to its absolute path by checking the active project.
 */
function resolveStoryPath(storyFile: string, kind: string): string {
  // If already absolute, use as-is
  if (storyFile.startsWith('/') && existsSync(storyFile)) return storyFile;

  const projectsPath = join(FACTORY_ROOT, 'projects.json');
  if (existsSync(projectsPath)) {
    try {
      const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
      const activeId = config.activeProject;
      const project = config.projects?.find((p: { id: string }) => p.id === activeId);

      if (project?.path) {
        const cleanFile = storyFile.replace(/^(apps|features)\//, '');
        const candidates = kind === 'FeatureSpec' || kind === 'FeatureStory'
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
  }

  // Fallback: factory root
  const fallback = join(FACTORY_ROOT, 'stories', storyFile);
  if (existsSync(fallback)) return fallback;

  const oldFallback = join(FACTORY_ROOT, 'specs', storyFile);
  if (existsSync(oldFallback)) return oldFallback;

  return storyFile; // Return as-is, let CLI report the error
}

/**
 * Process queue items sequentially in the background.
 * This function runs detached from the HTTP request.
 * Retries for transient LLM errors happen inside the CLI build process itself.
 *
 * Dependency cascade: if an item's dependencies (app story or explicit depends_on)
 * have failed or been blocked, this item is auto-blocked. No wasted LLM tokens.
 */
function processQueueInBackground() {
  const db = getDb();

  const pending = (db.prepare(`
    SELECT * FROM queue_items WHERE status = 'pending'
    ORDER BY phase ASC, priority DESC, added_at ASC
  `).all() as any[]).map(row => ({
    ...row,
    story_file: row.story_file || row.spec_file,
    spec_file: row.story_file || row.spec_file,
  }));

  if (pending.length === 0) {
    db.prepare(`UPDATE queue_state SET value = 'false' WHERE key = 'is_running'`).run();
    db.close();
    return;
  }

  // Process items one at a time, chaining via callbacks
  let index = 0;

  /** Extract real error messages from CLI output (✗ lines contain actual failures) */
  function extractRealError(stdout: string, stderr: string, code: number | null): string {
    const failLines = stdout.split('\n')
      .filter((l: string) => l.includes('✗'))
      .map((l: string) => stripAnsi(l).replace(/^.*✗\s*/, '').trim())
      .filter(Boolean);

    if (failLines.length > 0) return failLines.join('; ');

    // Fall back to stderr, but strip useless npm warnings
    const cleanStderr = stderr
      .split('\n')
      .filter((l: string) => !l.startsWith('npm warn'))
      .join('\n')
      .trim();

    return cleanStderr || `Process exited with code ${code}`;
  }

  /**
   * Check if an item should be blocked because its dependencies failed.
   * Returns the reason string if blocked, or null if OK to proceed.
   */
  function checkDependencyBlock(item: any): string | null {
    const checkDb = getDb();
    try {
      const file = item.story_file || item.spec_file;
      // 1. For FeatureStories/Specs: implicit dependency on the app story
      if ((item.kind === 'FeatureSpec' || item.kind === 'FeatureStory') && item.target_app) {
        // Find the app spec/story for this target_app
        const appItems = checkDb.prepare(`
          SELECT id, status, story_file, spec_file FROM queue_items
          WHERE kind IN ('AppSpec', 'AppStory')
          ORDER BY added_at ASC
        `).all() as any[];

        // Check if ANY app spec/story in the queue has failed or is blocked
        const matchingApp = appItems.find(a => {
          const appFile = a.story_file || a.spec_file || '';
          const slug = appFile.replace(/\.ya?ml$/, '').replace(/^apps\//, '');
          return slug === item.target_app;
        });

        if (matchingApp) {
          const appFile = matchingApp.story_file || matchingApp.spec_file;
          if (matchingApp.status === 'failed' || matchingApp.status === 'blocked') {
            return `App story "${appFile}" ${matchingApp.status}. Cannot build feature on a broken app.`;
          }
          if (matchingApp.status === 'pending' || matchingApp.status === 'running') {
            return `App story "${appFile}" has not completed yet.`;
          }
        }
      }

      // 2. Explicit depends_on check
      let dependsOn: string[] = [];
      try { dependsOn = JSON.parse(item.depends_on || '[]'); } catch {}

      if (dependsOn.length > 0) {
        for (const dep of dependsOn) {
          // dep is a slug — find matching queue item
          const depItem = checkDb.prepare(`
            SELECT id, status, story_file, spec_file FROM queue_items
            WHERE story_file LIKE ? OR spec_file LIKE ?
            ORDER BY added_at DESC LIMIT 1
          `).get(`%${dep}%`, `%${dep}%`) as any;

          if (depItem && (depItem.status === 'failed' || depItem.status === 'blocked')) {
            const depFile = depItem.story_file || depItem.spec_file;
            return `Dependency "${dep}" (${depFile}) ${depItem.status}. Cannot proceed.`;
          }
        }
      }

      return null; // All deps OK
    } finally {
      checkDb.close();
    }
  }

  /**
   * Write queue context for feature builds — what has been completed so far.
   * This lets the LLM wire things up with previously built features.
   */
  function writeQueueContext(item: any) {
    if (item.kind !== 'FeatureSpec' && item.kind !== 'FeatureStory') return;

    const ctxDb = getDb();
    try {
      // Get all completed items for context
      const completed = ctxDb.prepare(`
        SELECT story_file, spec_file, kind, output, target_app FROM queue_items
        WHERE status = 'completed'
        ORDER BY completed_at ASC
      `).all() as any[];

      if (completed.length === 0) return;

      // Extract file lists from build output (they appear as "Generated N files" sections)
      const context = completed.map(c => {
        const file = c.story_file || c.spec_file;
        const fileMatches = c.output?.match(/(?:src\/|lib\/|app\/|pages\/|components\/)[\w/.-]+\.(?:ts|tsx|js|jsx|json|css)/g) || [];
        return {
          storyFile: file,
          specFile: file,
          kind: c.kind,
          targetApp: c.target_app,
          generatedFiles: [...new Set(fileMatches)].slice(0, 50),
        };
      });

      const contextPath = join(FACTORY_ROOT, 'queue-context.json');
      writeFileSync(contextPath, JSON.stringify({ completedBuilds: context }, null, 2));
    } catch { /* non-critical */ }
    finally { ctxDb.close(); }
  }

  function processNext() {
    if (index >= pending.length) {
      // All done — mark queue as not running & clean up context file
      const finDb = getDb();
      finDb.prepare(`UPDATE queue_state SET value = 'false' WHERE key = 'is_running'`).run();
      finDb.close();
      try {
        const ctxPath = join(FACTORY_ROOT, 'queue-context.json');
        if (existsSync(ctxPath)) {
          writeFileSync(ctxPath, '{}');
        }
      } catch {}
      return;
    }

    const item = pending[index];
    index++;

    // ── Dependency cascade check ──
    const blockReason = checkDependencyBlock(item);
    if (blockReason) {
      const blockDb = getDb();
      blockDb.prepare(`
        UPDATE queue_items
        SET status = 'blocked', error = ?, completed_at = ?
        WHERE id = ?
      `).run(blockReason, new Date().toISOString(), item.id);
      blockDb.close();

      const file = item.story_file || item.spec_file;
      try {
        appendFileSync(LOG_FILE, `\n[blocked] ${file}: ${blockReason}\n`);
      } catch {}

      processNext(); // Skip to next item
      return;
    }

    const startTime = Date.now();

    // Mark item as running
    const runDb = getDb();
    runDb.prepare(`UPDATE queue_items SET status = 'running', started_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), item.id);
    runDb.close();

    const file = item.story_file || item.spec_file;
    // Clear live log file and write header
    writeFileSync(LOG_FILE, `[build] ${file} (${item.kind})\n`);

    // Write queue context for feature builds
    writeQueueContext(item);

    // Resolve the story/spec path
    const resolvedPath = resolveStoryPath(file, item.kind);

    // Build the command — pass engine flag if not factory (default)
    const engineFlag = item.engine && item.engine !== 'factory' ? ['--engine', item.engine] : [];
    const cmdArgs = item.kind === 'FeatureSpec' || item.kind === 'FeatureStory'
      ? ['feature', 'build', resolvedPath, ...engineFlag]
      : ['build', resolvedPath, ...engineFlag];

    // Spawn the build process using globally-linked factory CLI
    const child = spawn('factory', cmdArgs, {
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
      const doneDb = getDb();

      if (code === 0) {
        // Success
        doneDb.prepare(`
          UPDATE queue_items
          SET status = 'completed', output = ?, completed_at = ?, duration_ms = ?
          WHERE id = ?
        `).run(output, new Date().toISOString(), durationMs, item.id);

        logBuild(doneDb, item, 'completed', output, durationMs);
      } else {
        // Failed
        const realError = extractRealError(stdout, stderr, code);
        doneDb.prepare(`
          UPDATE queue_items
          SET status = 'failed', output = ?, error = ?, completed_at = ?, duration_ms = ?
          WHERE id = ?
        `).run(output, stripAnsi(realError), new Date().toISOString(), durationMs, item.id);

        logBuild(doneDb, item, 'failed', output, durationMs);
      }

      doneDb.close();
      processNext();
    });

    child.on('error', (err: Error) => {
      const durationMs = Date.now() - startTime;
      const errDb = getDb();
      errDb.prepare(`
        UPDATE queue_items
        SET status = 'failed', output = '', error = ?, completed_at = ?, duration_ms = ?
        WHERE id = ?
      `).run(err.message, new Date().toISOString(), durationMs, item.id);

      logBuild(errDb, item, 'failed', '', durationMs);
      errDb.close();
      processNext();
    });
  }

  db.close();
  processNext();
}

/** POST — Start processing the queue (returns immediately) */
export async function POST() {
  const db = getDb();

  try {
    // Check if already running
    const state = db.prepare(`SELECT value FROM queue_state WHERE key = 'is_running'`).get() as { value: string } | undefined;
    if (state?.value === 'true') {
      db.close();
      return NextResponse.json({ error: 'Queue is already running' }, { status: 409 });
    }

    // Check for pending items
    const pendingCount = (db.prepare(`SELECT COUNT(*) as count FROM queue_items WHERE status = 'pending'`).get() as any)?.count || 0;
    if (pendingCount === 0) {
      db.close();
      return NextResponse.json({ error: 'No pending items in queue' }, { status: 400 });
    }

    // Mark as running
    db.prepare(`UPDATE queue_state SET value = 'true' WHERE key = 'is_running'`).run();
    db.prepare(`UPDATE queue_state SET value = ? WHERE key = 'last_run_at'`).run(new Date().toISOString());
    db.close();

    // Fire-and-forget: process queue in background
    processQueueInBackground();

    return NextResponse.json({
      success: true,
      message: 'Queue processing started',
      pending: pendingCount,
    });
  } catch (error) {
    try {
      db.prepare(`UPDATE queue_state SET value = 'false' WHERE key = 'is_running'`).run();
      db.close();
    } catch { /* ignore */ }

    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** Log a build to the knowledge table with a structured debrief summary. */
function logBuild(
  db: Database.Database,
  item: any,
  status: string,
  rawOutput: string,
  durationMs: number,
) {
  // Ensure builds table exists with story_file (renamed from spec_file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      story_file TEXT NOT NULL,
      kind TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      files_generated TEXT DEFAULT '[]',
      validation_result TEXT,
      output TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      engine TEXT DEFAULT 'factory'
    );
  `);

  const id = `build_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Add columns if missing
  try {
    const cols = db.prepare(`PRAGMA table_info(builds)`).all() as any[];
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('story_file') && colNames.has('spec_file')) {
      db.exec(`ALTER TABLE builds RENAME COLUMN spec_file TO story_file`);
    }
    if (!colNames.has('engine')) {
      db.exec(`ALTER TABLE builds ADD COLUMN engine TEXT DEFAULT 'factory'`);
    }
  } catch { /* ignore */ }

  // Extract generated files from output
  const fileMatches = rawOutput.match(/✓\s+(.+)/g) || [];
  const filesGenerated = fileMatches.map((m: string) => m.replace(/^✓\s+/, '').trim());

  // Group files by directory
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

  const file = item.story_file || item.spec_file;
  const specName = file?.split('/').pop()?.replace('.yaml', '') || file;
  const outcome = status === 'failed'
    ? 'Build failed — check queue output for details'
    : `Successfully generated ${filesGenerated.length} file(s)`;

  const summary = `# Build Debrief: ${specName}

> ${outcome}

## What Was Built
- **Story**: \`${file}\`
- **Type**: ${item.kind === 'FeatureStory' || item.kind === 'FeatureSpec' ? 'Feature' : 'App'}

## Files Generated

${filesGenerated.length} files across ${dirCounts.size} director${dirCounts.size === 1 ? 'y' : 'ies'}

| Directory | Files |
|---|---|
${dirTable || '| — | 0 |'}

## Duration

Built in ${(durationMs / 1000).toFixed(1)}s.
`;

  const oneLiner = status === 'failed'
    ? 'Build failed'
    : `Built ${filesGenerated.length} file(s) in ${(durationMs / 1000).toFixed(1)}s`;

  db.prepare(`
    INSERT INTO builds (id, story_file, kind, timestamp, duration_ms, status, files_generated, output, notes, engine)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    file,
    item.kind,
    new Date().toISOString(),
    durationMs,
    status,
    JSON.stringify(filesGenerated),
    summary,
    oneLiner,
    item.engine || 'factory',
  );
}
