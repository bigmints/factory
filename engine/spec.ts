import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AppSpec, FeatureSpec, SpecStatus, BuildMeta, ValidationResult } from './types.ts';
import { specSlug, specPort } from './types.ts';
import { log } from './log.ts';
import { execSync } from 'node:child_process';

// ─── Load ────────────────────────────────────────────────

/** Load an app spec from a YAML file */
export function loadSpec(specPath: string): AppSpec {
    const absPath = resolve(specPath);
    if (!existsSync(absPath)) {
        throw new Error(`Spec file not found: ${absPath}`);
    }
    const raw = readFileSync(absPath, 'utf-8');
    return parseYaml(raw) as AppSpec;
}

/** Load a feature spec from a YAML file */
export function loadFeatureSpec(specPath: string): FeatureSpec {
    const absPath = resolve(specPath);
    if (!existsSync(absPath)) {
        throw new Error(`Feature spec not found: ${absPath}`);
    }
    const raw = readFileSync(absPath, 'utf-8');
    return parseYaml(raw) as FeatureSpec;
}

/** List all spec files in a repo's .factory/specs/ directory */
export function listSpecs(repoPath: string): { apps: string[]; features: string[] } {
    const appsDir = join(repoPath, '.factory', 'specs', 'apps');
    const featuresDir = join(repoPath, '.factory', 'specs', 'features');

    const apps = existsSync(appsDir)
        ? readdirSync(appsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        : [];

    const features = existsSync(featuresDir)
        ? readdirSync(featuresDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        : [];

    return { apps, features };
}

// ─── Validate ────────────────────────────────────────────

/** Validate an app spec */
export function validateSpec(spec: AppSpec): ValidationResult {
    const errors: string[] = [];

    // Required: appName
    if (!spec.appName || spec.appName.trim().length === 0) {
        errors.push('appName is required');
    }

    // Required: description
    if (!spec.description || spec.description.trim().length === 0) {
        errors.push('description is required');
    }

    // Slug must be valid
    const slug = specSlug(spec);
    if (slug && !/^[a-z][a-z0-9-]*$/.test(slug)) {
        errors.push(`Invalid slug "${slug}" — must be lowercase alphanumeric with hyphens`);
    }

    // Required: stack.framework
    if (!spec.stack?.framework) {
        errors.push('stack.framework is required');
    }

    // Port range (if specified)
    const port = specPort(spec);
    if (spec.deployment?.port && (port < 1024 || port > 65535)) {
        errors.push(`Port ${port} is out of range (1024–65535)`);
    }

    // Data tables: each must have a name and at least one field
    if (spec.data?.tables) {
        for (const table of spec.data.tables) {
            if (!table.name) {
                errors.push('Each data table must have a name');
            }
            if (!table.fields || Object.keys(table.fields).length === 0) {
                errors.push(`Table "${table.name}" must have at least one field`);
            }
        }
    }

    // Auth: if provider is set, check it's a known value
    if (spec.auth?.provider) {
        const known = ['firebase', 'nextauth', 'supabase', 'clerk', 'none'];
        if (!known.includes(spec.auth.provider)) {
            errors.push(`Unknown auth provider "${spec.auth.provider}". Known: ${known.join(', ')}`);
        }
    }

    // Engine: if specified, must be 'factory' or 'minions'
    if (spec.engine && !['factory', 'minions'].includes(spec.engine)) {
        errors.push(`Unknown engine "${spec.engine}". Known: factory, minions`);
    }

    return { passed: errors.length === 0, errors };
}

/** Validate a feature spec */
export function validateFeatureSpec(spec: FeatureSpec): ValidationResult {
    const errors: string[] = [];

    if (!spec.feature?.name) {
        errors.push('feature.name is required');
    }
    if (!spec.feature?.slug) {
        errors.push('feature.slug is required');
    }
    if (!spec.target?.app) {
        errors.push('target.app is required');
    }

    // Validate phase
    if (spec.phase !== undefined && (typeof spec.phase !== 'number' || spec.phase < 1 || spec.phase > 10)) {
        errors.push('phase must be a number between 1 and 10');
    }

    // Validate dependsOn
    if (spec.dependsOn) {
        if (!Array.isArray(spec.dependsOn)) {
            errors.push('dependsOn must be an array of spec slugs');
        } else {
            for (const dep of spec.dependsOn) {
                if (typeof dep !== 'string' || !/^[a-z][a-z0-9-]*$/.test(dep)) {
                    errors.push(`Invalid dependency slug "${dep}" — must be lowercase alphanumeric with hyphens`);
                }
                if (dep === spec.feature?.slug) {
                    errors.push(`Spec cannot depend on itself ("${dep}")`);
                }
            }
        }
    }

    // Engine: if specified, must be 'factory' or 'minions'
    if (spec.engine && !['factory', 'minions'].includes(spec.engine)) {
        errors.push(`Unknown engine "${spec.engine}". Known: factory, minions`);
    }

    return { passed: errors.length === 0, errors };
}

// ─── Status Update ───────────────────────────────────────

/**
 * Update a spec YAML file's status field in-place.
 * Preserves all other content — only changes the `status:` line.
 */
export function updateSpecStatus(specPath: string, status: SpecStatus): void {
    const absPath = resolve(specPath);
    if (!existsSync(absPath)) return;

    const raw = readFileSync(absPath, 'utf-8');
    const spec = parseYaml(raw);
    spec.status = status;
    writeFileSync(absPath, stringifyYaml(spec, { lineWidth: 120 }));
}

// ─── Build Metadata Writeback ────────────────────────────

/**
 * Write build results back into the spec YAML.
 * Records: lastBuiltAt, buildCount, outputDir, commitHash, filesGenerated, iterations, taskType.
 */
export function updateSpecBuildMeta(
    specPath: string,
    meta: Omit<BuildMeta, 'buildCount' | 'lastBuiltAt'>,
    repoPath?: string,
): void {
    const absPath = resolve(specPath);
    if (!existsSync(absPath)) return;

    const raw = readFileSync(absPath, 'utf-8');
    const spec = parseYaml(raw);

    // Increment build count
    const prevCount = spec.build?.buildCount ?? 0;

    // Try to get the latest commit hash
    let commitHash = meta.commitHash;
    if (!commitHash && repoPath && existsSync(join(repoPath, '.git'))) {
        try {
            commitHash = execSync('git rev-parse --short HEAD', {
                cwd: repoPath,
                stdio: 'pipe',
            }).toString().trim();
        } catch {
            // ignore — commitHash stays undefined
        }
    }

    spec.build = {
        lastBuiltAt: new Date().toISOString(),
        buildCount: prevCount + 1,
        outputDir: meta.outputDir,
        commitHash,
        filesGenerated: meta.filesGenerated,
        iterations: meta.iterations,
        taskType: meta.taskType,
    };

    writeFileSync(absPath, stringifyYaml(spec, { lineWidth: 120 }));
    log('✓', `Build metadata written to spec (build #${spec.build.buildCount})`);
}

// ─── Archive Spec ────────────────────────────────────────

/**
 * Move a completed spec from specs/apps/ to specs/done/.
 * Creates the done/ directory if it doesn't exist.
 * Returns the new path, or null if the spec couldn't be moved.
 */
export function archiveSpec(specPath: string): string | null {
    const absPath = resolve(specPath);
    if (!existsSync(absPath)) return null;

    const specsDir = dirname(absPath);
    const parentDir = dirname(specsDir); // .factory/specs
    const doneDir = join(parentDir, 'done');

    // Only archive if the spec is in an apps/ or features/ folder
    const folderName = basename(specsDir);
    if (folderName !== 'apps' && folderName !== 'features') {
        log('!', `Spec not in apps/ or features/ — skipping archive`);
        return null;
    }

    // Create done/ directory
    if (!existsSync(doneDir)) {
        mkdirSync(doneDir, { recursive: true });
    }

    const filename = basename(absPath);
    const destPath = join(doneDir, filename);

    // If a file with the same name already exists in done/, add a timestamp suffix
    let finalDest = destPath;
    if (existsSync(destPath)) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
        const base = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;
        finalDest = join(doneDir, `${base}-${ts}${ext}`);
    }

    try {
        renameSync(absPath, finalDest);
        log('✓', `Archived spec → ${finalDest}`);
        return finalDest;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('!', `Failed to archive spec: ${msg}`);
        return null;
    }
}

