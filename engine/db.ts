/**
 * YAML-driven build log manager for the Factory engine.
 * Replaces SQLite entirely, saving logs to ~/.factory/builds.yaml.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { log } from './log.ts';

const FACTORY_ROOT = resolve(homedir(), '.factory');
const BUILDS_YAML = resolve(FACTORY_ROOT, 'builds.yaml');

export interface BuildLog {
    id: string;
    storyFile: string;
    kind: string;
    timestamp: string;
    durationMs: number;
    status: string;
    filesGenerated: string[];
    output: string;
    notes: string;
    model: string | null;
    provider: string | null;
    engine: string;
    tokensIn: number;
    tokensOut: number;
    errorSource: string | null;
    errorCategory: string | null;
}

/** Get all build logs from builds.yaml */
export function getBuildLogs(): BuildLog[] {
    if (!existsSync(BUILDS_YAML)) {
        return [];
    }
    try {
        const raw = readFileSync(BUILDS_YAML, 'utf-8');
        const parsed = parseYaml(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        log('!', `Failed to parse builds.yaml: ${(err as Error).message?.slice(0, 100) || err}`);
        return [];
    }
}

/** Save build logs to builds.yaml */
export function saveBuildLogs(logs: BuildLog[]): void {
    writeFileSync(BUILDS_YAML, toYaml(logs, { lineWidth: 120 }), 'utf-8');
}

/** Log a build result to the builds.yaml file. */
export function logBuild(
    storyFile: string,
    kind: string,
    status: string,
    summary: string,
    filesGenerated: string[],
    durationMs: number,
    opts?: {
        model?: string;
        provider?: string;
        engine?: string;
        tokensIn?: number;
        tokensOut?: number;
        errorSource?: 'llm' | 'engine' | null;
        errorCategory?: 'transient' | 'permanent' | null;
    },
): void {
    const id = `build_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const oneLiner = status === 'failed'
        ? 'Build failed'
        : `Built ${filesGenerated.length} file(s) in ${(durationMs / 1000).toFixed(1)}s`;

    const newLog: BuildLog = {
        id,
        storyFile,
        kind,
        timestamp: new Date().toISOString(),
        durationMs,
        status,
        filesGenerated,
        output: summary,
        notes: oneLiner,
        model: opts?.model || null,
        provider: opts?.provider || null,
        engine: opts?.engine || 'factory',
        tokensIn: opts?.tokensIn || 0,
        tokensOut: opts?.tokensOut || 0,
        errorSource: opts?.errorSource || null,
        errorCategory: opts?.errorCategory || null,
    };

    const logs = getBuildLogs();
    logs.unshift(newLog); // Prepend to show latest first
    saveBuildLogs(logs);
    log('✓', `Logged build build_${id.split('_')[1]} to builds.yaml`);
}

/** Close database stub — no-op now. */
export function closeDb(): void {
    // No-op
}
