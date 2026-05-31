/**
 * YAML-driven Queue manager — enqueue, dequeue, update, list build items.
 * Replaces SQLite entirely, managing state via queue.yaml and queue_state.yaml.
 *
 * All mutating operations use file-level locking via proper-lockfile to prevent
 * race conditions when multiple processes (daemon, UI API, CLI) access queue.yaml.
 */

import { writeHeartbeat } from './toon.ts';
import { log, logError } from './log.ts';
import { existsSync, mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { slugify, LifecycleStatus } from './types.ts';
import { getActiveProject, isBootstrapped } from './config.ts';
import { updateStoryStatus, archiveStory } from './story.ts';
import lockfile from 'proper-lockfile';

// ─── Paths ───────────────────────────────────────────────

const FACTORY_ROOT = resolve(homedir(), '.factory');
const QUEUE_YAML = resolve(FACTORY_ROOT, 'queue.yaml');
const QUEUE_STATE_YAML = resolve(FACTORY_ROOT, 'queue_state.yaml');

// Ensure FACTORY_ROOT exists
if (!existsSync(FACTORY_ROOT)) {
    mkdirSync(FACTORY_ROOT, { recursive: true });
}

// Ensure QUEUE_YAML exists (proper-lockfile requires the target file to exist)
if (!existsSync(QUEUE_YAML)) {
    writeFileSync(QUEUE_YAML, '', 'utf-8');
}

// ─── File Locking ────────────────────────────────────────

/**
 * Acquire a file lock on queue.yaml before running a read-modify-write callback.
 * This prevents race conditions when multiple processes (daemon, UI API, CLI)
 * simultaneously mutate the queue.
 */
export async function withQueueLock<T>(fn: () => T): Promise<T> {
    const release = await lockfile.lock(QUEUE_YAML, {
        stale: 10000,        // consider lock stale after 10s
        retries: { retries: 3, minTimeout: 100, maxTimeout: 1000 },
        lockfilePath: QUEUE_YAML + '.lock',
    });
    try {
        return fn();
    } finally {
        await release();
    }
}

// ─── Types ───────────────────────────────────────────────

export type BuildEngine = 'factory' | 'worker';

export interface QueueItem {
    id: string;
    storyFile: string;
    kind: 'AppStory' | 'FeatureStory';
    status: LifecycleStatus;
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
    targetApp?: string; // Optional target app slug for feature stories
    threadId?: string;
}

export interface QueueState {
    is_running: boolean;
    last_run_at: string;
    last_heartbeat_at: string;
}

// ─── IO Helpers ──────────────────────────────────────────

function writeAtomic(filePath: string, content: string): void {
    const tempPath = filePath + '.tmp';
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, filePath);
}

export function loadQueue(): QueueItem[] {
    if (!existsSync(QUEUE_YAML)) {
        return [];
    }
    try {
        const raw = readFileSync(QUEUE_YAML, 'utf-8');
        const parsed = parseYaml(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        log('!', `Failed to parse queue.yaml: ${(err as Error).message?.slice(0, 100) || err}`);
        return [];
    }
}

export function saveQueue(queue: QueueItem[]): void {
    writeAtomic(QUEUE_YAML, toYaml(queue, { lineWidth: 120 }));
}

export function loadQueueState(): QueueState {
    const defaultState: QueueState = {
        is_running: false,
        last_run_at: '',
        last_heartbeat_at: '',
    };
    if (!existsSync(QUEUE_STATE_YAML)) {
        return defaultState;
    }
    try {
        const raw = readFileSync(QUEUE_STATE_YAML, 'utf-8');
        const parsed = parseYaml(raw) as any;
        return {
            is_running: parsed?.is_running === true || parsed?.is_running === 'true',
            last_run_at: parsed?.last_run_at || '',
            last_heartbeat_at: parsed?.last_heartbeat_at || '',
        };
    } catch (err) {
        log('!', `Failed to parse queue-state.yaml: ${(err as Error).message?.slice(0, 100) || err}`);
        return defaultState;
    }
}

export function saveQueueState(state: QueueState): void {
    writeAtomic(QUEUE_STATE_YAML, toYaml(state));
}

// ─── Helpers ─────────────────────────────────────────────

function generateId(): string {
    return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function timestamp(): string {
    return new Date().toISOString();
}

// ─── Core Operations ─────────────────────────────────────

/** Automatically find the right threadId for a story based on targetApp or dependencies */
export function resolveThreadIdForStory(storyFile: string, dependsOn: string[]): string | undefined {
    // 1. Check if the story file itself already contains a threadId
    try {
        const project = getActiveProject();
        const storyPath = resolve(project.path, '.factory', 'stories', storyFile);
        if (existsSync(storyPath)) {
            const parsed = parseYaml(readFileSync(storyPath, 'utf-8')) as any;
            if (parsed?.threadId) return parsed.threadId;
        }
    } catch { /* expected: project may not be set or story file may not exist */ }

    // 2. Check dependencies (dependsOn slugs) for an existing threadId in the queue or story YAMLs
    for (const depSlug of dependsOn) {
        const latestDep = getLatestDependencyItem(depSlug);
        if (latestDep && latestDep.threadId) {
            return latestDep.threadId;
        }
        
        // Check story file directly
        try {
            const project = getActiveProject();
            const storiesDir = join(project.path, '.factory', 'stories');
            for (const subDir of ['done', 'features', 'apps']) {
                const dirPath = join(storiesDir, subDir);
                if (!existsSync(dirPath)) continue;
                const files = readdirSync(dirPath, { recursive: true }) as string[];
                const file = files.find(f => typeof f === 'string' && f.split(/[\\/]/).pop()?.replace(/\.ya?ml$/, '') === depSlug);
                if (file) {
                    const parsed = parseYaml(readFileSync(join(dirPath, file), 'utf-8')) as any;
                    if (parsed?.threadId) return parsed.threadId;
                }
            }
        } catch { /* expected: project may not be set or stories dir may not exist */ }
    }

    // 3. Check other queue items with the same target app
    try {
        const project = getActiveProject();
        const storyPath = resolve(project.path, '.factory', 'stories', storyFile);
        if (existsSync(storyPath)) {
            const parsed = parseYaml(readFileSync(storyPath, 'utf-8')) as any;
            const targetApp = parsed?.target?.app;
            if (targetApp) {
                const queue = loadQueue();
                const match = queue.find(item => item.targetApp === targetApp && item.threadId);
                if (match && match.threadId) return match.threadId;
            }
        }
    } catch { /* expected: project may not be set or story file may not exist */ }

    return undefined;
}

/** Add a story to the build queue (sync inner helper). */
function _enqueueSync(
    storyFile: string,
    kind: 'AppStory' | 'FeatureStory',
    opts?: { phase?: number; dependsOn?: string[]; engine?: BuildEngine; threadId?: string },
): QueueItem {
    const queue = loadQueue();
    const id = generateId();
    const now = timestamp();
    const phase = opts?.phase ?? 0;
    const dependsOn = opts?.dependsOn ?? [];
    const engine = opts?.engine ?? 'factory';
    let threadId = opts?.threadId;

    if (!threadId) {
        threadId = resolveThreadIdForStory(storyFile, dependsOn);
    }

    // Check for duplicates
    const existing = queue.find(
        item => item.storyFile === storyFile
    );

    if (existing) {
        throw new Error(`Story "${storyFile}" is already in the queue (status: ${existing.status}). Use 'factory queue retry <id>' to run it again if needed.`);
    }

    // Try to parse targetApp if feature story
    let targetApp = '';
    if (kind === 'FeatureStory') {
        try {
            const project = getActiveProject();
            const storyPath = resolve(project.path, '.factory', 'stories', storyFile);
            if (existsSync(storyPath)) {
                const raw = readFileSync(storyPath, 'utf-8');
                const parsed = parseYaml(raw) as any;
                targetApp = parsed?.target?.app || '';
            }
        } catch {
            // ignore
        }
    }

    const newItem: QueueItem = {
        id,
        storyFile,
        kind,
        status: 'ready-to-build',
        priority: 0,
        phase,
        dependsOn,
        engine,
        addedAt: now,
        startedAt: null,
        completedAt: null,
        output: '',
        error: null,
        errorCategory: null,
        durationMs: null,
        targetApp: targetApp || undefined,
        threadId: threadId || undefined,
    };

    queue.push(newItem);
    saveQueue(queue);

    return newItem;
}

/** Add a story to the build queue (async, locked). */
export async function enqueue(
    storyFile: string,
    kind: 'AppStory' | 'FeatureStory',
    opts?: { phase?: number; dependsOn?: string[]; engine?: BuildEngine; threadId?: string },
): Promise<QueueItem> {
    return withQueueLock(() => _enqueueSync(storyFile, kind, opts));
}

/** Extract exact story slug from a story file path. */
export function getSlugFromPath(storyFile: string): string {
    return basename(storyFile).replace(/\.ya?ml$/, '');
}

/** Get the latest queued item matching a dependency slug by sorting by addedAt descending. */
export function getLatestDependencyItem(depSlug: string): QueueItem | null {
    depSlug = getSlugFromPath(depSlug);
    const queue = loadQueue();
    const matchingItems = queue.filter(
        item => getSlugFromPath(item.storyFile) === depSlug
    );
    if (matchingItems.length === 0) return null;
    return matchingItems.sort((a, b) => b.addedAt.localeCompare(a.addedAt))[0];
}

/** Check if a dependency is physically completed by searching for story files with matching slugs. */
export function isDependencyCompleted(depSlug: string): boolean {
    depSlug = getSlugFromPath(depSlug);
    try {
        const project = getActiveProject();
        if (!project || !project.path) {
            console.error(`[isDependencyCompleted] No active project for depSlug="${depSlug}"`);
            return false;
        }

        console.error(`[isDependencyCompleted] Checking depSlug="${depSlug}" in project="${project.path}"`);

        const storiesDir = join(project.path, '.factory', 'stories');
        const subDirs = ['done', 'features', 'apps'];

        for (const subDir of subDirs) {
            const dirPath = join(storiesDir, subDir);
            if (!existsSync(dirPath)) continue;

            const files = readdirSync(dirPath, { recursive: true }) as string[];
            const validFiles = files.filter(f => typeof f === 'string' && (f.endsWith('.yaml') || f.endsWith('.yml')));
            for (const file of validFiles) {
                const filePath = join(dirPath, file);
                try {
                    const raw = readFileSync(filePath, 'utf-8');
                    const parsed = parseYaml(raw);
                    if (!parsed) continue;

                    // Match by filename stem — this is what dependsOn actually uses
                    const fileStem = file.split(/[\\/]/).pop()?.replace(/\.ya?ml$/, '') || '';

                    let isMatch = fileStem === depSlug;

                    // Also match by feature.slug (internal slug field)
                    if (!isMatch && parsed.feature?.slug) {
                        isMatch = parsed.feature.slug === depSlug;
                    }
                    // Also match by appName slug
                    if (!isMatch && parsed.appName) {
                        isMatch = slugify(parsed.appName) === depSlug;
                    }

                    if (isMatch) {
                        // In done/ = completed. In features/apps with status:done = completed.
                        if (subDir === 'done' || parsed.status === 'done') {
                            console.error(`[isDependencyCompleted] FOUND depSlug="${depSlug}" → ${subDir}/${file} (status=${parsed.status || 'in-done-dir'})`);
                            return true;
                        }
                        console.error(`[isDependencyCompleted] MATCH but not done: depSlug="${depSlug}" → ${subDir}/${file} status=${parsed.status}`);
                    }
                } catch {
                    // Ignore parse/read errors for individual files
                }
            }
        }
        console.error(`[isDependencyCompleted] NOT FOUND depSlug="${depSlug}"`);
    } catch (e) {
        console.error(`[isDependencyCompleted] ERROR for depSlug="${depSlug}":`, e);
    }
    return false;
}

/** Check if a queue item is ready to build based on explicit and implicit dependencies. */
export function isItemReady(item: QueueItem): { ready: boolean; reason: string | null } {
    // 1. Implicit parent AppStory dependency check for FeatureStories
    if (item.kind === 'FeatureStory' && item.targetApp) {
        const latestApp = getLatestDependencyItem(item.targetApp);
        if (latestApp) {
            if (latestApp.status === 'failed' || latestApp.status === 'paused') {
                return { ready: false, reason: `App story "${latestApp.storyFile}" ${latestApp.status}. Cannot build feature on a broken app.` };
            }
            if (latestApp.status === 'ready-to-build' || latestApp.status === 'building') {
                return { ready: false, reason: `App story "${latestApp.storyFile}" has not completed yet.` };
            }
            // completed — fall through, ready
        } else {
            // App story not in queue — check if it was already built (in done/ dir or status:done in YAML)
            if (!isDependencyCompleted(item.targetApp)) {
                // Not found as done — fall back to bootstrapped flag in factory.yaml
                try {
                    const project = getActiveProject();
                    if (project && project.path && !isBootstrapped(project.path)) {
                        return {
                            ready: false,
                            reason: `Project is not bootstrapped. Build the "⚙️ Scaffold & Foundation" epic first.`,
                        };
                    }
                } catch {
                    // fall through — if we can't read config, don't block
                }
            }
            // isDependencyCompleted true — app was built outside the queue, allow feature to proceed
        }
    }

    // 2. Explicit dependsOn check
    const dependsOn = item.dependsOn || [];
    for (const depSlug of dependsOn) {
        const latestDep = getLatestDependencyItem(depSlug);
        if (latestDep) {
            if (latestDep.status === 'failed' || latestDep.status === 'paused') {
                return { ready: false, reason: `Dependency "${depSlug}" (${latestDep.storyFile}) ${latestDep.status}. Cannot proceed.` };
            }
            if (latestDep.status !== 'done') {
                return { ready: false, reason: `Dependency "${depSlug}" has not completed yet.` };
            }
        } else {
            if (!isDependencyCompleted(depSlug)) {
                return { ready: false, reason: `Dependency "${depSlug}" is missing from the queue.` };
            }
        }
    }

    return { ready: true, reason: null };
}

/**
 * Get the next pending item whose dependencies are all met.
 * Order: phase ASC, priority DESC, added_at ASC.
 * Skips items whose dependsOn stories are not all 'completed'.
 * Auto-blocks items whose dependencies have failed.
 */
export async function dequeue(): Promise<QueueItem | null> {
    const queue = loadQueue();
    const pendingItems = queue
        .filter(item => item.status === 'ready-to-build')
        .sort((a, b) => {
            if (a.phase !== b.phase) return a.phase - b.phase;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.addedAt.localeCompare(b.addedAt);
        });

    if (pendingItems.length > 0) {
        return pendingItems[0];
    }

    return null;
}

/**
 * Check if all dependency slugs have a corresponding completed queue item.
 * Returns true if dependsOn is empty (no dependencies).
 */
export function areDependenciesMet(dependsOn: string[]): boolean {
    if (!dependsOn || dependsOn.length === 0) return true;

    for (const depSlug of dependsOn) {
        const latestDep = getLatestDependencyItem(depSlug);
        if (latestDep) {
            if (latestDep.status !== 'done') {
                return false;
            }
        } else {
            if (!isDependencyCompleted(depSlug)) {
                return false;
            }
        }
    }

    return true;
}

/** Get a specific queue item by ID. */
export function getItem(id: string): QueueItem | null {
    const queue = loadQueue();
    return queue.find(item => item.id === id) || null;
}

/** Get all queue items, ordered by status then added time. */
export function listQueue(): QueueItem[] {
    const queue = loadQueue();
    const statusOrder: Record<QueueItem['status'], number> = {
        'building': 0,
        'ready-to-build': 1,
        'paused': 2,
        'failed': 3,
        'done': 4,
        'draft': 5,
    };

    return queue.sort((a, b) => {
        const orderA = statusOrder[a.status] ?? 99;
        const orderB = statusOrder[b.status] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.addedAt.localeCompare(b.addedAt);
    });
}

// ─── Status Updates ──────────────────────────────────────

/** Update a queue item's fields (sync inner helper). */
function _updateItemSync(
    id: string,
    updates: Partial<Pick<QueueItem, 'status' | 'output' | 'error' | 'errorCategory' | 'startedAt' | 'completedAt' | 'durationMs' | 'priority' | 'threadId'>>
): QueueItem | null {
    const queue = loadQueue();
    const index = queue.findIndex(item => item.id === id);
    if (index === -1) return null;

    queue[index] = {
        ...queue[index],
        ...updates,
    };
    saveQueue(queue);

    return queue[index];
}

/** Update a queue item's fields (async, locked). */
export async function updateItem(
    id: string,
    updates: Partial<Pick<QueueItem, 'status' | 'output' | 'error' | 'errorCategory' | 'startedAt' | 'completedAt' | 'durationMs' | 'priority' | 'threadId'>>
): Promise<QueueItem | null> {
    return withQueueLock(() => _updateItemSync(id, updates));
}

/** Mark an item as running (async, locked). */
export async function markRunning(id: string): Promise<QueueItem | null> {
    try {
        const projectPath = process.env.FACTORY_PROJECT_ROOT || process.cwd();
        writeHeartbeat(projectPath, 'queue: build started');
    } catch {
        // ignore heartbeat errors
    }
    return withQueueLock(() => _updateItemSync(id, { status: 'building', startedAt: timestamp() }));
}

/** Mark an item as completed (async, locked). */
export async function markCompleted(id: string, output: string, durationMs: number): Promise<QueueItem | null> {
    return withQueueLock(() => _updateItemSync(id, {
        status: 'done',
        output,
        completedAt: timestamp(),
        durationMs,
    }));
}

/** Mark an item as failed — updates YAML (locked) and writes failure knowledge to disk. */
export async function markFailed(id: string, error: string, output: string, durationMs: number, category?: 'transient' | 'permanent'): Promise<QueueItem | null> {
    const item = await withQueueLock(() => _updateItemSync(id, {
        status: 'failed',
        error,
        errorCategory: category ?? null,
        output,
        completedAt: timestamp(),
        durationMs,
    }));

    // Write failure knowledge so future builds can learn from this error
    try {
        const projectRoot = process.env.FACTORY_PROJECT_ROOT || process.cwd();
        const failuresDir = join(projectRoot, '.factory', 'logs', 'failures');
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
            `- Review the error above before retrying this story`,
            `- Run \`factory queue retry ${id}\` once the issue is resolved`,
        ].filter(l => l !== undefined).join('\n');

        writeFileSync(filename, content);
        log('→', `Failure knowledge written: .factory/logs/failures/${slug}-${ts}.md`);
    } catch {
        // Non-fatal
    }

    return item;
}

/** Remove a queue item (async, locked). */
export async function removeItem(id: string): Promise<boolean> {
    return withQueueLock(() => {
        const queue = loadQueue();
        const originalLength = queue.length;
        const filtered = queue.filter(item => item.id !== id);
        if (filtered.length < originalLength) {
            saveQueue(filtered);
            return true;
        }
        return false;
    });
}

/** Remove all completed items (async, locked). */
export async function clearCompleted(): Promise<number> {
    return withQueueLock(() => {
        const queue = loadQueue();
        const originalLength = queue.length;
        const filtered = queue.filter(item => item.status !== 'done');
        const removedCount = originalLength - filtered.length;
        if (removedCount > 0) {
            saveQueue(filtered);
        }
        return removedCount;
    });
}

/** Retry a failed item — reset to pending (async, locked). */
export async function retryItem(id: string): Promise<QueueItem | null> {
    return withQueueLock(() => _updateItemSync(id, {
        status: 'ready-to-build',
        error: null,
        output: '',
        startedAt: null,
        completedAt: null,
        durationMs: null,
    }));
}

// ─── Stats & State ───────────────────────────────────────

/** Get queue counts by status. */
export function getQueueStats(): Record<string, number> {
    const queue = loadQueue();
    const stats: Record<string, number> = {
        'draft': 0, 'ready-to-build': 0, 'building': 0, 'paused': 0, 'failed': 0, 'done': 0, total: 0,
    };
    for (const item of queue) {
        if (stats[item.status] !== undefined) {
            stats[item.status]++;
        }
        stats.total++;
    }
    return stats;
}

/** Check if the queue processor is running.
 *  Guards against stale state: if last_heartbeat_at is older than 5 minutes,
 *  the runner has crashed and the flag is stale — treat it as not running.
 */
export function isQueueRunning(): boolean {
    const state = loadQueueState();
    if (!state.is_running) return false;

    // Stale-heartbeat guard: if no heartbeat for >5 min, the runner has died
    if (state.last_heartbeat_at) {
        const lastBeat = new Date(state.last_heartbeat_at).getTime();
        const ageMs = Date.now() - lastBeat;
        if (ageMs > 5 * 60 * 1000) {
            // Auto-heal: reset the stale flag so the UI doesn't show "running" forever
            try {
                saveQueueState({ ...state, is_running: false });
            } catch { /* ignore write errors */ }
            return false;
        }
    }

    return true;
}

/** Set the queue running state. */
export function setQueueRunning(running: boolean): void {
    const state = loadQueueState();
    state.is_running = running;
    if (running) {
        state.last_run_at = timestamp();
    }
    saveQueueState(state);
}

// ─── Daemon Mode ─────────────────────────────────────────

/**
 * Start the queue daemon — persistent watch loop.
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
            const pending = stats['ready-to-build'] || 0;

            if (pending > 0) {
                log('●', `Processing ${pending} ready-to-build item(s)...`);
                const item = await dequeue();
                if (item) {
                    let lastError: string | null = null;
                    const buildStartTime = Date.now();

                    // Auto-retry with exponential backoff
                    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                        try {
                            await markRunning(item.id);
                            const success = await runBuild(item);
                            if (success) {
                                await markCompleted(item.id, 'Build succeeded', Date.now() - buildStartTime);
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
                        await markFailed(item.id, lastError, '', Date.now() - buildStartTime, 'permanent');
                    }
                }
            } else {
                log('  ', 'No ready-to-build items — polling in 30s...');
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
        const { loadStory, loadFeatureStory } = await import('./story.ts');
        const { gatherBlueprint } = await import('./blueprint.ts');
        const { loadBridgeConfig, getActiveProject, setBootstrapped } = await import('./config.ts');
        const { writeFiles, setupProject, writeKnowledgeEntry, writeAppAgentsMd } = await import('./writer.ts');
        const { resolve } = await import('node:path');
        const { storySlug } = await import('./types.ts');

        const project = getActiveProject();
        const projectPath = project.path;

        const bridge = loadBridgeConfig(projectPath);
        const blueprint = gatherBlueprint(projectPath, bridge);

        let result;
        let targetDir: string;
        if (item.kind === 'FeatureStory') {
            const story = loadFeatureStory(item.storyFile);
            const targetApp = story.target.app;
            targetDir = bridge.apps_dir && targetApp
                ? resolve(projectPath, bridge.apps_dir, targetApp)
                : targetApp && targetApp !== project.name && targetApp !== basename(projectPath)
                ? resolve(projectPath, targetApp)
                : projectPath;
            result = await runFeaturePipeline(story, blueprint, targetDir, item.storyFile);
        } else {
            const story = loadStory(item.storyFile);
            const slug = storySlug(story);
            targetDir = bridge.apps_dir
                ? resolve(projectPath, bridge.apps_dir, slug)
                : slug !== project.name && slug !== basename(projectPath)
                ? resolve(projectPath, slug)
                : projectPath;
            result = await runPipeline(story, blueprint, targetDir, item.storyFile);
        }

        // Write files
        writeFiles(targetDir, result.files);
        setupProject(targetDir, bridge.stack?.packageManager);

        // Knowledge feedback
        const story = item.kind === 'FeatureStory' ? loadFeatureStory(item.storyFile) : loadStory(item.storyFile);
        const appName = 'appName' in story ? story.appName : story.feature.name;
        writeKnowledgeEntry(projectPath, appName, result, (story as any).stack || {}, item.storyFile);
        writeAppAgentsMd(targetDir, appName, (story as any).stack || {}, result.files);

        // If an AppStory built successfully, mark the project as bootstrapped
        // so feature stories are no longer gated behind the scaffold check.
        if (item.kind === 'AppStory' && result.success) {
            try {
                setBootstrapped(projectPath, true);
                log('✓', 'Project marked as bootstrapped — feature stories are now unlocked');
            } catch {
                // Non-fatal: don’t fail the build over a flag write error
            }
        }

        // On success: persist 'done' status back into the story YAML, scaffold.yaml,
        // and physically archive the file to done/ directory.
        // This is critical — without all three, clearing the queue causes stories to bounce
        // back to "Ready to Build" because queueStatus becomes undefined.
        if (result.success) {
            try {
                const { updateStoryStatusInApp } = await import('./rollup.ts');

                // 1. Update the YAML status field in-place (before archiving, in case archive fails)
                updateStoryStatus(item.storyFile, 'done');

                // 2. Archive (move) the story file from features/|apps/ to done/
                //    so the board's file-path check (item.file.startsWith('done/')) works too
                const archivedPath = archiveStory(item.storyFile);
                const canonicalFile = archivedPath
                    ? `done/${basename(archivedPath)}`
                    : item.storyFile;

                // 3. Update scaffold.yaml story status + rollup — use archived path so
                //    the done/ path match in updateStoryStatusInApp finds the right entry
                await updateStoryStatusInApp(canonicalFile, 'done');
                log('✓', `Story archived and marked done: ${canonicalFile}`);
            } catch (e) {
                // Non-fatal: story YAML update failure doesn't fail the build
                logError(`Failed to archive/update story YAML status: ${e}`);
            }
        }

        // Auto-distill chronicle context (dynamic context accumulation)
        try {
            const { distillChronicle } = await import('./chronicle.ts');
            await distillChronicle(projectPath);
        } catch { /* ignore */ }

        return result.success;
    } catch (error) {
        logError(`Build failed: ${error}`);
        return false;
    }
}
