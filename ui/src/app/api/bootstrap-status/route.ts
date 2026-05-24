/**
 * GET /api/bootstrap-status
 * Returns whether the active project has been bootstrapped (scaffold built).
 *
 * Response:
 *   { bootstrapped: boolean, scaffoldStory: string | null, projectName: string | null }
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FACTORY_ROOT = resolve(homedir(), '.factory');

function getActiveProjectPath(): { path: string; name: string } | null {
  try {
    const projectsPath = join(FACTORY_ROOT, 'projects.json');
    if (!existsSync(projectsPath)) return null;
    const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
    if (!config.activeProject) return null;
    const project = config.projects?.find((p: any) => p.id === config.activeProject);
    return project ? { path: project.path, name: project.name } : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const project = getActiveProjectPath();
    if (!project) {
      return NextResponse.json({ bootstrapped: true, scaffoldStory: null, projectName: null });
    }

    const factoryYaml = join(project.path, '.factory', 'factory.yaml');
    if (!existsSync(factoryYaml)) {
      // No bridge config — treat as bootstrapped (existing project without factory.yaml)
      return NextResponse.json({ bootstrapped: true, scaffoldStory: null, projectName: project.name });
    }

    const config = parseYaml(readFileSync(factoryYaml, 'utf-8')) as any;

    // Explicitly false → not bootstrapped. Absent/true → bootstrapped.
    const bootstrapped = config?.project?.bootstrapped !== false;

    // Find the scaffold story file path (AppStory in stories/apps/)
    let scaffoldStory: string | null = null;
    const appsDir = join(project.path, '.factory', 'stories', 'apps');
    if (existsSync(appsDir)) {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(appsDir).filter(
        (f: string) => f.endsWith('.yaml') || f.endsWith('.yml')
      );
      if (files.length > 0) {
        scaffoldStory = `apps/${files[0]}`;
      }
    }

    return NextResponse.json({
      bootstrapped,
      scaffoldStory,
      projectName: project.name,
    });
  } catch (err: any) {
    return NextResponse.json(
      { bootstrapped: true, scaffoldStory: null, projectName: null, error: err.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bootstrap-status
 * Manually set bootstrapped: true (for existing projects being connected).
 */
export async function POST() {
  try {
    const project = getActiveProjectPath();
    if (!project) {
      return NextResponse.json({ error: 'No active project' }, { status: 400 });
    }

    const factoryYaml = join(project.path, '.factory', 'factory.yaml');
    if (!existsSync(factoryYaml)) {
      return NextResponse.json({ error: 'No factory.yaml found' }, { status: 400 });
    }

    const { readFileSync, writeFileSync, renameSync } = await import('node:fs');
    const { parse, stringify } = await import('yaml');

    const raw = readFileSync(factoryYaml, 'utf-8');
    const config = parse(raw) as any;
    if (!config.project) config.project = {};
    config.project.bootstrapped = true;

    const tmpPath = factoryYaml + '.tmp';
    writeFileSync(tmpPath, stringify(config, { lineWidth: 120 }));
    renameSync(tmpPath, factoryYaml);

    return NextResponse.json({ success: true, bootstrapped: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
