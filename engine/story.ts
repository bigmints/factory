import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AppStory, FeatureStory, StoryStatus, BuildMeta, ValidationResult, AppSpec, TaskItemSpec } from './types.ts';
import { storySlug, storyPort } from './types.ts';
import { log } from './log.ts';
import { AppStorySchema, FeatureStorySchema } from './schemas.ts';
import { execSync } from 'node:child_process';

import { getActiveProject } from './config.ts';

export function resolveStoryPath(storyPath: string): string {
    const directPath = resolve(storyPath);
    if (existsSync(directPath)) {
        return directPath;
    }

    try {
        const project = getActiveProject();
        if (project && project.path) {
            const projectDirect = resolve(project.path, storyPath);
            if (existsSync(projectDirect)) {
                return projectDirect;
            }

            const possibleDirs = [
                join(project.path, '.factory', 'stories', 'features'),
                join(project.path, '.factory', 'stories', 'apps'),
                join(project.path, '.factory', 'stories', 'done'),
                join(project.path, '.factory', 'stories'),
                join(project.path, '.factory')
            ];

            const filename = basename(storyPath);
            for (const dir of possibleDirs) {
                const target = join(dir, filename);
                if (existsSync(target)) {
                    return target;
                }
                const nestedTarget = resolve(dir, storyPath);
                if (existsSync(nestedTarget)) {
                    return nestedTarget;
                }
            }
        }
    } catch {
        // ignore and fall back
    }

    return directPath;
}

// ─── Load ────────────────────────────────────────────────


/** Load an app story from a YAML file */
export function loadStory(storyPath: string): AppStory {
    const absPath = resolveStoryPath(storyPath);
    if (!existsSync(absPath)) {
        throw new Error(`Story file not found: ${absPath}`);
    }
    const raw = readFileSync(absPath, 'utf-8');
    return parseYaml(raw) as AppStory;
}

/** Load a feature story from a YAML file */
export function loadFeatureStory(storyPath: string): FeatureStory {
    const absPath = resolveStoryPath(storyPath);
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

    // Structural validation via Zod
    const result = AppStorySchema.safeParse(story);
    if (!result.success) {
        for (const issue of result.error.issues) {
            const path = issue.path.length > 0 ? issue.path.join('.') + ': ' : '';
            errors.push(`${path}${issue.message}`);
        }
    }

    // Slug must be valid (domain rule not encoded in schema)
    if (story.appName) {
        const slug = storySlug(story);
        if (slug && !/^[a-z][a-z0-9-]*$/.test(slug)) {
            errors.push(`Invalid slug "${slug}" — must be lowercase alphanumeric with hyphens`);
        }
    }

    // Auth: if provider is set, check it's a known value
    if (story.auth?.provider) {
        const known = ['firebase', 'nextauth', 'supabase', 'clerk', 'none'];
        if (!known.includes(story.auth.provider)) {
            errors.push(`Unknown auth provider "${story.auth.provider}". Known: ${known.join(', ')}`);
        }
    }

    return { passed: errors.length === 0, errors };
}

/** Validate a feature story */
export function validateFeatureStory(story: FeatureStory): ValidationResult {
    const errors: string[] = [];

    // Structural validation via Zod
    const result = FeatureStorySchema.safeParse(story);
    if (!result.success) {
        for (const issue of result.error.issues) {
            const path = issue.path.length > 0 ? issue.path.join('.') + ': ' : '';
            errors.push(`${path}${issue.message}`);
        }
    }

    // Self-dependency check (domain rule not encoded in schema)
    if (story.dependsOn && Array.isArray(story.dependsOn)) {
        for (const dep of story.dependsOn) {
            if (dep === story.feature?.slug) {
                errors.push(`Story cannot depend on itself ("${dep}")`);
            }
        }
    }

    return { passed: errors.length === 0, errors };
}

// ─── Status Update ───────────────────────────────────────

/**
 * Update a story YAML file's status field in-place.
 * Preserves all other content — only changes the `status:` line.
 */
export function updateStoryStatus(storyPath: string, status: StoryStatus): void {
    const absPath = resolveStoryPath(storyPath);
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
    const absPath = resolveStoryPath(storyPath);
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
    const absPath = resolveStoryPath(storyPath);
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

/**
 * Restore an archived story back to its original apps/ or features/ folder.
 * Returns the new path, or null if it could not be restored.
 */
export function restoreStory(storyPath: string): string | null {
    const absPath = resolveStoryPath(storyPath);
    if (!existsSync(absPath)) return null;

    const storiesDir = dirname(absPath);
    const folderName = basename(storiesDir);
    if (folderName !== 'done') {
        // Already not in done/, so no-op
        return absPath;
    }

    const parentDir = dirname(storiesDir); // .factory/stories
    
    // Read the file to determine if it is a FeatureStory or AppStory
    let isFeature = false;
    try {
        const raw = readFileSync(absPath, 'utf-8');
        const parsed = parseYaml(raw) as any;
        isFeature = !!(parsed && (parsed.feature || parsed.target || 'phase' in parsed));
    } catch (err) {
        log('!', `Could not parse story to determine type: ${(err as Error).message?.slice(0, 100) || err}`);
    }

    const targetSubdir = isFeature ? 'features' : 'apps';
    const destDir = join(parentDir, targetSubdir);

    if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
    }

    const filename = basename(absPath);
    const destPath = join(destDir, filename);

    try {
        renameSync(absPath, destPath);
        log('✓', `Restored story from done/ to ${targetSubdir}/: ${filename}`);
        return destPath;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('!', `Failed to restore story: ${msg}`);
        return null;
    }
}


/** Generate a draft scaffold.yaml spec from a new AppStory */
export function generateAppYamlFromStory(story: AppStory, storyFile?: string): AppSpec {
    const slug = storySlug(story);
    const storyFilename = storyFile ? basename(storyFile) : `${slug}.yaml`;

    // Build BRD content from story
    const dbSection = story.stack.database ? `- **Database**: ${story.stack.database}` : '';
    const authSection = story.auth?.provider ? `- **Authentication**: ${story.auth.provider} (${Object.keys(story.auth.methods || {}).filter(m => (story.auth?.methods as any)[m]).join(', ') || 'credentials'})` : '';
    const pagesSection = story.pages ? `- **Pages/Routes**: Dashboard, CRUD tables` : '';

    const brd = `
# ${story.appName} (BRD)

${story.description || 'No description provided.'}

## Architecture & Requirements
- **Framework**: ${story.stack.framework}
- **Language**: ${story.stack.language || 'TypeScript'}
${dbSection ? dbSection + '\n' : ''}${authSection ? authSection + '\n' : ''}${pagesSection ? pagesSection + '\n' : ''}
`.trim();

    // Map features/stories/tasks
    const coreTasks: TaskItemSpec[] = [
        { id: 'task-skeleton', title: 'Scaffold project skeleton and configurations', status: 'ready-to-build' },
        { id: 'task-pages', title: 'Implement main pages, layout, and styling views', status: 'ready-to-build' },
    ];

    if (story.auth?.provider && story.auth.provider !== 'none') {
        coreTasks.push({ id: 'task-auth', title: `Integrate and configure ${story.auth.provider} authentication`, status: 'ready-to-build' });
    }

    if (story.stack.database) {
        coreTasks.push({ id: 'task-database', title: `Setup ${story.stack.database} schema, connection, and seed data`, status: 'ready-to-build' });
    }

    const appSpec: AppSpec = {
        name: story.appName,
        description: story.description,
        brd,
        version: '1.0.0',
        stack: story.stack,
        status: 'draft',
        features: [
            {
                name: 'Core Foundation',
                description: `Foundational scaffolding and layout styling for ${story.appName}.`,
                status: 'ready-to-build',
                stories: [
                    {
                        name: story.appName,
                        file: `stories/apps/${storyFilename}`,
                        status: 'draft',
                        tasks: coreTasks,
                    }
                ]
            }
        ]
    };

    return appSpec;
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

