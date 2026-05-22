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
    FactorySettings,
} from './types.ts';
import type { QueueBuildBlueprint } from './blueprint.ts';
import { classifyTask, classifyFeatureTask } from './task-classifier.ts';
import { storySlug, storyPort } from './types.ts';
import { loadSettings, getActiveProvider } from './config.ts';
import { gatherAppBlueprint, loadQueueBlueprint } from './blueprint.ts';
import { log, logStep, logError } from './log.ts';
import { resolveSkillsForBuild, formatSkillsForPrompt, seedDefaultSkills } from './skills.ts';
import { parse as parseYaml } from 'yaml';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

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

import { mkdtempSync, writeFileSync as fsWrite, readFileSync as fsRead, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execSync, spawn as cpSpawn, spawnSync } from 'node:child_process';
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
    let defaultCli: string | undefined;
    let settings: FactorySettings | null = null;

    try {
        settings = loadSettings();
        defaultCli = settings.defaultCli;
    } catch {
        // settings.json missing or malformed
    }

    // If a defaultCli is explicitly set, use it FIRST — CLIs take priority
    if (defaultCli) {
        const r = spawnSync('which', [defaultCli], { encoding: 'utf8', timeout: 3000 });
        if (r.status === 0 && r.stdout.trim()) {
            log('→', `Using CLI: ${defaultCli}`);
            const cliProvider: LLMProvider = {
                id: defaultCli,
                name: `${defaultCli} CLI`,
                kind: 'cli',
                enabled: true,
                models: [{ id: 'default', name: 'default' }],
            };
            return { provider: cliProvider, model: 'default' };
        }
        log('!', `Configured CLI "${defaultCli}" not found in PATH — falling back to API provider`);
    }

    // Try API provider next
    if (settings?.activeProvider && settings?.buildModel) {
        const provider = getActiveProvider(settings);
        if (provider) return { provider, model: settings.buildModel };
    }

    // Last resort: auto-detect any installed CLI
    const ALL_CLI_CANDIDATES = ['gemini', 'claude', 'pi', 'agy'] as const;
    for (const bin of ALL_CLI_CANDIDATES) {
        if (bin === defaultCli) continue; // already tried above
        try {
            const r = spawnSync('which', [bin], { encoding: 'utf8', timeout: 3000 });
            if (r.status === 0 && r.stdout.trim()) {
                log('→', `No API provider configured — using installed CLI: ${bin}`);
                const cliProvider: LLMProvider = {
                    id: bin,
                    name: `${bin} CLI`,
                    kind: 'cli',
                    enabled: true,
                    models: [{ id: 'default', name: 'default' }],
                };
                return { provider: cliProvider, model: 'default' };
            }
        } catch { /* try next */ }
    }

    throw new Error(
        'No LLM provider available.\n' +
        'Either configure an API provider in Settings, or install one of: gemini, claude, pi, agy'
    );
}

export async function callProvider(provider: LLMProvider, model: string, prompt: string): Promise<LLMResponse> {
    // Determine the effective kind: treat missing/undefined kind as 'builtin' (legacy)
    const kind = provider.kind || 'builtin';

    // CLI provider — pipe prompt to installed CLI binary
    if (kind === 'cli') {
        return callCLISimple(provider.id, prompt);
    }

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

import { TOOL_DEFINITIONS, executeTool, getDynamicMcpTools, type BuildToolBlueprint, type ToolResult } from './build-tools.ts';
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
    storyFile?: string,
): string {
    const isApp = 'appName' in story;
    const storyBlock = isApp ? formatStory(story as AppStory) : formatFeatureStory(story as FeatureStory);

    let roadmapBlock = '';
    try {
        const appYamlPath = resolve(blueprint.repoPath, '.factory', 'app.yaml');
        if (existsSync(appYamlPath)) {
            const raw = readFileSync(appYamlPath, 'utf-8');
            const appSpec = parseYaml(raw) as any;
            if (appSpec) {
                let brdContent = appSpec.brd || '';
                // If brd is a markdown file path, attempt to load its content
                if (brdContent && brdContent.endsWith('.md')) {
                    const possibleBrdPaths = [
                        resolve(blueprint.repoPath, brdContent),
                        resolve(blueprint.repoPath, '.factory', brdContent),
                        resolve(blueprint.repoPath, '.factory', 'specs', brdContent)
                    ];
                    for (const p of possibleBrdPaths) {
                        if (existsSync(p)) {
                            try {
                                brdContent = readFileSync(p, 'utf-8');
                                break;
                            } catch {}
                        }
                    }
                }

                let matchingFeature: any = null;
                const targetStoryFile = storyFile ? basename(storyFile) : '';
                if (targetStoryFile && appSpec.features) {
                    for (const f of appSpec.features) {
                        if (f.stories) {
                            for (const s of f.stories) {
                                if (s.file && basename(s.file) === targetStoryFile) {
                                    matchingFeature = f;
                                    break;
                                }
                            }
                        }
                        if (matchingFeature) break;
                    }
                }

                if (!matchingFeature && appSpec.features) {
                    const sName = isApp ? (story as AppStory).appName : (story as FeatureStory).feature?.name;
                    if (sName) {
                        for (const f of appSpec.features) {
                            if (f.stories && f.stories.some((s: any) => s.name === sName)) {
                                matchingFeature = f;
                                break;
                            }
                        }
                    }
                }

                roadmapBlock = `\n## Project Roadmap & Requirements (App-level Context)
Application: ${appSpec.name} (v${appSpec.version})
Description: ${appSpec.description}

### Business Requirements Document (BRD)
${brdContent || 'No business requirements document specified.'}
`;

                if (matchingFeature) {
                    roadmapBlock += `
### Active Feature Epic Context
You are currently building a story for the Feature Epic: **${matchingFeature.name}**
Feature Epic Description: ${matchingFeature.description || 'No description provided.'}
`;
                }
            }
        }
    } catch (e: any) {
        log('!', `Warning: Could not inject App Roadmap context: ${e?.message || e}`);
    }

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

    let isNativeTools = false;
    try {
        const { provider } = requireActiveProvider();
        if (provider) {
            isNativeTools = provider.id === 'gemini' || provider.id === 'openai' || provider.kind === 'openai-compat';
        }
    } catch {}

    const toolCallingBlock = isNativeTools
        ? `## Tool Calling Format
You MUST invoke tools using the native function-calling interface provided by the model environment. Do NOT wrap tool calls in XML tags, markdown code blocks, or custom text format.
Always provide the exact arguments required by each tool's schema, such as "path" and "content" for write_file/patch_file (do NOT use "filename", use "path").`
        : `## Tool Calling Format
You MUST invoke tools using this XML format:
<tool_call>{"name": "tool_name", "arguments": {"arg1": "val1"}}</tool_call>

For example, to read the story:
<tool_call>{"name": "read_story", "arguments": {}}</tool_call>

To list directory contents:
<tool_call>{"name": "list_dir", "arguments": {"recursive": true}}</tool_call>

To write a file:
<tool_call>{"name": "write_file", "arguments": {"path": "src/app.ts", "content": "console.log('hello');"}}</tool_call>

Make sure to format all your tool calls exactly like this inside your response. Do not use plain text or standard markdown code blocks for calling tools.`;

    return `You are an autonomous code generation engine with access to tools for reading, writing, and executing commands.

## Target Directory
${targetDir}

${toolCallingBlock}

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
${roadmapBlock}
${toonBlueprint}${skillsBlock}${appBlueprintBlock}
## Available Tools
${[...TOOL_DEFINITIONS, ...getDynamicMcpTools()].map(t => `- **${t.name}**: ${t.description}`).join('\n')}

Call mark_complete when the build is verified and complete.`;
}


/**
 * Build the system prompt for a CLI agent (e.g. pi, gemini, claude, agy).
 * Since these agents have their own native system prompts and toolchains,
 * we do NOT provide XML tool calling formatting instructions, internal tool definitions,
 * or loop recommended workflows. We give them a clean spec and context block.
 */
export function buildCLISystemPrompt(
    story: AppStory | FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    appBlueprint?: AppIntegrationBlueprint,
    storyFile?: string,
): string {
    const isApp = 'appName' in story;
    const storyBlock = isApp ? formatStory(story as AppStory) : formatFeatureStory(story as FeatureStory);

    let roadmapBlock = '';
    try {
        const appYamlPath = resolve(blueprint.repoPath, '.factory', 'app.yaml');
        if (existsSync(appYamlPath)) {
            const raw = readFileSync(appYamlPath, 'utf-8');
            const appSpec = parseYaml(raw) as any;
            if (appSpec) {
                let brdContent = appSpec.brd || '';
                if (brdContent && brdContent.endsWith('.md')) {
                    const possibleBrdPaths = [
                        resolve(blueprint.repoPath, brdContent),
                        resolve(blueprint.repoPath, '.factory', brdContent),
                        resolve(blueprint.repoPath, '.factory', 'specs', brdContent)
                    ];
                    for (const p of possibleBrdPaths) {
                        if (existsSync(p)) {
                            try {
                                brdContent = readFileSync(p, 'utf-8');
                                break;
                            } catch {}
                        }
                    }
                }

                let matchingFeature: any = null;
                const targetStoryFile = storyFile ? basename(storyFile) : '';
                if (targetStoryFile && appSpec.features) {
                    for (const f of appSpec.features) {
                        if (f.stories) {
                            for (const s of f.stories) {
                                if (s.file && basename(s.file) === targetStoryFile) {
                                    matchingFeature = f;
                                    break;
                                }
                            }
                        }
                        if (matchingFeature) break;
                    }
                }

                if (!matchingFeature && appSpec.features) {
                    const sName = isApp ? (story as AppStory).appName : (story as FeatureStory).feature?.name;
                    if (sName) {
                        for (const f of appSpec.features) {
                            if (f.stories && f.stories.some((s: any) => s.name === sName)) {
                                matchingFeature = f;
                                break;
                            }
                        }
                    }
                }

                roadmapBlock = `\n## Project Roadmap & Requirements (App-level Context)
Application: ${appSpec.name} (v${appSpec.version})
Description: ${appSpec.description}

### Business Requirements Document (BRD)
${brdContent || 'No business requirements document specified.'}
`;

                if (matchingFeature) {
                    roadmapBlock += `
### Active Feature Epic Context
You are currently building a story for the Feature Epic: **${matchingFeature.name}**
Feature Epic Description: ${matchingFeature.description || 'No description provided.'}
`;
                }
            }
        }
    } catch (e: any) {
        log('!', `Warning: Could not inject App Roadmap context: ${e?.message || e}`);
    }

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

    return `You are an expert autonomous software engineer agent with complete capabilities to read/write/edit files and run terminal commands using your own built-in tools.
You are tasked with building a feature or application story in the target directory.

## Target Directory
${targetDir}

## Rules
1. Examine the current folder structure, package.json, and tsconfig.json to orient yourself before starting.
2. Generate production-ready code — no placeholders, no TODOs, no stubs.
3. Every import from a package must exist in package.json. If you need to install a dependency, do so.
4. Match the coding style and patterns from the story and existing files.

${storyBlock}
${roadmapBlock}
${toonBlueprint}${skillsBlock}${appBlueprintBlock}
`;
}


/**
 * CLI single-shot build — used when provider.kind === 'cli'.
 *
 * These CLIs (gemini, claude, pi, agy) are AGENTIC tools with their own
 * file-read/write/bash capabilities. We send ONE comprehensive prompt,
 * run the CLI in the target directory, and let it build everything.
 * No turn loop, no XML parsing — just scan the directory when it's done.
 */
async function runCLISingleShot(
    cli: string,
    story: AppStory | FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
    appBlueprint?: AppIntegrationBlueprint,
): Promise<BuildResult> {
    const isApp = isAppStory(story);
    const name = isApp ? (story as AppStory).appName : (story as FeatureStory).feature.name;

    // Ensure target directory exists
    const { mkdirSync: mkd } = await import('node:fs');
    mkd(targetDir, { recursive: true });

    // Build a rich, self-contained prompt the CLI can act on directly
    const systemPrompt = buildCLISystemPrompt(story, blueprint, targetDir, appBlueprint, storyFile);
    const prompt = `${systemPrompt}

## Your Task

You are working in: ${targetDir}

Build the complete ${isApp ? 'application' : 'feature'} described above.
Use your file tools to write ALL necessary files directly to this directory.
Do not output file contents as text — write them to disk using your tools.
When complete, run: npx tsc --noEmit (if TypeScript) to verify there are no errors.
Fix any errors found before finishing.
`;

    const yoloFlags = CLI_FLAGS[cli] || [];
    log('●', `CLI single-shot build: ${name} (${cli})`);
    log('→', `Working directory: ${targetDir}`);
    log('→', `Prompt: ${prompt.length.toLocaleString()} chars`);

    let exitCode: number | null = null;
    let spawnError: any = undefined;
    let activeFilePath: string | null = null;
    let currentOffset = 0;
    let lineBuffer = '';
    let pollingInterval: NodeJS.Timeout | null = null;

    if (cli === 'pi') {
        const { homedir } = await import('node:os');
        const { join, basename } = await import('node:path');
        const { existsSync, readdirSync, statSync, openSync, readSync, closeSync } = await import('node:fs');

        const cleanDir = targetDir.endsWith('/') ? targetDir.slice(0, -1) : targetDir;
        const slug = '--' + cleanDir.replace(/^\//, '').replace(/\//g, '-').replace(/--/g, '-') + '--';
        const sessionDir = join(homedir(), '.pi', 'agent', 'sessions', slug);
        const startTime = Date.now();

        const parseAndLogSessionLine = (line: string) => {
            if (!line.trim()) return;
            try {
                const data = JSON.parse(line);
                if (data.type === 'message' && data.message) {
                    const role = data.message.role;
                    if (role === 'assistant') {
                        const content = data.message.content;
                        if (Array.isArray(content)) {
                            for (const item of content) {
                                if (item.type === 'thinking' && item.thinking) {
                                    // Omit thinking blocks entirely to keep logs clean
                                } else if (item.type === 'toolCall') {
                                    // Only print high-level progress tracking and completion tools
                                    if (item.name === 'log_step' || item.name === 'mark_complete' || item.name === 'mark_failed') {
                                        log('→', `🛠️  [Tool Call] ${item.name || ''} ${JSON.stringify(item.arguments || {})}`);
                                    }
                                } else if (item.type === 'text' && item.text) {
                                    const chatText = item.text.trim();
                                    if (chatText) {
                                        log('  ', `💬 ${chatText.replace(/\n/g, '\n     ')}`);
                                    }
                                }
                            }
                        }
                    } else if (role === 'toolResult') {
                        const toolName = data.message.toolName || '';
                        const isError = data.message.isError || false;
                        let resultText = '';
                        if (Array.isArray(data.message.content)) {
                            const firstText = data.message.content.find((c: any) => c.type === 'text');
                            if (firstText && typeof firstText.text === 'string') {
                                resultText = firstText.text.trim();
                            }
                        }
                        if (isError) {
                            // Always preserve and log errors for low-level mechanical tools
                            log('✗', `Tool ${toolName} failed.`);
                            if (resultText) {
                                log('  ', `Error: ${resultText.replace(/\n/g, '\n     ')}`);
                            }
                        } else {
                            // Only print success indicators for high-level progress or completion tools
                            if (toolName === 'log_step' || toolName === 'mark_complete' || toolName === 'mark_failed') {
                                log('✓', `Tool ${toolName} completed successfully.`);
                            }
                        }
                    }
                }
            } catch {
                // Ignore partial line parse errors
            }
        };

        pollingInterval = setInterval(() => {
            try {
                if (!activeFilePath) {
                    if (!existsSync(sessionDir)) return;
                    const files = readdirSync(sessionDir);
                    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
                    if (jsonlFiles.length === 0) return;

                    let newestFile: string | null = null;
                    let newestMtime = 0;

                    for (const file of jsonlFiles) {
                        const filePath = join(sessionDir, file);
                        const stat = statSync(filePath);
                        if (stat.mtimeMs > newestMtime && stat.mtimeMs > startTime - 10000) {
                            newestMtime = stat.mtimeMs;
                            newestFile = filePath;
                        }
                    }

                    if (newestFile) {
                        activeFilePath = newestFile;
                        log('→', `Discovered active CLI session log: ${basename(activeFilePath)}`);
                    }
                }

                if (activeFilePath) {
                    const stat = statSync(activeFilePath);
                    if (stat.size > currentOffset) {
                        const fd = openSync(activeFilePath, 'r');
                        const buffer = Buffer.alloc(stat.size - currentOffset);
                        readSync(fd, buffer, 0, buffer.length, currentOffset);
                        closeSync(fd);
                        currentOffset = stat.size;

                        const text = buffer.toString('utf8');
                        const lines = (lineBuffer + text).split('\n');
                        lineBuffer = lines.pop() || '';

                        for (const line of lines) {
                            parseAndLogSessionLine(line);
                        }
                    }
                }
            } catch {
                // Ignore tailing errors to keep engine running
            }
        }, 1000);
    }

    await new Promise<void>((resolvePromise) => {
        const child = cpSpawn(cli, ['-p', prompt, ...yoloFlags], {
            cwd: targetDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        child.stdout?.on('data', (data: Buffer) => {
            process.stdout.write(data);
        });

        child.stderr?.on('data', (data: Buffer) => {
            process.stderr.write(data);
        });

        child.on('close', (code) => {
            exitCode = code;
            if (pollingInterval) clearInterval(pollingInterval);
            resolvePromise();
        });

        child.on('error', (err) => {
            spawnError = err;
            if (pollingInterval) clearInterval(pollingInterval);
            resolvePromise();
        });
    });

    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    // Flush any remaining logs in the active file
    if (activeFilePath) {
        try {
            const { statSync, openSync, readSync, closeSync } = await import('node:fs');
            const stat = statSync(activeFilePath);
            if (stat.size > currentOffset) {
                const fd = openSync(activeFilePath, 'r');
                const buffer = Buffer.alloc(stat.size - currentOffset);
                readSync(fd, buffer, 0, buffer.length, currentOffset);
                closeSync(fd);
                const text = buffer.toString('utf8');
                const lines = (lineBuffer + text).split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.type === 'message' && data.message) {
                            const role = data.message.role;
                            if (role === 'assistant') {
                                const content = data.message.content;
                                if (Array.isArray(content)) {
                                    for (const item of content) {
                                        if (item.type === 'thinking' && item.thinking) {
                                            // Omit thinking block
                                        } else if (item.type === 'toolCall') {
                                            if (item.name === 'log_step' || item.name === 'mark_complete' || item.name === 'mark_failed') {
                                                log('→', `🛠️  [Tool Call] ${item.name || ''} ${JSON.stringify(item.arguments || {})}`);
                                            }
                                        } else if (item.type === 'text' && item.text) {
                                            const chatText = item.text.trim();
                                            if (chatText) {
                                                log('  ', `💬 ${chatText.replace(/\n/g, '\n     ')}`);
                                            }
                                        }
                                    }
                                }
                            } else if (role === 'toolResult') {
                                const toolName = data.message.toolName || '';
                                const isError = data.message.isError || false;
                                let resultText = '';
                                if (Array.isArray(data.message.content)) {
                                    const firstText = data.message.content.find((c: any) => c.type === 'text');
                                    if (firstText && typeof firstText.text === 'string') {
                                        resultText = firstText.text.trim();
                                    }
                                }
                                if (isError) {
                                    log('✗', `Tool ${toolName} failed.`);
                                    if (resultText) {
                                        log('  ', `Error: ${resultText.replace(/\n/g, '\n     ')}`);
                                    }
                                } else {
                                    if (toolName === 'log_step' || toolName === 'mark_complete' || toolName === 'mark_failed') {
                                        log('✓', `Tool ${toolName} completed successfully.`);
                                    }
                                }
                            }
                        }
                    } catch {}
                }
            }
        } catch {}
    }

    const success = spawnError === undefined && exitCode === 0;

    if (spawnError) {
        logError(`CLI error: ${spawnError.message}`);
    } else if (!success) {
        logError(`CLI exited with code ${exitCode}`);
    } else {
        log('✓', `CLI build complete`);
    }

    // Scan directory for all generated files
    const { readdirSync, readFileSync: rfs } = await import('node:fs');
    const files: GeneratedFile[] = [];
    function scanDir(dir: string, prefix: string): void {
        let entries: import('node:fs').Dirent[];
        try { entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' }) as import('node:fs').Dirent[]; } catch { return; }
        for (const entry of entries) {
            const eName = entry.name as string;
            if (['node_modules', '.git', '.factory', '.DS_Store'].includes(eName)) continue;
            const relPath = prefix ? `${prefix}/${eName}` : eName;
            if (entry.isDirectory()) {
                scanDir(`${dir}/${eName}`, relPath);
            } else {
                try { files.push({ filename: relPath, content: rfs(`${dir}/${eName}`, 'utf-8') }); }
                catch { /* skip binary */ }
            }
        }
    }
    scanDir(targetDir, '');

    log('→', `Scanned ${files.length} generated file(s)`);

    return {
        success,
        files,
        plan: {
            files: files.map(f => f.filename),
            architecture: name,
            decisions: [`engine:cli:${cli}`],
        },
        iterations: 1,
        errors: success ? undefined : [spawnError ? `CLI error: ${spawnError.message}` : `CLI exited with code ${exitCode}`],
        model: 'cli',
        provider: cli,
    };
}


export async function runToolSession(
    story: AppStory | FeatureStory,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
    appBlueprint?: AppIntegrationBlueprint,
): Promise<BuildResult> {
    const { provider, model } = requireActiveProvider();

    // ── CLI mode: single-shot agentic build ──────────────────────────────────
    // CLI tools (gemini, claude, pi, agy) are agents with their own file tools.
    // Don't try to parse XML tool calls from them — let them operate directly
    // in the target directory and scan the results.
    if (provider.kind === 'cli') {
        return runCLISingleShot(provider.id, story, blueprint, targetDir, storyFile, appBlueprint);
    }
    // ─────────────────────────────────────────────────────────────────────────

    const isNativeTools = provider && (provider.id === 'gemini' || provider.id === 'openai' || provider.kind === 'openai-compat');
    const systemPrompt = buildToolSystemPrompt(story, blueprint, targetDir, appBlueprint, storyFile);

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

    const MAX_TURNS = 50;
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

        const mcpTools = getDynamicMcpTools();
        const allTools = [...TOOL_DEFINITIONS, ...mcpTools];
        const response = await callProviderWithTools(provider, model, messages, allTools);
        totalTokensIn += response.tokensIn;
        totalTokensOut += response.tokensOut;

        const toolCalls = response.toolCalls || [];

        if (toolCalls.length === 0) {
            messages.push({ role: 'assistant', content: response.text });
            log('!', 'LLM returned no tool calls — prompting to invoke a tool');
            const promptContent = isNativeTools
                ? 'Please proceed by calling one or more tools natively (e.g. read_story, list_dir, write_file, or run_command) via the native tool-calling interface. Ensure you provide all required arguments (such as "path" and "content" for write_file/patch_file).'
                : 'Please proceed by invoking one or more tools (e.g. read_story, list_dir, write_file, or run_command) in the required XML tool-calling format:\n<tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>';
            messages.push({
                role: 'user',
                content: promptContent
            });
            continue;
        }

        messages.push({ role: 'assistant', content: response.text, tool_calls: toolCalls });

        // Execute each tool call sequentially
        for (const tc of toolCalls) {
            const toolName = tc.function.name;
            const args = tc.function.arguments || {};
            let details = '';
            
            if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'patch_file') {
                details = String(args.path || args.filename || '');
            } else if (toolName === 'list_dir') {
                details = `${args.path || ''}${args.recursive ? ' (recursive)' : ''}`;
            } else if (toolName === 'run_command') {
                details = `"${args.command || ''}"`;
            } else if (toolName === 'read_blueprint') {
                details = String(args.type || '');
            } else if (toolName === 'log_step') {
                details = `[${args.level || 'info'}] ${args.message || ''}`;
            } else if (Object.keys(args).length > 0) {
                details = JSON.stringify(args);
            }
            const displayDetails = details ? `: ${details}` : '';
            log('→', `Calling tool: ${toolName}${displayDetails}`);

            const result = await executeTool(tc.function.name, tc.function.arguments, ctx);
            messages.push({
                role: 'tool',
                content: result.content,
                tool_call_id: tc.id,
            });
            if (result.isError) {
                ctx.logs.push({ level: 'error', message: `[${tc.function.name}] ${result.content}` });
                log('✗', `Tool ${toolName} failed: ${result.content.slice(0, 200)}`);
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
    tools: readonly any[],
): Promise<ToolResponse> {
    const kind = provider.kind || 'builtin';

    // CLI provider — route entire conversation through the CLI binary
    if (kind === 'cli') {
        return callCLIWithTools(provider.id, messages, tools);
    }

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

// ─── CLI Provider Implementation ─────────────────────────

/**
 * Non-interactive (yolo) flags per CLI — confirmed from each CLI's --help output:
 *
 * gemini  → --yolo  (also accepts --approval-mode yolo)
 * claude  → --dangerously-skip-permissions
 * agy     → --dangerously-skip-permissions
 * pi      → non-interactive by default with -p; no approval flag needed
 */
const CLI_FLAGS: Record<string, string[]> = {
    gemini: ['--yolo'],
    claude: ['--dangerously-skip-permissions'],
    agy:    ['--dangerously-skip-permissions'],
    pi:     [],   // pi -p is already non-interactive
};

/**
 * Serialise the full message history + tool schemas into one prompt string
 * the CLI can process in a single -p invocation.
 *
 * Uses the XML <tool_call> format that parseXmlToolCalls() already understands.
 */
function buildCLIConversationPrompt(
    messages: ToolMessages,
    tools: readonly any[],
): string {
    // Tool schema block
    const toolSchemas = tools.map(t => {
        const params_def = (t.parameters as any);
        const params = params_def?.properties
            ? Object.entries(params_def.properties)
                .map(([k, v]: [string, any]) =>
                    `  - ${k} (${v.type || 'string'}${(params_def.required as string[] | undefined)?.includes(k) ? ', required' : ''}): ${v.description || ''}`
                )
                .join('\n')
            : '  (no parameters)';
        return `### ${t.name}\n${t.description}\nParameters:\n${params}`;
    }).join('\n\n');

    // Conversation history — skip system message (we embed it inline below)
    const history = messages
        .filter(m => m.role !== 'system')
        .map(m => {
            if (m.role === 'assistant' && m.tool_calls?.length) {
                const calls = m.tool_calls
                    .map(tc => `<tool_call>${JSON.stringify({ name: tc.function.name, arguments: tc.function.arguments })}</tool_call>`)
                    .join('\n');
                return `ASSISTANT:\n${m.content ? m.content + '\n' : ''}${calls}`;
            }
            if (m.role === 'tool') {
                return `TOOL RESULT (${m.tool_call_id || 'unknown'}):\n${m.content}`;
            }
            return `${m.role.toUpperCase()}:\n${m.content}`;
        })
        .join('\n\n---\n\n');

    // Extract the system message
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';

    return `${systemMsg}

## AVAILABLE TOOLS

You MUST respond by calling tools using this exact XML format:
<tool_call>{"name": "tool_name", "arguments": {"param": "value"}}</tool_call>

Call as many tools as needed in a single response. Each tool call must be valid JSON.

Available tools:
${toolSchemas}

## CONVERSATION HISTORY

${history}

## YOUR TURN

Continue the task. Call the appropriate tool(s) now.`;
}

/**
 * Route a tool-calling turn through an installed CLI binary.
 * NOTE: This is only called for API providers that fall through.
 * CLI providers (kind === 'cli') are handled by runCLISingleShot above.
 * Kept for completeness but should not normally be reached.
 */
async function callCLIWithTools(
    cli: string,
    messages: ToolMessages,
    tools: readonly any[],
): Promise<ToolResponse> {
    const prompt = buildCLIConversationPrompt(messages, tools);
    const extraFlags = CLI_FLAGS[cli] || [];

    log('→', `CLI turn → ${cli} (${prompt.length.toLocaleString()} chars)`);

    const result = spawnSync(cli, ['-p', prompt, ...extraFlags], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], // close stdin to prevent hangs
        maxBuffer: 50 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
    });

    if (result.error) {
        throw new Error(`CLI spawn error (${cli}): ${result.error.message}`);
    }

    if (result.status !== 0) {
        const stderr = result.stderr?.slice(0, 400) || '';
        throw new Error(`CLI ${cli} exited with code ${result.status}: ${stderr}`);
    }

    const text = result.stdout || '';
    log('✓', `CLI response: ${text.length.toLocaleString()} chars`);

    const toolCalls = parseXmlToolCalls(text);
    log('→', `Parsed ${toolCalls.length} tool call(s) from CLI output`);

    return { text, tokensIn: 0, tokensOut: 0, toolCalls };
}

/**
 * Simple (non-tool-calling) CLI invocation.
 */
async function callCLISimple(cli: string, prompt: string): Promise<LLMResponse> {
    const extraFlags = CLI_FLAGS[cli] || [];
    log('→', `CLI simple → ${cli} (${prompt.length.toLocaleString()} chars)`);

    const result = spawnSync(cli, ['-p', prompt, ...extraFlags], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], // close stdin to prevent hangs
        maxBuffer: 50 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
    });

    if (result.error) throw new Error(`CLI spawn error (${cli}): ${result.error.message}`);
    if (result.status !== 0) {
        throw new Error(`CLI ${cli} exited with code ${result.status}: ${result.stderr?.slice(0, 400) || ''}`);
    }

    const text = result.stdout || '';
    log('✓', `CLI response: ${text.length.toLocaleString()} chars`);
    return { text, tokensIn: 0, tokensOut: 0 };
}

/** Robust regex-based XML/tag tool-calling parser for Qwen and other local LLMs */
function parseXmlToolCalls(content: string): ToolCallResult {
    const toolCalls: ToolCallResult = [];

    // Split the content by `<tool_call>` to handle each block individually
    const blocks = content.split('<tool_call>');
    // The first block is content before the first <tool_call>, so we skip it
    for (let i = 1; i < blocks.length; i++) {
        let block = blocks[i].trim();
        // Remove closing tag if present
        const closeIdx = block.indexOf('</tool_call>');
        if (closeIdx !== -1) {
            block = block.slice(0, closeIdx).trim();
        }

        try {
            const parsed = JSON.parse(block);
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
            } else {
                // If it's a flat JSON object like {"run_command": {"command": "ls -la"}} or {"write_file": {...}}
                // where the key is the tool name
                const keys = Object.keys(parsed);
                if (keys.length === 1 && typeof parsed[keys[0]] === 'object' && parsed[keys[0]] !== null) {
                    const toolName = keys[0];
                    const args = parsed[toolName];
                    toolCalls.push({
                        id: `xml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        function: {
                            name: toolName,
                            arguments: args
                        }
                    });
                }
            }
        } catch {
            // Not valid JSON. Let's try to extract JSON-like structure or extract name/arguments manually if possible.
            const nameMatch = block.match(/"name"\s*:\s*"([^"]+)"/) || block.match(/(?:<)?function\s*=\s*\\?"?([a-zA-Z_][a-zA-Z0-9_]*)\\?"?/);
            const argsMatch = block.match(/"arguments"\s*:\s*(\{[\s\S]*\})/) || block.match(/"parameters"\s*:\s*(\{[\s\S]*\})/) || block.match(/"args"\s*:\s*(\{[\s\S]*\})/);
            if (nameMatch) {
                const name = nameMatch[1];
                let args: Record<string, any> = {};
                if (argsMatch) {
                    try {
                        let jsonStr = argsMatch[1].trim();
                        // If it has unmatched opening brackets, try to append closing ones
                        const openBraces = (jsonStr.match(/\{/g) || []).length;
                        const closeBraces = (jsonStr.match(/\}/g) || []).length;
                        if (openBraces > closeBraces) {
                            jsonStr += '}'.repeat(openBraces - closeBraces);
                        }
                        args = JSON.parse(jsonStr);
                    } catch {
                        // Fallback: try parsing individual parameters if JSON.parse fails
                        try {
                            const pathMatch = argsMatch[1].match(/"path"\s*:\s*"([^"]+)"/);
                            const contentMatch = argsMatch[1].match(/"content"\s*:\s*"([\s\S]*?)"(?=\s*[,\}])/);
                            const tempArgs: any = {};
                            if (pathMatch) tempArgs.path = pathMatch[1];
                            if (contentMatch) {
                                tempArgs.content = contentMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                            } else {
                                // If content is huge/multiline and has unescaped quotes, try to get it between content and next key or end
                                const contentFallback = argsMatch[1].match(/"content"\s*:\s*"([\s\S]*)$/);
                                if (contentFallback) {
                                    let raw = contentFallback[1].trim();
                                    if (raw.endsWith('}') || raw.endsWith('}"')) {
                                        raw = raw.replace(/"?\}*$/, '');
                                    }
                                    tempArgs.content = raw.replace(/\\n/g, '\n').replace(/\\"/g, '"');
                                }
                            }
                            if (Object.keys(tempArgs).length > 0) {
                                args = tempArgs;
                            }
                        } catch {}
                    }
                }
                // Fallback / Enrichment: parse key-value properties or XML parameter tags directly from block!
                const parsedParams = parseArgsFromBody(block);
                const parsedProperties = extractJsonProperties(block);
                args = { ...args, ...parsedParams, ...parsedProperties };
                // Delete fields that accidentally got parsed as arguments
                delete args.name;
                delete args.arguments;
                delete args.args;

                toolCalls.push({
                    id: `xml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    function: { name, arguments: args }
                });
            }
        }
    }
    if (toolCalls.length > 0) return toolCalls;

    // Pattern 2: <invoke name="tool_name">...params...</invoke> or <invoke>tool_name</invoke>
    const invokeRegex = /<invoke(?:\s+name="([^"]+)")?>([\s\S]*?)<\/invoke>/g;
    let match;
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

    let foundParams = false;

    // Check for <parameter name="param_name">value</parameter>
    const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
    let match;
    while ((match = paramRegex.exec(body)) !== null) {
        args[match[1]] = match[2].trim();
        foundParams = true;
    }

    // Check for <parameter=param_name>value</parameter>
    const paramEqualRegex = /<parameter=([a-zA-Z_][a-zA-Z0-9_]*)>([\s\S]*?)<\/parameter>/g;
    while ((match = paramEqualRegex.exec(body)) !== null) {
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
    tools: readonly any[],
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
        if (text && text.trim().length > 0) {
            const cleanText = text.trim().replace(/\s+/g, ' ').slice(0, 100);
            log('  ', `Model: "${cleanText}..."`);
        }
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
    tools: readonly any[],
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
    tools: readonly any[],
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
                        ? (() => {
                            try {
                                return JSON.parse(tc.function.arguments);
                            } catch {
                                return tc.function.arguments;
                            }
                        })()
                        : tc.function.arguments,
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

export function extractJsonProperties(str: string): Record<string, any> {
    const obj: Record<string, any> = {};
    
    // 1. First, let's extract standard string properties like "path": "value" or "content": "value"
    // Handles multi-line strings, escaped characters, and ignores potential following properties.
    const stringRegex = /"([a-zA-Z0-9_-]+)"\s*:\s*"([\s\S]*?)"(?=\s*(?:,|\}|"|[a-zA-Z_-]|$))/g;
    let match;
    while ((match = stringRegex.exec(str)) !== null) {
        const key = match[1];
        let val = match[2];
        // Clean up escaped characters
        val = val.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        obj[key] = val;
    }

    // 2. Extract boolean, number, and null values
    const scalarRegex = /"([a-zA-Z0-9_-]+)"\s*:\s*(true|false|null|[0-9.-]+)/g;
    while ((match = scalarRegex.exec(str)) !== null) {
        const key = match[1];
        if (!(key in obj)) {
            const val = match[2];
            if (val === 'true') obj[key] = true;
            else if (val === 'false') obj[key] = false;
            else if (val === 'null') obj[key] = null;
            else obj[key] = Number(val);
        }
    }

    // 3. Extract parameters of format 'key': 'value' (single quotes)
    const singleQuoteStringRegex = /'([a-zA-Z0-9_-]+)'\s*:\s*'([\s\S]*?)'(?=\s*(?:,|\}|'|[a-zA-Z_-]|$))/g;
    while ((match = singleQuoteStringRegex.exec(str)) !== null) {
        const key = match[1];
        if (!(key in obj)) {
            let val = match[2];
            val = val.replace(/\\n/g, '\n').replace(/\\"/g, "'").replace(/\\\\/g, '\\');
            obj[key] = val;
        }
    }

    return obj;
}
