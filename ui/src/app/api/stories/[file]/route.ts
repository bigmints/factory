import { homedir } from 'node:os';
/**
 * GET  /api/stories/[file] — Read raw YAML content of a story file
 * PUT  /api/stories/[file] — Write updated YAML content back to the story file
 * DELETE /api/stories/[file] — Delete a story file from disk
 */
import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { calculateRollups } from '@engine/rollup';
import { slugify } from '@engine/types';

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

  // Clean the file path of common prefixes
  let cleaned = file
    .replace(/^(\.?\.?\/)?(\.factory\/)?(stories\/)?/, '') // remove leading ./, .factory/, stories/
    .trim();

  // Try direct path first (in case it's absolute or relative to base)
  const directPath = join(base, cleaned);
  if (existsSync(directPath)) return directPath;

  // If it contains a subfolder like apps/, features/, done/
  const stem = cleaned.replace(/^(apps|features|done)\//, '');

  const candidates = [
    join(base, 'apps', stem),
    join(base, 'features', stem),
    join(base, 'done', stem),
    join(base, 'apps', cleaned),
    join(base, 'features', cleaned),
    join(base, 'done', cleaned),
  ];

  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  try {
    const { file } = await params;
    const decodedFile = decodeURIComponent(file);
    const storyPath = resolveStoryPath(decodedFile);

    if (!storyPath) {
      return NextResponse.json(
        { error: `Story not found: ${decodedFile}` },
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
    const decodedFile = decodeURIComponent(file);
    const body = await request.json();
    const content = body.content;

    if (typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: content' },
        { status: 400 }
      );
    }

    const storyPath = resolveStoryPath(decodedFile);

    if (!storyPath) {
      return NextResponse.json(
        { error: `Story not found: ${decodedFile}` },
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  try {
    const { file } = await params;
    const decodedFile = decodeURIComponent(file);
    const { searchParams } = new URL(request.url);
    const nameQuery = searchParams.get('name') || '';

    const storyPath = resolveStoryPath(decodedFile);

    // Attempt to remove it from scaffold.yaml if project base exists
    const base = getStoriesBase();
    let deletedFromScaffold = false;

    if (base) {
      const projectPath = resolve(base, '..', '..');
      const scaffoldYamlPath = join(projectPath, '.factory', 'scaffold.yaml');
      if (existsSync(scaffoldYamlPath)) {
        try {
          const raw = readFileSync(scaffoldYamlPath, 'utf-8');
          const app = parseYaml(raw) as any;
          const stem = decodedFile !== 'none' && decodedFile !== 'undefined' ? (decodedFile.split('/').pop() || '') : '';

          if (app && Array.isArray(app.features)) {
            let scaffoldChanged = false;
            app.features = app.features.map((feature: any) => {
              if (feature && Array.isArray(feature.stories)) {
                const originalCount = feature.stories.length;
                feature.stories = feature.stories.filter((story: any) => {
                  if (!story) return true;

                  // Match by file stem
                  if (stem && story.file) {
                    const sStem = story.file.split('/').pop() || '';
                    if (sStem === stem) return false;
                  }

                  // Match by exact name
                  if (nameQuery && story.name === nameQuery) return false;

                  return true;
                });
                if (feature.stories.length < originalCount) {
                  scaffoldChanged = true;
                }
              }
              return feature;
            });

            // Clean up empty features/epics if all their stories were deleted
            const originalFeaturesCount = app.features.length;
            app.features = app.features.filter((feature: any) => {
              // Keep epics that still have stories, or keep the required Scaffold epic
              return (feature.stories && feature.stories.length > 0) || feature.scaffold;
            });
            if (app.features.length < originalFeaturesCount) {
              scaffoldChanged = true;
            }

            if (scaffoldChanged) {
              const appSlug = slugify(app.name);
              const updatedApp = calculateRollups(app, appSlug);
              writeFileSync(scaffoldYamlPath, stringifyYaml(updatedApp, { lineWidth: 120 }), 'utf-8');
              deletedFromScaffold = true;
            }
          }
        } catch (scaffoldErr) {
          console.error('Failed to remove story from scaffold.yaml:', scaffoldErr);
        }
      }
    }

    if (storyPath && existsSync(storyPath)) {
      unlinkSync(storyPath);
      return NextResponse.json({ success: true, file, path: storyPath });
    }

    if (deletedFromScaffold) {
      return NextResponse.json({ success: true, file, message: 'Removed from scaffold.yaml' });
    }

    return NextResponse.json(
      { error: `Story not found: ${decodedFile} (${nameQuery})` },
      { status: 404 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete story' },
      { status: 500 }
    );
  }
}
