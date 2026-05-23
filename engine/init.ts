/**
 * Bridge Initialization — creates .factory/ scaffold in a target repo.
 *
 * Storage: all state files are stored as YAML (.yaml), human-editable.
 * TOON encoding happens at prompt-injection time (in blueprint.ts), not here.
 *
 * Creates:
 *   .factory/factory.yaml           — bridge config (absolute factory_home)
 *   .factory/logs/state.yaml          — project state (analyzed from codebase)
 *   .factory/logs/heartbeat.yaml      — liveness signal
 *   .factory/logs/worklog.yaml        — append-only session log
 *   .factory/skill-index.yaml       — skills directory
 *   .factory/task-manager/todo.yaml — task queue
 *   .factory/task-manager/manage.sh — task lifecycle manager (copied)
 *   .factory/workflows/             — workflow docs (copied)
 *   agents.md / AGENTS.md           — created or patched with Factory section
 */

import {
    existsSync, readFileSync, writeFileSync,
    mkdirSync, readdirSync, chmodSync, copyFileSync,
} from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as toYaml } from 'yaml';
import type { BridgeConfig, ProjectStack, AppSpec, FeatureEpicSpec, StoryReferenceSpec, TaskItemSpec } from './types.ts';
import { log, logError } from './log.ts';

// ─── Resolve factory root from this file's location ──────
// engine/init.ts → factory root is one level up
function getFactoryRoot(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

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

    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            // Framework
            if (deps.next) framework = 'next.js';
            else if (deps['@remix-run/react'] || deps.remix) framework = 'remix';
            else if (deps.vite) framework = 'vite';
            else if (deps.express) framework = 'express';
            else if (deps.fastify) framework = 'fastify';
            else if (deps['@sveltejs/kit']) framework = 'sveltekit';
            else if (deps.nuxt) framework = 'nuxt';
            else if (deps.electron) framework = 'electron';

            // Package manager from lockfile
            if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
            else if (existsSync(join(repoPath, 'yarn.lock'))) packageManager = 'yarn';
            else if (existsSync(join(repoPath, 'bun.lockb'))) packageManager = 'bun';

            // Linter
            if (deps.eslint || deps['@eslint/js']) linter = 'eslint';
            else if (deps.biome) linter = 'biome';
            else if (deps.oxlint) linter = 'oxlint';

            // Testing
            if (deps.vitest) testing = 'vitest';
            else if (deps.jest || deps['@jest/core']) testing = 'jest';
            else if (deps.playwright || deps['@playwright/test']) testing = 'playwright';

        } catch { /* ignore */ }
    }

    if (!framework && !existsSync(tsPath)) return undefined;

    return {
        framework: framework || 'node',
        packageManager,
        ...(linter && { linter }),
        ...(testing && { testing }),
    };
}

// ─── Existing Codebase Analysis ──────────────────────────

/**
 * Analyze an existing codebase to build a meaningful context.yaml.
 * Reads README, package.json summary, top-level file tree, detects conventions.
 */
export function analyzeExistingProject(repoPath: string): Record<string, unknown> {
    const name = basename(repoPath);
    const context: Record<string, unknown> = {
        project: {
            name,
            status: 'in-development',
            analyzed: new Date().toISOString().split('T')[0],
        },
    };

    // README summary (first 1500 chars)
    for (const f of ['README.md', 'readme.md', 'README.txt']) {
        const p = join(repoPath, f);
        if (existsSync(p)) {
            const content = readFileSync(p, 'utf-8').slice(0, 1500);
            (context.project as any).readme_summary = content
                .split('\n')
                .slice(0, 8)
                .join(' ')
                .replace(/#+\s*/g, '')
                .trim();
            break;
        }
    }

    // Package.json summary
    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            (context as any).package = {
                name: pkg.name || name,
                description: pkg.description || '',
                version: pkg.version || '0.0.0',
                key_deps: Object.keys(deps).slice(0, 12),
            };
        } catch { /* ignore */ }
    }

    // Stack
    const stack = detectStack(repoPath);
    if (stack) (context as any).stack = stack;

    // Top-level file structure (2 levels deep)
    (context as any).structure = buildFileTree(repoPath, 2);

    // Conventions
    const conventions: string[] = [];
    if (existsSync(join(repoPath, 'tsconfig.json'))) conventions.push('TypeScript');
    if (existsSync(join(repoPath, '.eslintrc.js')) || existsSync(join(repoPath, 'eslint.config.js'))) conventions.push('ESLint');
    if (existsSync(join(repoPath, '.prettierrc')) || existsSync(join(repoPath, '.prettierrc.json'))) conventions.push('Prettier');
    if (existsSync(join(repoPath, 'tailwind.config.ts')) || existsSync(join(repoPath, 'tailwind.config.js'))) conventions.push('Tailwind CSS');
    if (existsSync(join(repoPath, 'prisma'))) conventions.push('Prisma ORM');
    if (existsSync(join(repoPath, 'drizzle.config.ts'))) conventions.push('Drizzle ORM');
    if (conventions.length) (context as any).conventions = conventions;

    // Empty key_decisions ready for agent to fill
    (context as any).key_decisions = [];

    return context;
}

/** Build a simplified 2-level file tree, skipping noise dirs. */
function buildFileTree(dir: string, depth: number, _current = 0): string[] {
    const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', 'coverage', '.turbo']);
    if (_current >= depth) return [];
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter(e => !SKIP.has(e.name) && !e.name.startsWith('.'))
            .map(e => {
                const prefix = '  '.repeat(_current) + (e.isDirectory() ? '📁 ' : '📄 ');
                const entry = prefix + e.name;
                if (e.isDirectory() && _current < depth - 1) {
                    const children = buildFileTree(join(dir, e.name), depth, _current + 1);
                    return [entry, ...children];
                }
                return [entry];
            })
            .flat()
            .slice(0, 60); // cap at 60 lines
    } catch { return []; }
}

// ─── agents.md Patch ─────────────────────────────────────

const FACTORY_SECTION_MARKER = '## Factory Agentic Scaffold';

const FACTORY_AGENTS_SECTION = (name: string) => `
${FACTORY_SECTION_MARKER}

This project is connected to [Factory](https://github.com/Bigmints-com/factory) — an autonomous build engine.

### Quick Commands

\`\`\`bash
factory pulse "<msg>"            # Write liveness heartbeat
factory task list                # Show task queue
factory task start <id>          # Claim a task
factory blueprint update "<msg>" # Append to worklog
factory validate                 # Run tsc + lint
factory worker --queue <file>     # Run YAML prompt queue
factory hooks install            # Install git hooks
\`\`\`

### Factory Files

| File | Purpose |
|------|---------|
| \`.factory/factory.yaml\` | Bridge config (links to Factory install) |
| \`.factory/logs/state.yaml\` | Project state snapshot (read by agent on start) |
| \`.factory/logs/heartbeat.yaml\` | Liveness signal (written every build step) |
| \`.factory/logs/worklog.yaml\` | Append-only session log |
| \`.factory/skill-index.yaml\` | Available agentic skills |
| \`.factory/task-manager/todo.yaml\` | Task queue (human + agent readable) |
| \`.factory/task-manager/manage.sh\` | Task lifecycle CLI |

### Workflow

1. Start: \`factory task start <id>\` → \`factory pulse "starting <id>"\`
2. Work: agent reads logs/state.yaml, builds, writes heartbeat on each step
3. Done: \`factory task complete --id <id> --summary "what was done"\`
4. Commit: \`factory blueprint update "summary"\` → git commit
`.trim();

/** Find agents.md or AGENTS.md in the project root (case-insensitive). */
function findAgentsMd(repoPath: string): string | null {
    for (const name of ['AGENTS.md', 'agents.md', 'Agents.md']) {
        const p = join(repoPath, name);
        if (existsSync(p)) return p;
    }
    return null;
}

export function patchAgentsMd(repoPath: string): { path: string; action: 'created' | 'patched' | 'skipped' } {
    const name = basename(repoPath);
    const existing = findAgentsMd(repoPath);

    if (!existing) {
        // Create a fresh agents.md
        const stack = detectStack(repoPath);
        const stackLine = stack ? `**Stack:** ${stack.framework}, ${stack.packageManager}${stack.linter ? `, ${stack.linter}` : ''}${stack.testing ? `, ${stack.testing}` : ''}` : '';
        const content = `# ${name} — Agent Instructions

## Role
You are a senior developer working on **${name}**.
Always read .factory/logs/state.yaml before starting work.
Write heartbeat on every significant step.

${stackLine}

${FACTORY_AGENTS_SECTION(name)}
`;
        const outPath = join(repoPath, 'AGENTS.md');
        writeFileSync(outPath, content);
        return { path: 'AGENTS.md', action: 'created' };
    }

    // Patch existing file
    const content = readFileSync(existing, 'utf-8');
    if (content.includes(FACTORY_SECTION_MARKER)) {
        return { path: basename(existing), action: 'skipped' };
    }

    const patched = content.trimEnd() + '\n\n---\n\n' + FACTORY_AGENTS_SECTION(name) + '\n';
    writeFileSync(existing, patched);
    return { path: basename(existing), action: 'patched' };
}

// ─── manage.sh Copy ──────────────────────────────────────

function copyManageSh(factoryRoot: string, factoryDir: string): { path: string; action: 'created' | 'skipped' } {
    const dst = join(factoryDir, 'task-manager', 'manage.sh');
    if (existsSync(dst)) return { path: '.factory/task-manager/manage.sh', action: 'skipped' };

    // Look in factory's own .factory/task-manager/ first, then scripts/
    const candidates = [
        join(factoryRoot, '.factory', 'task-manager', 'manage.sh'),
        join(factoryRoot, 'factory', 'scripts', 'task-manager', 'manage.sh'),
    ];
    for (const src of candidates) {
        if (existsSync(src)) {
            copyFileSync(src, dst);
            try { chmodSync(dst, 0o755); } catch { /* ignore */ }
            return { path: '.factory/task-manager/manage.sh', action: 'created' };
        }
    }
    logError('manage.sh source not found — skipping copy');
    return { path: '.factory/task-manager/manage.sh', action: 'skipped' };
}


/** Generate an scaffold.yaml spec from an existing codebase.
 *  For brand-new/empty projects: stories are created as 'draft' (not 'done').
 *  For existing codebases (has src/, app/, components/, or ≥5 package deps): stories are marked 'done'.
 */
export function generateAppYamlFromExistingCodebase(repoPath: string): AppSpec {
    const name = basename(repoPath);
    let description = `Existing codebase for ${name}`;
    let version = '1.0.0';
    let pkgDepsCount = 0;

    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            if (pkg.description) description = pkg.description;
            if (pkg.version) version = pkg.version;
            pkgDepsCount = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
        } catch {}
    }

    // Detect whether this is a real existing codebase or a brand-new empty project.
    // Evidence of an existing codebase: has src/, app/, or components/ dirs, or ≥5 package.json deps.
    const hasSrcDir = existsSync(join(repoPath, 'src'));
    const hasAppDir = existsSync(join(repoPath, 'app'));
    const hasComponentsDir =
        existsSync(join(repoPath, 'src', 'components')) ||
        existsSync(join(repoPath, 'components'));
    const isExistingCodebase = hasSrcDir || hasAppDir || hasComponentsDir || pkgDepsCount >= 5;

    const stack = detectStack(repoPath) || { framework: 'node', packageManager: 'npm' };

    // Detect routes/pages
    const possibleRoutes: string[] = [];
    const appDirs = [
        join(repoPath, 'src', 'app'),
        join(repoPath, 'app'),
        join(repoPath, 'src', 'pages'),
        join(repoPath, 'pages')
    ];

    for (const appDir of appDirs) {
        if (existsSync(appDir)) {
            try {
                const entries = readdirSync(appDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (
                        entry.isDirectory() &&
                        !entry.name.startsWith('_') &&
                        !entry.name.startsWith('.') &&
                        entry.name !== 'api' &&
                        entry.name !== 'components'
                    ) {
                        possibleRoutes.push(entry.name);
                    }
                }
            } catch {}
        }
    }

    const features: FeatureEpicSpec[] = [];
    
    if (isExistingCodebase) {
        const epicStatus = 'completed';
        const storyStatus = 'done';
        const taskStatus = 'completed';

        // 1. Foundational Scaffold Feature
        features.push({
            name: 'Project Foundation',
            description: 'Scaffold and baseline project setup.',
            status: epicStatus as any,
            stories: [
                {
                    name: 'Scaffold Environment',
                    file: `stories/apps/${name}.yaml`,
                    status: storyStatus,
                    tasks: [
                        { id: 'task-init-setup', title: 'Initialize project, configurations, and environment dependencies', status: taskStatus }
                    ]
                }
            ]
        });

        // 2. Database Feature (if Prisma or Drizzle ORM detected)
        const hasPrisma = existsSync(join(repoPath, 'prisma'));
        const hasDrizzle = existsSync(join(repoPath, 'drizzle.config.ts')) || existsSync(join(repoPath, 'drizzle.config.js')) || existsSync(join(repoPath, 'drizzle'));

        if (hasPrisma || hasDrizzle) {
            const dbTech = hasPrisma ? 'Prisma' : 'Drizzle';
            features.push({
                name: 'Database Layer',
                description: `Database connectivity, schema validation, and ORM layer configuration using ${dbTech}.`,
                status: epicStatus as any,
                stories: [
                    {
                        name: `${dbTech} Configuration`,
                        status: storyStatus,
                        tasks: [
                            { id: 'task-db-setup', title: `Setup ${dbTech} ORM, configure database credentials, and seed initial schemas`, status: taskStatus }
                        ]
                    }
                ]
            });
        }

        // 3. Page Routes Feature
        if (possibleRoutes.length > 0) {
            const routeStories: StoryReferenceSpec[] = possibleRoutes.map(route => {
                const routeName = route.charAt(0).toUpperCase() + route.slice(1);
                return {
                    name: `${routeName} Page`,
                    status: storyStatus,
                    tasks: [
                        { id: `task-route-${route}`, title: `Implement ${route} page layout and visual route components`, status: taskStatus }
                    ]
                };
            });

            features.push({
                name: 'Application Pages & Routing',
                description: 'Core user-facing layout views and page route handlers.',
                status: epicStatus as any,
                stories: routeStories
            });
        } else {
            // Fallback main page feature
            features.push({
                name: 'Core Application Pages',
                description: 'Main user-facing layouts and pages.',
                status: epicStatus as any,
                stories: [
                    {
                        name: 'Root Application Page',
                        status: storyStatus,
                        tasks: [
                            { id: 'task-root-page', title: 'Scaffold application root homepage view and components', status: taskStatus }
                        ]
                    }
                ]
            });
        }

        // 4. UI Components Feature (if components dir exists)
        if (hasComponentsDir) {
            features.push({
                name: 'UI Components Library',
                description: 'Reusable structural layout components and design tokens.',
                status: epicStatus as any,
                stories: [
                    {
                        name: 'Common Design System',
                        status: storyStatus,
                        tasks: [
                            { id: 'task-common-ui', title: 'Scaffold responsive common layout component wrappers and UI elements', status: taskStatus }
                        ]
                    }
                ]
            });
        }
    }

    // Formulate a beautiful BRD section
    const frameworkName = stack.framework || 'Node.js';
    const brd = `
# ${name} (BRD)

${description}

## Core Requirements & Integrations
- **Framework**: ${frameworkName}
- **Package Manager**: ${stack.packageManager || 'npm'}
- **Detected Routes**: ${possibleRoutes.join(', ') || 'None (Single landing page)'}
`.trim();

    return {
        apiVersion: 'factory.com/v1alpha1' as any,
        kind: 'App' as any,
        name,
        description,
        brd,
        version,
        stack: stack as any,
        features,
        status: isExistingCodebase ? 'done' : 'draft',
        progressPercent: isExistingCodebase ? 100 : 0
    } as any;
}

// ─── initBridge ──────────────────────────────────────────

export function initBridge(repoPath: string): InitResult {
    const files: InitResult['files'] = [];
    const factoryRoot = getFactoryRoot();
    const factoryDir = join(repoPath, '.factory');
    const name = basename(repoPath);

    // Create directory structure
    const dirs = [
        factoryDir,
        join(factoryDir, 'logs'),
        join(factoryDir, 'logs', 'builds'),
        join(factoryDir, 'logs', 'failures'),
        join(factoryDir, 'stories', 'apps'),
        join(factoryDir, 'stories', 'features'),
        join(factoryDir, 'knowledge'),
        join(factoryDir, 'task-manager'),
        join(factoryDir, 'workflows'),
    ];
    for (const dir of dirs) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // Auto-detect stack
    const stack = detectStack(repoPath);

    // 1. factory.yaml — always refresh (to update factory_home on re-init)
    const yamlPath = join(factoryDir, 'factory.yaml');
    const config: BridgeConfig = {
        version: 1,
        name,
        description: `Bridge for ${name}`,
        factory_home: factoryRoot,  // absolute path — resolves scripts correctly
        stack,
        agentic: {
            logs_dir: '.factory/logs',
            task_queue: '.factory/task-manager/todo.yaml',
            skill_index: '.factory/skill-index.yaml',
            workflows_dir: '.factory/workflows',
            knowledge_dir: '.factory/knowledge',
        },
    };
    writeFileSync(yamlPath, toYaml(config));
    files.push({ path: '.factory/factory.yaml', action: 'created' });

    // 2. state.yaml — analyze codebase (skip if already exists)
    const statePath = join(factoryDir, 'logs', 'state.yaml');
    if (!existsSync(statePath)) {
        const stateData = analyzeExistingProject(repoPath);
        writeFileSync(statePath, toYaml(stateData));
        files.push({ path: '.factory/logs/state.yaml', action: 'created' });
    } else {
        files.push({ path: '.factory/logs/state.yaml', action: 'skipped' });
    }

    // 3. heartbeat.yaml
    const heartbeatPath = join(factoryDir, 'logs', 'heartbeat.yaml');
    if (!existsSync(heartbeatPath)) {
        writeFileSync(heartbeatPath, toYaml({
            heartbeat: {
                last_seen: new Date().toISOString(),
                host: 'uninitialized',
                task: 'scaffold created',
                status: 'idle',
            },
        }));
        files.push({ path: '.factory/logs/heartbeat.yaml', action: 'created' });
    } else {
        files.push({ path: '.factory/logs/heartbeat.yaml', action: 'skipped' });
    }

    // 4. worklog.yaml
    const worklogPath = join(factoryDir, 'logs', 'worklog.yaml');
    if (!existsSync(worklogPath)) {
        writeFileSync(worklogPath, toYaml({
            entries: [{
                date: new Date().toISOString().replace('T', ' ').substring(0, 19),
                message: `${name} .factory/ scaffold initialized`,
            }],
        }));
        files.push({ path: '.factory/logs/worklog.yaml', action: 'created' });
    } else {
        files.push({ path: '.factory/logs/worklog.yaml', action: 'skipped' });
    }

    // 5. skill-index.yaml
    const skillIndexPath = join(factoryDir, 'skill-index.yaml');
    if (!existsSync(skillIndexPath)) {
        writeFileSync(skillIndexPath, toYaml({
            skills: [
                { name: 'heartbeat', path: `${factoryRoot}/factory/scripts/heartbeat/pulse.sh`, description: 'Write a liveness timestamp' },
                { name: 'auto-blueprint', path: `${factoryRoot}/factory/scripts/auto-blueprint/update-blueprint.sh`, description: 'Append to worklog' },
                { name: 'compress-worklog', path: `${factoryRoot}/factory/scripts/compress-worklog/compress.sh`, description: 'Archive old worklog entries' },
                { name: 'validate-code', path: `${factoryRoot}/factory/scripts/validate-code/validate.sh`, description: 'Run lint and type checks' },
                { name: 'worker', path: 'factory worker', description: 'Run YAML prompt queue' },
                { name: 'task-manager', path: '.factory/task-manager/manage.sh', description: 'Manage task lifecycle' },
            ],
        }));
        files.push({ path: '.factory/skill-index.yaml', action: 'created' });
    } else {
        files.push({ path: '.factory/skill-index.yaml', action: 'skipped' });
    }

    // 6. todo.yaml
    const todoPath = join(factoryDir, 'task-manager', 'todo.yaml');
    if (!existsSync(todoPath)) {
        writeFileSync(todoPath, toYaml({
            summary: { completed: 0, next: 0, in_progress: 0, cancelled: 0 },
            completed: [],
            next: [],
            in_progress: [],
            cancelled: [],
        }));
        files.push({ path: '.factory/task-manager/todo.yaml', action: 'created' });
    } else {
        files.push({ path: '.factory/task-manager/todo.yaml', action: 'skipped' });
    }

    // 7. manage.sh — copy from factory
    const manageResult = copyManageSh(factoryRoot, factoryDir);
    files.push(manageResult);

    // 8. Workflow docs — copy from factory's own .factory/workflows/
    // Use import.meta.url path — safe regardless of process.cwd()
    const sourceWorkflows = join(factoryRoot, '.factory', 'workflows');
    if (existsSync(sourceWorkflows)) {
        for (const file of ['bootstrap.md', 'process.md', 'commit.md']) {
            const src = join(sourceWorkflows, file);
            const dst = join(factoryDir, 'workflows', file);
            if (existsSync(src) && !existsSync(dst)) {
                copyFileSync(src, dst);
                files.push({ path: `.factory/workflows/${file}`, action: 'created' });
            } else if (existsSync(dst)) {
                files.push({ path: `.factory/workflows/${file}`, action: 'skipped' });
            }
        }
    }

    // 9. agents.md — create or patch
    try {
        const agentsResult = patchAgentsMd(repoPath);
        files.push(agentsResult);
    } catch (e) {
        logError(`agents.md patch failed: ${e}`);
    }

    // 10. scaffold.yaml — generate completed spec if not exists
    const scaffoldYamlPath = join(factoryDir, 'scaffold.yaml');
    if (!existsSync(scaffoldYamlPath)) {
        try {
            const appSpec = generateAppYamlFromExistingCodebase(repoPath);
            writeFileSync(scaffoldYamlPath, toYaml(appSpec));
            files.push({ path: '.factory/scaffold.yaml', action: 'created' });
        } catch (e) {
            logError(`scaffold.yaml generation failed: ${e}`);
        }
    } else {
        files.push({ path: '.factory/scaffold.yaml', action: 'skipped' });
    }

    log('✓', `Initialized .factory/ bridge in ${repoPath} (${files.filter(f => f.action === 'created').length} created, ${files.filter(f => f.action === 'skipped').length} skipped)`);
    return { success: true, files };
}
