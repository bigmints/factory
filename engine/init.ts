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
    mkdirSync, readdirSync, chmodSync, copyFileSync, symlinkSync, cpSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as toYaml } from 'yaml';
import type { BridgeConfig, ProjectStack, AppSpec, FeatureEpicSpec, StoryReferenceSpec } from './types.ts';
import { log, logError } from './log.ts';

// ─── Resolve factory root ──────────────────────────────────
import { FACTORY_ROOT } from './config.ts';

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

    if (existsSync(join(repoPath, 'pubspec.yaml'))) {
        let isFlutter = false;
        try {
            const pub = readFileSync(join(repoPath, 'pubspec.yaml'), 'utf-8');
            if (pub.includes('sdk: flutter')) isFlutter = true;
        } catch {}
        return {
            framework: isFlutter ? 'flutter' : 'dart',
            packageManager: 'pub',
        };
    }

    if (existsSync(join(repoPath, 'go.mod'))) {
        return { framework: 'go', packageManager: 'go modules' };
    }

    if (existsSync(join(repoPath, 'Cargo.toml'))) {
        return { framework: 'rust', packageManager: 'cargo' };
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
export function buildFileTree(dir: string, depth: number, _current = 0): string[] {
    const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', 'coverage', '.turbo', '.dart_tool', 'android', 'ios', 'macos', 'linux', 'windows']);
    if (_current >= depth) return [];
    try {
        const entries = readdirSync(dir, { withFileTypes: true })
            .filter(e => !SKIP.has(e.name) && !e.name.startsWith('.'));
            
        // Sort files first, then directories, so that we don't truncate before seeing files
        entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return 1;
            if (!a.isDirectory() && b.isDirectory()) return -1;
            return a.name.localeCompare(b.name);
        });

        return entries.map(e => {
                const prefix = '  '.repeat(_current) + (e.isDirectory() ? '📁 ' : '📄 ');
                const entry = prefix + e.name;
                if (e.isDirectory() && _current < depth - 1) {
                    const children = buildFileTree(join(dir, e.name), depth, _current + 1);
                    return [entry, ...children];
                }
                return [entry];
            })
            .flat()
            .slice(0, 80); // cap at 80 lines
    } catch { return []; }
}

// ─── agents.md Patch ─────────────────────────────────────

const FACTORY_SECTION_MARKER = '## Factory Agentic Scaffold';

const FACTORY_AGENTS_SECTION = (_name: string) => `
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

### Architecture & File Structure Protocols
You MUST adhere to the following file paths:
- **Stories**: \`.factory/stories/<slug>.md\`
- **Skills**: Global skills live in \`~/.factory/skills/\`. Project-specific overrides go in \`.factory/skills/\`
- **Knowledge / ADRs**: \`.factory/knowledge/\`
- **Agent Logs**: \`.factory/logs/\`

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

export function patchEncapsulatedAgentsMd(repoPath: string, factoryDir: string): { path: string; action: 'created' | 'patched' | 'skipped' } {
    const name = basename(repoPath);
    const outPath = join(factoryDir, 'AGENTS.md');
    
    const stack = detectStack(repoPath);
    const stackLine = stack ? `**Stack:** ${stack.framework}, ${stack.packageManager}${stack.linter ? `, ${stack.linter}` : ''}${stack.testing ? `, ${stack.testing}` : ''}` : '';
    
    const content = `# Factory Agent — ${name} Instructions

## Architecture & File Structure Protocols
To ensure the Factory engine functions correctly, you MUST adhere to the following file paths:
- **Stories**: Must be written to \`.factory/stories/<slug>.md\`
- **Skills**: Global skills live in \`~/.factory/skills/\`. Project-specific overrides go in \`.factory/skills/\`
- **Knowledge / ADRs**: Must be written to \`.factory/knowledge/\`
- **Agent Logs**: Must be written to \`.factory/logs/\`

---

## Role
You are a senior, highly capable TypeScript/Node.js autonomous engineer designed to safely build, validate, and evolve the **${name}** application. Your mission is to deliver fully functional features and stories in accordance with acceptance criteria, avoiding hallucinations or placeholder code.

${stackLine}

## Process Lifecycle Protocol
Always adhere strictly to the following phased lifecycle when executing tasks:

1. **GATHER CONTEXT & RESEARCH:**
   - Read \`.factory/logs/state.yaml\` (or legacy state snapshots) to understand existing file locations and conventions before editing or creating files.
   - Run compilation (\`npx tsc --noEmit\`) and lint checks first to verify pre-existing project health.
   
2. **CLAIM TASK:**
   - Locate the target task ID in \`.factory/task-manager/todo.yaml\`.
   - Run the task claim command:
     \`\`\`bash
     .factory/task-manager/manage.sh start <task-id>
     \`\`\`
   - Write a heartbeat pulse indicating you have claimed and started the task:
     \`\`\`bash
     factory pulse "Starting work on <task-id>: <brief summary>"
     \`\`\`

3. **BUILD & ITERATE:**
   - Write modular, readable, fully typed code. Avoid placeholders, "TODO" comments in critical paths, or stubbed endpoints.
   - Constantly write heartbeat signals to \`.factory/logs/heartbeat.yaml\` at significant coding milestones via:
     \`\`\`bash
     factory pulse "<milestone summary>"
     \`\`\`
   - Perform incremental validation checks. If compilation or lint errors are returned, perform targeted debugging rather than full regeneration.

4. **VERIFY QUALITY GATES:**
   - Confirm changes do not break typings: \`npx tsc --noEmit\` (or equivalent).
   - Ensure the code passes linter audits: \`npm run lint\` or \`npx eslint\`.
   - If unit/integration tests exist, execute the test runner to verify coverage and behaviors.

5. **COMPLETE & DOCUMENT:**
   - Mark the task completed:
     \`\`\`bash
     .factory/task-manager/manage.sh complete --id <task-id> --summary "<detailed checklist of what was achieved>"
     \`\`\`
   - Write a session update pulse:
     \`\`\`bash
     factory pulse "Successfully completed and validated <task-id>."
     \`\`\`

## Coding Conventions
- **Strict TypeScript:** No implicit \`any\`. Ensure proper interface declarations and type-safe data pipelines.
- **Tailwind & Component Styling:** Use predefined tokens, utilities, and components. Avoid adding ad-hoc CSS classes unless strictly necessary.
- **State Preservation:** When editing files, preserve existing comments, documentation strings, and helper functions that are unrelated to your immediate task.

---

${FACTORY_AGENTS_SECTION(name)}
`;

    if (existsSync(outPath)) {
        const currentContent = readFileSync(outPath, 'utf-8');
        if (currentContent.includes(FACTORY_SECTION_MARKER)) {
            return { path: '.factory/AGENTS.md', action: 'skipped' };
        }
        writeFileSync(outPath, content);
        return { path: '.factory/AGENTS.md', action: 'patched' };
    }

    writeFileSync(outPath, content);
    return { path: '.factory/AGENTS.md', action: 'created' };
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

    const hasSrcDir = existsSync(join(repoPath, 'src'));
    const hasAppDir = existsSync(join(repoPath, 'app'));
    const hasComponentsDir = existsSync(join(repoPath, 'src', 'components')) || existsSync(join(repoPath, 'components'));

    // Detect whether this is a real existing codebase or a brand-new empty project.
    // Evidence of an existing codebase: has > 2 commits in git (a new project usually has 1 or 2 commits for initial scaffold).
    let isExistingCodebase = false;
    try {
        const { execSync } = require('node:child_process');
        const commitCount = parseInt(execSync('git rev-list --count HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim(), 10);
        isExistingCodebase = commitCount > 2;
    } catch {
        // Fallback: if not a git repo or no commits yet, it's not an existing legacy codebase.
        isExistingCodebase = (hasSrcDir || hasAppDir || hasComponentsDir || pkgDepsCount >= 5) && existsSync(join(repoPath, '.git'));
    }

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

    // Helper: convert a story name to a filename slug
    const toSlug = (s: string) =>
        s.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

    if (isExistingCodebase) {
        const epicStatus = 'done';
        const storyStatus = 'done';
        const taskStatus = 'done';

        // 1. Foundational Scaffold Feature
        features.push({
            name: 'Project Foundation',
            description: 'Scaffold and baseline project setup.',
            status: epicStatus as any,
            stories: [
                {
                    name: 'Scaffold Environment',
                    file: `stories/${name}.md`,
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
            const dbSlug = toSlug(`${dbTech}-configuration`);
            features.push({
                name: 'Database Layer',
                description: `Database connectivity, schema validation, and ORM layer configuration using ${dbTech}.`,
                status: epicStatus as any,
                stories: [
                    {
                        name: `${dbTech} Configuration`,
                        file: `stories/${dbSlug}.md`,
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
                const routeSlug = toSlug(`${routeName}-page`);
                return {
                    name: `${routeName} Page`,
                    file: `stories/${routeSlug}.md`,
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
                        file: `stories/${toSlug('root-application-page')}.md`,
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
                        file: `stories/${toSlug('common-design-system')}.md`,
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

export async function initBridge(repoPath: string): Promise<InitResult> {
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
        join(factoryDir, 'stories'),
        join(factoryDir, 'knowledge'),
        join(factoryDir, 'task-manager'),
        join(factoryDir, 'workflows'),
    ];
    for (const dir of dirs) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // Run LLM Analysis with a strict 5-second timeout so init never hangs.
    // Falls back to static stack detection if LLM is slow, unreachable, or not configured.
    let analysisResult = null;
    try {
        const { llmAnalyzeProject } = await import('./analyze.ts');
        const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 5000));
        analysisResult = await Promise.race([llmAnalyzeProject(repoPath), timeout]);
        if (!analysisResult) {
            log('!', 'LLM analysis timed out (>5s) — using static stack detection');
        }
    } catch (e) {
        logError(`LLM analysis skipped: ${e}`);
    }

    // Auto-detect stack (fallback)
    const stack = analysisResult?.stack || detectStack(repoPath);

    // 1. factory.yaml — always refresh (to update factory_home on re-init)
    const yamlPath = join(factoryDir, 'factory.yaml');
    const config: BridgeConfig = {
        version: 1,
        name,
        description: `Bridge for ${name}`,
        factory_home: FACTORY_ROOT,  // points to ~/.factory
        stack,
        conventions: {
            rules: '.factory/knowledge',
            agents: '.factory/AGENTS.md',
        },
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
        let stateData: any = analyzeExistingProject(repoPath);
        if (analysisResult?.context) {
            stateData = { ...stateData, ...analysisResult.context };
        }
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

    // 5. skill-index.yaml and skills directory (Global Symlinks)
    const globalSkillsDir = join(FACTORY_ROOT, 'skills');
    const globalSkillIndex = join(FACTORY_ROOT, 'skill-index.yaml');

    if (!existsSync(globalSkillsDir)) mkdirSync(globalSkillsDir, { recursive: true });
    if (!existsSync(globalSkillIndex)) {
        writeFileSync(globalSkillIndex, toYaml({
            skills: [
                { name: 'heartbeat', path: `factory pulse "liveness check"`, description: 'Write a liveness timestamp' },
                { name: 'auto-blueprint', path: `factory blueprint update "checkpoint"`, description: 'Append to worklog' },
                { name: 'validate-code', path: `factory validate`, description: 'Run lint and type checks' },
                { name: 'worker', path: 'factory worker', description: 'Run YAML prompt queue' },
                { name: 'task-manager', path: 'factory task', description: 'Manage task lifecycle' },
            ],
        }));
    }

    const localSkillIndex = join(factoryDir, 'skill-index.yaml');
    if (!existsSync(localSkillIndex)) {
        try { copyFileSync(globalSkillIndex, localSkillIndex); } catch { /* fallback or ignore */ }
        files.push({ path: '.factory/skill-index.yaml', action: 'created' });
    } else {
        files.push({ path: '.factory/skill-index.yaml', action: 'skipped' });
    }

    const localSkillsDir = join(factoryDir, 'skills');
    if (!existsSync(localSkillsDir)) {
        try { 
            mkdirSync(localSkillsDir, { recursive: true }); 
            const readme = `# Project-Specific Skills\n\nAny \`SKILL.md\` placed in this directory will be available to Factory agents in this project.\n\nTo override a global skill, create a file with the exact same name as the global skill (e.g. \`story-generator.md\`) in this folder. Factory merges these at runtime, with local skills taking precedence.\n`;
            writeFileSync(join(localSkillsDir, 'README.md'), readme);
        } catch { /* fallback or ignore */ }
        files.push({ path: '.factory/skills', action: 'created' });
    } else {
        files.push({ path: '.factory/skills', action: 'skipped' });
    }

    // 6. Seed knowledge files
    const knowledgeFiles = [
        { name: 'blueprint.md', title: 'Tech Stack & Architecture Blueprint', type: 'blueprint' },
        { name: 'knowledge.md', title: 'Project Knowledge & Strategy', type: 'knowledge' },
        { name: 'chronicles.md', title: 'Project Chronicles', type: 'chronicles' }
    ];
    for (const kFile of knowledgeFiles) {
        const kPath = join(factoryDir, 'knowledge', kFile.name);
        if (!existsSync(kPath)) {
            const frontmatter = `---\ntitle: "${kFile.title}"\ntype: "${kFile.type}"\ndate: "${new Date().toISOString()}"\n---\n\n`;
            writeFileSync(kPath, frontmatter);
            files.push({ path: `.factory/knowledge/${kFile.name}`, action: 'created' });
        }
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
        const agentsResult = patchEncapsulatedAgentsMd(repoPath, factoryDir);
        files.push(agentsResult);
        
        // Also keep/patch a root-level reference AGENTS.md for backward compatibility
        const rootAgentsResult = patchAgentsMd(repoPath);
        files.push(rootAgentsResult);
    } catch (e) {
        logError(`agents.md patch failed: ${e}`);
    }

    // 10. blueprint/scaffold.md — generate completed spec if not exists
    const blueprintDir = join(factoryDir, 'blueprint');
    if (!existsSync(blueprintDir)) {
        mkdirSync(blueprintDir, { recursive: true });
    }
    const scaffoldMdPath = join(blueprintDir, 'scaffold.md');
    if (!existsSync(scaffoldMdPath)) {
        try {
            const appSpec = generateAppYamlFromExistingCodebase(repoPath);
            // Write it as markdown with yaml frontmatter
            const mdContent = `---\n${toYaml(appSpec)}---\n\n# System Scaffold\n\nThis is an auto-generated architectural scaffold.`;
            writeFileSync(scaffoldMdPath, mdContent);
            files.push({ path: '.factory/blueprint/scaffold.md', action: 'created' });

            // Generate physical story files
            if (appSpec.features && Array.isArray(appSpec.features)) {
                for (const feature of appSpec.features) {
                    if (feature.stories && Array.isArray(feature.stories)) {
                        for (const story of feature.stories) {
                            if (!story.file) continue;
                            const storyFilePath = join(factoryDir, story.file.replace(/\.ya?ml$/, '.md'));
                            if (!existsSync(storyFilePath)) {
                                const storyDir = dirname(storyFilePath);
                                if (!existsSync(storyDir)) {
                                    mkdirSync(storyDir, { recursive: true });
                                }
                                const storyYaml = {
                                    name: story.name,
                                    description: 'Auto-generated baseline story for existing codebase.',
                                    status: story.status || 'draft',
                                    feature: { name: feature.name },
                                    stack: appSpec.stack,
                                    tasks: story.tasks || []
                                };
                                const mdStoryContent = `---\n${toYaml(storyYaml)}---\n\n# ${story.name}\n\nAuto-generated baseline story for existing codebase.`;
                                writeFileSync(storyFilePath, mdStoryContent);
                                files.push({ path: `.factory/${story.file.replace(/\.ya?ml$/, '.md')}`, action: 'created' });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            logError(`scaffold.md generation failed: ${e}`);
        }
    } else {
        files.push({ path: '.factory/blueprint/scaffold.md', action: 'skipped' });
    }

    log('✓', `Initialized .factory/ bridge in ${repoPath} (${files.filter(f => f.action === 'created').length} created, ${files.filter(f => f.action === 'skipped').length} skipped)`);

    // ── Background TPM context generation ────────────────────────────────────
    // Fire-and-forget: run 'factory build-knowledge' in the project dir
    // so the TPM agent generates deep codebase context asynchronously.
    // This never blocks the caller — init returns immediately after this.
    try {
        const factoryBin = resolve(getFactoryRoot(), '..', 'factory', 'bin', 'factory');
        const binToUse = existsSync(factoryBin) ? factoryBin : 'factory';
        const bgProc = spawn(binToUse, ['build-knowledge', repoPath], {
            cwd: repoPath,
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, FACTORY_PROJECT_ROOT: repoPath },
        });
        bgProc.unref(); // Let it run independently after parent exits
        log('→', 'TPM context generation started in background (factory build-knowledge)');
    } catch (e) {
        // Non-fatal: context generation is best-effort
        logError(`Background TPM context generation could not start: ${e}`);
    }

    return { success: true, files };
}
