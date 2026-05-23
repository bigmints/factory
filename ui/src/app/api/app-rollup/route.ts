/**
 * GET /api/app-rollup — Fetch hierarchical rollup roadmaps (App -> Features -> Stories -> Tasks)
 * POST /api/app-rollup — Update status of a task or run CLI sync
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { getAppRollup, updateTaskStatus, syncAppRoadmap } from '@engine/rollup';
import { getActiveProject } from '@engine/config';
import { slugify } from '@engine/types';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let appId = searchParams.get('appId');

    const activeProject = getActiveProject();

    if (!appId) {
      if (activeProject) {
        const scaffoldYamlPath = join(activeProject.path, '.factory', 'scaffold.yaml');
        if (existsSync(scaffoldYamlPath)) {
          const raw = readFileSync(scaffoldYamlPath, 'utf-8');
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

    const data = getAppRollup(appId);
    if (!data) {
      return NextResponse.json({ error: `App "${appId}" not found or failed to load. Run "factory app sync" first.` }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Support sync action
    if (body.action === 'sync') {
      const activeProject = getActiveProject();
      if (!activeProject) {
        return NextResponse.json({ error: 'No active project found to sync.' }, { status: 400 });
      }

      const scaffoldYamlPath = join(activeProject.path, '.factory', 'scaffold.yaml');
      if (!existsSync(scaffoldYamlPath)) {
        return NextResponse.json({ error: 'scaffold.yaml not found in active project. Cannot sync.' }, { status: 404 });
      }

      await syncAppRoadmap(scaffoldYamlPath);
      return NextResponse.json({ success: true, message: 'Roadmap synchronized successfully.' });
    }

    const { taskId, status } = body;
    if (!taskId || !status) {
      return NextResponse.json({ error: 'Missing taskId or status.' }, { status: 400 });
    }

    if (!['pending', 'running', 'completed', 'failed'].includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    // Update task status in scaffold.yaml and recalculate rollups in-memory
    await updateTaskStatus(taskId, status);

    return NextResponse.json({ success: true, message: `Task "${taskId}" updated to "${status}" and scaffold.yaml synced.` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
