/**
 * pi CLI Engine — delegates code generation to `pi` CLI.
 *
 * Factory remains the orchestrator — manages specs, queue, git.
 * pi CLI does the actual coding work.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { AppSpec, FeatureSpec, ProjectContext, BuildResult, GeneratedFile, PagesConfig } from './types.ts';
import { specSlug } from './types.ts';
import { log, logError } from './log.ts';

// ─── Availability ────────────────────────────────────────

export function isPiCLIAvailable(): { available: boolean; version?: string; error?: string } {
    try {
        const result = execSync('pi --version 2>&1', {
            timeout: 10_000,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: '/bin/bash',
        });
        const version = result.toString().trim();
        return { available: true, version };
    } catch (err: any) {
        return {
            available: false,
            error: err.message?.includes('not found') || err.message?.includes('ENOENT')
                ? 'pi CLI is not installed. Install with: npm install -g pi-coding-agent'
                : `pi CLI check failed: ${err.message?.slice(0, 200)}`,
        };
    }
}

// ─── Prompt Builder ──────────────────────────────────────

function formatPages(pages: PagesConfig | undefined): string {
    if (!pages) return '';
    const lines: string[] = [];
    if (pages.dashboard && pages.dashboard.length > 0) {
        lines.push(`  Dashboard pages: ${pages.dashboard.join(', ')}`);
    }
    if (pages.crud && pages.crud.length > 0) {
        lines.push(`  CRUD pages: ${pages.crud.map(c => c.table).join(', ')}`);
    }
    if (pages.custom && pages.custom.length > 0) {
        lines.push(`  Custom pages: ${pages.custom.join(', ')}`);
    }
    return lines.join('\n');
}

function buildPiPrompt(spec: AppSpec, context: ProjectContext, targetDir: string): string {
    const tables = spec.data?.tables || [];
    const tableDefs = tables.map(t => {
        const fields = Object.entries(t.fields)
            .map(([name, def]) => `  - ${name}: ${def.type}${def.required ? ' (required)' : ''}`)
            .join('\n');
        return `- ${t.name}\n${fields}`;
    }).join('\n');

    const conventions = context.conventions.length > 0
        ? `\n## Project Conventions\n${context.conventions.join('\n')}`
        : '';

    const knowledge = context.knowledgeFiles.length > 0
        ? `\n## Existing Knowledge\n${context.knowledgeFiles.map(k => `### ${k.app}\n${k.content}`).join('\n\n')}`
        : '';

    return `You are building a complete, production-ready application. Generate ALL necessary files.

## Application Specification

- **Name**: ${spec.appName}
- **Description**: ${spec.description}
- **Framework**: ${spec.stack.framework}
- **Package Manager**: ${spec.stack.packageManager || 'npm'}
- **Language**: ${spec.stack.language || 'typescript'}
- **Database**: ${spec.stack.database || 'local state'}
- **Linter**: ${spec.stack.linter || 'none'}
- **Testing**: ${spec.stack.testing || 'none'}

### Frontend
- UI Library: ${spec.frontend?.ui || 'tailwind'}
- Theme: ${spec.frontend?.theme || 'light'}

### Layout
- Sidebar: ${spec.layout?.sidebar !== false ? 'yes' : 'no'}

## Data Model${tableDefs ? `\n${tableDefs}` : '\nNo data model specified.'}

## Pages / Routes
${formatPages(spec.pages) || 'No pages specified.'}

## Authentication
${spec.auth || 'None'}

## Deployment
${spec.deployment || 'Not specified'}${conventions}${knowledge}

## Target Directory
All files must be placed in: ${targetDir}

Generate the complete application. Run any necessary commands (npm install, etc.).`;
}

function buildPiFeaturePrompt(spec: FeatureSpec, context: ProjectContext, targetDir: string): string {
    const pages = (spec.pages || []).map(p => `- ${p.title || p.slug} (${p.type})`).join('\n') || 'No new pages.';
    const modelDefs = spec.model
        ? spec.model.fields.map(f => `  - ${f.name}: ${f.type}${f.required ? ' (required)' : ''}`).join('\n')
        : 'No model changes.';

    return `You are adding a feature to an existing application.

## Feature: ${spec.feature.name}

## Target App
${spec.target.app} at ${targetDir}

## Pages/Routes to add\n${pages}
## Models to add\n${modelDefs}

## Target Directory
All files must go in: ${targetDir}

Generate the feature. Do NOT modify existing files unless necessary.`;
}

// ─── Execution ───────────────────────────────────────────

interface PiCLIResult {
    success: boolean;
    filesGenerated: string[];
    output: string;
    durationMs: number;
    error?: string;
}

async function executePiCLI(prompt: string, workDir: string): Promise<PiCLIResult> {
    const startTime = Date.now();

    const promptFile = join(tmpdir(), `factory-pi-${Date.now()}.md`);
    writeFileSync(promptFile, prompt);

    return new Promise((resolvePromise) => {
        log('→', 'Spawning pi CLI...');

        const child = spawn('pi', ['--provider', 'gx10', '--model', 'gx10/deepseek-v4-flash', '--api-key', 'gx10', `@${promptFile}`], {
            cwd: workDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env },
            shell: '/bin/bash',
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data: Buffer) => {
            const chunk = data.toString();
            stdout += chunk;
            const lines = chunk.split('\n').filter(Boolean);
            for (const line of lines) {
                if (line.includes('✓') || line.includes('Created') || line.includes('Writing') || line.includes('Installing')) {
                    log('  ', `  [pi] ${line.trim().slice(0, 120)}`);
                }
            }
        });

        child.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        child.on('close', (code: number | null) => {
            const durationMs = Date.now() - startTime;
            try { execSync(`rm -f '${promptFile}'`, { stdio: 'pipe' }); } catch { /* ignore */ }

            if (code === 0) {
                log('✓', `pi CLI completed in ${(durationMs / 1000).toFixed(1)}s`);
                resolvePromise({
                    success: true,
                    filesGenerated: [],
                    output: stdout,
                    durationMs,
                });
            } else {
                const errorMsg = stderr.trim() || `pi CLI exited with code ${code}`;
                logError(`pi CLI failed: ${errorMsg.slice(0, 200)}`);
                resolvePromise({
                    success: false,
                    filesGenerated: [],
                    output: stdout + '\n' + stderr,
                    durationMs,
                    error: errorMsg.slice(0, 500),
                });
            }
        });

        child.on('error', (err: Error) => {
            const durationMs = Date.now() - startTime;
            try { execSync(`rm -f '${promptFile}'`, { stdio: 'pipe' }); } catch { /* ignore */ }
            resolvePromise({
                success: false,
                filesGenerated: [],
                output: '',
                durationMs,
                error: `Failed to spawn pi CLI: ${err.message}`,
            });
        });
    });
}

// ─── Build Functions ─────────────────────────────────────

export async function runPiCLIBuild(
    spec: AppSpec,
    context: ProjectContext,
    targetDir: string,
): Promise<BuildResult> {
    const check = isPiCLIAvailable();
    if (!check.available) {
        throw new Error(check.error || 'pi CLI is not available');
    }

    log('→', `Using pi CLI engine (${check.version || 'unknown version'})`);

    if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
    }

    const prompt = buildPiPrompt(spec, context, targetDir);
    const result = await executePiCLI(prompt, targetDir);

    const files = scanGeneratedFiles(targetDir);

    return {
        success: result.success,
        files,
        plan: {
            files: files.map(f => f.filename),
            architecture: 'Generated by pi CLI',
            decisions: ['engine:pi-cli'],
        },
        iterations: 1,
        errors: result.error ? [result.error] : undefined,
        provider: 'pi-cli',
        model: 'pi-cli',
    };
}

export async function runPiCLIFeatureBuild(
    spec: FeatureSpec,
    context: ProjectContext,
    targetDir: string,
): Promise<BuildResult> {
    const check = isPiCLIAvailable();
    if (!check.available) {
        throw new Error(check.error || 'pi CLI is not available');
    }

    log('→', `Using pi CLI engine for feature: ${spec.feature.name}`);

    if (!existsSync(targetDir)) {
        throw new Error(`Target app directory does not exist: ${targetDir}`);
    }

    const before = new Set(scanAllFiles(targetDir));

    const prompt = buildPiFeaturePrompt(spec, context, targetDir);
    const result = await executePiCLI(prompt, targetDir);

    const after = scanGeneratedFiles(targetDir);
    const newFiles = after.filter(f => !before.has(f.filename));

    return {
        success: result.success,
        files: newFiles,
        plan: {
            files: newFiles.map(f => f.filename),
            architecture: `Feature: ${spec.feature.name}`,
            decisions: ['engine:pi-cli'],
        },
        iterations: 1,
        errors: result.error ? [result.error] : undefined,
        provider: 'pi-cli',
        model: 'pi-cli',
    };
}

// ─── File Scanning ───────────────────────────────────────

function scanAllFiles(dir: string, prefix = ''): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.factory') continue;
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            results.push(...scanAllFiles(join(dir, entry.name), relPath));
        } else {
            results.push(relPath);
        }
    }
    return results;
}

function scanGeneratedFiles(dir: string): GeneratedFile[] {
    const paths = scanAllFiles(dir);
    return paths.map(p => ({
        filename: p,
        content: readFileSync(join(dir, p), 'utf-8'),
    }));
}
