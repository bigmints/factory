import { homedir } from 'node:os';
/**
 * GET  /api/stories/[file] — Read raw YAML content of a story file
 * PUT  /api/stories/[file] — Write updated YAML content back to the story file
 */
import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const FACTORY_ROOT = resolve(homedir(), '.factory');

/**
 * Resolve the stories base directory — active project.
 */
function getStoriesBase(): string {
  try {
    const projectsPath = join(FACTORY_ROOT, 'projects.json');
    if (existsSync(projectsPath)) {
      const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
      if (config.activeProject) {
        const project = config.projects?.find(
          (p: any) => p.id === config.activeProject
        );
        if (project) {
          return join(project.path, '.factory', 'stories');
        }
      }
    }
  } catch {}
  return '';
}

function resolveStoryPath(file: string): string | null {
  const base = getStoriesBase();
  if (!base) return null;

  // Direct match in apps/
  const appsPath = join(base, 'apps', file);
  if (existsSync(appsPath)) return appsPath;

  // Match in features/
  const cleanedFeatures = file.replace(/^features\//, '');
  const featuresPath = join(base, 'features', cleanedFeatures);
  if (existsSync(featuresPath)) return featuresPath;

  // Match in done/
  const cleanedDone = file.replace(/^done\//, '');
  const donePath = join(base, 'done', cleanedDone);
  if (existsSync(donePath)) return donePath;

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  try {
    const { file } = await params;
    const storyPath = resolveStoryPath(decodeURIComponent(file));

    if (!storyPath) {
      return NextResponse.json(
        { error: `Story not found: ${file}` },
        { status: 404 }
      );
    }

    const content = readFileSync(storyPath, 'utf-8');
    return NextResponse.json({ file, content, path: storyPath });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to read story' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  try {
    const { file } = await params;
    const body = await request.json();
    const content = body.content;

    if (typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: content' },
        { status: 400 }
      );
    }

    const storyPath = resolveStoryPath(decodeURIComponent(file));

    if (!storyPath) {
      return NextResponse.json(
        { error: `Story not found: ${file}` },
        { status: 404 }
      );
    }

    // Validate YAML before saving
    try {
      const { parse: parseYaml } = require('yaml');
      parseYaml(content);
    } catch (yamlErr: any) {
      return NextResponse.json(
        { error: `Invalid YAML: ${yamlErr.message}` },
        { status: 422 }
      );
    }

    writeFileSync(storyPath, content, 'utf-8');
    return NextResponse.json({ success: true, file, path: storyPath });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to save story' },
      { status: 500 }
    );
  }
}
