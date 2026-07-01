import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join, basename, dirname, relative } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Story, StoryStatus, BuildMeta, ValidationResult, AppSpec, TaskItemSpec } from './types.ts';
import { storySlug } from './types.ts';
import { log } from './log.ts';
import { StorySchema } from './schemas.ts';
import matter from 'gray-matter';
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


/** Load a story from a Markdown file with YAML frontmatter */
export function loadStory(storyPath: string): Story {
    const absPath = resolveStoryPath(storyPath);
    if (!existsSync(absPath)) {
        throw new Error(`Story file not found: ${absPath}`);
    }
    const raw = readFileSync(absPath, 'utf-8');
    
    // Parse using gray-matter
    const parsed = matter(raw);
    const story = {
        ...parsed.data,
        content: parsed.content.trim()
    } as Story;

    // Fallback if parsing didn't find kind (e.g., pure yaml files temporarily during migration)
    if (!story.kind) {
        if ((story as any).feature) story.kind = 'feature';
        else story.kind = 'app';
    }

    // Normalize target if it is an object (e.g. { app: 'bbr' })
    if (story.target && typeof story.target === 'object') {
        story.target = (story.target as any).app || '';
    }

    // Name fallback for legacy yaml
    if (!story.name) {
        if ((story as any).appName) story.name = (story as any).appName;
        else if ((story as any).feature?.name) story.name = (story as any).feature.name;
    }

    return story;
}

/** List all markdown story files in a repo's .factory/stories/ directory */
export function listStories(repoPath: string): { apps: string[]; features: string[] } {
    const storiesDir = join(repoPath, '.factory', 'stories');
    
    if (!existsSync(storiesDir)) {
        return { apps: [], features: [] };
    }

    const allFiles: string[] = [];
    function walk(dir: string, basePath = '') {
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name.startsWith('_')) {
                    continue;
                }
                const relPath = join(basePath, entry.name);
                if (entry.isDirectory()) {
                    walk(join(dir, entry.name), relPath);
                } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
                    allFiles.push(relPath);
                }
            }
        } catch { /* ignore */ }
    }
    walk(storiesDir);
    
    const apps: string[] = [];
    const features: string[] = [];

    for (const file of allFiles) {
        // Skip scaffold.md if we want to treat it specially, but usually it's an app story.
        try {
            const story = loadStory(join(storiesDir, file));
            if (story.kind === 'app') {
                apps.push(file);
            } else if (story.kind === 'feature') {
                features.push(file);
            }
        } catch {
            // If it fails to parse, just ignore or put it in apps by default to show an error later
            apps.push(file);
        }
    }

    return { apps, features };
}

// ─── Validate ────────────────────────────────────────────

/** Validate a story */
export function validateStory(story: Story): ValidationResult {
    const errors: string[] = [];

    // Structural validation via Zod
    const result = StorySchema.safeParse(story);
    if (!result.success) {
        for (const issue of result.error.issues) {
            const path = issue.path.length > 0 ? issue.path.join('.') + ': ' : '';
            errors.push(`${path}${issue.message}`);
        }
    }

    // Slug must be valid (domain rule not encoded in schema)
    if (story.name) {
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

    // Self-dependency check (for features)
    if (story.dependsOn && Array.isArray(story.dependsOn)) {
        for (const dep of story.dependsOn) {
            if (dep === storySlug(story)) {
                errors.push(`Feature cannot depend on itself ("${dep}")`);
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
export function updateStoryStatus(storyPath: string, status: StoryStatus, summary?: string): void {
    const absPath = resolveStoryPath(storyPath);
    if (!existsSync(absPath)) return;

    const raw = readFileSync(absPath, 'utf-8');
    const parsed = matter(raw);
    const story = parsed.data;
    story.status = status;
    
    let updatedContent = parsed.content.trim();
    if (summary) {
        updatedContent += `\n\n## Build Summary\n\n${summary}`;
    }

    const updated = `---\n${stringifyYaml(story, { lineWidth: 120 }).trim()}\n---\n\n${updatedContent}\n`;
    writeFileSync(absPath, updated);
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
    const parsed = matter(raw);
    const story = parsed.data;

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

    const updated = `---\n${stringifyYaml(story, { lineWidth: 120 }).trim()}\n---\n\n${parsed.content.trim()}\n`;
    writeFileSync(absPath, updated);
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

    const project = getActiveProject();
    if (!project || !project.path) {
        log('!', `No active project found — skipping archive`);
        return null;
    }

    const storiesRoot = join(project.path, '.factory', 'stories');
    const rel = relative(storiesRoot, absPath);
    const firstPart = rel.split(/[\\/]/)[0];

    // Archive if the story is directly in stories/
    if (firstPart === 'done') {
        log('!', `Story already in done/ — skipping archive`);
        return null;
    }

    const doneDir = join(storiesRoot, 'done');

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
    try {
        const raw = readFileSync(absPath, 'utf-8');
        // just parse to check valid yaml
        const _parsed = parseYaml(raw) as any;
    } catch (err) {
        log('!', `Could not parse story to determine type: ${(err as Error).message?.slice(0, 100) || err}`);
    }

    const destDir = parentDir;

    if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
    }

    const filename = basename(absPath);
    const destPath = join(destDir, filename);

    try {
        renameSync(absPath, destPath);
        log('✓', `Restored story from done/ to stories/: ${filename}`);
        return destPath;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('!', `Failed to restore story: ${msg}`);
        return null;
    }
}


/** Generate a draft scaffold.yaml spec from a new AppStory */
export function generateAppYamlFromStory(story: Story, storyFile?: string): AppSpec {
    const slug = storySlug(story);
    const storyFilename = storyFile ? basename(storyFile) : `${slug}.yaml`;

    // Build BRD content from story
    const stack = story.stack || {} as any;
    const dbSection = stack.database ? `- **Database**: ${stack.database}` : '';
    const authSection = story.auth?.provider ? `- **Authentication**: ${story.auth.provider} (${Object.keys(story.auth.methods || {}).filter(m => (story.auth?.methods as any)[m]).join(', ') || 'credentials'})` : '';
    const pagesSection = story.pages ? `- **Pages/Routes**: Dashboard, CRUD tables` : '';

    const brd = `
# ${story.name} (BRD)

${story.description || 'No description provided.'}

## Architecture & Requirements
- **Framework**: ${stack.framework || 'unknown'}
- **Language**: ${stack.language || 'TypeScript'}
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

    if (stack.database) {
        coreTasks.push({ id: 'task-database', title: `Setup ${stack.database} schema, connection, and seed data`, status: 'ready-to-build' });
    }

    const appSpec: AppSpec = {
        name: story.name,
        description: story.description || '',
        brd,
        version: '1.0.0',
        stack: story.stack || { framework: 'unknown' } as any,
        status: 'draft',
        features: [
            {
                name: 'Core Foundation',
                description: `Foundational scaffolding and layout styling for ${story.name}.`,
                status: 'ready-to-build',
                stories: [
                    {
                        name: story.name,
                        file: `stories/${storyFilename}`,
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
                                        if (task.status && !['pending', 'running', 'completed', 'failed', 'done', 'building', 'ready-to-build', 'paused', 'draft'].includes(task.status)) {
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

/**
 * Topologically sort a list of pending story items based on phase and dependsOn.
 */
export function sortStoriesTopologically(pending: Array<{ path: string, story: any }>): Array<{ path: string, story: any }> {
    // Sort by phase first
    pending.sort((a, b) => {
        const phaseA = typeof a.story.phase === 'number' ? a.story.phase : 99;
        const phaseB = typeof b.story.phase === 'number' ? b.story.phase : 99;
        return phaseA - phaseB;
    });

    // Topological sort respecting dependencies
    const orderedPending: typeof pending = [];
    const visited = new Set<string>();
    const pendingMap = new Map(pending.map(item => [item.story.feature?.slug || item.story.name, item]));

    function visit(item: typeof pending[0]) {
        const key = item.story.feature?.slug || item.story.name;
        if (!key || visited.has(key)) return;
        visited.add(key);
        
        const deps = item.story.dependsOn || [];
        for (const dep of deps) {
            const depItem = pendingMap.get(dep);
            if (depItem) visit(depItem);
        }
        orderedPending.push(item);
    }

    for (const item of pending) {
        visit(item);
    }

    return orderedPending;
}


