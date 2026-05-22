/**
 * YAML-driven Queue manager — enqueue, dequeue, update, list build items.
 * Replaces SQLite entirely, managing state via queue.yaml and queue_state.yaml.
 */

import { writeHeartbeat } from './toon.ts';
import { log, logError } from './log.ts';
import { existsSync, mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

// ─── Paths ───────────────────────────────────────────────

const FACTORY_ROOT = resolve(homedir(), '.factory');
const QUEUE_YAML = resolve(FACTORY_ROOT, 'queue.yaml');
const QUEUE_STATE_YAML = resolve(FACTORY_ROOT, 'queue_state.yaml');

// Ensure FACTORY_ROOT exists
if (!existsSync(FACTORY_ROOT)) {
    mkdirSync(FACTORY_ROOT, { recursive: true });
}

// ─── Types ───────────────────────────────────────────────

export type BuildEngine = 'factory' | 'worker';

export interface QueueItem {
    id: string;
    storyFile: string;
    kind: 'AppStory' | 'FeatureStory';
    status: 'pending' | 'running' | 'completed' | 'failed' | 'needs-attention' | 'blocked';
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
    } catch {
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
    } catch {
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

/** Add a story to the build queue. */
export function enqueue(
    storyFile: string,
    kind: 'AppStory' | 'FeatureStory',
    opts?: { phase?: number; dependsOn?: string[]; engine?: BuildEngine },
): QueueItem {
    const queue = loadQueue();
    const id = generateId();
    const now = timestamp();
    const phase = opts?.phase ?? 0;
    const dependsOn = opts?.dependsOn ?? [];
    const engine = opts?.engine ?? 'factory';

    // Check for duplicates
    const existing = queue.find(
        item => item.storyFile === storyFile && ['pending', 'running'].includes(item.status)
    );

    if (existing) {
        throw new Error(`Story "${storyFile}" is already in the queue`);
    }

    // Try to parse targetApp if feature story
    let targetApp = '';
    if (kind === 'FeatureStory') {
        try {
            const { getActiveProject } = require('./config.ts');
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
        status: 'pending',
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
    };

    queue.push(newItem);
    saveQueue(queue);

    return newItem;
}

/**
 * Get the next pending item whose dependencies are all met.
 * Order: phase ASC, priority DESC, added_at ASC.
 * Skips items whose dependsOn stories are not all 'completed'.
 */
export function dequeue(): QueueItem | null {
    const queue = loadQueue();
    const pendingItems = queue
        .filter(item => item.status === 'pending')
        .sort((a, b) => {
            if (a.phase !== b.phase) return a.phase - b.phase;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.addedAt.localeCompare(b.addedAt);
        });

    for (const item of pendingItems) {
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

    const queue = loadQueue();
    for (const depSlug of dependsOn) {
        // Match by storyFile containing the slug
        const completed = queue.some(
            item => item.storyFile.includes(depSlug) && item.status === 'completed'
        );

        if (!completed) return false;
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
    const statusOrder = {
        'running': 0,
        'pending': 1,
        'needs-attention': 2,
        'blocked': 3,
        'failed': 4,
        'completed': 5,
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

/** Update a queue item's fields. */
export function updateItem(
    id: string,
    updates: Partial<Pick<QueueItem, 'status' | 'output' | 'error' | 'errorCategory' | 'startedAt' | 'completedAt' | 'durationMs' | 'priority'>>
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

/** Mark an item as failed — updates YAML and writes failure knowledge to disk. */
export function markFailed(id: string, error: string, output: string, durationMs: number, category?: 'transient' | 'permanent'): QueueItem | null {
    const item = updateItem(id, {
        status: 'failed',
        error,
        errorCategory: category ?? null,
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
            `- Review the error above before retrying this story`,
            `- Run \`factory queue retry ${id}\` once the issue is resolved`,
        ].filter(l => l !== undefined).join('\n');

        writeFileSync(filename, content);
        log('→', `Failure knowledge written: .factory/knowledge/failures/${slug}-${ts}.md`);
    } catch {
        // Non-fatal
    }

    return item;
}

/** Remove a queue item. */
export function removeItem(id: string): boolean {
    const queue = loadQueue();
    const originalLength = queue.length;
    const filtered = queue.filter(item => item.id !== id);
    if (filtered.length < originalLength) {
        saveQueue(filtered);
        return true;
    }
    return false;
}

/** Remove all completed items. */
export function clearCompleted(): number {
    const queue = loadQueue();
    const originalLength = queue.length;
    const filtered = queue.filter(item => item.status !== 'completed');
    const removedCount = originalLength - filtered.length;
    if (removedCount > 0) {
        saveQueue(filtered);
    }
    return removedCount;
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
    const queue = loadQueue();
    const stats: Record<string, number> = {
        pending: 0, running: 0, completed: 0, failed: 0, 'needs-attention': 0, blocked: 0, total: 0,
    };
    for (const item of queue) {
        if (stats[item.status] !== undefined) {
            stats[item.status]++;
        }
        stats.total++;
    }
    return stats;
}

/** Check if the queue processor is running. */
export function isQueueRunning(): boolean {
    const state = loadQueueState();
    return state.is_running;
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
        const { loadStory, loadFeatureStory } = await import('./story.ts');
        const { gatherBlueprint } = await import('./blueprint.ts');
        const { loadBridgeConfig, getActiveProject } = await import('./config.ts');
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
            targetDir = bridge.apps_dir
                ? resolve(projectPath, bridge.apps_dir, story.target.app)
                : resolve(projectPath, story.target.app);
            result = await runFeaturePipeline(story, blueprint, targetDir, item.storyFile);
        } else {
            const story = loadStory(item.storyFile);
            const slug = storySlug(story);
            targetDir = bridge.apps_dir
                ? resolve(projectPath, bridge.apps_dir, slug)
                : resolve(projectPath, slug);
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

        return result.success;
    } catch (error) {
        logError(`Build failed: ${error}`);
        return false;
    }
}
