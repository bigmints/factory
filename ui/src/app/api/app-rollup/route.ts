import { homedir } from 'node:os';
/**
 * GET /api/app-rollup — Fetch hierarchical rollup roadmaps (App -> Features -> Stories -> Tasks)
 * POST /api/app-rollup — Update status of a task or run CLI sync
 */
import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import Database from 'better-sqlite3';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);
const FACTORY_ROOT = resolve(homedir(), '.factory');
const DB_PATH = resolve(FACTORY_ROOT, 'factory.db');
const PROJECTS_FILE = join(FACTORY_ROOT, 'projects.json');

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function loadProjectsConfig() {
  if (!existsSync(PROJECTS_FILE)) {
    return { activeProject: null, projects: [] };
  }
  return JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let appId = searchParams.get('appId');

    const config = loadProjectsConfig();
    const activeProject = config.projects.find((p: any) => p.id === config.activeProject);

    if (!appId) {
      if (activeProject) {
        const appYamlPath = join(activeProject.path, '.factory', 'app.yaml');
        if (existsSync(appYamlPath)) {
          const raw = readFileSync(appYamlPath, 'utf-8');
          const parsed = parseYaml(raw) as any;
          if (parsed && parsed.name) {
            appId = slugify(parsed.name);
          }
        }
      }
    }

    if (!appId) {
      return NextResponse.json({ error: 'No active project or appId provided.' }, { status: 400 });
    }

    if (!existsSync(DB_PATH)) {
      return NextResponse.json({ error: 'Database does not exist yet.' }, { status: 404 });
    }

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Fetch App
    const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId) as any;
    if (!app) {
      db.close();
      return NextResponse.json({ error: `App "${appId}" not found in database. Run "factory app sync" first.` }, { status: 404 });
    }

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
                tasks: tasks.map((t: any) => ({
                    id: t.id.split(':').pop() || t.id,
                    fullId: t.id,
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

    db.close();

    return NextResponse.json({
        id: app.id,
        name: app.name,
        description: app.description,
        brd: app.brd,
        version: app.version,
        status: app.status,
        stack: JSON.parse(app.stack),
        progressPercent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        features: resultFeatures
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Support sync action
    if (body.action === 'sync') {
      const config = loadProjectsConfig();
      const activeProject = config.projects.find((p: any) => p.id === config.activeProject);
      if (!activeProject) {
        return NextResponse.json({ error: 'No active project found to sync.' }, { status: 400 });
      }

      const appYamlPath = join(activeProject.path, '.factory', 'app.yaml');
      if (!existsSync(appYamlPath)) {
        return NextResponse.json({ error: 'app.yaml not found in active project. Cannot sync.' }, { status: 404 });
      }

      // Execute factory app sync command using node tsx runner
      await execPromise(`npx tsx engine/cli.ts app sync "${appYamlPath}"`, { cwd: resolve(process.cwd()) });
      return NextResponse.json({ success: true, message: 'Roadmap synchronized successfully.' });
    }

    const { taskId, status } = body;
    if (!taskId || !status) {
      return NextResponse.json({ error: 'Missing taskId or status.' }, { status: 400 });
    }

    if (!['pending', 'running', 'completed', 'failed'].includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    if (!existsSync(DB_PATH)) {
      return NextResponse.json({ error: 'Database does not exist yet.' }, { status: 404 });
    }

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Verify task exists
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task) {
      db.close();
      return NextResponse.json({ error: `Task "${taskId}" not found.` }, { status: 404 });
    }

    // Update task status in database
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);

    // Sync database status back to app.yaml in the active project
    const config = loadProjectsConfig();
    const activeProject = config.projects.find((p: any) => p.id === config.activeProject);
    if (!activeProject) {
      db.close();
      return NextResponse.json({ error: 'No active project found to write changes back.' }, { status: 400 });
    }

    const appYamlPath = join(activeProject.path, '.factory', 'app.yaml');
    if (!existsSync(appYamlPath)) {
      db.close();
      return NextResponse.json({ error: 'app.yaml not found in active project.' }, { status: 404 });
    }

    const app = parseYaml(readFileSync(appYamlPath, 'utf-8')) as any;
    const appSlug = slugify(app.name);

    // Sync App status
    const dbApp = db.prepare('SELECT status FROM apps WHERE id = ?').get(appSlug) as { status: string } | undefined;
    if (dbApp) {
      app.status = dbApp.status;
    }

    if (app.features) {
      for (const feature of app.features) {
        const featureSlug = slugify(feature.name);
        const featureId = `${appSlug}:${featureSlug}`;

        const dbFeature = db.prepare('SELECT status FROM features WHERE id = ?').get(featureId) as { status: string } | undefined;
        if (dbFeature) {
          feature.status = dbFeature.status;
        }

        if (feature.stories) {
          for (const story of feature.stories) {
            const storySlug = slugify(story.name);
            const storyId = `${featureId}:${storySlug}`;

            const dbStory = db.prepare('SELECT status FROM stories WHERE id = ?').get(storyId) as { status: string } | undefined;
            if (dbStory) {
              story.status = dbStory.status;
            }

            if (story.tasks) {
              for (const t of story.tasks) {
                const dbTId = `${storyId}:${t.id}`;
                const dbTask = db.prepare('SELECT status FROM tasks WHERE id = ?').get(dbTId) as { status: string } | undefined;
                if (dbTask) {
                  t.status = dbTask.status;
                }
              }
            }
          }
        }
      }
    }

    writeFileSync(appYamlPath, stringifyYaml(app, { lineWidth: 120 }));
    db.close();

    return NextResponse.json({ success: true, message: `Task "${taskId}" updated to "${status}" and app.yaml synced.` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
