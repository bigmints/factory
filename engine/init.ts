/**
 * Bridge Initialization — creates .factory/ scaffold in a target repo.
 *
 * Auto-detects stack from package.json/tsconfig.json.
 * Copies workflow docs from Factory's own .factory/workflows/.
 * Returns InitResult with list of files created.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import type { BridgeConfig, ProjectStack } from './types.ts';
import { log, logError } from './log.ts';

// ─── Types ───────────────────────────────────────────────

export interface InitResult {
    success: boolean;
    files: Array<{ path: string; action: 'created' | 'patched' | 'skipped' }>;
    error?: string;
}

// ─── Stack Detection ─────────────────────────────────────

/** Auto-detect stack from package.json and tsconfig.json */
export function detectStack(repoPath: string): ProjectStack | undefined {
    const pkgPath = join(repoPath, 'package.json');
    const tsPath = join(repoPath, 'tsconfig.json');

    let framework = '';
    let packageManager = 'npm';
    let linter = '';
    let testing = '';
    let database = '';

    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            // Detect framework
            if (deps.next) framework = 'next.js';
            else if (deps['@remix-run/react'] || deps.remix) framework = 'remix';
            else if (deps.vite) framework = 'vite';
            else if (deps.express) framework = 'express';
            else if (deps.fastify) framework = 'fastify';
            else if (deps['@sveltejs/kit']) framework = 'sveltekit';
            else if (deps.nuxt) framework = 'nuxt';

            // Detect package manager from lockfile
            if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
            else if (existsSync(join(repoPath, 'yarn.lock'))) packageManager = 'yarn';
            else if (existsSync(join(repoPath, 'bun.lockb'))) packageManager = 'bun';

            // Detect linter
            if (deps.eslint || deps['eslint-config-next']) linter = 'eslint';
            else if (deps['@biomejs/biome']) linter = 'biome';
            else if (deps.oxlint) linter = 'oxlint';

            // Detect testing
            if (deps.vitest) testing = 'vitest';
            else if (deps.jest) testing = 'jest';
            else if (deps['@playwright/test']) testing = 'playwright';
            else if (deps.cypress) testing = 'cypress';

            // Detect database
            if (deps['@prisma/client']) database = 'prisma';
            else if (deps.drizzle || deps['drizzle-orm']) database = 'drizzle';
            else if (deps['better-sqlite3']) database = 'sqlite';
            else if (deps.pg || deps['pg-native']) database = 'postgres';
            else if (deps.mongoose) database = 'mongodb';
        } catch { /* ignore parse errors */ }
    }

    if (framework || linter || testing || database) {
        return { framework, packageManager, linter, testing, database };
    }
    return undefined;
}

// ─── Bridge Scaffold ─────────────────────────────────────

/**
 * Initialize .factory/ bridge in a target repo.
 * Creates all necessary directories and files.
 */
export function initBridge(repoPath: string): InitResult {
    const files: InitResult['files'] = [];
    const factoryDir = join(repoPath, '.factory');

    // Create directory structure
    const dirs = [
        factoryDir,
        join(factoryDir, 'context'),
        join(factoryDir, 'specs', 'apps'),
        join(factoryDir, 'specs', 'features'),
        join(factoryDir, 'knowledge', 'builds'),
        join(factoryDir, 'task-manager'),
        join(factoryDir, 'workflows'),
    ];

    for (const dir of dirs) {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }

    // Auto-detect stack
    const stack = detectStack(repoPath);
    const name = basename(repoPath);

    // 1. factory.yaml
    const yamlPath = join(factoryDir, 'factory.yaml');
    const config: BridgeConfig = {
        version: 1,
        name,
        description: `Bridge for ${name}`,
        factory_home: '.',
        stack,
        agentic: {
            context_dir: '.factory/context',
            task_queue: '.factory/task-manager/todo.toon',
            skill_index: '.factory/skill-index.toon',
            workflows_dir: '.factory/workflows',
            knowledge_dir: '.factory/knowledge',
        },
    };
    writeFileSync(yamlPath, toYaml(config));
    files.push({ path: '.factory/factory.yaml', action: 'created' });

    // 2. context.toon
    const contextPath = join(factoryDir, 'context', 'context.toon');
    const contextData = {
        project: {
            name,
            status: 'in-development',
            created: new Date().toISOString().split('T')[0],
            last_updated: new Date().toISOString().split('T')[0],
        },
    };
    writeFileSync(contextPath, JSON.stringify(contextData, null, 2));
    files.push({ path: '.factory/context/context.toon', action: 'created' });

    // 3. heartbeat.toon
    const heartbeatPath = join(factoryDir, 'context', 'heartbeat.toon');
    const heartbeatData = {
        heartbeat: {
            last_seen: new Date().toISOString(),
            host: 'uninitialized',
            task: 'scaffold created',
            status: 'idle',
        },
    };
    writeFileSync(heartbeatPath, JSON.stringify(heartbeatData, null, 2));
    files.push({ path: '.factory/context/heartbeat.toon', action: 'created' });

    // 4. worklog.toon
    const worklogPath = join(factoryDir, 'context', 'worklog.toon');
    const worklogData = {
        entries: [
            {
                date: new Date().toISOString().replace('T', ' ').substring(0, 19),
                message: `${name} .factory/ scaffold created`,
            },
        ],
    };
    writeFileSync(worklogPath, JSON.stringify(worklogData, null, 2));
    files.push({ path: '.factory/context/worklog.toon', action: 'created' });

    // 5. skill-index.toon
    const skillIndexPath = join(factoryDir, 'skill-index.toon');
    const skillIndexData = {
        skills: [
            { name: 'heartbeat', path: 'factory/scripts/heartbeat/pulse.sh', description: 'Write a liveness timestamp' },
            { name: 'auto-context', path: 'factory/scripts/auto-context/update-context.sh', description: 'Append to worklog in TOON format' },
            { name: 'compress-worklog', path: 'factory/scripts/compress-worklog/compress.sh', description: 'Archive old worklog entries' },
            { name: 'validate-code', path: 'factory/scripts/validate-code/validate.sh', description: 'Run lint and type checks' },
            { name: 'minions', path: 'factory/scripts/minions/scripts/minions', description: 'Run YAML prompt queue' },
            { name: 'task-manager', path: '.factory/task-manager/manage.sh', description: 'Manage task lifecycle' },
        ],
    };
    writeFileSync(skillIndexPath, JSON.stringify(skillIndexData, null, 2));
    files.push({ path: '.factory/skill-index.toon', action: 'created' });

    // 6. todo.toon
    const todoPath = join(factoryDir, 'task-manager', 'todo.toon');
    const todoData = {
        summary: { completed: 0, next: 0, cancelled: 0 },
        completed: [],
        next: [],
        in_progress: [],
        cancelled: [],
    };
    writeFileSync(todoPath, JSON.stringify(todoData, null, 2));
    files.push({ path: '.factory/task-manager/todo.toon', action: 'created' });

    // 7. Copy workflow docs from Factory's own .factory/workflows/
    const sourceWorkflows = resolve(process.cwd(), '.factory/workflows');
    if (existsSync(sourceWorkflows)) {
        const workflowFiles = ['bootstrap.md', 'process.md', 'commit.md'];
        for (const file of workflowFiles) {
            const src = join(sourceWorkflows, file);
            const dst = join(factoryDir, 'workflows', file);
            if (existsSync(src) && !existsSync(dst)) {
                writeFileSync(dst, readFileSync(src, 'utf-8'));
                files.push({ path: `.factory/workflows/${file}`, action: 'created' });
            }
        }
    }

    log('✓', `Initialized .factory/ bridge in ${repoPath} (${files.length} files)`);
    return { success: true, files };
}
