/**
 * Blueprint gathering — reads knowledge files and conventions from the target repo.
 *
 * Only reads from paths declared in factory.yaml. No filesystem scanning.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { encode } from '@toon-format/toon';
import type { BridgeConfig, ProjectBlueprint, KnowledgeFile, AppIntegrationBlueprint } from './types.ts';
import { log, logError } from './log.ts';
import { analyzeExistingProject } from './init.ts';

/**
 * Gather integration blueprint for a specific target app.
 * Reads package.json, tsconfig, file tree so feature builds know what exists.
 */
export function gatherAppBlueprint(repoPath: string, bridge: BridgeConfig, appSlug: string): AppIntegrationBlueprint {
    const appDir = bridge.apps_dir
        ? join(repoPath, bridge.apps_dir, appSlug)
        : join(repoPath, appSlug);

    const bp: AppIntegrationBlueprint = { fileTree: [] };

    if (!existsSync(appDir)) {
        log('!', `Target app directory not found: ${appDir}`);
        return bp;
    }

    // Read package.json
    const pkgPath = join(appDir, 'package.json');
    if (existsSync(pkgPath)) {
        try {
            const raw = readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(raw);
            bp.packageJson = {
                dependencies: pkg.dependencies,
                devDependencies: pkg.devDependencies,
                scripts: pkg.scripts,
            };

            // Derive stack from package.json
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            bp.stack = {
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
            bp.tsconfigRaw = readFileSync(tscPath, 'utf-8');
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
    bp.fileTree = fileTree.sort();

    log('✓', `App blueprint for "${appSlug}": ${bp.fileTree.length} files, ${Object.keys(bp.packageJson?.dependencies || {}).length} deps`);
    return bp;
}

/** Completed build info from the queue — used for blueprint accumulation */
export interface QueueBuildBlueprint {
    storyFile: string;
    kind: string;
    targetApp: string;
    generatedFiles: string[];
}

/**
 * Load queue blueprint / context — what builds have already completed in this queue run.
 * The queue processor writes this to queue-blueprint.json before spawning each feature build.
 */
export function loadQueueBlueprint(repoPath: string): QueueBuildBlueprint[] {
    // queue-blueprint.json is at the factory root (parent of app dirs)
    const candidates = [
        join(repoPath, 'queue-blueprint.json'),
        join(repoPath, '..', 'queue-blueprint.json'),
        // legacy fallbacks
        join(repoPath, 'queue-context.json'),
        join(repoPath, '..', 'queue-context.json'),
    ];

    for (const bpPath of candidates) {
        if (existsSync(bpPath)) {
            try {
                const raw = readFileSync(bpPath, 'utf-8');
                const data = JSON.parse(raw);
                if (data.completedBuilds && Array.isArray(data.completedBuilds)) {
                    log('✓', `Queue blueprint: ${data.completedBuilds.length} completed build(s)`);
                    return data.completedBuilds;
                }
            } catch { /* ignore parse errors */ }
        }
    }

    return [];
}

/**
 * Gather all blueprint data from a target repo for the LLM prompt.
 *
 * Reads:
 *  - Knowledge/skill files declared in factory.yaml
 *  - Convention files declared in factory.yaml
 *  - Stack information from factory.yaml
 */
export function gatherBlueprint(repoPath: string, bridge: BridgeConfig): ProjectBlueprint {
    const knowledgeFiles = gatherKnowledgeFiles(repoPath, bridge);
    const conventions = gatherConventions(repoPath, bridge);
    const { toonSnapshot, projectSkills } = gatherToonSnapshot(repoPath);

    log('✓', `Gathered ${knowledgeFiles.length} knowledge files, ${conventions.length} convention files for blueprint`);

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

    // Build knowledge - auto-discover .factory/logs/builds/ summaries
    const logsBuildsDir = join(repoPath, '.factory', 'logs', 'builds');
    if (existsSync(logsBuildsDir)) {
        const buildFiles = readdirSync(logsBuildsDir)
            .filter(f => f.endsWith('.md'))
            .sort();
        for (const buildFile of buildFiles) {
            const relPath = `.factory/logs/builds/${buildFile}`;
            if (!files.some(f => f.path === relPath)) {
                files.push({
                    app: buildFile.replace('.md', ''),
                    filename: buildFile,
                    path: relPath,
                    content: readFileSync(join(logsBuildsDir, buildFile), 'utf-8'),
                });
            }
        }
    }

    // Dynamic knowledge - auto-discover .factory/knowledge/ markdown files (ADRs, Chronicle, Decisions)
    const knowledgeDir = join(repoPath, '.factory', 'knowledge');
    if (existsSync(knowledgeDir)) {
        try {
            const entries = readdirSync(knowledgeDir, { withFileTypes: true });
            const mdFiles = entries
                .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
                .map(entry => entry.name)
                .sort();
            for (const file of mdFiles) {
                const relPath = `.factory/knowledge/${file}`;
                if (!files.some(f => f.path === relPath)) {
                    files.push({
                        app: file.replace('.md', ''),
                        filename: file,
                        path: relPath,
                        content: readFileSync(join(knowledgeDir, file), 'utf-8'),
                    });
                }
            }
        } catch { /* ignore */ }
    }

    return files;
}

// ─── Conventions ─────────────────────────────────────────

/**
 * Read convention/rule files from paths in factory.yaml.
 */
function gatherConventions(repoPath: string, bridge: BridgeConfig): string[] {
    const contents: string[] = [];

    // Encapsulated .factory/AGENTS.md
    const factoryAgentsPath = join(repoPath, '.factory', 'AGENTS.md');
    const factoryAgentsPathLc = join(repoPath, '.factory', 'agents.md');
    if (existsSync(factoryAgentsPath)) {
        contents.push(readFileSync(factoryAgentsPath, 'utf-8'));
    } else if (existsSync(factoryAgentsPathLc)) {
        contents.push(readFileSync(factoryAgentsPathLc, 'utf-8'));
    }

    // Configured agents.md path
    if (bridge.conventions?.agents) {
        const agentsPath = join(repoPath, bridge.conventions.agents);
        if (existsSync(agentsPath) && agentsPath !== factoryAgentsPath && agentsPath !== factoryAgentsPathLc) {
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

// ─── TOON Blueprint Bridge ─────────────────────────────────

/**
 * Gather blueprint from .factory/ YAML files and encode to TOON at prompt-injection time.
 *
 * Architecture: data is STORED as YAML (human-editable, git-trackable).
 * TOON encoding happens HERE, just before injecting into the LLM system prompt —
 * the same role gzip plays in HTTP: store raw, compress on transmission.
 */
export function gatherToonSnapshot(repoPath: string): { toonSnapshot?: string; projectSkills?: Array<{ name: string; path: string; description: string }> } {
    // Prefer logs/ — fall back to blueprint/ and context/ for backward compatibility
    const stateYaml = join(repoPath, '.factory/logs/state.yaml');
    const stateToon = join(repoPath, '.factory/logs/state.toon');
    const legacyBlueprintYaml = join(repoPath, '.factory/blueprint/blueprint.yaml');
    const legacyBlueprintToon = join(repoPath, '.factory/blueprint/blueprint.toon');
    const legacyContextYaml = join(repoPath, '.factory/context/context.yaml');
    const legacyContextToon = join(repoPath, '.factory/context/context.toon');

    const skillIndexYaml = join(repoPath, '.factory/skill-index.yaml');
    const skillIndexToon = join(repoPath, '.factory/skill-index.toon');

    let toonSnapshot: string | undefined;
    let projectSkills: Array<{ name: string; path: string; description: string }> | undefined;

    // Read state — encode YAML → TOON for token-efficient LLM injection
    const blueprintFile = existsSync(stateYaml) ? stateYaml
        : existsSync(stateToon) ? stateToon
        : existsSync(legacyBlueprintYaml) ? legacyBlueprintYaml
        : existsSync(legacyBlueprintToon) ? legacyBlueprintToon
        : existsSync(legacyContextYaml) ? legacyContextYaml
        : existsSync(legacyContextToon) ? legacyContextToon : null;

    if (blueprintFile) {
        try {
            const raw = readFileSync(blueprintFile, 'utf-8');
            if (blueprintFile.endsWith('.yaml')) {
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

/**
 * Perform a codebase analysis and merge/integrate the new context into the existing blueprint.yaml.
 * Ensures manual edits, key decisions, and custom configurations are preserved.
 */
export function syncBlueprint(repoPath: string): void {
    const factoryDir = join(repoPath, '.factory');
    if (!existsSync(factoryDir)) {
        log('!', `No .factory directory in ${repoPath} — skipping blueprint sync`);
        return;
    }

    const logsDir = join(factoryDir, 'logs');
    const statePath = join(logsDir, 'state.yaml');
    const legacyBlueprintPath = join(factoryDir, 'blueprint', 'blueprint.yaml');
    const legacyContextPath = join(factoryDir, 'context', 'context.yaml');

    if (!existsSync(logsDir)) {
        try {
            mkdirSync(logsDir, { recursive: true });
        } catch (e) {
            log('!', `Failed to create logs directory: ${e}`);
        }
    }

    log('→', `Running codebase analysis for ${repoPath}...`);
    const newAnalysis = analyzeExistingProject(repoPath);

    let existingData: Record<string, any> = {};
    const pathToRead = existsSync(statePath) ? statePath : (existsSync(legacyBlueprintPath) ? legacyBlueprintPath : (existsSync(legacyContextPath) ? legacyContextPath : null));

    if (pathToRead) {
        try {
            const raw = readFileSync(pathToRead, 'utf-8');
            existingData = parseYaml(raw) as Record<string, any>;
            if (!existingData || typeof existingData !== 'object') {
                existingData = {};
            }
        } catch (e) {
            log('!', `Failed to parse existing state/blueprint/context at ${pathToRead}: ${e}`);
        }
    }

    // Merge logic prioritizing existing user data where custom
    const mergedData: Record<string, any> = { ...existingData };

    // 1. Merge "project"
    const existingProject = existingData.project || {};
    const newProject = newAnalysis.project as Record<string, any> || {};
    mergedData.project = {
        name: existingProject.name || newProject.name,
        status: existingProject.status || newProject.status,
        readme_summary: existingProject.readme_summary || newProject.readme_summary,
        ...existingProject,
        analyzed: newProject.analyzed,
    };

    // 2. Merge "package" (overwrite/update with latest deps, but keep description if customized)
    const existingPackage = existingData.package || {};
    const newPackage = newAnalysis.package as Record<string, any> || {};
    if (Object.keys(newPackage).length > 0) {
        mergedData.package = {
            ...newPackage,
            ...existingPackage,
            name: newPackage.name || existingPackage.name,
            description: existingPackage.description || newPackage.description,
            version: newPackage.version || existingPackage.version,
            key_deps: newPackage.key_deps || existingPackage.key_deps,
        };
    }

    // 3. Overwrite "stack" and "structure" with latest active codebase analysis
    if (newAnalysis.stack) {
        mergedData.stack = newAnalysis.stack;
    }
    if (newAnalysis.structure) {
        mergedData.structure = newAnalysis.structure;
    }

    // 4. Merge "conventions" (union of existing ones with newly detected ones)
    const existingConventions = Array.isArray(existingData.conventions) ? existingData.conventions : [];
    const newConventions = Array.isArray(newAnalysis.conventions) ? newAnalysis.conventions : [];
    const conventionsSet = new Set([...existingConventions, ...newConventions]);
    if (conventionsSet.size > 0) {
        mergedData.conventions = Array.from(conventionsSet);
    }

    // 5. Preserving "key_decisions" is CRITICAL.
    const existingDecisions = Array.isArray(existingData.key_decisions) ? existingData.key_decisions : [];
    const newDecisions = Array.isArray(newAnalysis.key_decisions) ? newAnalysis.key_decisions : [];
    const mergedDecisions = existingDecisions.length > 0 ? existingDecisions : newDecisions;
    mergedData.key_decisions = mergedDecisions;

    // 6. Write back to state.yaml
    try {
        writeFileSync(statePath, toYaml(mergedData));
        log('✓', `Codebase analysis merged and written to ${statePath}`);
    } catch (e) {
        logError(`Failed to write merged state to ${statePath}: ${e}`);
    }
}
