import { loadAppSpec, validateAppSpec } from './story.ts';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { slugify } from './types.ts';
import { log, logError } from './log.ts';
import { getActiveProject } from './config.ts';

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

                            if (task.status === 'completed') {
                                storyCompletedTasks++;
                                featureCompletedTasks++;
                                appCompletedTasks++;
                            }
                        }
                    }

                    // Calculate story progress percentage
                    story.progressPercent = storyTotalTasks > 0
                        ? Math.round((storyCompletedTasks / storyTotalTasks) * 100)
                        : (story.status === 'done' ? 100 : 0);

                    // Rollup story status based on tasks
                    if (story.tasks && story.tasks.length > 0) {
                        const allCompleted = story.tasks.every((t: any) => t.status === 'completed');
                        const anyStarted = story.tasks.some((t: any) => ['completed', 'running', 'failed'].includes(t.status));

                        if (allCompleted) {
                            story.status = 'done';
                        } else if (anyStarted) {
                            if (!['validation', 'review', 'done'].includes(story.status)) {
                                story.status = 'in-progress';
                            }
                        }
                        // Otherwise keep the original status (e.g. draft, ready)
                    }

                    if (story.status === 'done') {
                        doneStories++;
                    } else if (['in-progress', 'validation', 'review'].includes(story.status)) {
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
                    feature.status = 'completed';
                } else if (inProgressStories > 0 || doneStories > 0) {
                    feature.status = 'in-progress';
                } else {
                    feature.status = 'pending';
                }
            } else {
                feature.status = feature.status || 'pending';
            }

            if (feature.status === 'completed') {
                completedFeatures++;
            } else if (feature.status === 'in-progress') {
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
            app.status = 'in-progress';
        } else {
            app.status = 'draft';
        }
    } else {
        app.status = app.status || 'draft';
    }

    return app;
}

/**
 * Synchronizes the app.yaml specification.
 * Since we are database-free, this is a pure self-contained in-memory rollup
 * that writes status and progress rollups directly back to the yaml file.
 */
export async function syncAppRoadmap(appYamlPath: string): Promise<void> {
    const absPath = resolve(appYamlPath);
    if (!existsSync(absPath)) {
        throw new Error(`App spec file not found at: ${absPath}`);
    }

    const app = loadAppSpec(absPath);
    const validation = validateAppSpec(app);
    if (!validation.passed) {
        logError(`App spec validation failed for ${appYamlPath}:`);
        for (const err of validation.errors) {
            log('  ', `  ✗ ${err}`);
        }
        throw new Error('Validation failed');
    }

    const appSlug = slugify(app.name);

    // Sync physical story statuses first
    if (app.features) {
        for (const feature of app.features) {
            if (feature.stories) {
                for (const story of feature.stories) {
                    if (story.file) {
                        try {
                            const { resolveStoryPath } = await import('./story.ts');
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
                                            task.status = 'completed';
                                        }
                                    } else if (['in-progress', 'validation', 'review'].includes(physicalStatus) && story.tasks) {
                                        // Ensure at least one task is started to support the rollup logic
                                        const hasStarted = story.tasks.some((t: any) => ['completed', 'running', 'failed'].includes(t.status));
                                        if (!hasStarted && story.tasks.length > 0) {
                                            story.tasks[0].status = physicalStatus === 'review' ? 'failed' : 'running';
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

    // Perform rollup computations directly in memory
    const updatedApp = calculateRollups(app, appSlug);

    // Write the updated spec back to the yaml file
    writeFileSync(absPath, stringifyYaml(updatedApp, { lineWidth: 120 }));
    log('✓', `Synced roadmap structure and statuses successfully: ${appYamlPath}`);
}

/**
 * Get overall progress stats for the app rollup UI dashboard.
 * Directly loads app.yaml from the active project.
 */
export function getAppRollup(appId: string): AppRollupData | null {
    try {
        const project = getActiveProject();
        const appYamlPath = resolve(project.path, '.factory', 'app.yaml');
        if (!existsSync(appYamlPath)) {
            return null;
        }

        const raw = readFileSync(appYamlPath, 'utf-8');
        const app = parseYaml(raw) as any;
        if (!app) return null;

        const appSlug = slugify(app.name);

        // Perform in-memory rollups to ensure absolute consistency
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
                    status: feature.status || 'pending',
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
}

/**
 * Updates the status of a specific task within app.yaml directly, recalculating rollups.
 */
export async function updateTaskStatus(taskId: string, newStatus: string): Promise<void> {
    const project = getActiveProject();
    const yamlPath = resolve(project.path, '.factory', 'app.yaml');
    if (!existsSync(yamlPath)) {
        throw new Error(`app.yaml not found at active project: ${yamlPath}`);
    }

    const raw = readFileSync(yamlPath, 'utf-8');
    const app = parseYaml(raw) as any;
    if (!app) {
        throw new Error('Failed to parse app.yaml');
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
        throw new Error(`Task with ID "${taskId}" not found in app.yaml`);
    }

    // Re-run rollup calculations and save
    const appSlug = slugify(app.name);
    const updatedApp = calculateRollups(app, appSlug);
    writeFileSync(yamlPath, stringifyYaml(updatedApp, { lineWidth: 120 }), 'utf-8');
    log('✓', `Updated task "${taskId}" status to "${newStatus}" and saved app.yaml`);
}

/**
 * Updates the status of a specific story within app.yaml directly, recalculating rollups.
 */
export async function updateStoryStatusInApp(storyFile: string, newStatus: string): Promise<void> {
    const project = getActiveProject();
    if (!project) return;
    const yamlPath = resolve(project.path, '.factory', 'app.yaml');
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
                                task.status = 'completed';
                            }
                        } else if (['in-progress', 'validation', 'review'].includes(newStatus) && story.tasks) {
                            const hasStarted = story.tasks.some((t: any) => ['completed', 'running', 'failed'].includes(t.status));
                            if (!hasStarted && story.tasks.length > 0) {
                                story.tasks[0].status = newStatus === 'review' ? 'failed' : 'running';
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
    log('✓', `Updated story "${storyFile}" status to "${newStatus}" and saved app.yaml`);
}

