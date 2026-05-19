/**
 * Minions Engine — delegates code generation to the minions YAML prompt queue runner.
 *
 * Converts specs to 5-step (AppSpec) or 6-step (FeatureSpec) YAML queues,
 * spawns the minions script, and returns BuildResult.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { AppSpec, FeatureSpec, ProjectContext, BuildResult, GeneratedFile } from './types.ts';
import { specSlug } from './types.ts';
import { log, logError } from './log.ts';
import { stringify } from 'yaml';

// ─── Queue YAML Generator ───────────────────────────────

/**
 * Convert an AppSpec to a 5-step YAML queue for minions.
 * Steps: 1. Setup, 2. Scaffold, 3. Generate, 4. Test, 5. Deploy
 */
function specToQueueYaml(spec: AppSpec): string {
    const queue = {
        queue: [
            {
                name: 'Setup project',
                prompt: `Create package.json and tsconfig.json for ${spec.appName}. Framework: ${spec.stack.framework}. Package manager: ${spec.stack.packageManager || 'npm'}.`,
            },
            {
                name: 'Scaffold structure',
                prompt: `Create the directory structure and base files for ${spec.appName}. Framework: ${spec.stack.framework}. Include layout, routing, and configuration files.`,
            },
            {
                name: 'Generate core code',
                prompt: `Generate the core application code for ${spec.appName}. Description: ${spec.description}. Stack: ${spec.stack.framework}, ${spec.stack.database || 'no database'}.`,
            },
            {
                name: 'Test and validate',
                prompt: `Run tests and validate the build for ${spec.appName}. Run tsc --noEmit, lint, and any configured tests. Fix any errors found.`,
            },
            {
                name: 'Finalize',
                prompt: `Finalize the build for ${spec.appName}. Ensure all files are complete, run a final validation, and mark the build as complete.`,
            },
        ],
    };
    return stringify(queue);
}

/**
 * Convert a FeatureSpec to a 6-step YAML queue for minions.
 * Steps: 1. Analyze, 2. Plan, 3. Generate, 4. Integrate, 5. Test, 6. Finalize
 */
function featureSpecToQueueYaml(spec: FeatureSpec): string {
    const queue = {
        queue: [
            {
                name: 'Analyze target app',
                prompt: `Analyze the target app ${spec.target.app}. Read its structure, dependencies, and conventions. Understand where this feature fits.`,
            },
            {
                name: 'Plan feature',
                prompt: `Plan the feature ${spec.feature.name} for app ${spec.target.app}. Determine which files need to be created or modified.`,
            },
            {
                name: 'Generate feature code',
                prompt: `Generate the feature code for ${spec.feature.name}. Target app: ${spec.target.app}. Phase: ${spec.phase || 'unspecified'}.`,
            },
            {
                name: 'Integrate with app',
                prompt: `Integrate the feature ${spec.feature.name} with the existing app ${spec.target.app}. Update routes, imports, and configuration as needed.`,
            },
            {
                name: 'Test feature',
                prompt: `Test the feature ${spec.feature.name}. Run tsc, lint, and any tests. Fix errors.`,
            },
            {
                name: 'Finalize feature',
                prompt: `Finalize the feature ${spec.feature.name}. Ensure everything is complete and mark as done.`,
            },
        ],
    };
    return stringify(queue);
}

// ─── Minions Runner ──────────────────────────────────────

/**
 * Run the minions engine against a spec.
 * Spawns the minions script with a generated YAML queue.
 */
async function runMinionsEngine(
    spec: AppSpec | FeatureSpec,
    context: ProjectContext,
    targetDir: string,
): Promise<BuildResult> {
    const isApp = 'appName' in spec;
    const queueYaml = isApp ? specToQueueYaml(spec as AppSpec) : featureSpecToQueueYaml(spec as FeatureSpec);

    // Write queue YAML to temp file
    const queueFile = join(tmpdir(), `factory-minions-${Date.now()}.yaml`);
    writeFileSync(queueFile, queueYaml);

    // Resolve minions script
    const minionsScript = resolve(process.cwd(), 'factory/scripts/minions/scripts/minions');

    if (!existsSync(minionsScript)) {
        return {
            success: false,
            files: [],
            plan: { files: [], architecture: 'minions', decisions: [] },
            iterations: 1,
            errors: [`Minions script not found: ${minionsScript}`],
        };
    }

    log('→', `Running minions engine with queue: ${queueFile}`);

    return new Promise((resolve) => {
        const child = spawn(minionsScript, ['--queue', queueFile, '--workdir', targetDir], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.trim()) log('  ', line.trim());
            }
        });

        child.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        child.on('close', (code: number | null) => {
            try {
                // Clean up queue file
                try { readFileSync(queueFile); } catch { /* ignore */ }
            } catch { /* ignore */ }

            if (code === 0) {
                const files = scanGeneratedFiles(targetDir);
                const name = isApp ? (spec as AppSpec).appName : (spec as FeatureSpec).feature.name;
                resolve({
                    success: true,
                    files,
                    plan: {
                        files: files.map(f => f.filename),
                        architecture: `minions: ${name}`,
                        decisions: ['engine:minions'],
                    },
                    iterations: 1,
                });
            } else {
                resolve({
                    success: false,
                    files: scanGeneratedFiles(targetDir),
                    plan: { files: [], architecture: 'minions', decisions: [] },
                    iterations: 1,
                    errors: [stderr.slice(0, 500) || `minions exited with code ${code}`],
                });
            }
        });

        child.on('error', (err: Error) => {
            resolve({
                success: false,
                files: [],
                plan: { files: [], architecture: 'minions', decisions: [] },
                iterations: 1,
                errors: [`Minions spawn error: ${err.message}`],
            });
        });
    });
}

// ─── File Scanning ───────────────────────────────────────

function scanGeneratedFiles(dir: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    if (!existsSync(dir)) return files;
    scanDir(dir, '', files);
    return files;
}

function scanDir(dir: string, prefix: string, files: GeneratedFile[]): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.factory' || entry.name === '.DS_Store') continue;
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            scanDir(join(dir, entry.name), relPath, files);
        } else {
            try {
                const content = readFileSync(join(dir, entry.name), 'utf-8');
                files.push({ filename: relPath, content });
            } catch {
                // Skip binary files
            }
        }
    }
}

// ─── CLI Integration ─────────────────────────────────────

/** Build using minions engine (called from cli.ts) */
export async function runMinionsBuild(
    spec: AppSpec,
    context: ProjectContext,
): Promise<BuildResult> {
    const slug = specSlug(spec);
    const targetDir = resolve(process.cwd(), slug);
    mkdirSync(targetDir, { recursive: true });
    return runMinionsEngine(spec, context, targetDir);
}

/** Feature build using minions engine (called from cli.ts) */
export async function runMinionsFeatureBuild(
    spec: FeatureSpec,
    context: ProjectContext,
    targetDir: string,
): Promise<BuildResult> {
    return runMinionsEngine(spec, context, targetDir);
}
