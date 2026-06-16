import { loadAppSpec, validateAppSpec, resolveStoryPath } from './story.ts';
import { writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { slugify } from './types.ts';
import { log, logError } from './log.ts';
import { getActiveProject } from './config.ts';
import { listQueue } from './queue.ts';
import lockfile from 'proper-lockfile';

export function getScaffoldYamlPath(): string {
    const project = getActiveProject();
    if (!project || !project.path) {
        throw new Error('No active project found for scaffold.yaml path');
    }
    return resolve(project.path, '.factory', 'scaffold.yaml');
}

export async function withScaffoldLock<T>(fn: () => Promise<T> | T): Promise<T> {
    try {
        const yamlPath = getScaffoldYamlPath();
        if (!existsSync(yamlPath)) {
            return await fn();
        }
        const release = await lockfile.lock(yamlPath, {
            stale: 10000,
            retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
            lockfilePath: yamlPath + '.lock',
        });
        try {
            return await fn();
        } finally {
            await release();
        }
    } catch {
        // Fall back to executing without lock if locking fails
        return await fn();
    }
}


export interface AppRollupData {
    id: string;
    name: string;
    description: string;
    brd: string;
    version: string;
    status: string;
    stack: any;
    progressPercent: number;
    features: Array<{
        id: string;
        name: string;
        description: string;
        status: string;
        progressPercent: number;
        stories: Array<{
            id: string;
            name: string;
            file: string;
            status: string;
            progressPercent: number;
            tasks: Array<{
                id: string;
                title: string;
                status: string;
            }>;
        }>;
    }>;
}

/**
 * Computes status rollups and progress percentages for an app spec in-memory.
 * Returns the modified app spec object.
 */
export function calculateRollups(app: any, appSlug: string): any {
    let appTotalTasks = 0;
    let appCompletedTasks = 0;
    let totalFeatures = 0;
    let completedFeatures = 0;
    let inProgressFeatures = 0;

    if (app.features) {
        for (const feature of app.features) {
            totalFeatures++;
            const featureSlug = slugify(feature.name);
            const featureId = `${appSlug}:${featureSlug}`;

            let featureTotalTasks = 0;
            let featureCompletedTasks = 0;
            let totalStories = 0;
            let doneStories = 0;
            let inProgressStories = 0;

            if (feature.stories) {
                for (const story of feature.stories) {
                    totalStories++;
                    const storySlug = slugify(story.name);
                    const storyId = `${featureId}:${storySlug}`;

                    let storyTotalTasks = 0;
                    let storyCompletedTasks = 0;

                    if (story.tasks) {
                        for (const task of story.tasks) {
                            storyTotalTasks++;
                            featureTotalTasks++;
                            appTotalTasks++;

                             if (['done', 'completed'].includes(task.status)) {
                                 storyCompletedTasks++;
                                 featureCompletedTasks++;
                                 appCompletedTasks++;
                             }
                         }
                     }
 
                     // Calculate story progress percentage
                     story.progressPercent = storyTotalTasks > 0
                         ? Math.round((storyCompletedTasks / storyTotalTasks) * 100)
                         : (['done', 'completed'].includes(story.status) ? 100 : 0);
 
                     // Rollup story status based on tasks
                     if (story.tasks && story.tasks.length > 0) {
                         const allCompleted = story.tasks.every((t: any) => ['done', 'completed'].includes(t.status));
                         const anyStarted = story.tasks.some((t: any) => ['done', 'completed', 'building', 'running', 'failed'].includes(t.status));
 
                         if (allCompleted) {
                             story.status = 'done';
                         } else if (anyStarted) {
                             if (!['paused', 'done', 'completed'].includes(story.status)) {
                                 story.status = 'building';
                             }
                         }
                         // Otherwise keep the original status (e.g. draft, ready)
                     }

                    if (story.status === 'done') {
                        doneStories++;
                    } else if (['building', 'paused'].includes(story.status)) {
                        inProgressStories++;
                    }
                }
            }

            // Calculate feature progress percentage
            feature.progressPercent = featureTotalTasks > 0
                ? Math.round((featureCompletedTasks / featureTotalTasks) * 100)
                : (totalStories > 0 ? Math.round((doneStories / totalStories) * 100) : 0);

            // Rollup feature status based on stories
            if (totalStories > 0) {
                if (doneStories === totalStories) {
                    feature.status = 'done';
                } else if (inProgressStories > 0 || doneStories > 0) {
                    feature.status = 'building';
                } else {
                    feature.status = 'ready-to-build';
                }
            } else {
                feature.status = feature.status || 'ready-to-build';
            }

            if (feature.status === 'done') {
                completedFeatures++;
            } else if (feature.status === 'building') {
                inProgressFeatures++;
            }
        }
    }

    // Calculate app progress percentage
    app.progressPercent = appTotalTasks > 0
        ? Math.round((appCompletedTasks / appTotalTasks) * 100)
        : (totalFeatures > 0 ? Math.round((completedFeatures / totalFeatures) * 100) : 0);

    // Rollup app status based on features
    if (totalFeatures > 0) {
        if (completedFeatures === totalFeatures) {
            app.status = 'done';
        } else if (inProgressFeatures > 0 || completedFeatures > 0) {
            app.status = 'building';
        } else {
            app.status = 'draft';
        }
    } else {
        app.status = app.status || 'draft';
    }

    return app;
}

/**
 * Synchronizes the scaffold.yaml specification synchronously.
 * Since we are database-free, this is a pure self-contained in-memory rollup
 * that writes status and progress rollups directly back to the yaml file.
 * It also auto-discovers physical story files and maps them to features/epics.
 */
export function syncAppRoadmapSync(scaffoldYamlPath: string): void {
    const absPath = resolve(scaffoldYamlPath);
    if (!existsSync(absPath)) {
        throw new Error(`App spec file not found at: ${absPath}`);
    }

    const app = loadAppSpec(absPath);
    const validation = validateAppSpec(app);
    if (!validation.passed) {
        logError(`App spec validation failed for ${scaffoldYamlPath}:`);
        for (const err of validation.errors) {
            log('  ', `  ✗ ${err}`);
        }
        throw new Error('Validation failed');
    }

    const appSlug = slugify(app.name);
    const project = getActiveProject();
    const storiesDir = resolve(project.path, '.factory', 'stories');

    // 1. Gather all existing story files referenced in scaffold.yaml to avoid duplicates
    const referencedFiles = new Set<string>();
    if (app.features) {
        for (const feature of app.features) {
            if (feature.stories) {
                for (const story of feature.stories) {
                    if (story.file) {
                        const clean = story.file.replace(/^\.?\//, '').replace(/^.*?\.factory\/stories\//, '');
                        referencedFiles.add(clean);
                    }
                }
            }
        }
    }

    // 2. Discover physical story files in features/, apps/, done/
    const newStories: { file: string; name: string; kind: 'AppStory' | 'FeatureStory'; status: string; requirements: string[] }[] = [];

    const appsDir = join(storiesDir, 'apps');
    const featuresDir = join(storiesDir, 'features');
    const doneDir = join(storiesDir, 'done');

    const scanDir = (dirPath: string, subfolder: 'apps' | 'features' | 'done') => {
        if (!existsSync(dirPath)) return;
        const files = readdirSync(dirPath).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of files) {
            const relPath = `${subfolder}/${file}`;
            if (referencedFiles.has(relPath)) continue;
            
            try {
                const absFilePath = join(dirPath, file);
                const raw = readFileSync(absFilePath, 'utf-8');
                const parsed = parseYaml(raw) as any;
                if (!parsed) continue;

                const isFeature = subfolder === 'features' || !!(parsed.feature || parsed.target || 'phase' in parsed);
                const name = isFeature 
                    ? (parsed.feature?.name || parsed.name || file.replace(/\.ya?ml$/i, ''))
                    : (parsed.appName || parsed.metadata?.name || file.replace(/\.ya?ml$/i, ''));
                
                let requirements: string[] = [];
                if (Array.isArray(parsed.requirements)) {
                    requirements = parsed.requirements;
                } else if (Array.isArray(parsed.acceptanceCriteria)) {
                    requirements = parsed.acceptanceCriteria;
                }
                
                newStories.push({
                    file: relPath,
                    name,
                    kind: isFeature ? 'FeatureStory' : 'AppStory',
                    status: parsed.status || (subfolder === 'done' ? 'done' : 'draft'),
                    requirements
                });
            } catch {}
        }
    };

    scanDir(appsDir, 'apps');
    scanDir(featuresDir, 'features');
    scanDir(doneDir, 'done');

    // 3. For each newly discovered story, append it to a feature in app.features
    if (newStories.length > 0) {
        if (!app.features) {
            app.features = [];
        }

        for (const story of newStories) {
            // Determine feature/epic name
            let featureName = story.kind === 'AppStory' ? '⚙️ Scaffold & Foundation' : story.name;
            let featureDescription = story.kind === 'AppStory' 
                ? 'Foundational scaffolding and environment baseline setup.' 
                : `Feature capability for ${story.name}.`;

            // Find or create feature
            let feature = app.features.find((f: any) => f.name.toLowerCase() === featureName.toLowerCase());
            if (!feature) {
                feature = {
                    name: featureName,
                    description: featureDescription,
                    status: 'ready-to-build',
                    stories: []
                };
                app.features.push(feature);
            }

            // Map tasks from requirements
            const tasks: any[] = story.requirements.map((req: string, idx: number) => ({
                id: `task-${slugify(story.name)}-${idx + 1}`,
                title: req.slice(0, 180),
                status: story.status === 'done' ? 'done' : 'ready-to-build'
            }));

            if (tasks.length === 0) {
                tasks.push({
                    id: `task-${slugify(story.name)}-default`,
                    title: `Implement core requirements for ${story.name}`,
                    status: story.status === 'done' ? 'done' : 'ready-to-build'
                });
            }

            feature.stories.push({
                name: story.name,
                file: story.file,
                status: story.status as any,
                tasks
            });
        }
    }

    // 4. Sync physical story statuses first
    if (app.features) {
        for (const feature of app.features) {
            if (feature.stories) {
                for (const story of feature.stories) {
                    if (story.file) {
                        try {
                            const storyAbsPath = resolveStoryPath(story.file);
                            if (existsSync(storyAbsPath)) {
                                const rawStory = readFileSync(storyAbsPath, 'utf-8');
                                const parsedStory = parseYaml(rawStory) as any;
                                const physicalStatus = parsedStory?.status;
                                if (physicalStatus) {
                                    story.status = physicalStatus;
                                    
                                    // If story is physically done, ensure all tasks are marked completed
                                    if (physicalStatus === 'done' && story.tasks) {
                                        for (const task of story.tasks) {
                                            task.status = 'done';
                                        }
                                    } else if (physicalStatus === 'draft' && story.tasks) {
                                        for (const task of story.tasks) {
                                            task.status = 'ready-to-build';
                                        }
                                    } else if (['building', 'paused'].includes(physicalStatus) && story.tasks) {
                                        // Ensure at least one task is started to support the rollup logic
                                        const hasStarted = story.tasks.some((t: any) => ['done', 'building', 'failed'].includes(t.status));
                                        if (!hasStarted && story.tasks.length > 0) {
                                            story.tasks[0].status = physicalStatus === 'paused' ? 'failed' : 'building';
                                        }
                                    }
                                }
                            }
                        } catch (e: any) {
                            logError(`Failed to sync physical story file "${story.file}": ${e?.message || e}`);
                        }
                    }
                }
            }
        }
    }

    // 5. Perform rollup computations directly in memory
    const updatedApp = calculateRollups(app, appSlug);

    // Write the updated spec back to the yaml file
    writeFileSync(absPath, stringifyYaml(updatedApp, { lineWidth: 120 }));
    log('✓', `Synced roadmap structure and statuses successfully: ${scaffoldYamlPath}`);
}

/**
 * Synchronizes the scaffold.yaml specification.
 */
export async function syncAppRoadmap(scaffoldYamlPath: string): Promise<void> {
    return withScaffoldLock(() => {
        syncAppRoadmapSync(scaffoldYamlPath);
    });
}

/**
 * Get overall progress stats for the app rollup UI dashboard.
 * Directly loads scaffold.yaml from the active project.
 * Resolves physical story statuses from the filesystem before computing rollups
 * so the UI always reflects real state without needing a manual sync.
 */
export async function getAppRollup(appId: string): Promise<AppRollupData | null> {
    return withScaffoldLock(async () => {
        try {
            const project = getActiveProject();
            const scaffoldYamlPath = resolve(project.path, '.factory', 'scaffold.yaml');
            if (!existsSync(scaffoldYamlPath)) {
                return null;
            }

            let raw = readFileSync(scaffoldYamlPath, 'utf-8');
            let app = parseYaml(raw) as any;
            if (!app) return null;

            // Auto-heal un-synchronized roadmaps on first load
            if (!app.features) {
                try {
                    syncAppRoadmapSync(scaffoldYamlPath);
                    // Reload
                    raw = readFileSync(scaffoldYamlPath, 'utf-8');
                    app = parseYaml(raw) as any;
                } catch (e) {
                    logError(`Auto-sync failed on load: ${e}`);
                }
            }

            const appSlug = slugify(app.name);
            const storiesDir = resolve(project.path, '.factory', 'stories');
            const queueItems = listQueue();

            // ── Discover physical story files not yet in scaffold.yaml ──────────────
            // Scan features/, apps/, done/ and inject any untracked stories as
            // synthetic epics into the in-memory app object.
            // This is read-only — no disk writes, no queue interference.
            {
                // Build a set of all filenames already tracked in scaffold.yaml
                const trackedStems = new Set<string>();
                if (app.features) {
                    for (const feature of app.features) {
                        for (const story of (feature.stories || [])) {
                            if (story.file) {
                                trackedStems.add(story.file.split('/').pop()?.replace(/\.ya?ml$/i, '') || '');
                            }
                        }
                    }
                }

                if (!app.features) app.features = [];

                const subDirs: Array<{ dir: string; subfolder: string }> = [
                    { dir: resolve(storiesDir, 'features'), subfolder: 'features' },
                    { dir: resolve(storiesDir, 'apps'),     subfolder: 'apps'     },
                    { dir: resolve(storiesDir, 'done'),     subfolder: 'done'     },
                ];

                for (const { dir, subfolder } of subDirs) {
                    if (!existsSync(dir)) continue;
                    let files: string[];
                    try { files = readdirSync(dir).filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml')); }
                    catch { continue; }

                    for (const file of files) {
                        const stem = file.replace(/\.ya?ml$/i, '');
                        if (trackedStems.has(stem)) continue;   // already in scaffold.yaml
                        trackedStems.add(stem);

                        try {
                            const raw = readFileSync(resolve(dir, file), 'utf-8');
                            const parsed = parseYaml(raw) as any;
                            if (!parsed) continue;

                            const isFeature = !!(parsed.feature || parsed.target || 'phase' in parsed);
                            const name = isFeature
                                ? (parsed.feature?.name || parsed.name || stem)
                                : (parsed.appName || parsed.metadata?.name || stem);

                            const storyStatus = parsed.status
                                || (subfolder === 'done' ? 'done' : 'draft');

                            // Determine epic group
                            const epicName = isFeature ? (parsed.feature?.name || name) : '⚙️ Scaffold & Foundation';

                            // Find or create a matching feature/epic
                            let epic = app.features.find((f: any) =>
                                f.name.toLowerCase() === epicName.toLowerCase()
                            );
                            if (!epic) {
                                epic = { name: epicName, description: '', status: 'ready-to-build', stories: [] };
                                app.features.push(epic);
                            }

                            // Build synthetic tasks from requirements / acceptance_criteria
                            const reqs: string[] = Array.isArray(parsed.requirements)
                                ? parsed.requirements
                                : Array.isArray(parsed.acceptanceCriteria)
                                ? parsed.acceptanceCriteria
                                : Array.isArray(parsed.acceptance_criteria)
                                ? parsed.acceptance_criteria
                                : [];

                            const tasks = reqs.length > 0
                                ? reqs.map((r: string, i: number) => ({
                                    id: `task-${stem}-${i + 1}`,
                                    title: r.slice(0, 180),
                                    status: storyStatus === 'done' ? 'done' : 'ready-to-build',
                                }))
                                : [{
                                    id: `task-${stem}-default`,
                                    title: `Implement ${name}`,
                                    status: storyStatus === 'done' ? 'done' : 'ready-to-build',
                                }];

                            epic.stories.push({
                                name,
                                file: `${subfolder}/${file}`,
                                status: storyStatus,
                                tasks,
                            });
                        } catch { /* skip unparseable files */ }
                    }
                }
            }

            // Resolve physical story status from filesystem BEFORE running rollup
            // This ensures done/in-progress status is always current, not stale YAML
            if (app.features) {
                for (const feature of app.features) {
                    if (feature.stories) {
                        for (const story of feature.stories) {
                            if (!story.file) continue;
                            try {
                                // Check done/ dir first (filename stem match)
                                const stem = story.file.split('/').pop()?.replace(/\.ya?ml$/i, '') || '';

                                const doneFile = resolve(storiesDir, 'done', `${stem}.yaml`);
                                const doneFileYml = resolve(storiesDir, 'done', `${stem}.yml`);
                                if (existsSync(doneFile) || existsSync(doneFileYml)) {
                                    story.status = 'done';
                                    if (story.tasks) {
                                        for (const task of story.tasks) task.status = 'done';
                                    }
                                    continue;
                                }

                                // Try to read the story file at its declared path
                                const candidates = [
                                    resolve(storiesDir, story.file),
                                    resolve(storiesDir, 'features', stem + '.yaml'),
                                    resolve(storiesDir, 'apps', stem + '.yaml'),
                                    resolve(project.path, '.factory', story.file),
                                ];

                                for (const candidate of candidates) {
                                    if (existsSync(candidate)) {
                                        const physicalStatus = (parseYaml(readFileSync(candidate, 'utf-8')) as any)?.status;
                                        if (physicalStatus) {
                                            story.status = physicalStatus;
                                            if (physicalStatus === 'done' && story.tasks) {
                                                for (const task of story.tasks) task.status = 'done';
                                            }
                                        }
                                        break;
                                    }
                                }

                                // Check active queue status from SQLite database queue
                                const qi = queueItems.find(item => {
                                    const qiFile = item.storyFile || '';
                                    return slugify(qiFile) === slugify(story.file) || slugify(qiFile.split('/').pop() || '') === slugify(stem);
                                });
                                if (qi) {
                                    if (qi.status === 'building') {
                                        story.status = 'building';
                                        if (story.tasks && story.tasks.length > 0) {
                                            const hasStarted = story.tasks.some((t: any) => ['done', 'building', 'failed'].includes(t.status));
                                            if (!hasStarted) {
                                                story.tasks[0].status = 'building';
                                            }
                                        }
                                    } else if (qi.status === 'done') {
                                        story.status = 'done';
                                        if (story.tasks) {
                                            for (const task of story.tasks) task.status = 'done';
                                        }
                                    } else if (qi.status === 'failed') {
                                        story.status = 'failed';
                                        if (story.tasks && story.tasks.length > 0) {
                                            const hasFailed = story.tasks.some((t: any) => ['done', 'building', 'failed'].includes(t.status));
                                            if (!hasFailed) {
                                                story.tasks[0].status = 'failed';
                                            }
                                        }
                                    }
                                }
                            } catch {
                                // ignore individual file read errors
                            }
                        }
                    }
                }
            }

            // Perform in-memory rollups with the now-correct physical statuses
            const rolled = calculateRollups(app, appSlug);

            const resultFeatures = [];
            if (rolled.features) {
                for (const feature of rolled.features) {
                    const featureSlug = slugify(feature.name);
                    const featureId = `${appSlug}:${featureSlug}`;

                    const resultStories = [];
                    if (feature.stories) {
                        for (const story of feature.stories) {
                            const storySlug = slugify(story.name);
                            const storyId = `${featureId}:${storySlug}`;

                            const tasks = story.tasks ? story.tasks.map((t: any) => ({
                                id: t.id,
                                title: t.title,
                                status: t.status
                            })) : [];

                            resultStories.push({
                                id: storyId,
                                name: story.name,
                                file: story.file || '',
                                status: story.status || 'draft',
                                progressPercent: story.progressPercent || 0,
                                tasks
                            });
                        }
                    }

                    resultFeatures.push({
                        id: featureId,
                        name: feature.name,
                        description: feature.description || '',
                        status: feature.status || 'ready-to-build',
                        progressPercent: feature.progressPercent || 0,
                        stories: resultStories
                    });
                }
            }

            return {
                id: appSlug,
                name: rolled.name,
                description: rolled.description || '',
                brd: rolled.brd || '',
                version: rolled.version || '1.0.0',
                status: rolled.status || 'draft',
                stack: rolled.stack || {},
                progressPercent: rolled.progressPercent || 0,
                features: resultFeatures
            };
        } catch (e: any) {
            logError(`Failed to rollup app roadmap: ${e?.message || e}`);
            return null;
        }
    });
}

/**
 * Updates the status of a specific task within scaffold.yaml directly, recalculating rollups.
 */
export async function updateTaskStatus(taskId: string, newStatus: string): Promise<void> {
    return withScaffoldLock(async () => {
        const project = getActiveProject();
        const yamlPath = resolve(project.path, '.factory', 'scaffold.yaml');
        if (!existsSync(yamlPath)) {
            throw new Error(`scaffold.yaml not found at active project: ${yamlPath}`);
        }

        const raw = readFileSync(yamlPath, 'utf-8');
        const app = parseYaml(raw) as any;
        if (!app) {
            throw new Error('Failed to parse scaffold.yaml');
        }

        // Traverse and update task
        let found = false;
        if (app.features) {
            for (const feature of app.features) {
                if (feature.stories) {
                    for (const story of feature.stories) {
                        if (story.tasks) {
                            for (const task of story.tasks) {
                                // Match exact taskId or trailing :taskId
                                if (task.id === taskId || taskId.endsWith(`:${task.id}`)) {
                                    task.status = newStatus;
                                    found = true;
                                    break;
                                }
                            }
                        }
                        if (found) break;
                    }
                }
                if (found) break;
            }
        }

        if (!found) {
            throw new Error(`Task with ID "${taskId}" not found in scaffold.yaml`);
        }

        // Re-run rollup calculations and save
        const appSlug = slugify(app.name);
        const updatedApp = calculateRollups(app, appSlug);
        writeFileSync(yamlPath, stringifyYaml(updatedApp, { lineWidth: 120 }), 'utf-8');
        log('✓', `Updated task "${taskId}" status to "${newStatus}" and saved scaffold.yaml`);
    });
}

/**
 * Updates the status of a specific story within scaffold.yaml directly, recalculating rollups.
 */
export async function updateStoryStatusInApp(storyFile: string, newStatus: string): Promise<void> {
    return withScaffoldLock(async () => {
        const project = getActiveProject();
        if (!project) return;
        const yamlPath = resolve(project.path, '.factory', 'scaffold.yaml');
        if (!existsSync(yamlPath)) return;

        const raw = readFileSync(yamlPath, 'utf-8');
        const app = parseYaml(raw) as any;
        if (!app) return;

        const basenameOfFile = storyFile.split('/').pop();

        let found = false;
        if (app.features) {
            for (const feature of app.features) {
                if (feature.stories) {
                    for (const story of feature.stories) {
                        const storyBasename = (story.file || '').split('/').pop();
                        if (story.file === storyFile || storyBasename === basenameOfFile) {
                            story.status = newStatus;
                            if (newStatus === 'done' && story.tasks) {
                                for (const task of story.tasks) {
                                    task.status = 'done';
                                }
                            } else if (['building', 'paused'].includes(newStatus) && story.tasks) {
                                const hasStarted = story.tasks.some((t: any) => ['done', 'building', 'failed'].includes(t.status));
                                if (!hasStarted && story.tasks.length > 0) {
                                    story.tasks[0].status = newStatus === 'paused' ? 'failed' : 'building';
                                }
                            }
                            found = true;
                            break;
                        }
                    }
                }
                if (found) break;
            }
        }

        if (!found) return;

        // Re-run rollup calculations and save
        const appSlug = slugify(app.name);
        const updatedApp = calculateRollups(app, appSlug);
        writeFileSync(yamlPath, stringifyYaml(updatedApp, { lineWidth: 120 }), 'utf-8');
        log('✓', `Updated story "${storyFile}" status to "${newStatus}" and saved scaffold.yaml`);
    });
}

/**
 * Removes a specific task from scaffold.yaml by its ID, recalculating rollups.
 */
export async function deleteTask(taskId: string): Promise<void> {
    return withScaffoldLock(async () => {
        const project = getActiveProject();
        const yamlPath = resolve(project.path, '.factory', 'scaffold.yaml');
        if (!existsSync(yamlPath)) {
            throw new Error(`scaffold.yaml not found at active project: ${yamlPath}`);
        }

        const raw = readFileSync(yamlPath, 'utf-8');
        const app = parseYaml(raw) as any;
        if (!app) {
            throw new Error('Failed to parse scaffold.yaml');
        }

        let found = false;
        if (app.features) {
            for (const feature of app.features) {
                if (feature.stories) {
                    for (const story of feature.stories) {
                        if (story.tasks) {
                            const originalLength = story.tasks.length;
                            story.tasks = story.tasks.filter((t: any) => !(t.id === taskId || taskId.endsWith(`:${t.id}`)));
                            if (story.tasks.length < originalLength) {
                                found = true;
                                break;
                            }
                        }
                    }
                }
                if (found) break;
            }
        }

        if (!found) {
            throw new Error(`Task with ID "${taskId}" not found in scaffold.yaml`);
        }

        // Re-run rollup calculations and save
        const appSlug = slugify(app.name);
        const updatedApp = calculateRollups(app, appSlug);
        writeFileSync(yamlPath, stringifyYaml(updatedApp, { lineWidth: 120 }), 'utf-8');
        log('✓', `Deleted task "${taskId}" from scaffold.yaml`);
    });
}


