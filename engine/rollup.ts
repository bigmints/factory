import { getDb } from './db.ts';
import { loadAppSpec, validateAppSpec } from './story.ts';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { slugify } from './types.ts';
import { log, logError } from './log.ts';

/**
 * Synchronizes the app.yaml specification with the SQLite database.
 * 
 * 1. Reads app.yaml
 * 2. Merges database runtime task/story/epic statuses into the spec tree
 * 3. Writes missing/updated structures to the database
 * 4. Recalculates all progress/statuses using SQLite triggers/queries
 * 5. Saves the final aggregated status/percentages back to app.yaml
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

    const db = getDb();
    const appSlug = slugify(app.name);

    // Get existing database statuses to merge and keep runtime state
    const existingTasks = new Map<string, string>();
    try {
        const rows = db.prepare('SELECT id, status FROM tasks').all() as { id: string; status: string }[];
        for (const r of rows) {
            existingTasks.set(r.id, r.status);
        }
    } catch (e) {
        // Tables might be empty or triggers not fired yet, ignore
    }

    // 1. Upsert App
    db.prepare(`
        INSERT INTO apps (id, name, description, brd, version, stack, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            brd = excluded.brd,
            version = excluded.version,
            stack = excluded.stack
    `).run(
        appSlug,
        app.name,
        app.description,
        app.brd,
        app.version,
        JSON.stringify(app.stack),
        app.status || 'draft'
    );

    // Keep track of visited keys to clean up deleted elements if needed
    const activeFeatureIds = new Set<string>();
    const activeStoryIds = new Set<string>();
    const activeTaskIds = new Set<string>();

    // 2. Loop features, stories, and tasks
    if (app.features) {
        for (const feature of app.features) {
            const featureSlug = slugify(feature.name);
            const featureId = `${appSlug}:${featureSlug}`;
            activeFeatureIds.add(featureId);

            db.prepare(`
                INSERT INTO features (id, app_id, name, description, status)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description
            `).run(
                featureId,
                appSlug,
                feature.name,
                feature.description || '',
                feature.status || 'pending'
            );

            if (feature.stories) {
                for (const story of feature.stories) {
                    const storySlug = slugify(story.name);
                    const storyId = `${featureId}:${storySlug}`;
                    activeStoryIds.add(storyId);

                    db.prepare(`
                        INSERT INTO stories (id, feature_id, name, story_file, status)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            name = excluded.name,
                            story_file = excluded.story_file
                    `).run(
                        storyId,
                        featureId,
                        story.name,
                        story.file || '',
                        story.status || 'draft'
                    );

                    if (story.tasks) {
                        for (const task of story.tasks) {
                            const taskId = `${storyId}:${task.id}`;
                            activeTaskIds.add(taskId);

                            // Keep runtime database status if it exists, otherwise use YAML status
                            const dbStatus = existingTasks.get(taskId) || task.status || 'pending';

                            db.prepare(`
                                INSERT INTO tasks (id, story_id, title, status)
                                VALUES (?, ?, ?, ?)
                                ON CONFLICT(id) DO UPDATE SET
                                    title = excluded.title
                            `).run(
                                taskId,
                                storyId,
                                task.title,
                                dbStatus
                            );
                        }
                    }
                }
            }
        }
    }

    // 3. Perform manual updates of statuses and percentages to sync DB perfectly
    // The SQLite triggers are active, but let's run updates on all tasks to ensure triggers propagate
    try {
        const tasks = db.prepare('SELECT id, status FROM tasks').all() as { id: string; status: string }[];
        for (const t of tasks) {
            db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(t.status, t.id);
        }
    } catch (e) {
        log('!', `Trigger propagation hint: ${e}`);
    }

    // 4. Read the updated statuses from the DB and write back to app.yaml
    const dbApp = db.prepare('SELECT status FROM apps WHERE id = ?').get(appSlug) as { status: string } | undefined;
    if (dbApp) {
        app.status = dbApp.status as any;
    }

    if (app.features) {
        for (const feature of app.features) {
            const featureSlug = slugify(feature.name);
            const featureId = `${appSlug}:${featureSlug}`;

            const dbFeature = db.prepare('SELECT status FROM features WHERE id = ?').get(featureId) as { status: string } | undefined;
            if (dbFeature) {
                feature.status = dbFeature.status as any;
            }

            if (feature.stories) {
                for (const story of feature.stories) {
                    const storySlug = slugify(story.name);
                    const storyId = `${featureId}:${storySlug}`;

                    const dbStory = db.prepare('SELECT status FROM stories WHERE id = ?').get(storyId) as { status: string } | undefined;
                    if (dbStory) {
                        story.status = dbStory.status as any;
                    }

                    if (story.tasks) {
                        for (const task of story.tasks) {
                            const taskId = `${storyId}:${task.id}`;
                            const dbTask = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string } | undefined;
                            if (dbTask) {
                                task.status = dbTask.status as any;
                            }
                        }
                    }
                }
            }
        }
    }

    // Write the updated spec back to the yaml file
    writeFileSync(absPath, stringifyYaml(app, { lineWidth: 120 }));
    log('✓', `Synced roadmap structure and statuses successfully: ${appYamlPath}`);
}

/** Get overall progress stats for the app rollup UI dashboard */
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

export function getAppRollup(appId: string): AppRollupData | null {
    const db = getDb();
    const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId) as any;
    if (!app) return null;

    const features = db.prepare('SELECT * FROM features WHERE app_id = ?').all(appId) as any[];
    const resultFeatures = [];

    let totalTasks = 0;
    let completedTasks = 0;

    for (const f of features) {
        const stories = db.prepare('SELECT * FROM stories WHERE feature_id = ?').all(f.id) as any[];
        const resultStories = [];

        let fTotalTasks = 0;
        let fCompletedTasks = 0;

        for (const s of stories) {
            const tasks = db.prepare('SELECT * FROM tasks WHERE story_id = ?').all(s.id) as any[];
            let sCompleted = 0;

            for (const t of tasks) {
                if (t.status === 'completed') {
                    sCompleted++;
                    fCompletedTasks++;
                    completedTasks++;
                }
                fTotalTasks++;
                totalTasks++;
            }

            resultStories.push({
                id: s.id,
                name: s.name,
                file: s.story_file,
                status: s.status,
                progressPercent: tasks.length > 0 ? Math.round((sCompleted / tasks.length) * 100) : 0,
                tasks: tasks.map(t => ({
                    id: t.id.split(':').pop() || t.id,
                    title: t.title,
                    status: t.status
                }))
            });
        }

        resultFeatures.push({
            id: f.id,
            name: f.name,
            description: f.description,
            status: f.status,
            progressPercent: fTotalTasks > 0 ? Math.round((fCompletedTasks / fTotalTasks) * 100) : 0,
            stories: resultStories
        });
    }

    return {
        id: app.id,
        name: app.name,
        description: app.description,
        brd: app.brd,
        version: app.version,
        status: app.status,
        stack: JSON.parse(app.stack),
        progressPercent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        features: resultFeatures
    };
}
