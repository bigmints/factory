/**
 * Queue manager — enqueue, dequeue, update, list build items.
 * The factory processes specs from this queue while you sleep.
 */

import { getDb } from './db.ts';
import { writeHeartbeat } from './toon.ts';
import { log, logError } from './log.ts';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

// ─── Types ───────────────────────────────────────────────

export type BuildEngine = 'factory' | 'worker';

export interface QueueItem {
    id: string;
    specFile: string;
    kind: 'AppSpec' | 'FeatureSpec';
    status: 'pending' | 'running' | 'completed' | 'failed' | 'needs-attention';
    priority: number;
    phase: number;
    dependsOn: string[];
    engine: BuildEngine;
    addedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    output: string;
    error: string | null;
    errorCategory: 'transient' | 'permanent' | null;
    durationMs: number | null;
}

interface QueueRow {
    id: string;
    spec_file: string;
    kind: string;
    status: string;
    priority: number;
    phase: number;
    depends_on: string;
    engine: string | null;
    added_at: string;
    started_at: string | null;
    completed_at: string | null;
    output: string;
    error: string | null;
    error_category: string | null;
    duration_ms: number | null;
}

// ─── Helpers ─────────────────────────────────────────────

function mapRow(row: QueueRow): QueueItem {
    let dependsOn: string[] = [];
    try { dependsOn = JSON.parse(row.depends_on || '[]'); } catch { /* empty */ }
    return {
        id: row.id,
        specFile: row.spec_file,
        kind: row.kind as QueueItem['kind'],
        status: row.status as QueueItem['status'],
        priority: row.priority,
        phase: row.phase || 0,
        dependsOn,
        engine: (row.engine as BuildEngine) || 'factory',
        addedAt: row.added_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        output: row.output,
        error: row.error,
        errorCategory: row.error_category as any,
        durationMs: row.duration_ms,
    };
}

function generateId(): string {
    return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function timestamp(): string {
    return new Date().toISOString();
}

// ─── Core Operations ─────────────────────────────────────

/** Add a spec to the build queue. */
export function enqueue(
    specFile: string,
    kind: 'AppSpec' | 'FeatureSpec',
    opts?: { phase?: number; dependsOn?: string[]; engine?: BuildEngine },
): QueueItem {
    const db = getDb();
    const id = generateId();
    const now = timestamp();
    const phase = opts?.phase ?? 0;
    const dependsOn = JSON.stringify(opts?.dependsOn ?? []);
    const engine = opts?.engine ?? 'factory';

    // Check for duplicates
    const existing = db.prepare(
        `SELECT id FROM queue_items WHERE spec_file = ? AND status IN ('pending', 'running')`
    ).get(specFile) as QueueRow | undefined;

    if (existing) {
        throw new Error(`Spec "${specFile}" is already in the queue`);
    }

    db.prepare(`
        INSERT INTO queue_items (id, spec_file, kind, status, priority, phase, depends_on, engine, added_at)
        VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `).run(id, specFile, kind, phase, dependsOn, engine, now);

    return getItem(id)!;
}

/**
 * Get the next pending item whose dependencies are all met.
 * Order: phase ASC, priority DESC, added_at ASC.
 * Skips items whose dependsOn specs are not all 'completed'.
 */
export function dequeue(): QueueItem | null {
    const db = getDb();
    // Get all pending items in scheduling order
    const rows = db.prepare(`
        SELECT * FROM queue_items
        WHERE status = 'pending'
        ORDER BY phase ASC, priority DESC, added_at ASC
    `).all() as QueueRow[];

    for (const row of rows) {
        const item = mapRow(row);
        if (areDependenciesMet(item.dependsOn)) {
            return item;
        }
    }

    return null;
}

/**
 * Check if all dependency slugs have a corresponding completed queue item.
 * Returns true if dependsOn is empty (no dependencies).
 */
export function areDependenciesMet(dependsOn: string[]): boolean {
    if (!dependsOn || dependsOn.length === 0) return true;

    const db = getDb();
    for (const depSlug of dependsOn) {
        // Match by spec_file containing the slug (e.g., "auth-system.yaml" matches slug "auth-system")
        const completed = db.prepare(`
            SELECT id FROM queue_items
            WHERE spec_file LIKE ? AND status = 'completed'
            LIMIT 1
        `).get(`%${depSlug}%`) as QueueRow | undefined;

        if (!completed) return false;
    }

    return true;
}

/** Get a specific queue item by ID. */
export function getItem(id: string): QueueItem | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM queue_items WHERE id = ?').get(id) as QueueRow | undefined;
    return row ? mapRow(row) : null;
}

/** Get all queue items, ordered by status then added time. */
export function listQueue(): QueueItem[] {
    const db = getDb();
    const rows = db.prepare(`
        SELECT * FROM queue_items
        ORDER BY
            CASE status
                WHEN 'running' THEN 0
                WHEN 'pending' THEN 1
                WHEN 'needs-attention' THEN 2
                WHEN 'failed' THEN 3
                WHEN 'completed' THEN 4
            END,
            priority DESC,
            added_at ASC
    `).all() as QueueRow[];

    return rows.map(mapRow);
}

// ─── Status Updates ──────────────────────────────────────

/** Update a queue item's fields. */
export function updateItem(
    id: string,
    updates: Partial<Pick<QueueItem, 'status' | 'output' | 'error' | 'errorCategory' | 'startedAt' | 'completedAt' | 'durationMs'>>
): QueueItem | null {
    const db = getDb();
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
    if (updates.output !== undefined) { sets.push('output = ?'); values.push(updates.output); }
    if (updates.error !== undefined) { sets.push('error = ?'); values.push(updates.error); }
    if (updates.errorCategory !== undefined) { sets.push('error_category = ?'); values.push(updates.errorCategory); }
    if (updates.startedAt !== undefined) { sets.push('started_at = ?'); values.push(updates.startedAt); }
    if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); values.push(updates.completedAt); }
    if (updates.durationMs !== undefined) { sets.push('duration_ms = ?'); values.push(updates.durationMs); }

    if (sets.length === 0) return getItem(id);

    values.push(id);
    db.prepare(`UPDATE queue_items SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    return getItem(id);
}

/** Mark an item as running. */
export function markRunning(id: string): QueueItem | null {
    try {
        const projectPath = process.env.FACTORY_PROJECT_ROOT || process.cwd();
        writeHeartbeat(projectPath, 'queue: build started');
    } catch {
        // ignore heartbeat errors
    }
    return updateItem(id, { status: 'running', startedAt: timestamp() });
}

/** Mark an item as completed. */
export function markCompleted(id: string, output: string, durationMs: number): QueueItem | null {
    return updateItem(id, {
        status: 'completed',
        output,
        completedAt: timestamp(),
        durationMs,
    });
}

/** Mark an item as failed — updates DB and writes failure knowledge to disk. */
export function markFailed(id: string, error: string, output: string, durationMs: number, category?: 'transient' | 'permanent'): QueueItem | null {
    const item = updateItem(id, {
        status: 'failed',
        error,
        errorCategory: category,
        output,
        completedAt: timestamp(),
        durationMs,
    });

    // Write failure knowledge so future builds can learn from this error
    try {
        const projectRoot = process.env.FACTORY_PROJECT_ROOT || process.cwd();
        const failuresDir = join(projectRoot, '.factory', 'knowledge', 'failures');
        if (!existsSync(failuresDir)) mkdirSync(failuresDir, { recursive: true });

        const slug = id.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const filename = join(failuresDir, `${slug}-${ts}.md`);

        const content = [
            `# Build Failure: ${id}`,
            ``,
            `**Date:** ${new Date().toISOString()}`,
            `**Category:** ${category || 'unknown'}`,
            `**Duration:** ${durationMs}ms`,
            ``,
            `## Error`,
            `\`\`\``,
            error,
            `\`\`\``,
            ``,
            output ? `## Output\n\`\`\`\n${output.slice(0, 3000)}\n\`\`\`` : '',
            ``,
            `## Action`,
            `- Review the error above before retrying this spec`,
            `- Run \`factory queue retry ${id}\` once the issue is resolved`,
        ].filter(l => l !== undefined).join('\n');

        writeFileSync(filename, content);
        log('→', `Failure knowledge written: .factory/knowledge/failures/${slug}-${ts}.md`);
    } catch {
        // Non-fatal — failure recording must never crash the daemon
    }

    return item;
}

/** Remove a queue item. */
export function removeItem(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM queue_items WHERE id = ?').run(id);
    return result.changes > 0;
}

/** Remove all completed items. */
export function clearCompleted(): number {
    const db = getDb();
    const result = db.prepare(`DELETE FROM queue_items WHERE status = 'completed'`).run();
    return result.changes;
}

/** Retry a failed item — reset to pending. */
export function retryItem(id: string): QueueItem | null {
    return updateItem(id, {
        status: 'pending',
        error: null,
        output: '',
        startedAt: null,
        completedAt: null,
        durationMs: null,
    });
}

// ─── Stats & State ───────────────────────────────────────

/** Get queue counts by status. */
export function getQueueStats(): Record<string, number> {
    const db = getDb();
    const rows = db.prepare(`
        SELECT status, COUNT(*) as count FROM queue_items GROUP BY status
    `).all() as { status: string; count: number }[];

    const stats: Record<string, number> = {
        pending: 0, running: 0, completed: 0, failed: 0, 'needs-attention': 0, total: 0,
    };
    for (const row of rows) {
        stats[row.status] = row.count;
        stats.total += row.count;
    }
    return stats;
}

/** Check if the queue processor is running. */
export function isQueueRunning(): boolean {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM queue_state WHERE key = 'is_running'`).get() as { value: string } | undefined;
    return row?.value === 'true';
}

/** Set the queue running state. */
export function setQueueRunning(running: boolean): void {
    const db = getDb();
    db.prepare(`UPDATE queue_state SET value = ? WHERE key = 'is_running'`).run(running ? 'true' : 'false');
    if (running) {
        db.prepare(`UPDATE queue_state SET value = ? WHERE key = 'last_run_at'`).run(timestamp());
    }
}

// ─── Heartbeat Integration ───────────────────────────────

/** Write heartbeat when a build starts. Wrapped in try/catch so it never breaks the queue. */
function writeHeartbeatOnStart(projectPath: string): void {
    try {
        import('./toon.ts').then(({ writeHeartbeat }) => {
            writeHeartbeat(projectPath, 'queue: build started');
        }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
}

// ─── Daemon Mode ─────────────────────────────────────────

/**
 * Start the queue daemon — persistent watch loop.
 * Processes all pending items, then polls SQLite every 30s for new items.
 * Never exits unless killed (SIGTERM/SIGINT).
 */
export async function startQueueDaemon(): Promise<void> {
    let running = true;
    const POLL_INTERVAL = 30_000; // 30 seconds
    const MAX_RETRIES = 3;
    const BASE_DELAY = 5000; // 5 seconds

    process.on('SIGTERM', () => { running = false; });
    process.on('SIGINT', () => { running = false; });

    log('●', 'Queue daemon starting...');

    while (running) {
        try {
            const stats = getQueueStats();
            const pending = stats.pending || 0;

            if (pending > 0) {
                log('●', `Processing ${pending} pending item(s)...`);
                const item = dequeue();
                if (item) {
                    let lastError: string | null = null;

                    // Auto-retry with exponential backoff
                    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                        try {
                            markRunning(item.id);
                            const success = await runBuild(item);
                            if (success) {
                                markCompleted(item.id, 'Build succeeded', Date.now());
                                lastError = null;
                                break;
                            }
                        } catch (error) {
                            lastError = error instanceof Error ? error.message : String(error);
                            logError(`Attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`);
                        }

                        if (attempt < MAX_RETRIES && lastError) {
                            const delay = BASE_DELAY * Math.pow(2, attempt - 1);
                            log('  ', `Retrying in ${delay/1000}s...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    }

                    if (lastError) {
                        markFailed(item.id, lastError, '', 0, 'permanent');
                    }
                }
            } else {
                log('  ', 'No pending items — polling in 30s...');
            }

            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        } catch (error) {
            logError(`Daemon error: ${error}`);
            await new Promise(resolve => setTimeout(resolve, 10_000));
        }
    }

    log('✓', 'Queue daemon stopped');
}

// ─── Build Runner ────────────────────────────────────────

/**
 * Run a build for a queue item.
 * Returns true if the build succeeded.
 */
async function runBuild(item: QueueItem): Promise<boolean> {
    try {
        const { runPipeline, runFeaturePipeline } = await import('./generate.ts');
        const { loadSpec, loadFeatureSpec } = await import('./spec.ts');
        const { gatherContext } = await import('./context.ts');
        const { loadBridgeConfig } = await import('./config.ts');
        const { writeFiles, setupProject, writeKnowledgeEntry, writeAppAgentsMd } = await import('./writer.ts');
        const { resolve } = await import('node:path');
        const { specSlug } = await import('./types.ts');

        const bridge = loadBridgeConfig(process.cwd());
        const context = gatherContext(process.cwd(), bridge);

        let result;
        let targetDir: string;
        if (item.kind === 'FeatureSpec') {
            const spec = loadFeatureSpec(item.specFile);
            targetDir = bridge.apps_dir
                ? resolve(process.cwd(), bridge.apps_dir, spec.target.app)
                : resolve(process.cwd(), spec.target.app);
            result = await runFeaturePipeline(spec, context, targetDir, item.specFile);
        } else {
            const spec = loadSpec(item.specFile);
            const slug = specSlug(spec);
            targetDir = bridge.apps_dir
                ? resolve(process.cwd(), bridge.apps_dir, slug)
                : resolve(process.cwd(), slug);
            result = await runPipeline(spec, context, targetDir, item.specFile);
        }

        // Write files
        writeFiles(targetDir, result.files);
        setupProject(targetDir, bridge.stack?.packageManager);

        // Knowledge feedback
        const spec = item.kind === 'FeatureSpec' ? loadFeatureSpec(item.specFile) : loadSpec(item.specFile);
        const appName = 'appName' in spec ? spec.appName : spec.feature.name;
        writeKnowledgeEntry(process.cwd(), appName, result, (spec as any).stack || {}, item.specFile);
        writeAppAgentsMd(targetDir, appName, (spec as any).stack || {}, result.files);

        return result.success;
    } catch (error) {
        logError(`Build failed: ${error}`);
        return false;
    }
}
