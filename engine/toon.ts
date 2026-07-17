/**
 * TOON Helpers — read, write, compress context files for the agentic bridge.
 *
 * Storage: context files are stored as YAML (.yaml), human-editable and git-trackable.
 * TOON encoding (encode/decode) is used for reading/writing the internal TOON format
 * when legacy .toon files are present.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { hostname as osHostname } from 'node:os';
import { encode, decode } from '@toon-format/toon';
import { stringify as toYaml } from 'yaml';
import { log } from './log.ts';

// ─── Read ────────────────────────────────────────────────

/** Read a TOON file and decode it. Returns null if file doesn't exist. */
export function readToonFile(path: string): Record<string, unknown> | null {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf-8');
    if (!content.trim()) return {};
    try {
        return decode(content) as Record<string, unknown>;
    } catch (err) {
        log('!', `Failed to decode TOON file ${path}: ${(err as Error).message?.slice(0, 100) || err}`);
        return null;
    }
}

/** Read a TOON file and return raw string content. */
export function readToonRaw(path: string): string | null {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
}

// ─── Write ───────────────────────────────────────────────

/** Write data to a TOON file, creating directories as needed. */
export function writeToFile(path: string, data: Record<string, unknown>): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, encode(data));
}

// ─── Compress ────────────────────────────────────────────

/**
 * Compress a TOON worklog by keeping only the last N entries.
 * @param path - Path to the worklog file
 * @param keep - Number of recent entries to keep (default: 10)
 */
export function compressToon(path: string, keep = 10): void {
    const data = readToonFile(path);
    if (!data || !data.entries || !Array.isArray(data.entries)) return;

    const entries = data.entries as Array<Record<string, unknown>>;
    if (entries.length <= keep + 1) return; // Already small enough

    const recent = entries.slice(-keep);
    const older = entries.slice(0, -keep);

    const summaryEntry: Record<string, unknown> = {
        date: new Date().toISOString().replace('T', ' ').substring(0, 19),
        message: `[ARCHIVED HISTORY] Compressed ${older.length} earlier entries to save context.`,
    };

    (data as any).entries = [summaryEntry, ...recent];
    writeToFile(path, data);
}

// ─── Skill Index ────────────────────────────────────────

/**
 * Parse a skill-index.toon file into an array of skill entries.
 * Expected format: skills[N]{name,path,description}: ...
 */
export function parseToonSkillIndex(path: string): Array<{ name: string; path: string; description: string }> {
    const data = readToonFile(path);
    if (!data) return [];

    const skills = (data as any).skills;
    if (!skills || !Array.isArray(skills)) return [];

    return skills.map((s: any) => ({
        name: s.name || '',
        path: s.path || '',
        description: s.description || '',
    }));
}

// ─── Heartbeat ───────────────────────────────────────────

/**
// ─── Tasks Snapshot ─────────────────────────────────────

/**
 * Write a TOON snapshot of the current task queue to .factory/logs/tasks.yaml.
 * Preserves human-added tasks (those not matching any spec slug).
 */
export function writeToonTasksSnapshot(
    projectRoot: string,
    tasks: Array<{ id: string; status: string; summary: string }>,
): void {
    // Write to .yaml — YAML is the canonical storage format
    const tasksFile = join(projectRoot, '.factory/logs/tasks.yaml');
    mkdirSync(dirname(tasksFile), { recursive: true });
    const data = {
        tasks: tasks.map(t => ({ id: t.id, status: t.status, summary: t.summary })),
        updated: new Date().toISOString(),
    };
    writeFileSync(tasksFile, toYaml(data));
}
