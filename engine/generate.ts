/**
 * LLM Generation Pipeline — the core of the factory.
 *
 * Autonomous loop: Plan → Build → Test → Iterate → Done
 *
 * Reuses proven provider calls (Gemini, OpenAI, Ollama) from the
 * original engine. New: planning step, test step, iteration loop.
 */

import type {
    AppStory, FeatureStory, ProjectBlueprint,
    GeneratedFile, BuildPlan, BuildResult,
    LLMProvider, TaskProfile, AppIntegrationBlueprint,
} from './types.ts';
import type { QueueBuildBlueprint } from './blueprint.ts';
import { classifyTask, classifyFeatureTask } from './task-classifier.ts';
import { storySlug, storyPort } from './types.ts';
import { loadSettings, getActiveProvider } from './config.ts';
import { gatherAppBlueprint, loadQueueBlueprint } from './blueprint.ts';
import { log, logStep, logError } from './log.ts';
import { resolveSkillsForBuild, formatSkillsForPrompt, seedDefaultSkills } from './skills.ts';

const PIPELINE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — prioritise quality over speed

/** Token usage from a single LLM call */
export interface LLMResponse {
    text: string;
    tokensIn: number;
    tokensOut: number;
}

// ─── Main Pipeline ───────────────────────────────────────

/**
 * Run the full autonomous build pipeline for an app story.
 *
 * Gather context → Tool-calling session
 */
export async function runPipeline(
    story: AppStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
): Promise<BuildResult> {
    log('●', `Starting tool-calling build session for app: ${story.appName}`);
    return runToolSession(story, blueprint, targetDir, storyFile);
}

/**
 * Run the pipeline for a feature story.
 * Gathers AppIntegrationBlueprint from the target app and passes it into the tool session.
 */
export async function runFeaturePipeline(
    story: FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
): Promise<BuildResult> {
    log('●', `Starting tool-calling build session for feature: ${story.feature.name}`);
    const appBlueprint = gatherAppBlueprint(blueprint.repoPath, blueprint.bridge, story.target.app);
    return runToolSession(story, blueprint, targetDir, storyFile, appBlueprint);
}

// ─── Plan ────────────────────────────────────────────────

/**
 * Ask the LLM to create a build plan before generating code.
 * @deprecated Use tool-calling session instead.
 */
async function planBuild(
    story: AppStory,
    blueprint: ProjectBlueprint,
    provider: LLMProvider,
    model: string,
): Promise<{ plan: BuildPlan; tokensIn: number; tokensOut: number }> {
    const blueprintBlock = formatBlueprint(blueprint);
    const storyBlock = formatStory(story);

    const prompt = `You are a senior architect planning a new application build.

Given the following story and project blueprint, create a build plan.

${storyBlock}

${blueprintBlock}

Respond in this exact JSON format only:
{
  "files": ["list", "of", "file", "paths", "to", "generate"],
  "architecture": "Brief description of the architecture approach",
  "decisions": ["Key decision 1", "Key decision 2"]
}

Output ONLY the JSON. No markdown, no explanation.`;

    const raw = await callProvider(provider, model, prompt);

    try {
        // Strip markdown code fences if present
        const cleaned = raw.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return { plan: JSON.parse(cleaned) as BuildPlan, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut };
    } catch {
        // If parsing fails, create a sensible default plan
        log('!', 'Could not parse plan JSON — using default plan');
        return {
            plan: {
                files: ['package.json', 'tsconfig.json', 'src/app/layout.tsx', 'src/app/page.tsx'],
                architecture: `${story.stack.framework} app with ${story.stack.database || 'local state'}`,
                decisions: ['Using story defaults'],
            },
            tokensIn: raw.tokensIn,
            tokensOut: raw.tokensOut,
        };
    }
}

// ─── Build ───────────────────────────────────────────────

/**
 * Generate code files from story + plan + blueprint.
 * @deprecated Use tool-calling session instead.
 */
async function executeBuild(
    story: AppStory,
    blueprint: ProjectBlueprint,
    plan: BuildPlan,
    provider: LLMProvider,
    model: string,
    skillsBlock?: string,
): Promise<{ files: GeneratedFile[]; tokensIn: number; tokensOut: number }> {
    // For large apps, use module-by-module generation
    const MODULE_THRESHOLD = 15;
    if (plan.files.length > MODULE_THRESHOLD) {
        log('●', `Large app detected (${plan.files.length} files > ${MODULE_THRESHOLD}). Using module-by-module generation.`);
        return executeModularBuild(story, blueprint, plan, provider, model);
    }

    // Standard single-shot generation for smaller apps
    const prompt = buildAppPrompt(story, blueprint, plan, skillsBlock);

    log('→', `Prompt: ${prompt.length.toLocaleString()} chars`);
    log('→', `Calling ${provider.name}...`);

    const raw = await callProvider(provider, model, prompt);
    log('✓', `Response received (${raw.text.length.toLocaleString()} chars)`);

    log('→', `Parsing generated files...`);
    const files = parseGeneratedFiles(raw.text);
    if (files.length === 0) {
        throw new Error(
            'LLM response contained no parseable files.\n' +
            'Try a different model or check the story.'
        );
    }

    for (const f of files) {
        const size = f.content.length;
        const sizeLabel = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
        log('→', `  ${f.filename} (${sizeLabel})`);
    }

    return { files, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut };
}

// ─── Module-by-Module Generation ─────────────────────────

type ModuleName = 'config' | 'db' | 'api' | 'pages' | 'components' | 'utils';

interface BuildModule {
    name: ModuleName;
    files: string[];
    description: string;
}

/**
 * Decompose a build plan into ordered modules.
 * Each module will be generated in a separate LLM call.
 */
function moduleDecomposition(plan: BuildPlan): BuildModule[] {
    const buckets: Record<ModuleName, string[]> = {
        config: [],
        db: [],
        api: [],
        pages: [],
        components: [],
        utils: [],
    };

    for (const file of plan.files) {
        const lower = file.toLowerCase();

        if (lower === 'package.json' || lower === 'tsconfig.json' ||
            lower.includes('vite.config') || lower.includes('next.config') ||
            lower.includes('tailwind.config') || lower.includes('postcss') ||
            lower.includes('.env') || lower.endsWith('.css') ||
            lower.includes('eslint')) {
            buckets.config.push(file);
        } else if (lower.includes('/db/') || lower.includes('/database/') ||
            lower.includes('schema') || lower.includes('migration') ||
            lower.includes('seed') || lower.includes('drizzle') ||
            lower.includes('prisma')) {
            buckets.db.push(file);
        } else if (lower.includes('/api/') || lower.includes('route.ts') ||
            lower.includes('route.js') || lower.includes('/server/') ||
            lower.includes('middleware') || lower.includes('controller')) {
            buckets.api.push(file);
        } else if (lower.includes('/app/') || lower.includes('page.ts') ||
            lower.includes('page.tsx') || lower.includes('layout.ts') ||
            lower.includes('layout.tsx') || lower.includes('/pages/')) {
            buckets.pages.push(file);
        } else if (lower.includes('/components/') || lower.includes('/ui/')) {
            buckets.components.push(file);
        } else {
            buckets.utils.push(file);
        }
    }

    const descriptions: Record<ModuleName, string> = {
        config: 'Project configuration: package.json, tsconfig, framework config, CSS, env',
        db: 'Database layer: schema, migrations, seed data, ORM config',
        api: 'API layer: routes, controllers, middleware, server-side logic',
        pages: 'Pages & layouts: app router pages, layouts, loading states',
        components: 'Shared components: UI components, reusable widgets',
        utils: 'Utilities: types, helpers, constants, lib functions',
    };

    const order: ModuleName[] = ['config', 'utils', 'db', 'api', 'components', 'pages'];

    return order
        .filter(name => buckets[name].length > 0)
        .map(name => ({
            name,
            files: buckets[name],
            description: descriptions[name],
        }));
}

/**
 * Build a prompt for a single module, including context from previously generated modules.
 */
function buildModulePrompt(
    module: BuildModule,
    story: AppStory,
    blueprint: ProjectBlueprint,
    previousModules: { name: string; files: GeneratedFile[] }[],
): string {
    const storyBlock = formatStory(story);
    const blueprintBlock = formatBlueprint(blueprint);

    // Show interfaces/exports from previous modules so this module can import from them
    let prevContext = '';
    if (previousModules.length > 0) {
        const summaries = previousModules.map(m => {
            const fileSummaries = m.files.map(f => {
                // Extract exports and key type definitions
                const exports = f.content.match(/export\s+(default\s+)?(function|const|class|type|interface)\s+\w+/g) || [];
                return `- ${f.filename}: ${exports.join(', ') || '(no named exports)'}`;
            }).join('\n');
            return `### ${m.name} module\n${fileSummaries}`;
        }).join('\n\n');

        // Also include full content of config files (package.json, tsconfig etc)
        const configFiles = previousModules
            .filter(m => m.name === 'config')
            .flatMap(m => m.files)
            .filter(f => f.filename === 'package.json' || f.filename === 'tsconfig.json');

        const configContents = configFiles.map(f =>
            `\n#### ${f.filename}\n\`\`\`\n${f.content}\n\`\`\``
        ).join('\n');

        prevContext = `\n## Already Generated Modules (refer to these, import from them)\n${summaries}\n${configContents}\n`;
    }

    return `You are a senior full-stack developer. Generate ONLY the **${module.name}** module for this application.

## Module: ${module.name}
${module.description}

### Files to generate in this module:
${module.files.map(f => `- ${f}`).join('\n')}

${storyBlock}
${blueprintBlock}
${prevContext}

## Rules
1. Generate ONLY the files listed above for this module. Do NOT generate files from other modules.
2. Every "import ... from 'package'" MUST reference a real npm package.
3. Match the coding style and patterns from the story and any previous modules.
4. For package versions in package.json, use "*" — the engine resolves to latest.
5. When using ESM with moduleResolution "NodeNext", include .js extensions in relative imports.

## Output Format

===FILE: path/to/file.ext===
(file content here)
===END_FILE===

Output ONLY the files. No explanations.`;
}

/**
 * Execute modular build — generate each module as a separate LLM call,
 * building blueprint context from previously generated modules.
 * @deprecated Use tool-calling session instead.
 */
async function executeModularBuild(
    story: AppStory,
    blueprint: ProjectBlueprint,
    plan: BuildPlan,
    provider: LLMProvider,
    model: string,
): Promise<{ files: GeneratedFile[]; tokensIn: number; tokensOut: number }> {
    const modules = moduleDecomposition(plan);
    const allFiles: GeneratedFile[] = [];
    const completedModules: { name: string; files: GeneratedFile[] }[] = [];
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    log('●', `Decomposed into ${modules.length} modules: ${modules.map(m => `${m.name}(${m.files.length})`).join(', ')}`);

    for (let i = 0; i < modules.length; i++) {
        const mod = modules[i];
        log('→', `[${i + 1}/${modules.length}] Generating ${mod.name} module (${mod.files.length} files)...`);

        const prompt = buildModulePrompt(mod, story, blueprint, completedModules);
        log('→', `  Prompt: ${prompt.length.toLocaleString()} chars`);

        const raw = await callProvider(provider, model, prompt);
        const files = parseGeneratedFiles(raw.text);
        totalTokensIn += raw.tokensIn;
        totalTokensOut += raw.tokensOut;

        if (files.length === 0) {
            log('!', `  ${mod.name} module produced no files — skipping`);
            continue;
        }

        log('✓', `  ${mod.name}: ${files.length} files generated`);
        for (const f of files) {
            const size = f.content.length;
            const sizeLabel = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
            log('→', `    ${f.filename} (${sizeLabel})`);
        }

        allFiles.push(...files);
        completedModules.push({ name: mod.name, files });
    }

    if (allFiles.length === 0) {
        throw new Error(
            'Modular build produced no files across all modules.\n' +
            'Try a different model or check the story.'
        );
    }

    log('✓', `Modular build complete: ${allFiles.length} total files across ${completedModules.length} modules`);
    return { files: allFiles, tokensIn: totalTokensIn, tokensOut: totalTokensOut };
}

/**
 * Group files by their top-level directory for summary logging.
 */
function groupFilesByDirectory(files: GeneratedFile[]): Record<string, number> {
    const groups: Record<string, number> = {};
    for (const f of files) {
        const parts = f.filename.split('/');
        const dir = parts.length > 1 ? parts[0] : '.';
        groups[dir] = (groups[dir] || 0) + 1;
    }
    return groups;
}

// ─── Test ────────────────────────────────────────────────

import { mkdtempSync, writeFileSync as fsWrite, readFileSync as fsRead, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execSync, spawn as cpSpawn } from 'node:child_process';
import type { StackConfig } from './types.ts';

/**
 * Runtime smoke test: start the dev server, wait for port, GET main page, check 200.
 * Returns an error string if something fails, or null if everything is OK.
 * @deprecated Use tool-calling session instead.
 */
async function runtimeSmokeTest(tmpDir: string, stack: StackConfig): Promise<string | null> {
    const port = 3099; // Use a fixed high port for smoke tests
    logStep(0, 0, 'Runtime smoke test...');

    // Determine the dev command
    const pm = stack.packageManager || 'npm';
    const devCmd = pm === 'pnpm' ? 'pnpm' : pm === 'yarn' ? 'yarn' : 'npx';
    const devArgs = pm === 'pnpm' ? ['run', 'dev', '--', '--port', String(port)]
        : pm === 'yarn' ? ['run', 'dev', '--port', String(port)]
        : ['next', 'dev', '--port', String(port)];

    let child: ReturnType<typeof cpSpawn> | null = null;

    try {
        // Spawn dev server
        child = cpSpawn(devCmd, devArgs, {
            cwd: tmpDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
        });

        // Capture stderr for diagnosis
        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        // Wait for port — exponential backoff, max 15s total
        const MAX_WAIT = 15_000;
        const startTime = Date.now();
        let portReady = false;

        while (Date.now() - startTime < MAX_WAIT) {
            const delay = Math.min(1000, (Date.now() - startTime) / 3 + 500);
            await new Promise(r => setTimeout(r, delay));

            try {
                const res = await fetch(`http://localhost:${port}`, {
                    signal: AbortSignal.timeout(2000),
                });
                if (res.ok || res.status === 304) {
                    portReady = true;
                    log('✓', `Runtime smoke test passed (HTTP ${res.status} in ${Date.now() - startTime}ms)`);
                    return null;
                } else {
                    return `Runtime smoke test failed: HTTP ${res.status} from dev server`;
                }
            } catch {
                // Port not ready yet — keep waiting
            }

            // Check if process died
            if (child.exitCode !== null) {
                return `Dev server crashed on startup:\n${stderr.slice(0, 500)}`;
            }
        }

        if (!portReady) {
            return `Dev server did not respond within ${MAX_WAIT / 1000}s. stderr:\n${stderr.slice(0, 500)}`;
        }

        return null;
    } catch (err) {
        return `Runtime smoke test error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
        // Always kill the dev server
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            // Give it a moment to die
            await new Promise(r => setTimeout(r, 500));
            if (child.exitCode === null) child.kill('SIGKILL');
        }
    }
}

/**
 * Map user-facing tool names to actual commands.
 */
function lintCommand(linter: string | undefined): string | null {
    if (!linter) return null;
    const map: Record<string, string> = {
        'eslint': 'npx eslint . --max-warnings=0',
        'biome': 'npx @biomejs/biome check .',
        'oxlint': 'npx oxlint .',
        'prettier': 'npx prettier --check .',
        'none': '',
    };
    return map[linter.toLowerCase()] || `npx ${linter}`;
}

function testCommand(testing: string | undefined): string | null {
    if (!testing) return null;
    const map: Record<string, string> = {
        'vitest': 'npx vitest run --reporter=verbose',
        'jest': 'npx jest --forceExit',
        'playwright': 'npx playwright test',
        'cypress': 'npx cypress run',
        'none': '',
    };
    return map[testing.toLowerCase()] || `npx ${testing}`;
}

function packageInstallCommand(pm: string | undefined): string {
    switch (pm?.toLowerCase()) {
        case 'pnpm': return 'pnpm install --no-frozen-lockfile';
        case 'yarn': return 'yarn install --no-immutable';
        case 'bun': return 'bun install';
        default: return 'npm install --legacy-peer-deps';
    }
}

/**
 * Test the generated files for real.
 *
 * Phase 1: Structural checks (fast, no I/O)
 * Phase 2: Write to temp dir, npm install, tsc, lint, test
 *
 * Returns a list of error messages. Empty = all good.
 * @deprecated Use tool-calling session instead.
 */
async function testBuild(files: GeneratedFile[], stack: StackConfig, profile: TaskProfile): Promise<string[]> {
    const errors: string[] = [];

    // ── Phase 1: Structural checks (always run) ──

    // Only check for package.json if we need install
    if (profile.needsInstall) {
        const pkg = files.find(f => f.filename === 'package.json');
        if (!pkg) {
            errors.push('Missing package.json');
        } else {
            try { JSON.parse(pkg.content); }
            catch { errors.push('package.json is not valid JSON'); }
        }
    }

    // Only require tsconfig for TypeScript projects that need type checking
    if (profile.needsTypeCheck) {
        const tsconfig = files.find(f => f.filename === 'tsconfig.json');
        if (!tsconfig) errors.push('Missing tsconfig.json');
    }

    for (const file of files) {
        if (file.content.trim().length === 0) {
            errors.push(`Empty file: ${file.filename}`);
        }
    }

    for (const file of files) {
        if (file.filename.endsWith('.json')) {
            try { JSON.parse(file.content); }
            catch { errors.push(`Invalid JSON: ${file.filename}`); }
        }
    }

    // ── Phase 1.5: Cross-module consistency checks ──

    // Check that every imported npm package is listed in package.json
    if (profile.needsInstall) {
        const pkg = files.find(f => f.filename === 'package.json');
        if (pkg) {
            try {
                const pkgJson = JSON.parse(pkg.content);
                const allDeps = new Set([
                    ...Object.keys(pkgJson.dependencies || {}),
                    ...Object.keys(pkgJson.devDependencies || {}),
                ]);
                // Node built-in modules
                const builtins = new Set([
                    'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram',
                    'dns', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https',
                    'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'querystring',
                    'readline', 'stream', 'string_decoder', 'timers', 'tls', 'tty',
                    'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
                    'node:assert', 'node:buffer', 'node:child_process', 'node:cluster',
                    'node:crypto', 'node:events', 'node:fs', 'node:http', 'node:https',
                    'node:module', 'node:net', 'node:os', 'node:path', 'node:process',
                    'node:readline', 'node:stream', 'node:url', 'node:util', 'node:zlib',
                    'node:worker_threads', 'node:timers',
                ]);
                const missingPkgs = new Set<string>();
                for (const file of files) {
                    if (!file.filename.endsWith('.ts') && !file.filename.endsWith('.tsx') &&
                        !file.filename.endsWith('.js') && !file.filename.endsWith('.jsx')) continue;
                    // Match: import ... from 'package-name' or import 'package-name'
                    const importRegex = /(?:import|from)\s+['"]([^.'"@][^'"]*)['"]|(?:import|from)\s+['"](@[^/]+\/[^'"]+)['"]|require\(['"]([^.'"@][^'"]*)['"]\)|require\(['"](@[^/]+\/[^'"]+)['"]\)/g;
                    let m;
                    while ((m = importRegex.exec(file.content)) !== null) {
                        const raw = m[1] || m[2] || m[3] || m[4];
                        if (!raw) continue;
                        // Get the package name (handle sub-path imports like 'drizzle-orm/sqlite-core')
                        const pkgName = raw.startsWith('@')
                            ? raw.split('/').slice(0, 2).join('/')
                            : raw.split('/')[0];
                        if (!builtins.has(raw) && !builtins.has(pkgName) && !allDeps.has(pkgName)) {
                            missingPkgs.add(pkgName);
                        }
                    }
                }
                if (missingPkgs.size > 0) {
                    // Auto-fix: add missing packages to package.json instead of
                    // reporting as errors (burns LLM iterations for no good reason)
                    if (!pkgJson.dependencies) pkgJson.dependencies = {};
                    for (const p of missingPkgs) {
                        pkgJson.dependencies[p] = '*';
                    }
                    // Update the file content in-place
                    pkg.content = JSON.stringify(pkgJson, null, 2);
                    log('!', `Auto-added ${missingPkgs.size} missing dep(s): ${Array.from(missingPkgs).join(', ')}`);
                }
            } catch { /* already caught above */ }
        }
    }

    // ── Phase 1.6: Missing file detection ──
    // Check that every relative import resolves to an actual generated file
    {
        const fileSet = new Set(files.map(f => f.filename));
        for (const file of files) {
            if (!file.filename.endsWith('.ts') && !file.filename.endsWith('.tsx')) continue;
            const relImportRegex = /(?:import|export)\s+.*?from\s+['"](\.[^'"]+)['"]/g;
            let m;
            while ((m = relImportRegex.exec(file.content)) !== null) {
                const importPath = m[1];
                // Resolve relative to the importing file's directory
                const dir = file.filename.includes('/') ? file.filename.substring(0, file.filename.lastIndexOf('/')) : '';
                // Try several extensions
                const basePath = importPath.replace(/\.js$/, ''); // strip .js for NodeNext resolution
                const candidates = [
                    join(dir, basePath + '.ts'),
                    join(dir, basePath + '.tsx'),
                    join(dir, basePath + '/index.ts'),
                    join(dir, basePath + '/index.tsx'),
                    join(dir, importPath), // exact match
                ].map(p => p.replace(/^\//, '')); // normalize leading slash

                if (!candidates.some(c => fileSet.has(c))) {
                    errors.push(`Missing file: ${file.filename} imports '${importPath}' but no matching file exists. Generate the missing file.`);
                }
            }
        }
    }

    // ── Phase 1.7: Cross-module export validation ──
    // Check that named imports from relative paths match actual exports in the target file
    {
        // Build a map of exports per file
        const exportsMap = new Map<string, Set<string>>();
        for (const file of files) {
            if (!file.filename.endsWith('.ts') && !file.filename.endsWith('.tsx')) continue;
            const exports = new Set<string>();
            // Match: export function/class/const/let/var/type/interface/enum NAME
            const namedExportRegex = /export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
            let m;
            while ((m = namedExportRegex.exec(file.content)) !== null) {
                exports.add(m[1]);
            }
            // Match: export { Name1, Name2, ... }
            const bracketExportRegex = /export\s*\{([^}]+)\}/g;
            while ((m = bracketExportRegex.exec(file.content)) !== null) {
                for (const name of m[1].split(',')) {
                    const trimmed = name.trim().split(/\s+as\s+/)[0].trim();
                    if (trimmed) exports.add(trimmed);
                }
            }
            // Default export
            if (/export\s+default\s/.test(file.content)) {
                exports.add('default');
            }
            exportsMap.set(file.filename, exports);
        }

        for (const file of files) {
            if (!file.filename.endsWith('.ts') && !file.filename.endsWith('.tsx')) continue;
            // Match: import { Name1, Name2 } from './relative-path'
            const namedImportRegex = /import\s*\{([^}]+)\}\s*from\s+['"](\.[^'"]+)['"]/g;
            let m;
            while ((m = namedImportRegex.exec(file.content)) !== null) {
                const importedNames = m[1].split(',').map(n => {
                    const parts = n.trim().split(/\s+as\s+/);
                    return parts[0].trim(); // original name before 'as'
                }).filter(n => n.length > 0);
                const importPath = m[2];

                // Resolve target file
                const dir = file.filename.includes('/') ? file.filename.substring(0, file.filename.lastIndexOf('/')) : '';
                const basePath = importPath.replace(/\.js$/, '');
                const candidates = [
                    join(dir, basePath + '.ts'),
                    join(dir, basePath + '.tsx'),
                    join(dir, basePath + '/index.ts'),
                    join(dir, basePath + '/index.tsx'),
                ].map(p => p.replace(/^\//, ''));

                const targetFile = candidates.find(c => exportsMap.has(c));
                if (!targetFile) continue; // missing file already caught above

                const targetExports = exportsMap.get(targetFile)!;
                const missingExports = importedNames.filter(n => !targetExports.has(n));
                if (missingExports.length > 0) {
                    errors.push(
                        `Export mismatch: ${file.filename} imports { ${missingExports.join(', ')} } from '${importPath}', ` +
                        `but ${targetFile} does not export them. Available exports: ${[...targetExports].slice(0, 15).join(', ')}. ` +
                        `Add the missing exports to ${targetFile}.`
                    );
                }
            }
        }
    }

    // Bail early on structural failures — no point running tools
    if (errors.length > 0) return errors;

    // ── Phase 2: Real toolchain validation (gated by profile) ──

    // Skip entire toolchain if no install needed
    if (!profile.needsInstall) {
        log('✓', `Skipping toolchain (task type: ${profile.type})`);
        return errors;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'factory-test-'));
    log('●', `Testing in ${tmpDir}`);

    // Write all generated files to temp dir
    for (const file of files) {
        const absPath = join(tmpDir, file.filename);
        const dir = dirname(absPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        fsWrite(absPath, file.content);
    }

    // Step 0: Bump package versions to latest (LLM often pins stale versions from training data)
    try {
        logStep(0, 0, 'Bumping package versions to latest...');
        execSync('npx -y npm-check-updates -u', { cwd: tmpDir, stdio: 'pipe', timeout: 30_000, maxBuffer: 50 * 1024 * 1024 });
        log('✓', 'Package versions bumped to latest');

        // Read back the updated package.json so future iterations have correct versions
        const updatedPkg = fsRead(join(tmpDir, 'package.json'), 'utf-8');
        const pkgIdx = files.findIndex(f => f.filename === 'package.json');
        if (pkgIdx >= 0) {
            files[pkgIdx] = { ...files[pkgIdx], content: updatedPkg };
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('!', `Version bump failed (non-fatal): ${msg.slice(0, 200)}`);
    }

    // Step 1: Package install
    const installCmd = packageInstallCommand(stack.packageManager);
    try {
        logStep(0, 0, `Running ${installCmd}...`);
        execSync(installCmd, { cwd: tmpDir, stdio: 'pipe', timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
        log('✓', 'Package install succeeded');
    } catch (err) {
        const msg = err instanceof Error ? (err as any).stderr?.toString() || err.message : String(err);
        errors.push(`Package install failed: ${msg.slice(0, 300)}`);
        return errors; // Can't continue without deps
    }

    // Step 2: TypeScript check (gated)
    if (profile.needsTypeCheck) {
        try {
            logStep(0, 0, 'Running tsc --noEmit...');
            execSync('npx tsc --noEmit', { cwd: tmpDir, stdio: 'pipe', timeout: 30_000, maxBuffer: 50 * 1024 * 1024 });
            log('✓', 'TypeScript check passed');
        } catch (err) {
            const msg = err instanceof Error ? (err as any).stdout?.toString() || err.message : String(err);
            // Extract just the error lines
            const tsErrors = msg.split('\n')
                .filter((l: string) => l.includes('error TS'))
                .slice(0, 10)
                .join('\n');
            errors.push(`TypeScript errors:\n${tsErrors || msg.slice(0, 500)}`);
        }
    } else {
        log('○', 'Skipping tsc (not needed)');
    }

    // Step 3: Lint (gated)
    if (profile.needsLint) {
        const lint = lintCommand(stack.linter);
        if (lint) {
            try {
                logStep(0, 0, `Running ${stack.linter} linter...`);
                execSync(lint, { cwd: tmpDir, stdio: 'pipe', timeout: 30_000, maxBuffer: 50 * 1024 * 1024 });
                log('✓', 'Lint passed');
            } catch (err) {
                const msg = err instanceof Error ? (err as any).stdout?.toString() || err.message : String(err);
                // Filter out non-actionable config file parsing errors
                // (e.g. eslint.config.js, postcss.config.js not in tsconfig)
                const filteredLines = msg.split('\n').filter((line: string) => {
                    const l = line.toLowerCase();
                    // Skip config file parsing errors (tsconfig/project service issues)
                    if (l.includes('eslint.config') && l.includes('parsing error')) return false;
                    if (l.includes('postcss.config') && l.includes('parsing error')) return false;
                    if (l.includes('next.config') && l.includes('parsing error')) return false;
                    if (l.includes('was not found by the project service')) return false;
                    if (l.includes('allowdefaultproject')) return false;
                    return true;
                }).join('\n').trim();
                // Only report if there are real errors left
                if (filteredLines && filteredLines.includes('error')) {
                    errors.push(`Lint errors (${stack.linter}):\n${filteredLines.slice(0, 500)}`);
                } else {
                    log('!', 'Lint warnings only (config file issues) — treated as pass');
                }
            }
        }
    } else {
        log('○', 'Skipping lint (not needed)');
    }

    // Step 4: Test (gated)
    if (profile.needsTest) {
        const test = testCommand(stack.testing);
        if (test) {
            try {
                logStep(0, 0, `Running ${stack.testing} tests...`);
                execSync(test, { cwd: tmpDir, stdio: 'pipe', timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
                log('✓', 'Tests passed');
            } catch (err) {
                const msg = err instanceof Error ? (err as any).stdout?.toString() || err.message : String(err);
                errors.push(`Test failures (${stack.testing}):\n${msg.slice(0, 500)}`);
            }
        }
    } else {
        log('○', 'Skipping tests (not needed)');
    }

    // Step 5: Runtime smoke test (gated)
    // NOTE: Runtime errors (dev server crash, timeout) are logged as warnings,
    // NOT added to errors list. These are infra issues the LLM can't fix and
    // would waste iteration retries.
    if (profile.needsRuntimeTest && errors.length === 0) {
        const runtimeError = await runtimeSmokeTest(tmpDir, stack);
        if (runtimeError) {
            log('!', `Runtime warning (non-blocking): ${runtimeError}`);
        }
    } else if (profile.needsRuntimeTest && errors.length > 0) {
        log('○', 'Skipping runtime test (compilation errors exist)');
    }

    return errors;
}

// ─── Iterate ─────────────────────────────────────────────

/**
 * Extract filenames mentioned in error messages.
 * Handles tsc output like "src/foo.ts(12,5): error TS2304"
 * and lint output like "/tmp/factory-test-xxx/src/foo.ts:12:5"
 */
function extractBrokenFiles(errors: string[], allFiles: GeneratedFile[]): Set<string> {
    const broken = new Set<string>();
    const knownPaths = new Set(allFiles.map(f => f.filename));

    for (const err of errors) {
        // TSC: "src/db/schema.ts(12,5): error TS..."
        const tscMatch = err.match(/([a-zA-Z0-9_/.@-]+\.(?:ts|tsx|js|jsx))\(\d+/);
        if (tscMatch) {
            const candidate = tscMatch[1];
            if (knownPaths.has(candidate)) {
                broken.add(candidate);
                continue;
            }
        }

        // Lint / absolute path: ".../src/foo.ts:12:5"
        const lintMatch = err.match(/\/([a-zA-Z0-9_/.@-]+\.(?:ts|tsx|js|jsx)):/);
        if (lintMatch) {
            // Find matching file by suffix
            const suffix = lintMatch[1];
            for (const known of knownPaths) {
                if (suffix.endsWith(known)) {
                    broken.add(known);
                    break;
                }
            }
        }

        // "Missing package" errors affect package.json
        if (err.toLowerCase().includes('package.json') || err.toLowerCase().includes('missing package')) {
            if (knownPaths.has('package.json')) broken.add('package.json');
        }

        // "Invalid JSON" errors
        const jsonMatch = err.match(/Invalid JSON:\s*(\S+)/);
        if (jsonMatch && knownPaths.has(jsonMatch[1])) {
            broken.add(jsonMatch[1]);
        }
    }

    return broken;
}

/**
 * Find files that import from the broken files — these need to be sent
 * as context so the LLM can fix cross-module issues.
 */
function identifyRelatedFiles(brokenFiles: Set<string>, allFiles: GeneratedFile[]): GeneratedFile[] {
    const related: GeneratedFile[] = [];
    const brokenBasenames = new Set(
        Array.from(brokenFiles).map(f => f.replace(/\.[^.]+$/, ''))
    );

    for (const file of allFiles) {
        if (brokenFiles.has(file.filename)) continue; // already broken, skip

        // Check if this file imports from any broken file
        for (const brokenBase of brokenBasenames) {
            const brokenName = brokenBase.split('/').pop() || brokenBase;
            if (file.content.includes(brokenName)) {
                related.push(file);
                break;
            }
        }
    }

    return related;
}

/**
 * Feed errors back to the LLM — TARGETED: only send broken files + related context.
 * Merges fixed files back into the full set.
 * @deprecated Use tool-calling session instead.
 */
async function iterateBuild(
    story: AppStory,
    blueprint: ProjectBlueprint,
    plan: BuildPlan,
    previousFiles: GeneratedFile[],
    errors: string[],
    provider: LLMProvider,
    model: string,
): Promise<{ files: GeneratedFile[]; tokensIn: number; tokensOut: number }> {
    // Identify broken files
    const brokenFileNames = extractBrokenFiles(errors, previousFiles);
    const brokenFiles = previousFiles.filter(f => brokenFileNames.has(f.filename));
    const relatedFiles = identifyRelatedFiles(brokenFileNames, previousFiles);

    // If we couldn't identify specific broken files, fall back to sending all
    const targetFiles = brokenFiles.length > 0 ? brokenFiles : previousFiles;
    const isTargeted = brokenFiles.length > 0 && brokenFiles.length < previousFiles.length;

    if (isTargeted) {
        log('→', `Targeted fix: ${brokenFiles.length} broken file(s), ${relatedFiles.length} related file(s) (of ${previousFiles.length} total)`);
    } else {
        log('→', `Full regeneration: could not isolate broken files (sending all ${previousFiles.length})`);
    }

    const brokenContents = targetFiles.map(f => `===FILE: ${f.filename}===\n${f.content}\n===END_FILE===`).join('\n\n');
    const relatedSummary = relatedFiles.length > 0
        ? `\n## Related Files (for context — do NOT regenerate these unless needed)\n${relatedFiles.map(f => `===FILE: ${f.filename}===\n${f.content}\n===END_FILE===`).join('\n\n')}`
        : '';

    const instruction = isTargeted
        ? `Fix ONLY the broken files listed below. The other ${previousFiles.length - brokenFiles.length} files are working fine — do NOT change them.`
        : `Fix ALL the errors. Regenerate the complete set of files with corrections applied.`;

    const prompt = `You previously generated code for an application. There were errors that need fixing.

## Original Story
- App: ${story.appName}
- Framework: ${story.stack.framework}
- Database: ${story.stack.database || 'local state'}

## ${isTargeted ? 'Broken Files (fix these)' : 'Files Generated'}
${brokenContents}
${relatedSummary}

## Errors Found
${errors.map(e => `- ${e}`).join('\n')}

## Instructions
${instruction}

Output EVERY fixed file using this exact format:

===FILE: path/to/file.ext===
(file content here)
===END_FILE===

Output ONLY the files. No explanations.`;

    const raw = await callProvider(provider, model, prompt);
    const fixedFiles = parseGeneratedFiles(raw.text);

    if (fixedFiles.length === 0) {
        log('!', 'Iteration produced no files — keeping previous version');
        return { files: previousFiles, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut };
    }

    // Merge: replace fixed files into the full set, keep untouched files
    if (isTargeted) {
        const fixedMap = new Map(fixedFiles.map(f => [f.filename, f]));
        const merged = previousFiles.map(f => fixedMap.get(f.filename) || f);
        // Add any new files the LLM created
        for (const f of fixedFiles) {
            if (!previousFiles.some(p => p.filename === f.filename)) {
                merged.push(f);
            }
        }
        return { files: merged, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut };
    }

    return { files: fixedFiles, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut };
}

/**
 * Feed errors back to the LLM for a feature build — TARGETED iteration.
 * @deprecated Use tool-calling session instead.
 */
async function iterateFeatureBuild(
    story: FeatureStory,
    blueprint: ProjectBlueprint,
    appBlueprint: AppIntegrationBlueprint,
    previousFiles: GeneratedFile[],
    errors: string[],
    provider: LLMProvider,
    model: string,
): Promise<{ files: GeneratedFile[]; tokensIn: number; tokensOut: number }> {
    // Identify broken files
    const brokenFileNames = extractBrokenFiles(errors, previousFiles);
    const brokenFiles = previousFiles.filter(f => brokenFileNames.has(f.filename));
    const relatedFiles = identifyRelatedFiles(brokenFileNames, previousFiles);

    const targetFiles = brokenFiles.length > 0 ? brokenFiles : previousFiles;
    const isTargeted = brokenFiles.length > 0 && brokenFiles.length < previousFiles.length;

    if (isTargeted) {
        log('→', `Targeted fix: ${brokenFiles.length} broken file(s), ${relatedFiles.length} related file(s) (of ${previousFiles.length} total)`);
    }

    const brokenContents = targetFiles.map(f => `===FILE: ${f.filename}===\n${f.content}\n===END_FILE===`).join('\n\n');
    const relatedSummary = relatedFiles.length > 0
        ? `\n## Related Files (for context)\n${relatedFiles.map(f => `===FILE: ${f.filename}===\n${f.content}\n===END_FILE===`).join('\n\n')}`
        : '';

    // Integration context
    const existingDeps = appBlueprint.packageJson
        ? Object.keys({ ...appBlueprint.packageJson.dependencies, ...appBlueprint.packageJson.devDependencies }).join(', ')
        : 'unknown';

    const instruction = isTargeted
        ? `Fix ONLY the broken files below. The other ${previousFiles.length - brokenFiles.length} files are working fine.`
        : `Fix ALL the errors. Regenerate the complete set of files with corrections applied.`;

    const prompt = `You previously generated code for a feature. There were errors that need fixing.

## Feature
- Name: ${story.feature.name}
- Slug: ${story.feature.slug}
- Target App: ${story.target.app}

## Existing App Dependencies (already installed)
${existingDeps}

## ${isTargeted ? 'Broken Files (fix these)' : 'Current File Contents'}
${brokenContents}
${relatedSummary}

## Errors Found
${errors.map(e => `- ${e}`).join('\n')}

## Instructions
${instruction}

Critical rules:
1. Every "import ... from 'package'" MUST reference a package listed in package.json
2. Cross-module import/export consistency: if file A exports X, file B must import X (not Y)
3. For package versions in package.json, use "*" — the engine resolves to latest
4. When using ESM with moduleResolution "NodeNext", include .js extensions in relative imports
5. Do NOT use overly strict tsconfig flags like noUnusedLocals, noImplicitReturns
6. Do NOT duplicate packages already installed in the target app

Output EVERY fixed file using this exact format:

===FILE: path/to/file.ext===
(file content here)
===END_FILE===

Output ONLY the files. No explanations.`;

    const raw = await callProvider(provider, model, prompt);
    const fixedFiles = parseGeneratedFiles(raw.text);

    if (fixedFiles.length === 0) {
        log('!', 'Iteration produced no files — keeping previous version');
        return { files: previousFiles, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut };
    }

    // Merge: replace fixed files into the full set, keep untouched files
    if (isTargeted) {
        const fixedMap = new Map(fixedFiles.map(f => [f.filename, f]));
        const merged = previousFiles.map(f => fixedMap.get(f.filename) || f);
        for (const f of fixedFiles) {
            if (!previousFiles.some(p => p.filename === f.filename)) {
                merged.push(f);
            }
        }
        return { files: merged, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut };
    }

    return { files: fixedFiles, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut };
}

// ─── Prompt Builders ─────────────────────────────────────

function buildAppPrompt(story: AppStory, blueprint: ProjectBlueprint, plan: BuildPlan, skillsBlock?: string): string {
    const storyBlock = formatStory(story);
    const blueprintBlock = formatBlueprint(blueprint);
    const planBlock = `## Build Plan\n- Architecture: ${plan.architecture}\n- Files to generate: ${plan.files.join(', ')}\n- Decisions: ${plan.decisions.join('; ')}`;
    const skillsSection = skillsBlock ? `\n${skillsBlock}\n` : '';

    return `You are a senior full-stack developer. Generate a complete, production-ready application based on the following story, plan, and project blueprint.

${storyBlock}

${planBlock}

${blueprintBlock}
${skillsSection}

## Requirements

1. Follow the framework and stack specified
2. Generate ALL files needed for a working application
3. Include proper TypeScript types for all models
4. The app should work out of the box with package install + dev server
5. Follow the conventions and patterns from the project blueprint if provided
6. Use modern, clean code with proper error handling
7. CRITICAL: Every plugin/preset referenced in config files (.eslintrc, jest.config, etc.) MUST be listed in package.json devDependencies
8. If using ESLint with TypeScript, you MUST include these devDependencies: eslint, @typescript-eslint/parser, @typescript-eslint/eslint-plugin
9. If using Jest with TypeScript, you MUST include these devDependencies: jest, @types/jest, ts-jest
10. Do NOT reference any package in config files that is not in package.json
11. CRITICAL: Every "import ... from 'package'" MUST reference a package that is listed in package.json dependencies or devDependencies. If you use dotenv, uuid, puppeteer, nodemailer, react, or ANY third-party package, it MUST appear in package.json.
12. CRITICAL: Cross-module import/export consistency. If file A does "import { foo } from './bar'", then bar.ts MUST export a named export called "foo". Use consistent export styles (default vs named) across all files. Every barrel/index file must re-export all symbols that other files import from it.
13. When generating tsconfig.json, do NOT enable strict flags like noUnusedLocals, noUnusedParameters, noImplicitReturns, or noFallthroughCasesInSwitch — generated code rarely satisfies these. Keep strict:true but leave the granular flags at their defaults.
14. When using ESM ("type": "module" in package.json) with moduleResolution "NodeNext" or "Node16", all relative imports MUST include the .js extension (e.g. import { foo } from './bar.js').
15. For package versions in package.json, use "*" instead of pinning specific version numbers. The engine will resolve them to the latest compatible versions automatically. Do NOT use hardcoded version numbers like "^9.4.3" — they may be outdated.

## Output Format

Output EVERY file with this exact delimiter format:

===FILE: path/to/file.ext===
(file content here)
===END_FILE===

Do NOT include any explanatory text outside of the file delimiters. Output ONLY the files.`;
}

function buildFeaturePrompt(story: FeatureStory, blueprint: ProjectBlueprint, appBlueprint?: AppIntegrationBlueprint, queueBlueprint?: QueueBuildBlueprint[], skillsBlock?: string): string {
    const blueprintBlock = formatBlueprint(blueprint);
    const depsBlock = story.dependencies?.length
        ? `\n## Required Packages\nThese packages MUST be in package.json dependencies:\n${story.dependencies.map(d => `- ${d}`).join('\n')}\n\nDo not add version numbers — use "*" and the engine will resolve to latest.`
        : '';

    // Integration context from existing app
    let integrationBlock = '';
    if (appBlueprint) {
        const parts: string[] = [];

        if (appBlueprint.packageJson) {
            const existingDeps = Object.keys({
                ...appBlueprint.packageJson.dependencies,
                ...appBlueprint.packageJson.devDependencies,
            });
            if (existingDeps.length > 0) {
                parts.push(`### Existing Dependencies (already installed)\n${existingDeps.map(d => `- ${d}`).join('\n')}\n\nDo NOT add these to your package.json — they are already available.`);
            }
            if (appBlueprint.packageJson.scripts) {
                parts.push(`### Existing Scripts\n${Object.entries(appBlueprint.packageJson.scripts).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`);
            }
        }

        if (appBlueprint.tsconfigRaw) {
            parts.push(`### tsconfig.json\n\`\`\`json\n${appBlueprint.tsconfigRaw}\n\`\`\`\n\nUse the SAME compiler options. Do NOT generate a conflicting tsconfig.`);
        }

        if (appBlueprint.fileTree.length > 0) {
            // Show at most 60 files to avoid prompt bloat
            const shownFiles = appBlueprint.fileTree.slice(0, 60);
            parts.push(`### Existing File Structure\n\`\`\`\n${shownFiles.join('\n')}${appBlueprint.fileTree.length > 60 ? `\n... and ${appBlueprint.fileTree.length - 60} more files` : ''}\n\`\`\`\n\nDo NOT create files that conflict with these existing files. Add complementary files that integrate cleanly.`);
        }

        if (appBlueprint.stack) {
            parts.push(`### Detected Stack\n- Framework: ${appBlueprint.stack.framework}\n- Package Manager: ${appBlueprint.stack.packageManager || 'npm'}\n- Language: ${appBlueprint.stack.language || 'typescript'}\n- Database: ${appBlueprint.stack.database || 'none'}`);
        }

        if (parts.length > 0) {
            integrationBlock = `\n## Existing App Blueprint (IMPORTANT — read carefully)\n\n${parts.join('\n\n')}\n`;
        }
    }

    return `You are a senior full-stack developer. Generate a new feature for an existing application.

## Feature
- Name: ${story.feature.name}
- Slug: ${story.feature.slug}
- Target App: ${story.target.app}
${depsBlock}
${integrationBlock}

${queueBlueprint && queueBlueprint.length > 0 ? `## Previously Completed Builds (CRITICAL — wire up with these)

The following stories have already been built successfully in this queue run.
Your feature MUST integrate with these — import from their files, use their types, and follow their patterns.

${queueBlueprint.map(c => `### ${c.storyFile} (${c.kind})
Generated files:
${c.generatedFiles.map(f => `- ${f}`).join('\n')}`).join('\n\n')}

IMPORTANT: These files already exist in the app. Import from them where needed. Do NOT recreate types or utilities they already export.
` : ''}

${story.model ? `## Data Model
- Collection: ${story.model.collection}
- Fields:
${story.model.fields.map(f => `  - ${f.name}: ${f.type}${f.required ? ' (required)' : ''}`).join('\n')}` : ''}

${story.pages ? `## Pages
${story.pages.map(p => `- ${p.title} (${p.type}) at /${p.slug}`).join('\n')}` : ''}

${blueprintBlock}
${skillsBlock ? `\n${skillsBlock}\n` : ''}
## Requirements
1. Every "import ... from 'package'" MUST reference a package listed in package.json
2. Cross-module import/export consistency: use consistent export styles across all files
3. For package versions in package.json, use "*" — the engine resolves to latest
4. When using ESM with moduleResolution "NodeNext", include .js extensions in relative imports
5. Your code MUST integrate with the existing app — use the same patterns, imports, and conventions

## Output Format

===FILE: path/to/file.ext===
(file content here)
===END_FILE===

Output ONLY the files. No explanations.`;
}

function formatStory(story: AppStory): string {
    const slug = storySlug(story);
    const port = storyPort(story);
    const tables = story.data?.tables || [];

    const tableDefs = tables.map(t => {
        const fields = Object.entries(t.fields)
            .map(([name, def]) => `      ${name}: ${def.type}${def.required ? ' (required)' : ''}${def.default !== undefined ? ` [default: ${def.default}]` : ''}`)
            .join('\n');
        return `    - ${t.name}\n${fields}`;
    }).join('\n');

    const layoutInfo = story.layout
        ? `- Sidebar: ${story.layout.sidebar ? 'yes' : 'no'}\n- Topbar: ${story.layout.topbar ? 'yes' : 'no'}`
        : '- Include a navigation sidebar';

    const authInfo = story.auth
        ? `- Auth provider: ${story.auth.provider}\n- Methods: ${Object.entries(story.auth.methods || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'email'}`
        : '- No auth required';

    const depsInfo = story.dependencies?.length
        ? `### Required Packages\n${story.dependencies.map(d => `- ${d}`).join('\n')}\n\nThese packages MUST be included in package.json. Do not add version numbers — use "*" and the engine will resolve to latest.`
        : '';

    return `## Application Story

- **Name**: ${story.appName}
- **Slug**: ${slug}
- **Description**: ${story.description}
- **Port**: ${port}

### Stack
- Framework: ${story.stack.framework}
- Package Manager: ${story.stack.packageManager || 'npm'}
- Language: ${story.stack.language || 'typescript'}
- Database: ${story.stack.database || 'none'}
- Cloud: ${story.stack.cloud || 'none'}

### Frontend
- UI: ${story.frontend?.ui || 'tailwind'}
- Theme: ${story.frontend?.theme || 'light'}

### Layout
${layoutInfo}

### Authentication
${authInfo}

${depsInfo}

### Data Model
${tableDefs || '    No tables defined — use in-memory state.'}`;
}

function formatBlueprint(blueprint: ProjectBlueprint): string {
    if (blueprint.knowledgeFiles.length === 0 && blueprint.conventions.length === 0) {
        return '';
    }

    let block = '## Project Blueprint\n\n';

    if (blueprint.stack) {
        block += `### Stack: ${blueprint.stack.framework}, ${blueprint.stack.packageManager || 'npm'}\n\n`;
    }

    if (blueprint.conventions.length > 0) {
        block += '### Conventions\n\n';
        for (const conv of blueprint.conventions) {
            block += conv + '\n\n';
        }
    }

    if (blueprint.knowledgeFiles.length > 0) {
        block += '### Existing App Knowledge\n\n';
        for (const kf of blueprint.knowledgeFiles) {
            block += `#### ${kf.app} (${kf.filename})\n\n${kf.content}\n\n`;
        }
    }

    return block;
}

// ─── Provider Calls ──────────────────────────────────────

export function requireActiveProvider(): { provider: LLMProvider; model: string } {
    const settings = loadSettings();
    if (!settings.activeProvider || !settings.buildModel) {
        throw new Error(
            'No active model set.\n' +
            'Go to Settings → enable a provider → click "Set as Default".'
        );
    }
    const provider = getActiveProvider(settings);
    if (!provider) {
        throw new Error(`Provider "${settings.activeProvider}" is not enabled.`);
    }
    return { provider, model: settings.buildModel };
}

export async function callProvider(provider: LLMProvider, model: string, prompt: string): Promise<LLMResponse> {
    // Determine the effective kind: treat missing/undefined kind as 'builtin' (legacy)
    const kind = provider.kind || 'builtin';
    
    // Built-in providers
    if (kind === 'builtin') {
        switch (provider.id) {
            case 'gemini':
                if (!provider.apiKey) throw new Error('Gemini API key not configured');
                return callGemini(provider.apiKey, model, prompt);
            case 'openai':
                return callOpenAI(provider.apiKey || '', model, prompt, provider.baseUrl);
            case 'ollama':
                return callOllama(provider.baseUrl || 'http://localhost:11434', model, prompt);
            default:
                throw new Error(`Unknown built-in provider: ${provider.id}`);
        }
    }
    // OpenAI-compatible custom providers
    if (kind === 'openai-compat') {
        if (!provider.baseUrl) throw new Error('Custom OpenAI provider needs a baseUrl');
        return callOpenAI(provider.apiKey || '', model, prompt, provider.baseUrl);
    }
    throw new Error(`Unknown provider kind: ${kind} (id: ${provider.id})`);
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<LLMResponse> {
    log('→', `Calling Gemini (${model})...`);

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 65536, temperature: 0.2 },
            }),
        }
    );

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned empty response');

    const usage = data.usageMetadata;
    const tokensIn = usage?.promptTokenCount || 0;
    const tokensOut = usage?.candidatesTokenCount || 0;
    if (usage) {
        log('  ', `  Tokens: ${tokensIn} in / ${tokensOut} out`);
    }

    return { text, tokensIn, tokensOut };
}

async function callOpenAI(apiKey: string, model: string, prompt: string, baseUrl?: string): Promise<LLMResponse> {
    log('→', `Calling OpenAI (${model})...`);

    const url = baseUrl ? `${baseUrl}/chat/completions` : 'https://api.openai.com/v1/chat/completions';
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: 'You are a senior full-stack developer who generates complete, working code. Output only file contents in the exact format requested.' },
                { role: 'user', content: prompt },
            ],
            max_tokens: 16384,
            temperature: 0.2,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI API error (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenAI returned empty response');

    const usage = data.usage;
    const tokensIn = usage?.prompt_tokens || 0;
    const tokensOut = usage?.completion_tokens || 0;
    if (usage) {
        log('  ', `  Tokens: ${tokensIn} in / ${tokensOut} out`);
    }

    return { text, tokensIn, tokensOut };
}

const OLLAMA_FALLBACK_MODEL = 'glm-4.7-flash';

async function callOllama(baseUrl: string, model: string, prompt: string): Promise<LLMResponse> {
    // Try primary model first, then fallback if all retries fail
    try {
        return await ollamaFetchWithRetry(baseUrl, model, prompt);
    } catch (primaryErr: any) {
        if (model !== OLLAMA_FALLBACK_MODEL) {
            log('⚠', `Primary model ${model} failed: ${primaryErr.message}`);
            log('→', `Falling back to ${OLLAMA_FALLBACK_MODEL}...`);
            try {
                return await ollamaFetchWithRetry(baseUrl, OLLAMA_FALLBACK_MODEL, prompt);
            } catch (fallbackErr: any) {
                throw new Error(`Both ${model} and fallback ${OLLAMA_FALLBACK_MODEL} failed. Last error: ${fallbackErr.message}`);
            }
        }
        throw primaryErr;
    }
}

async function ollamaFetchWithRetry(baseUrl: string, model: string, prompt: string): Promise<LLMResponse> {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        log('→', `Calling Ollama (${model}) at ${baseUrl}...${attempt > 1 ? ` (retry ${attempt}/${MAX_ATTEMPTS})` : ''}`);

        // 10-minute timeout — large prompts can take several minutes
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

        try {
            const res = await fetch(`${baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    prompt,
                    stream: false,
                    keep_alive: '30m',
                    options: { temperature: 0.2, num_predict: 16384, num_ctx: 8192 },
                }),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) {
                const body = await res.text();
                throw new Error(`Ollama error (${res.status}): ${body.slice(0, 300)}`);
            }

            const data = await res.json();
            const text = data.response;
            if (!text) throw new Error('Ollama returned empty response');

            const tokensIn = data.prompt_eval_count || 0;
            const tokensOut = data.eval_count || 0;
            if (tokensOut) {
                log('  ', `  Tokens: ${tokensIn} in / ${tokensOut} out`);
            }

            return { text, tokensIn, tokensOut };
        } catch (err: any) {
            clearTimeout(timeout);

            const msg = (err?.message || String(err)).toLowerCase();
            const isTransient =
                msg.includes('fetch failed') ||
                msg.includes('econnrefused') ||
                msg.includes('etimedout') ||
                msg.includes('econnreset') ||
                msg.includes('socket hang up') ||
                msg.includes('aborted') ||
                msg.includes('network error');

            if (isTransient && attempt < MAX_ATTEMPTS) {
                const delaySec = attempt * 5;
                log('⚠', `Transient error: ${err.message} — retrying in ${delaySec}s...`);
                await new Promise(r => setTimeout(r, delaySec * 1000));
                continue;
            }

            // Not transient or out of retries
            throw err;
        }
    }

    throw new Error(`Ollama (${model}): all ${MAX_ATTEMPTS} retry attempts exhausted`);
}

// ─── Response Parser ─────────────────────────────────────

/** Parse ===FILE: path=== ... ===END_FILE=== blocks from LLM output */
export function parseGeneratedFiles(raw: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const regex = /===FILE:\s*(.+?)===\n([\s\S]*?)===END_FILE===/g;
    let match;

    while ((match = regex.exec(raw)) !== null) {
        const filename = match[1].trim();
        let content = match[2];

        // Remove trailing newline before END_FILE
        if (content.endsWith('\n')) {
            content = content.slice(0, -1);
        }

        // Strip markdown code fences that LLMs sometimes wrap around file content
        // e.g. ```typescript\n...\n``` or ```json\n...\n```
        content = content.replace(/^```\w*\s*\n/, '').replace(/\n```\s*$/, '');

        files.push({ filename, content });
    }

    if (files.length === 0) {
        // Fallback: try code blocks with file paths
        const codeBlockRegex = /```(?:\w+)?\n\/\/\s*(.+?)\n([\s\S]*?)```/g;
        while ((match = codeBlockRegex.exec(raw)) !== null) {
            files.push({
                filename: match[1].trim(),
                content: match[2].trim(),
            });
        }
    }

    return files;
}

// ─── Tool-Calling Loop (us_012 + us_013) ─────────────────

import { TOOL_DEFINITIONS, executeTool, type BuildToolBlueprint, type ToolResult } from './build-tools.ts';
import { readToonFile, parseToonSkillIndex } from './toon.ts';

/**
 * Build the system prompt for the tool-calling LLM session.
 * Includes target dir, workflow, rules, TOON context, skills, and app integration context.
 */
export function buildToolSystemPrompt(
    story: AppStory | FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    appBlueprint?: AppIntegrationBlueprint,
): string {
    const isApp = 'appName' in story;
    const storyBlock = isApp ? formatStory(story as AppStory) : formatFeatureStory(story as FeatureStory);

    const toonBlueprint = blueprint.toonSnapshot
        ? `\n## Project Blueprint (TOON)\n\`\`\`toon\n${blueprint.toonSnapshot}\n\`\`\`\n`
        : '';

    const skillsBlock = blueprint.projectSkills && blueprint.projectSkills.length > 0
        ? `\n## Project Skills\n${blueprint.projectSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')}\n`
        : '';

    let appBlueprintBlock = '';
    if (appBlueprint) {
        const parts: string[] = [];
        if (appBlueprint.packageJson) {
            const deps = Object.keys({
                ...appBlueprint.packageJson.dependencies,
                ...appBlueprint.packageJson.devDependencies,
            });
            if (deps.length > 0) {
                parts.push(`### Existing Dependencies (do NOT add to package.json)\n${deps.map(d => `- ${d}`).join('\n')}`);
            }
            if (appBlueprint.packageJson.scripts) {
                parts.push(`### NPM Scripts\n${Object.entries(appBlueprint.packageJson.scripts).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`);
            }
        }
        if (appBlueprint.tsconfigRaw) {
            parts.push(`### tsconfig.json (use the SAME options)\n\`\`\`json\n${appBlueprint.tsconfigRaw}\n\`\`\``);
        }
        if (appBlueprint.fileTree.length > 0) {
            const shown = appBlueprint.fileTree.slice(0, 80);
            const more = appBlueprint.fileTree.length > 80 ? `\n... and ${appBlueprint.fileTree.length - 80} more` : '';
            parts.push(`### Existing Files (do NOT recreate)\n\`\`\`\n${shown.join('\n')}${more}\n\`\`\``);
        }
        if (parts.length > 0) {
            appBlueprintBlock = `\n## Existing App Integration Blueprint\n${parts.join('\n\n')}\n`;
        }
    }

    return `You are an autonomous code generation engine with access to tools for reading, writing, and executing commands.

## Target Directory
${targetDir}

## Recommended Workflow
1. Call read_story to fully understand the build requirements.
2. Call list_dir(recursive=true) to explore what already exists.
3. Read key files with read_blueprint(type='package_json') and read_blueprint(type='tsconfig').
4. Write files using write_file. Use patch_file for targeted edits to existing files.
5. Call run_command to install deps (e.g. npm install) and type-check (npx tsc --noEmit).
6. Fix any errors using patch_file or write_file, then re-run checks.
7. When all checks pass, call mark_complete with a clear summary.
8. If you cannot proceed after exhausting all fixes, call mark_failed with the reason.

## Rules
1. Always call read_file before modifying — never assume a file's current contents.
2. Generate production-ready code — no placeholders, no TODOs, no stubs.
3. Every import from a package must exist in package.json.
4. Match the coding style and patterns from the story and existing code.
5. Use log_step(info/warn/error) to track progress.
6. Only call mark_failed after genuinely exhausting all remediation options.
${storyBlock}
${toonBlueprint}${skillsBlock}${appBlueprintBlock}
## Available Tools
${TOOL_DEFINITIONS.map(t => `- **${t.name}**: ${t.description}`).join('\n')}

Call mark_complete when the build is verified and complete.`;
}


/**
 * Run a tool-calling LLM session.
 * Max 30 turns. Token guard trims context at turn 20. Wall-clock timeout: 20 min.
 */
export async function runToolSession(
    story: AppStory | FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
    appBlueprint?: AppIntegrationBlueprint,
): Promise<BuildResult> {
    const { provider, model } = requireActiveProvider();
    const systemPrompt = buildToolSystemPrompt(story, blueprint, targetDir, appBlueprint);

    const ctx: BuildToolBlueprint = {
        targetDir,
        storyFile,
        terminal: false,
        success: false,
        generatedFiles: new Map(),
        logs: [],
        contextData: {
            conventions: blueprint.conventions.length > 0 ? blueprint.conventions.join('\n\n') : undefined,
            knowledge: blueprint.knowledgeFiles.length > 0
                ? blueprint.knowledgeFiles.map(k => `### ${k.app} (${k.filename})\n${k.content}`).join('\n\n')
                : undefined,
        },
    };

    const messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
        { role: 'system', content: systemPrompt },
        // Bootstrap: orient the LLM to start immediately without waiting
        {
            role: 'user',
            content: 'Begin by calling read_story to understand the requirements, then list_dir(recursive=true) to explore the target directory. Write files, validate with run_command, and call mark_complete when done.',
        },
    ];

    const MAX_TURNS = 30;
    const TOKEN_GUARD_AT = 20;
    const KEEP_LAST = 15;
    const SESSION_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
    const sessionStart = Date.now();
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    for (let turn = 0; turn < MAX_TURNS && !ctx.terminal; turn++) {
        // Wall-clock session timeout guard
        if (Date.now() - sessionStart > SESSION_TIMEOUT_MS) {
            const elapsedMin = Math.round((Date.now() - sessionStart) / 60_000);
            logError(`Tool session timed out after ${elapsedMin} min`);
            ctx.logs.push({ level: 'error', message: `Session timed out after ${elapsedMin} min` });
            break;
        }

        // Token guard: keep system + bootstrap user + last KEEP_LAST messages to avoid context overflow
        if (messages.length >= TOKEN_GUARD_AT) {
            const keep = messages.slice(0, 2).concat(messages.slice(-KEEP_LAST));
            messages.length = 0;
            messages.push(...keep);
        }

        log('●', `Turn ${turn + 1}/${MAX_TURNS} — calling LLM...`);

        const response = await callProviderWithTools(provider, model, messages, TOOL_DEFINITIONS);
        totalTokensIn += response.tokensIn;
        totalTokensOut += response.tokensOut;

        const toolCalls = response.toolCalls || [];

        if (toolCalls.length === 0) {
            // LLM returned text with no tool calls — session ended without a terminal call
            messages.push({ role: 'assistant', content: response.text });
            if (!ctx.terminal) {
                log('!', 'LLM returned no tool calls — session ended without mark_complete or mark_failed');
                ctx.logs.push({ level: 'warn', message: 'Session ended without a terminal tool call' });
            }
            break;
        }

        messages.push({ role: 'assistant', content: response.text, tool_calls: toolCalls });

        // Execute each tool call sequentially
        for (const tc of toolCalls) {
            const result = await executeTool(tc.function.name, tc.function.arguments, ctx);
            messages.push({
                role: 'tool',
                content: result.content,
                tool_call_id: tc.id,
            });
            if (result.isError) {
                ctx.logs.push({ level: 'error', message: `[${tc.function.name}] ${result.content}` });
            } else {
                ctx.logs.push({ level: 'info', message: result.content });
            }
        }

        if (ctx.terminal) break;
    }

    // Max-turns exhaustion without a terminal call
    if (!ctx.terminal) {
        logError(`Tool session exhausted all ${MAX_TURNS} turns without calling mark_complete or mark_failed`);
        ctx.logs.push({ level: 'error', message: `Exceeded max turns (${MAX_TURNS}) without completing` });
    }

    // Normalize file paths — strip targetDir prefix so filenames are relative
    const targetPrefix = targetDir.endsWith('/') ? targetDir : targetDir + '/';
    const files = Array.from(ctx.generatedFiles.entries()).map(([absPath, content]) => {
        const filename = absPath.startsWith(targetPrefix)
            ? absPath.slice(targetPrefix.length)
            : absPath.startsWith(targetDir)
            ? absPath.slice(targetDir.length)
            : absPath;
        return { filename, content };
    });

    // Use ctx.success — set exclusively by mark_complete, not a heuristic
    const success = ctx.success;
    const errors = ctx.logs.filter(l => l.level === 'error').map(l => l.message);

    return {
        success,
        files,
        plan: {
            files: files.map(f => f.filename),
            architecture: isAppStory(story) ? story.appName : (story as FeatureStory).feature.name,
            decisions: ['engine:tool-calling'],
        },
        iterations: 1,
        errors: errors.length > 0 ? errors : undefined,
        tokenUsage: { promptTokens: totalTokensIn, completionTokens: totalTokensOut },
        model,
        provider: provider.id,
    };
}



function isAppStory(story: AppStory | FeatureStory): story is AppStory {
    return 'appName' in story;
}

export type ToolCallResult = Array<{ id: string; function: { name: string; arguments: Record<string, unknown> } }>;
export type ToolResponse = LLMResponse & { toolCalls?: ToolCallResult };
export type ToolMessages = Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }>;

/**
 * Route tool-calling to the correct provider implementation.
 * Supports: Gemini (native function calling), Ollama (/api/chat), OpenAI-compat (everything else).
 */
export async function callProviderWithTools(
    provider: LLMProvider,
    model: string,
    messages: ToolMessages,
    tools: typeof TOOL_DEFINITIONS,
): Promise<ToolResponse> {
    const kind = provider.kind || 'builtin';

    if (kind === 'builtin') {
        if (provider.id === 'gemini') {
            if (!provider.apiKey) throw new Error('Gemini API key not configured');
            return callGeminiWithTools(provider.apiKey, model, messages, tools);
        }
        if (provider.id === 'ollama') {
            return callOllamaWithTools(provider.baseUrl || 'http://localhost:11434', model, messages, tools);
        }
        // 'openai' built-in falls through to OpenAI-compat
    }

    const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
    return callOpenAICompatWithTools(provider.apiKey || '', model, messages, tools, baseUrl);
}

/** Robust regex-based XML/tag tool-calling parser for Qwen and other local LLMs */
function parseXmlToolCalls(content: string): ToolCallResult {
    const toolCalls: ToolCallResult = [];

    // Pattern 1: <tool_call>JSON</tool_call>
    const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let match;
    while ((match = toolCallRegex.exec(content)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            if (parsed.name) {
                toolCalls.push({
                    id: `xml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    function: {
                        name: parsed.name,
                        arguments: parsed.arguments || parsed.args || {}
                    }
                });
            } else if (parsed.function) {
                toolCalls.push({
                    id: `xml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    function: {
                        name: parsed.function.name,
                        arguments: parsed.function.arguments || {}
                    }
                });
            }
        } catch {
            // Not valid JSON, ignore
        }
    }
    if (toolCalls.length > 0) return toolCalls;

    // Pattern 2: <invoke name="tool_name">...params...</invoke> or <invoke>tool_name</invoke>
    const invokeRegex = /<invoke(?:\s+name="([^"]+)")?>([\s\S]*?)<\/invoke>/g;
    while ((match = invokeRegex.exec(content)) !== null) {
        let name = match[1]?.trim() || '';
        const body = match[2]?.trim() || '';

        if (!name) {
            // Maybe <invoke>tool_name</invoke> or tool_name is the first line of body
            const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length > 0 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(lines[0])) {
                name = lines[0];
            }
        }

        if (name) {
            const args = parseArgsFromBody(body);
            toolCalls.push({
                id: `xml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                function: { name, arguments: args }
            });
        }
    }
    if (toolCalls.length > 0) return toolCalls;

    // Pattern 3: <function=tool_name>...params...</function>
    const functionRegex = /<function=([a-zA-Z_][a-zA-Z0-9_]*)>([\s\S]*?)<\/function>/g;
    while ((match = functionRegex.exec(content)) !== null) {
        const name = match[1];
        const body = match[2].trim();
        const args = parseArgsFromBody(body);
        toolCalls.push({
            id: `xml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            function: { name, arguments: args }
        });
    }
    if (toolCalls.length > 0) return toolCalls;

    // Pattern 4: <invoke:tool_name>...params...</invoke:tool_name>
    const invokeColonRegex = /<invoke:([a-zA-Z_][a-zA-Z0-9_]*)>([\s\S]*?)<\/invoke:\1>/g;
    while ((match = invokeColonRegex.exec(content)) !== null) {
        const name = match[1];
        const body = match[2].trim();
        const args = parseArgsFromBody(body);
        toolCalls.push({
            id: `xml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            function: { name, arguments: args }
        });
    }
    if (toolCalls.length > 0) return toolCalls;

    // Pattern 5: Simple <invoke>tool_name</invoke> without body or matching invoke tags
    const simpleInvokeRegex = /<invoke>([a-zA-Z_][a-zA-Z0-9_]*)<\/invoke>/g;
    while ((match = simpleInvokeRegex.exec(content)) !== null) {
        const name = match[1];
        toolCalls.push({
            id: `xml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            function: { name, arguments: {} }
        });
    }

    return toolCalls;
}

function parseArgsFromBody(body: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    // Check if body itself is JSON
    try {
        const parsed = JSON.parse(body);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
    } catch {}

    // Check for <parameter name="param_name">value</parameter>
    const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
    let match;
    let foundParams = false;
    while ((match = paramRegex.exec(body)) !== null) {
        args[match[1]] = match[2].trim();
        foundParams = true;
    }
    if (foundParams) return args;

    // Check for custom tags like <param_name>value</param_name>
    const tagRegex = /<([a-zA-Z_][a-zA-Z0-9_]*)>([\s\S]*?)<\/\1>/g;
    while ((match = tagRegex.exec(body)) !== null) {
        args[match[1]] = match[2].trim();
    }
    
    return args;
}

/** OpenAI-compatible tool-calling with retry on transient errors and guarded JSON.parse */
async function callOpenAICompatWithTools(
    apiKey: string,
    model: string,
    messages: ToolMessages,
    tools: typeof TOOL_DEFINITIONS,
    baseUrl: string,
): Promise<ToolResponse> {
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const apiMessages = messages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
            ...(m.tool_calls ? {
                tool_calls: m.tool_calls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.function.name,
                        arguments: typeof tc.function.arguments === 'string'
                            ? tc.function.arguments
                            : JSON.stringify(tc.function.arguments),
                    },
                }))
            } : {}),
        }));

        let res: Response;
        try {
            res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
                },
                body: JSON.stringify({
                    model,
                    messages: apiMessages,
                    tools: tools.map(t => ({
                        type: 'function',
                        function: { name: t.name, description: t.description, parameters: t.parameters },
                    })),
                    temperature: 0.2,
                    max_tokens: 16384,
                }),
            });
        } catch (networkErr) {
            if (attempt < MAX_RETRIES) { await sleep(attempt * 2000); continue; }
            throw networkErr;
        }

        // Retry on rate-limit or server errors
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
            const wait = parseInt(res.headers.get('retry-after') || '0') * 1000 || attempt * 2000;
            await sleep(wait);
            continue;
        }

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Provider error (${res.status}): ${body.slice(0, 300)}`);
        }

        const data = await res.json();
        const choice = data.choices?.[0];
        if (!choice) throw new Error('Provider returned no choices');

        const text = choice.message?.content || '';
        let toolCalls: ToolCallResult = (choice.message?.tool_calls || []).map((tc: any) => {
            let parsedArgs: Record<string, unknown> = {};
            try {
                const raw = tc.function?.arguments;
                parsedArgs = typeof raw === 'object' && raw !== null ? raw : JSON.parse(raw || '{}');
            } catch { parsedArgs = {}; }
            return {
                id: tc.id || `tc-${Date.now()}`,
                function: { name: tc.function?.name || '', arguments: parsedArgs },
            };
        });

        // Fallback or enrichment for Qwen/local LLMs XML-style tool invocation
        if (text) {
            const parsedXmlCalls = parseXmlToolCalls(text);
            if (parsedXmlCalls.length > 0) {
                if (toolCalls.length === 0) {
                    log('●', `Parsed ${parsedXmlCalls.length} XML tool call(s) from content`);
                    toolCalls = parsedXmlCalls;
                } else {
                    const nameCounts = new Map<string, number>();
                    for (const tc of toolCalls) {
                        const name = tc.function.name;
                        if (Object.keys(tc.function.arguments).length === 0) {
                            const count = nameCounts.get(name) || 0;
                            nameCounts.set(name, count + 1);

                            const matchingXmlCalls = parsedXmlCalls.filter(x => x.function.name === name);
                            if (matchingXmlCalls[count] && Object.keys(matchingXmlCalls[count].function.arguments).length > 0) {
                                log('●', `Enriched XML arguments for tool "${name}" from content`);
                                tc.function.arguments = matchingXmlCalls[count].function.arguments;
                            }
                        }
                    }
                }
            }
        }

        return {
            text,
            tokensIn: data.usage?.prompt_tokens || 0,
            tokensOut: data.usage?.completion_tokens || 0,
            toolCalls,
        };
    }

    throw new Error(`Provider: all ${MAX_RETRIES} retry attempts exhausted`);
}

/** Gemini-native tool-calling — converts OpenAI message format to Gemini contents format */
async function callGeminiWithTools(
    apiKey: string,
    model: string,
    messages: ToolMessages,
    tools: typeof TOOL_DEFINITIONS,
): Promise<ToolResponse> {
    const toolCallNameMap = new Map<string, string>(); // tool_call_id → function name
    let systemInstruction: string | undefined;
    const contents: Array<{ role: 'user' | 'model'; parts: any[] }> = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction = msg.content;
            continue;
        }
        if (msg.role === 'user') {
            const prev = contents[contents.length - 1];
            if (prev?.role === 'user' && prev.parts.every((p: any) => p.text !== undefined)) {
                prev.parts.push({ text: msg.content });
            } else {
                contents.push({ role: 'user', parts: [{ text: msg.content }] });
            }
            continue;
        }
        if (msg.role === 'assistant') {
            const parts: any[] = [];
            if (msg.content) parts.push({ text: msg.content });
            for (const tc of (msg.tool_calls || [])) {
                toolCallNameMap.set(tc.id, tc.function.name);
                parts.push({ functionCall: { name: tc.function.name, args: tc.function.arguments } });
            }
            if (parts.length > 0) contents.push({ role: 'model', parts });
            continue;
        }
        if (msg.role === 'tool') {
            const funcName = toolCallNameMap.get(msg.tool_call_id || '') || 'unknown_function';
            const responsePart = {
                functionResponse: { name: funcName, response: { content: msg.content } },
            };
            const prev = contents[contents.length - 1];
            if (prev?.role === 'user' && prev.parts.some((p: any) => p.functionResponse)) {
                prev.parts.push(responsePart);
            } else {
                contents.push({ role: 'user', parts: [responsePart] });
            }
            continue;
        }
    }

    const body: Record<string, unknown> = {
        contents,
        tools: [{
            functionDeclarations: tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            })),
        }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
    };
    if (systemInstruction) {
        body.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Gemini tool call error (${res.status}): ${txt.slice(0, 300)}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('Gemini returned no candidates');

    const parts: any[] = candidate.content?.parts || [];
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text as string).join('');
    const toolCalls: ToolCallResult = parts
        .filter((p: any) => p.functionCall)
        .map((p: any, i: number) => ({
            id: `gemini-${Date.now()}-${i}`,
            function: {
                name: p.functionCall.name as string,
                arguments: (p.functionCall.args || {}) as Record<string, unknown>,
            },
        }));

    return {
        text,
        tokensIn: data.usageMetadata?.promptTokenCount || 0,
        tokensOut: data.usageMetadata?.candidatesTokenCount || 0,
        toolCalls,
    };
}

/** Ollama tool-calling via /api/chat endpoint (requires a model that supports tools, e.g. llama3.1) */
async function callOllamaWithTools(
    baseUrl: string,
    model: string,
    messages: ToolMessages,
    tools: typeof TOOL_DEFINITIONS,
): Promise<ToolResponse> {
    const apiMessages = messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls ? {
            tool_calls: m.tool_calls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.function.name,
                    arguments: typeof tc.function.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function.arguments),
                },
            }))
        } : {}),
    }));

    const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: apiMessages,
            tools: tools.map(t => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            stream: false,
            options: { temperature: 0.2 },
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Ollama tool call error (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const message = data.message;
    const text = message?.content || '';
    let toolCalls: ToolCallResult = (message?.tool_calls || []).map((tc: any, i: number) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
            const raw = tc.function?.arguments;
            parsedArgs = typeof raw === 'object' && raw !== null ? raw : JSON.parse(raw || '{}');
        } catch { parsedArgs = {}; }
        return {
            id: tc.id || `ollama-${Date.now()}-${i}`,
            function: { name: tc.function?.name || '', arguments: parsedArgs },
        };
    });

    // Fallback or enrichment for Qwen/local LLMs XML-style tool invocation
    if (text) {
        const parsedXmlCalls = parseXmlToolCalls(text);
        if (parsedXmlCalls.length > 0) {
            if (toolCalls.length === 0) {
                log('●', `Parsed ${parsedXmlCalls.length} XML tool call(s) from content`);
                toolCalls = parsedXmlCalls;
            } else {
                const nameCounts = new Map<string, number>();
                for (const tc of toolCalls) {
                    const name = tc.function.name;
                    if (Object.keys(tc.function.arguments).length === 0) {
                        const count = nameCounts.get(name) || 0;
                        nameCounts.set(name, count + 1);

                        const matchingXmlCalls = parsedXmlCalls.filter(x => x.function.name === name);
                        if (matchingXmlCalls[count] && Object.keys(matchingXmlCalls[count].function.arguments).length > 0) {
                            log('●', `Enriched XML arguments for tool "${name}" from content`);
                            tc.function.arguments = matchingXmlCalls[count].function.arguments;
                        }
                    }
                }
            }
        }
    }

    return {
        text,
        tokensIn: data.prompt_eval_count || 0,
        tokensOut: data.eval_count || 0,
        toolCalls,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}



function formatFeatureStory(story: FeatureStory): string {
    return `## Feature Story

- **Name**: ${story.feature.name}
- **Slug**: ${story.feature.slug}
- **Target App**: ${story.target.app}
- **Phase**: ${story.phase || 'unspecified'}
${story.dependsOn?.length ? `- **Depends on**: ${story.dependsOn.join(', ')}` : ''}
${story.dependencies?.length ? `\n### Required Packages\n${story.dependencies.map(d => `- ${d}`).join('\n')}` : ''}`;
}
