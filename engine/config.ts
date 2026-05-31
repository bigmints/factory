/**
 * Configuration — reads projects.json, settings.json, factory.yaml.
 * Single source for all config operations.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import type {
    ProjectsConfig, Project, ProjectStack,
    FactorySettings, LLMProvider,
    BridgeConfig,
} from './types.ts';
import { log, logError } from './log.ts';
import { initBridge } from './init.ts';
import { BridgeConfigSchema } from './schemas.ts';

// ─── Paths ───────────────────────────────────────────────

/** Root of the global factory state */
export const FACTORY_ROOT = resolve(homedir(), '.factory');

// Ensure FACTORY_ROOT exists
if (!existsSync(FACTORY_ROOT)) {
    mkdirSync(FACTORY_ROOT, { recursive: true });
}

/** Key file paths within the global factory directory */
export const PATHS = {
    projects: resolve(FACTORY_ROOT, 'projects.json'),
    settings: resolve(FACTORY_ROOT, 'settings.json'),
    reports: resolve(FACTORY_ROOT, 'reports'),
    db: resolve(FACTORY_ROOT, 'factory.db'),
    mcp: resolve(FACTORY_ROOT, 'mcp.json'),
} as const;

// ─── Projects ────────────────────────────────────────────

/** Load the projects config (projects.json) */
export function loadProjects(): ProjectsConfig {
    if (!existsSync(PATHS.projects)) {
        return { activeProject: null, projects: [] };
    }
    return JSON.parse(readFileSync(PATHS.projects, 'utf-8'));
}

/** Save the projects config */
export function saveProjects(config: ProjectsConfig): void {
    writeFileSync(PATHS.projects, JSON.stringify(config, null, 2) + '\n');
}

/** Get the active project or throw */
export function getActiveProject(): Project {
    const config = loadProjects();
    if (!config.activeProject) {
        throw new Error('No active project. Run: factory project add <repo-path>');
    }
    const project = config.projects.find(p => p.id === config.activeProject);
    if (!project) {
        throw new Error(`Active project "${config.activeProject}" not found in projects.json`);
    }
    return project;
}

/** Add a new project */
export async function addProject(repoPath: string, stack?: ProjectStack): Promise<Project> {
    const absPath = resolve(repoPath);
    if (!existsSync(absPath)) {
        throw new Error(`Path does not exist: ${absPath}`);
    }

    const config = loadProjects();
    const id = basename(absPath);
    const name = id;

    // Check for duplicates
    if (config.projects.some(p => p.path === absPath)) {
        throw new Error(`Project already registered: ${absPath}`);
    }

    const project: Project = {
        id,
        name,
        path: absPath,
        addedAt: new Date().toISOString(),
        stack,
    };

    config.projects.push(project);
    config.activeProject = id;
    saveProjects(config);

    // Run full bridge initialization in the target repo
    try {
        await initBridge(absPath);
    } catch (e) {
        logError(`Bridge init failed: ${e}`);
    }

    log('✓', `Added project: ${name} (${absPath})`);
    log('→', 'Set as active project');

    return project;
}

/** Remove a project by ID */
export function removeProject(id: string): void {
    const config = loadProjects();
    const idx = config.projects.findIndex(p => p.id === id);
    if (idx === -1) {
        throw new Error(`Project not found: ${id}`);
    }

    config.projects.splice(idx, 1);
    if (config.activeProject === id) {
        config.activeProject = config.projects[0]?.id || null;
    }
    saveProjects(config);
    log('✓', `Removed project: ${id}`);
}

/** Switch active project */
export function switchProject(id: string): void {
    const config = loadProjects();
    const project = config.projects.find(p => p.id === id);
    if (!project) {
        throw new Error(`Project not found: ${id}`);
    }
    config.activeProject = id;
    saveProjects(config);
    log('✓', `Switched to: ${project.name} (${project.path})`);
}

// ─── LLM Settings ────────────────────────────────────────

/** Load LLM provider settings (settings.json) */
export function loadSettings(): FactorySettings {
    if (!existsSync(PATHS.settings)) {
        throw new Error(
            'No LLM settings found.\n' +
            'Go to Settings in the Factory UI to configure a provider.'
        );
    }
    return JSON.parse(readFileSync(PATHS.settings, 'utf-8'));
}

/** Save LLM settings */
export function saveSettings(settings: FactorySettings): void {
    writeFileSync(PATHS.settings, JSON.stringify(settings, null, 2) + '\n');
}

/** Get the active LLM provider or null */
export function getActiveProvider(settings?: FactorySettings): LLMProvider | null {
    const s = settings || loadSettings();
    return s.providers.find(p => p.id === s.activeProvider && p.enabled) || null;
}

// ─── Bridge Config (factory.yaml) ────────────────────────

/** Load a project's .factory/factory.yaml */
export function loadBridgeConfig(repoPath: string): BridgeConfig {
    const yamlPath = join(repoPath, '.factory', 'factory.yaml');
    if (!existsSync(yamlPath)) {
        throw new Error(`No .factory/factory.yaml in ${repoPath}`);
    }
    const data = parseYaml(readFileSync(yamlPath, 'utf-8'));

    // Validate with Zod — warn on invalid but don't crash
    const result = BridgeConfigSchema.safeParse(data);
    if (!result.success) {
        for (const issue of result.error.issues) {
            const path = issue.path.length > 0 ? issue.path.join('.') + ': ' : '';
            log('!', `factory.yaml validation: ${path}${issue.message}`);
        }
    }

    return data as BridgeConfig;
}

/**
 * Check whether a project's scaffold has been built.
 * Returns true when:
 *   - project.bootstrapped is explicitly true in factory.yaml, OR
 *   - project.bootstrapped is absent/undefined (treat legacy configs as bootstrapped)
 * Returns false only when project.bootstrapped is explicitly false.
 */
export function isBootstrapped(repoPath: string): boolean {
    try {
        const bridge = loadBridgeConfig(repoPath);
        // Explicitly false → new project that still needs scaffolding
        if (bridge.project?.bootstrapped === false) return false;
        // Absent or true → treat as bootstrapped (existing projects, legacy configs)
        return true;
    } catch (err) {
        log('!', `Cannot read factory.yaml for bootstrap check: ${(err as Error).message?.slice(0, 100) || err}`);
        return true; // If we can't read the config, don't block builds
    }
}

/**
 * Mark a project as bootstrapped by writing project.bootstrapped: true
 * into its .factory/factory.yaml. Called by the engine after a scaffold
 * AppStory build succeeds.
 */
export function setBootstrapped(repoPath: string, value: boolean): void {
    const yamlPath = join(repoPath, '.factory', 'factory.yaml');
    if (!existsSync(yamlPath)) return;

    const raw = readFileSync(yamlPath, 'utf-8');
    const config = parseYaml(raw) as any;

    if (!config.project) config.project = {};
    config.project.bootstrapped = value;

    const tempPath = yamlPath + '.tmp';
    writeFileSync(tempPath, toYaml(config, { lineWidth: 120 }));
    renameSync(tempPath, yamlPath);
    log(value ? '✓' : '→', `project.bootstrapped → ${value} written to factory.yaml`);
}

/** Check if a repo has a .factory bridge */
export function hasBridge(repoPath: string): boolean {
    return existsSync(join(repoPath, '.factory', 'factory.yaml'));
}

/** Load MCP config */
export function loadMcpConfig(): any {
    if (!existsSync(PATHS.mcp)) {
        return { mcpServers: {} };
    }
    try {
        return JSON.parse(readFileSync(PATHS.mcp, 'utf-8'));
    } catch (err) {
        log('!', `Failed to parse mcp.json: ${(err as Error).message?.slice(0, 100) || err}`);
        return { mcpServers: {} };
    }
}

/** Save MCP config */
export function saveMcpConfig(config: any): void {
    writeFileSync(PATHS.mcp, JSON.stringify(config, null, 2) + '\n');
}

