/**
 * Context gathering — reads knowledge files and conventions from the target repo.
 *
 * Only reads from paths declared in factory.yaml. No filesystem scanning.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { encode } from '@toon-format/toon';
import type { BridgeConfig, ProjectContext, KnowledgeFile, ProjectStack, AppIntegrationContext, StackConfig } from './types.ts';
import { log } from './log.ts';

/**
 * Gather integration context for a specific target app.
 * Reads package.json, tsconfig, file tree so feature builds know what exists.
 */
export function gatherAppContext(repoPath: string, bridge: BridgeConfig, appSlug: string): AppIntegrationContext {
    const appDir = bridge.apps_dir
        ? join(repoPath, bridge.apps_dir, appSlug)
        : join(repoPath, appSlug);

    const ctx: AppIntegrationContext = { fileTree: [] };

    if (!existsSync(appDir)) {
        log('!', `Target app directory not found: ${appDir}`);
        return ctx;
    }

    // Read package.json
    const pkgPath = join(appDir, 'package.json');
    if (existsSync(pkgPath)) {
        try {
            const raw = readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(raw);
            ctx.packageJson = {
                dependencies: pkg.dependencies,
                devDependencies: pkg.devDependencies,
                scripts: pkg.scripts,
            };

            // Derive stack from package.json
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            ctx.stack = {
                framework: allDeps['next'] ? 'next.js'
                    : allDeps['express'] ? 'express'
                    : allDeps['react'] ? 'react'
                    : allDeps['vue'] ? 'vue'
                    : 'unknown',
                packageManager: existsSync(join(appDir, 'pnpm-lock.yaml')) ? 'pnpm'
                    : existsSync(join(appDir, 'yarn.lock')) ? 'yarn'
                    : 'npm',
                language: allDeps['typescript'] ? 'typescript' : 'javascript',
                linter: allDeps['eslint'] ? 'eslint' : undefined,
                testing: allDeps['jest'] ? 'jest'
                    : allDeps['vitest'] ? 'vitest'
                    : undefined,
                database: allDeps['drizzle-orm'] ? 'drizzle'
                    : allDeps['prisma'] ? 'prisma'
                    : allDeps['better-sqlite3'] ? 'sqlite'
                    : undefined,
            };
        } catch { /* ignore parse errors */ }
    }

    // Read tsconfig.json
    const tscPath = join(appDir, 'tsconfig.json');
    if (existsSync(tscPath)) {
        try {
            ctx.tsconfigRaw = readFileSync(tscPath, 'utf-8');
        } catch { /* ignore */ }
    }

    // Gather file tree (max 200 files, skip node_modules/.git)
    const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.factory']);
    const MAX_FILES = 200;
    const fileTree: string[] = [];

    function walk(dir: string) {
        if (fileTree.length >= MAX_FILES) return;
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (fileTree.length >= MAX_FILES) break;
                if (SKIP.has(entry.name)) continue;
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else {
                    fileTree.push(relative(appDir, fullPath));
                }
            }
        } catch { /* permission errors etc */ }
    }
    walk(appDir);
    ctx.fileTree = fileTree.sort();

    log('✓', `App context for "${appSlug}": ${ctx.fileTree.length} files, ${Object.keys(ctx.packageJson?.dependencies || {}).length} deps`);
    return ctx;
}

/** Completed build info from the queue — used for context accumulation */
export interface QueueBuildContext {
    specFile: string;
    kind: string;
    targetApp: string;
    generatedFiles: string[];
}

/**
 * Load queue context — what builds have already completed in this queue run.
 * The queue processor writes this to queue-context.json before spawning each feature build.
 */
export function loadQueueContext(repoPath: string): QueueBuildContext[] {
    // queue-context.json is at the factory root (parent of app dirs)
    const candidates = [
        join(repoPath, 'queue-context.json'),
        join(repoPath, '..', 'queue-context.json'),
    ];

    for (const ctxPath of candidates) {
        if (existsSync(ctxPath)) {
            try {
                const raw = readFileSync(ctxPath, 'utf-8');
                const data = JSON.parse(raw);
                if (data.completedBuilds && Array.isArray(data.completedBuilds)) {
                    log('✓', `Queue context: ${data.completedBuilds.length} completed build(s)`);
                    return data.completedBuilds;
                }
            } catch { /* ignore parse errors */ }
        }
    }

    return [];
}

/**
 * Gather all context from a target repo for the LLM prompt.
 *
 * Reads:
 *  - Knowledge/skill files declared in factory.yaml
 *  - Convention files declared in factory.yaml
 *  - Stack information from factory.yaml
 */
export function gatherContext(repoPath: string, bridge: BridgeConfig): ProjectContext {
    const knowledgeFiles = gatherKnowledgeFiles(repoPath, bridge);
    const conventions = gatherConventions(repoPath, bridge);
    const { toonSnapshot, projectSkills } = gatherToonSnapshot(repoPath);

    log('✓', `Gathered ${knowledgeFiles.length} knowledge files, ${conventions.length} convention files`);

    return {
        repoPath,
        bridge,
        knowledgeFiles,
        conventions,
        stack: bridge.stack,
        toonSnapshot,
        projectSkills,
    };
}

// ─── Knowledge Files ─────────────────────────────────────

/**
 * Read knowledge files (agents.md, skills.md, etc.) from paths in factory.yaml.
 */
function gatherKnowledgeFiles(repoPath: string, bridge: BridgeConfig): KnowledgeFile[] {
    const files: KnowledgeFile[] = [];

    // Skills: declared file list in factory.yaml
    if (bridge.skills?.files) {
        for (const filePath of bridge.skills.files) {
            const absPath = join(repoPath, filePath);
            if (existsSync(absPath)) {
                files.push({
                    app: extractAppName(filePath),
                    filename: filePath.split('/').pop() || filePath,
                    path: filePath,
                    content: readFileSync(absPath, 'utf-8'),
                });
            }
        }
    }

    // Auto discovery - if configured, walk apps_dir and look for standard files
    if (bridge.skills?.discovery === 'auto' && bridge.apps_dir) {
        const appsDir = join(repoPath, bridge.apps_dir);
        if (existsSync(appsDir)) {
            const SKILL_FILES = ['agents.md', 'AGENTS.md', 'skills.md', 'SKILL.md'];
            const appDirs = readdirSync(appsDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const appName of appDirs) {
                for (const skillFile of SKILL_FILES) {
                    const filePath = join(appsDir, appName, skillFile);
                    if (existsSync(filePath)) {
                        // Check we didn't already add it from the explicit list
                        const relPath = `${bridge.apps_dir}/${appName}/${skillFile}`;
                        if (!files.some(f => f.path === relPath)) {
                            files.push({
                                app: appName,
                                filename: skillFile,
                                path: relPath,
                                content: readFileSync(filePath, 'utf-8'),
                            });
                        }
                    }
                }
            }
        }
    }

    // Build knowledge - auto-discover .factory/knowledge/builds/ summaries
    const knowledgeBuildsDir = join(repoPath, '.factory', 'knowledge', 'builds');
    if (existsSync(knowledgeBuildsDir)) {
        const buildFiles = readdirSync(knowledgeBuildsDir)
            .filter(f => f.endsWith('.md'))
            .sort();
        for (const buildFile of buildFiles) {
            const relPath = `.factory/knowledge/builds/${buildFile}`;
            if (!files.some(f => f.path === relPath)) {
                files.push({
                    app: buildFile.replace('.md', ''),
                    filename: buildFile,
                    path: relPath,
                    content: readFileSync(join(knowledgeBuildsDir, buildFile), 'utf-8'),
                });
            }
        }
    }

    return files;
}

// ─── Conventions ─────────────────────────────────────────

/**
 * Read convention/rule files from paths in factory.yaml.
 */
function gatherConventions(repoPath: string, bridge: BridgeConfig): string[] {
    const contents: string[] = [];

    // Agents.md
    if (bridge.conventions?.agents) {
        const agentsPath = join(repoPath, bridge.conventions.agents);
        if (existsSync(agentsPath)) {
            contents.push(readFileSync(agentsPath, 'utf-8'));
        }
    }

    // Rules directory
    if (bridge.conventions?.rules) {
        const rulesDir = join(repoPath, bridge.conventions.rules);
        if (existsSync(rulesDir)) {
            const ruleFiles = readdirSync(rulesDir)
                .filter(f => f.endsWith('.md'))
                .sort();
            for (const file of ruleFiles) {
                contents.push(readFileSync(join(rulesDir, file), 'utf-8'));
            }
        }
    }

    return contents;
}

// ─── Helpers ─────────────────────────────────────────────

/** Extract an app name from a file path like "apps/invoicer/agents.md" → "invoicer" */
function extractAppName(filePath: string): string {
    const parts = filePath.split('/');
    // Look for the directory before the file name
    return parts.length >= 2 ? parts[parts.length - 2] : 'root';
}

// ─── TOON Context Bridge ─────────────────────────────────

/**
 * Gather context from .factory/ YAML files and encode to TOON at prompt-injection time.
 *
 * Architecture: data is STORED as YAML (human-editable, git-trackable).
 * TOON encoding happens HERE, just before injecting into the LLM system prompt —
 * the same role gzip plays in HTTP: store raw, compress on transmission.
 */
export function gatherToonSnapshot(repoPath: string): { toonSnapshot?: string; projectSkills?: Array<{ name: string; path: string; description: string }> } {
    // Prefer .yaml — fall back to .toon for backward compat with existing projects
    const contextYaml = join(repoPath, '.factory/context/context.yaml');
    const contextToon = join(repoPath, '.factory/context/context.toon');
    const skillIndexYaml = join(repoPath, '.factory/skill-index.yaml');
    const skillIndexToon = join(repoPath, '.factory/skill-index.toon');

    let toonSnapshot: string | undefined;
    let projectSkills: Array<{ name: string; path: string; description: string }> | undefined;

    // Read context — encode YAML → TOON for token-efficient LLM injection
    const contextFile = existsSync(contextYaml) ? contextYaml
        : existsSync(contextToon) ? contextToon : null;
    if (contextFile) {
        try {
            const raw = readFileSync(contextFile, 'utf-8');
            if (contextFile.endsWith('.yaml')) {
                const data = parseYaml(raw) as Record<string, unknown>;
                toonSnapshot = encode(data);
            } else {
                toonSnapshot = raw; // legacy: already TOON or raw
            }
        } catch { /* ignore */ }
    }

    // Read skill-index
    const skillFile = existsSync(skillIndexYaml) ? skillIndexYaml
        : existsSync(skillIndexToon) ? skillIndexToon : null;
    if (skillFile) {
        try {
            const raw = readFileSync(skillFile, 'utf-8');
            const data = skillFile.endsWith('.yaml')
                ? parseYaml(raw) as Record<string, unknown>
                : JSON.parse(raw);
            projectSkills = (data as any).skills?.map((s: any) => ({
                name: s.name || '',
                path: s.path || '',
                description: s.description || '',
            })) || undefined;
        } catch { /* ignore */ }
    }

    return { toonSnapshot, projectSkills };
}
