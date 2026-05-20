/**
 * Writer — writes generated files to the target repo and handles git operations.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import type { GeneratedFile, AppSpec, FeatureSpec, BuildResult, StackConfig } from './types.ts';
import { log, logError } from './log.ts';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

/**
 * Write generated files to a target directory.
 * Creates directories as needed.
 */
export function writeFiles(targetDir: string, files: GeneratedFile[]): string[] {
    const writtenPaths: string[] = [];

    for (const file of files) {
        const absPath = resolve(targetDir, file.filename);
        const dir = dirname(absPath);

        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        writeFileSync(absPath, file.content);
        writtenPaths.push(file.filename);
        log('  ', `  ✓ ${file.filename}`);
    }

    log('✓', `Wrote ${writtenPaths.length} files to ${targetDir}`);
    return writtenPaths;
}

/**
 * Run package install in the target directory.
 * Detects package manager from spec stack config.
 */
export function setupProject(targetDir: string, packageManager?: string): boolean {
    if (!existsSync(join(targetDir, 'package.json'))) {
        log('!', 'No package.json — skipping install');
        return false;
    }

    let cmd: string;
    switch (packageManager?.toLowerCase()) {
        case 'pnpm': cmd = 'pnpm install --no-frozen-lockfile'; break;
        case 'yarn': cmd = 'yarn install --no-immutable'; break;
        case 'bun': cmd = 'bun install'; break;
        default: cmd = 'npm install --legacy-peer-deps'; break;
    }

    // Bump package versions to latest before install (LLM pins stale versions)
    try {
        log('●', 'Bumping package versions to latest...');
        execSync('npx -y npm-check-updates -u', { cwd: targetDir, stdio: 'pipe', timeout: 30_000 });
        log('✓', 'Package versions bumped to latest');
    } catch {
        log('!', 'Version bump skipped (non-fatal)');
    }

    try {
        log('●', `Running ${cmd} in ${targetDir}...`);
        execSync(cmd, { cwd: targetDir, stdio: 'pipe', timeout: 120_000 });
        log('✓', 'Package install complete');
        return true;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logError(`Package install failed: ${msg.slice(0, 200)}`);
        return false;
    }
}

/**
 * Stage all changed files and commit.
 */
export function gitCommit(repoPath: string, message: string): boolean {
    try {
        // Init git repo if not present
        if (!existsSync(join(repoPath, '.git'))) {
            log('●', 'Initializing git repo');
            execSync('git init', { cwd: repoPath, stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
            log('✓', 'Git repo initialized');
        }

        execSync('git add -A', { cwd: repoPath, stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
        execSync(`git commit -m "${message}"`, { cwd: repoPath, stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
        log('✓', `Committed: ${message}`);
        return true;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // "nothing to commit" is not an error
        if (msg.includes('nothing to commit')) {
            log('!', 'Nothing to commit');
            return true;
        }
        logError(`Git commit failed: ${msg}`);
        return false;
    }
}

/**
 * Push to remote.
 */
export function gitPush(repoPath: string, branch?: string): boolean {
    try {
        if (!existsSync(join(repoPath, '.git'))) {
            log('!', 'Not a git repo — skipping push');
            return true; // Not an error
        }

        // Check if a remote is configured
        try {
            const remotes = execSync('git remote', { cwd: repoPath, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }).toString().trim();
            if (!remotes) {
                log('!', 'No git remote configured — skipping push');
                return true; // Not an error
            }
        } catch {
            log('!', 'No git remote configured — skipping push');
            return true;
        }

        const cmd = branch ? `git push origin ${branch}` : 'git push';
        execSync(cmd, { cwd: repoPath, stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
        log('✓', 'Pushed to remote');
        return true;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log('!', `Git push skipped: ${msg.slice(0, 100)}`);
        return true; // Push failure should not fail the build
    }
}

// ─── Knowledge Feedback ──────────────────────────────────

/**
 * Build a structured debrief markdown string from build results.
 * This is the standard format used for both file-based knowledge
 * entries and DB knowledge entries.
 */
export function buildDebrief(
    appName: string,
    result: BuildResult,
    stack: StackConfig,
    specFile: string,
    durationMs?: number,
): string {
    const lines: string[] = [];
    lines.push(appName);
    lines.push('');

    // Architecture summary (from LLM plan)
    if (result.plan?.architecture) {
        lines.push(result.plan.architecture);
        lines.push('');
    }

    // Extract meaningful exports from each source file
    for (const f of result.files) {
        if (!f.filename.match(/\.(ts|tsx|js|jsx)$/) || f.filename === 'package.json') continue;

        const exports = extractExports(f.content);
        if (exports.length === 0) continue;

        lines.push(`- ${f.filename}: ${exports.join(', ')}`);
    }

    // Dependencies (from package.json)
    const pkg = result.files.find(f => f.filename === 'package.json');
    if (pkg) {
        try {
            const parsed = JSON.parse(pkg.content);
            const deps = Object.keys(parsed.dependencies || {});
            if (deps.length > 0) {
                lines.push('');
                lines.push(`Dependencies: ${deps.join(', ')}`);
            }
        } catch { /* skip */ }
    }

    // Key decisions
    if (result.plan?.decisions?.length) {
        lines.push('');
        for (const d of result.plan.decisions) {
            lines.push(`- ${d}`);
        }
    }

    // Issues worth knowing about
    if (result.errors?.length) {
        lines.push('');
        lines.push('Known issues:');
        for (const e of result.errors) {
            lines.push(`- ${e}`);
        }
    }

    return lines.join('\n') + '\n';
}

/** Extract exported class names, function names, and interface names from TypeScript/JS source */
function extractExports(content: string): string[] {
    const items: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();

        // export class Foo / export default class Foo
        const classMatch = trimmed.match(/^export\s+(?:default\s+)?class\s+(\w+)/);
        if (classMatch) { items.push(classMatch[1]); continue; }

        // export function foo / export async function foo / export default function foo
        const fnMatch = trimmed.match(/^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
        if (fnMatch) { items.push(`${fnMatch[1]}()`); continue; }

        // export interface Foo / export type Foo
        const typeMatch = trimmed.match(/^export\s+(?:interface|type)\s+(\w+)/);
        if (typeMatch) { items.push(typeMatch[1]); continue; }

        // export const foo = ... (named exports)
        const constMatch = trimmed.match(/^export\s+const\s+(\w+)/);
        if (constMatch) { items.push(constMatch[1]); continue; }
    }

    return items;
}

/**
 * Write a structured debrief into `.factory/knowledge/builds/` so future
 * specs have context about what has already been built.
 *
 * The context gatherer auto-discovers these if the directory is listed
 * in factory.yaml skills.files or if discovery is set to auto.
 */
export function writeKnowledgeEntry(
    repoPath: string,
    appName: string,
    result: BuildResult,
    stack: StackConfig,
    specFile: string,
): void {
    const knowledgeDir = join(repoPath, '.factory', 'knowledge', 'builds');
    if (!existsSync(knowledgeDir)) {
        mkdirSync(knowledgeDir, { recursive: true });
    }

    const slug = appName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const filePath = join(knowledgeDir, `${slug}.md`);
    const content = buildDebrief(appName, result, stack, specFile);

    writeFileSync(filePath, content);
    log('✓', `Knowledge entry written: .factory/knowledge/builds/${slug}.md`);
    writeTasksToon(repoPath, slug);
}

// ─── AGENTS.md Generation ────────────────────────────────

/**
 * Generate an AGENTS.md file inside the built app directory.
 *
 * This file describes the app's stack, structure, and conventions
 * so that AI coding assistants (Copilot, Cursor, Gemini, etc.)
 * understand the project when working on it later.
 */
export function writeAppAgentsMd(
    targetDir: string,
    appName: string,
    stack: StackConfig,
    files: GeneratedFile[],
): void {
    const agentsPath = join(targetDir, 'AGENTS.md');

    // Group files by directory
    const dirs = new Map<string, string[]>();
    for (const f of files) {
        const parts = f.filename.split('/');
        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
        const existing = dirs.get(dir) || [];
        existing.push(parts[parts.length - 1]);
        dirs.set(dir, existing);
    }

    // Build the folder tree
    const tree = Array.from(dirs.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dir, fileNames]) => {
            const indent = dir === '.' ? '' : '│   ';
            const dirLine = dir === '.' ? '.' : `├── ${dir}/`;
            const fileLines = fileNames.map(f => `${indent}├── ${f}`).join('\n');
            return `${dirLine}\n${fileLines}`;
        })
        .join('\n');

    const content = `# ${appName} — Agent Instructions

> Auto-generated by Factory. Update this file as the app evolves.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | ${stack.framework} |
| Language | ${stack.language || 'TypeScript'} |
| Package Manager | ${stack.packageManager || 'npm'} |
${stack.linter ? `| Linter | ${stack.linter} |\n` : ''}${stack.testing ? `| Testing | ${stack.testing} |\n` : ''}${stack.database ? `| Database | ${stack.database} |\n` : ''}${stack.cloud ? `| Cloud | ${stack.cloud} |\n` : ''}
## Project Structure

\`\`\`
${tree}
\`\`\`

## Conventions

- Run \`${stack.packageManager || 'npm'} install\` after cloning
${stack.linter ? `- Lint with \`${lintCmdForAgents(stack.linter)}\`` : ''}
${stack.testing ? `- Test with \`${testCmdForAgents(stack.testing)}\`` : ''}
- This project was scaffolded by the Factory engine — preserve its structure
- Follow existing patterns when adding new files

## Key Files

${files.slice(0, 15).map(f => `- \`${f.filename}\``).join('\n')}
${files.length > 15 ? `\n...and ${files.length - 15} more files` : ''}
`;

    writeFileSync(agentsPath, content);
    log('✓', `AGENTS.md written to ${targetDir}`);
}

function lintCmdForAgents(linter: string): string {
    const map: Record<string, string> = {
        'eslint': 'npx eslint .',
        'biome': 'npx @biomejs/biome check .',
        'oxlint': 'npx oxlint .',
        'prettier': 'npx prettier --check .',
    };
    return map[linter.toLowerCase()] || `npx ${linter}`;
}

function testCmdForAgents(testing: string): string {
    const map: Record<string, string> = {
        'vitest': 'npx vitest run',
        'jest': 'npx jest',
        'playwright': 'npx playwright test',
        'cypress': 'npx cypress run',
    };
    return map[testing.toLowerCase()] || `npx ${testing}`;
}

// ─── TOON Tasks Snapshot ─────────────────────────────────

/**
 * Write .factory/task-manager/todo.yaml (or legacy todo.toon) snapshot of completed tasks.
 * Called after each successful build so the task queue reflects reality.
 */
export function writeTasksToon(repoPath: string, specSlug: string): void {
    const todoYamlPath = join(repoPath, '.factory', 'task-manager', 'todo.yaml');
    const todoToonPath = join(repoPath, '.factory', 'task-manager', 'todo.toon');
    const todoPath = existsSync(todoYamlPath) ? todoYamlPath : (existsSync(todoToonPath) ? todoToonPath : null);
    if (!todoPath) return;

    try {
        const content = readFileSync(todoPath, 'utf-8');
        let data: any;
        if (todoPath.endsWith('.yaml') || todoPath.endsWith('.yml')) {
            data = parseYaml(content);
        } else {
            data = JSON.parse(content);
        }

        if (!data) data = {};

        // Move specSlug from in_progress/next to completed if present
        for (const section of ['in_progress', 'next']) {
            if (data[section] && Array.isArray(data[section])) {
                data[section] = data[section].filter((t: any) => {
                    if (typeof t === 'string') return t !== specSlug;
                    if (t && typeof t === 'object') {
                        // Check if it's in format: { [specSlug]: summary } or { id: specSlug }
                        const keys = Object.keys(t);
                        if (keys.length > 0 && keys[0] === specSlug) return false;
                        return t.id !== specSlug;
                    }
                    return true;
                });
            }
        }

        if (!data.completed) data.completed = [];
        if (Array.isArray(data.completed)) {
            // Check if already completed
            const alreadyCompleted = data.completed.some((t: any) => {
                if (typeof t === 'string') return t === specSlug;
                if (t && typeof t === 'object') {
                    const keys = Object.keys(t);
                    if (keys.length > 0 && keys[0] === specSlug) return true;
                    return t.id === specSlug;
                }
                return false;
            });

            if (!alreadyCompleted) {
                if (todoPath.endsWith('.yaml') || todoPath.endsWith('.yml')) {
                    data.completed.push({ [specSlug]: `Completed build for ${specSlug}` });
                } else {
                    data.completed.push({ id: specSlug, completed: new Date().toISOString() });
                }
            }
        }

        // Update summary counts
        data.summary = {
            completed: (data.completed || []).length,
            next: (data.next || []).length,
            in_progress: (data.in_progress || []).length,
            cancelled: (data.cancelled || []).length,
        };

        if (todoPath.endsWith('.yaml') || todoPath.endsWith('.yml')) {
            writeFileSync(todoPath, toYaml(data));
        } else {
            writeFileSync(todoPath, JSON.stringify(data, null, 2));
        }
    } catch (e) {
        // Silently fail — don't break the build
    }
}

// ─── TOON Tasks Snapshot ─────────────────────────────────

/**
 * Write .factory/task-manager/todo.toon snapshot of completed tasks.
 * Called after each successful build so the task queue reflects reality.
 */
