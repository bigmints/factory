import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AppStory, FeatureStory, StoryStatus, BuildMeta, ValidationResult, AppSpec } from './types.ts';
import { storySlug, storyPort } from './types.ts';
import { log } from './log.ts';
import { execSync } from 'node:child_process';

// ─── Load ────────────────────────────────────────────────


/** Load an app story from a YAML file */
export function loadStory(storyPath: string): AppStory {
    const absPath = resolve(storyPath);
    if (!existsSync(absPath)) {
        throw new Error(`Story file not found: ${absPath}`);
    }
    const raw = readFileSync(absPath, 'utf-8');
    return parseYaml(raw) as AppStory;
}

/** Load a feature story from a YAML file */
export function loadFeatureStory(storyPath: string): FeatureStory {
    const absPath = resolve(storyPath);
    if (!existsSync(absPath)) {
        throw new Error(`Feature story not found: ${absPath}`);
    }
    const raw = readFileSync(absPath, 'utf-8');
    return parseYaml(raw) as FeatureStory;
}

/** List all story files in a repo's .factory/stories/ directory */
export function listStories(repoPath: string): { apps: string[]; features: string[] } {
    const appsDir = join(repoPath, '.factory', 'stories', 'apps');
    const featuresDir = join(repoPath, '.factory', 'stories', 'features');

    const apps = existsSync(appsDir)
        ? readdirSync(appsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        : [];

    const features = existsSync(featuresDir)
        ? readdirSync(featuresDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        : [];

    return { apps, features };
}

// ─── Validate ────────────────────────────────────────────

/** Validate an app story */
export function validateStory(story: AppStory): ValidationResult {
    const errors: string[] = [];

    // Required: appName
    if (!story.appName || story.appName.trim().length === 0) {
        errors.push('appName is required');
    }

    // Required: description
    if (!story.description || story.description.trim().length === 0) {
        errors.push('description is required');
    }

    // Slug must be valid
    const slug = storySlug(story);
    if (slug && !/^[a-z][a-z0-9-]*$/.test(slug)) {
        errors.push(`Invalid slug "${slug}" — must be lowercase alphanumeric with hyphens`);
    }

    // Required: stack.framework
    if (!story.stack?.framework) {
        errors.push('stack.framework is required');
    }

    // Port range (if specified)
    const port = storyPort(story);
    if (story.deployment?.port && (port < 1024 || port > 65535)) {
        errors.push(`Port ${port} is out of range (1024–65535)`);
    }

    // Data tables: each must have a name and at least one field
    if (story.data?.tables) {
        for (const table of story.data.tables) {
            if (!table.name) {
                errors.push('Each data table must have a name');
            }
            if (!table.fields || Object.keys(table.fields).length === 0) {
                errors.push(`Table "${table.name}" must have at least one field`);
            }
        }
    }

    // Auth: if provider is set, check it's a known value
    if (story.auth?.provider) {
        const known = ['firebase', 'nextauth', 'supabase', 'clerk', 'none'];
        if (!known.includes(story.auth.provider)) {
            errors.push(`Unknown auth provider "${story.auth.provider}". Known: ${known.join(', ')}`);
        }
    }

    // Engine: if specified, must be 'factory' or 'worker'
    if (story.engine && !['factory', 'worker'].includes(story.engine)) {
        errors.push(`Unknown engine "${story.engine}". Known: factory, worker`);
    }

    return { passed: errors.length === 0, errors };
}

/** Validate a feature story */
export function validateFeatureStory(story: FeatureStory): ValidationResult {
    const errors: string[] = [];

    if (!story.feature?.name) {
        errors.push('feature.name is required');
    }
    if (!story.feature?.slug) {
        errors.push('feature.slug is required');
    }
    if (!story.target?.app) {
        errors.push('target.app is required');
    }

    // Validate phase
    if (story.phase !== undefined && (typeof story.phase !== 'number' || story.phase < 1 || story.phase > 10)) {
        errors.push('phase must be a number between 1 and 10');
    }

    // Validate dependsOn
    if (story.dependsOn) {
        if (!Array.isArray(story.dependsOn)) {
            errors.push('dependsOn must be an array of story slugs');
        } else {
            for (const dep of story.dependsOn) {
                if (typeof dep !== 'string' || !/^[a-z][a-z0-9-]*$/.test(dep)) {
                    errors.push(`Invalid dependency slug "${dep}" — must be lowercase alphanumeric with hyphens`);
                }
                if (dep === story.feature?.slug) {
                    errors.push(`Story cannot depend on itself ("${dep}")`);
                }
            }
        }
    }

    // Engine: if specified, must be 'factory' or 'worker'
    if (story.engine && !['factory', 'worker'].includes(story.engine)) {
        errors.push(`Unknown engine "${story.engine}". Known: factory, worker`);
    }

    return { passed: errors.length === 0, errors };
}

// ─── Status Update ───────────────────────────────────────

/**
 * Update a story YAML file's status field in-place.
 * Preserves all other content — only changes the `status:` line.
 */
export function updateStoryStatus(storyPath: string, status: StoryStatus): void {
    const absPath = resolve(storyPath);
    if (!existsSync(absPath)) return;

    const raw = readFileSync(absPath, 'utf-8');
    const story = parseYaml(raw);
    story.status = status;
    writeFileSync(absPath, stringifyYaml(story, { lineWidth: 120 }));
}

// ─── Build Metadata Writeback ────────────────────────────

/**
 * Write build results back into the story YAML.
 * Records: lastBuiltAt, buildCount, outputDir, commitHash, filesGenerated, iterations, taskType.
 */
export function updateStoryBuildMeta(
    storyPath: string,
    meta: Omit<BuildMeta, 'buildCount' | 'lastBuiltAt'>,
    repoPath?: string,
): void {
    const absPath = resolve(storyPath);
    if (!existsSync(absPath)) return;

    const raw = readFileSync(absPath, 'utf-8');
    const story = parseYaml(raw);

    // Increment build count
    const prevCount = story.build?.buildCount ?? 0;

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

    story.build = {
        lastBuiltAt: new Date().toISOString(),
        buildCount: prevCount + 1,
        outputDir: meta.outputDir,
        commitHash,
        filesGenerated: meta.filesGenerated,
        iterations: meta.iterations,
        taskType: meta.taskType,
    };

    writeFileSync(absPath, stringifyYaml(story, { lineWidth: 120 }));
    log('✓', `Build metadata written to story (build #${story.build.buildCount})`);
}

// ─── Archive Story ────────────────────────────────────────

/**
 * Move a completed story from stories/apps/ to stories/done/.
 * Creates the done/ directory if it doesn't exist.
 * Returns the new path, or null if the story couldn't be moved.
 */
export function archiveStory(storyPath: string): string | null {
    const absPath = resolve(storyPath);
    if (!existsSync(absPath)) return null;

    const storiesDir = dirname(absPath);
    const parentDir = dirname(storiesDir); // .factory/stories
    const doneDir = join(parentDir, 'done');

    // Only archive if the story is in an apps/ or features/ folder
    const folderName = basename(storiesDir);
    if (folderName !== 'apps' && folderName !== 'features') {
        log('!', `Story not in apps/ or features/ — skipping archive`);
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
        log('✓', `Archived story → ${finalDest}`);
        return finalDest;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('!', `Failed to archive story: ${msg}`);
        return null;
    }
}

/** Load an app spec from a YAML file */
export function loadAppSpec(appPath: string): AppSpec {
    const absPath = resolve(appPath);
    if (!existsSync(absPath)) {
        throw new Error(`App spec file not found: ${absPath}`);
    }
    const raw = readFileSync(absPath, 'utf-8');
    return parseYaml(raw) as AppSpec;
}

/** Validate an app spec */
export function validateAppSpec(app: AppSpec): ValidationResult {
    const errors: string[] = [];

    if (!app.name || app.name.trim().length === 0) {
        errors.push('App name is required');
    }
    if (!app.description || app.description.trim().length === 0) {
        errors.push('App description is required');
    }
    if (!app.brd || app.brd.trim().length === 0) {
        errors.push('App brd is required');
    }
    if (!app.version || app.version.trim().length === 0) {
        errors.push('App version is required');
    }
    if (!app.stack?.framework) {
        errors.push('App stack.framework is required');
    }

    if (app.features) {
        if (!Array.isArray(app.features)) {
            errors.push('App features must be an array');
        } else {
            for (let fIdx = 0; fIdx < app.features.length; fIdx++) {
                const feature = app.features[fIdx];
                if (!feature.name || feature.name.trim().length === 0) {
                    errors.push(`Feature at index ${fIdx} must have a name`);
                }
                if (feature.stories) {
                    if (!Array.isArray(feature.stories)) {
                        errors.push(`Feature "${feature.name}" stories must be an array`);
                    } else {
                        for (let sIdx = 0; sIdx < feature.stories.length; sIdx++) {
                            const story = feature.stories[sIdx];
                            if (!story.name || story.name.trim().length === 0) {
                                errors.push(`Story at index ${sIdx} under Feature "${feature.name}" must have a name`);
                            }
                            if (story.tasks) {
                                if (!Array.isArray(story.tasks)) {
                                    errors.push(`Story "${story.name}" tasks must be an array`);
                                } else {
                                    for (let tIdx = 0; tIdx < story.tasks.length; tIdx++) {
                                        const task = story.tasks[tIdx];
                                        if (!task.id || task.id.trim().length === 0) {
                                            errors.push(`Task at index ${tIdx} under Story "${story.name}" must have an id`);
                                        }
                                        if (!task.title || task.title.trim().length === 0) {
                                            errors.push(`Task at index ${tIdx} under Story "${story.name}" must have a title`);
                                        }
                                        if (task.status && !['pending', 'running', 'completed', 'failed'].includes(task.status)) {
                                            errors.push(`Task "${task.title}" has invalid status "${task.status}"`);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return { passed: errors.length === 0, errors };
}

