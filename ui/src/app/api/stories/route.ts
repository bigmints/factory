/**
 * GET /api/stories — List all story files (app stories + feature stories)
 *
 * Reads stories from the active project's .factory/stories/ directory.
 * Falls back to the factory's own stories/ directory if no project is active.
 */
export const dynamic = 'force-dynamic';

import { homedir } from 'node:os';
import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FACTORY_ROOT = resolve(homedir(), '.factory');

/**
 * Parse frontmatter block from markdown content.
 */
function parseFrontmatter(raw: string): { parsed: any; body: string } {
  if (raw.startsWith('---')) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (match) {
      try {
        const data = parseYaml(match[1]);
        return { parsed: data || {}, body: match[2] };
      } catch (e) {
        console.error('Error parsing frontmatter:', e);
      }
    }
  }
  return { parsed: {}, body: raw };
}

/**
 * Recursively walk a directory and return all relative file paths.
 */
function walkDirSync(dir: string, fileList: string[] = [], basePath = ''): string[] {
  if (!existsSync(dir)) return fileList;
  const files = readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const relPath = join(basePath, file.name);
    if (file.isDirectory()) {
      if (!file.name.startsWith('.') && !file.name.startsWith('_')) {
        walkDirSync(join(dir, file.name), fileList, relPath);
      }
    } else {
      fileList.push(relPath);
    }
  }
  return fileList;
}

/**
 * Resolve the active project's path
 */
function getActiveProjectPath(): string | null {
  try {
    const projectsPath = join(FACTORY_ROOT, 'projects.json');
    if (existsSync(projectsPath)) {
      const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
      if (config.activeProject) {
        const project = config.projects?.find(
          (p: any) => p.id === config.activeProject
        );
        if (project) {
          return project.path;
        }
      }
    }
  } catch {}
  return null;
}

interface ScaffoldStoryMeta {
  phase: number;
  priority: number;
  dependsOn: string[];
}

/**
 * Parses scaffold.yaml and returns metadata for each story to preserve planning order
 */
function loadScaffoldStoryMeta(projectPath: string): Map<string, ScaffoldStoryMeta> {
  const metaMap = new Map<string, ScaffoldStoryMeta>();
  const scaffoldPath = join(projectPath, '.factory', 'scaffold.yaml');
  if (!existsSync(scaffoldPath)) return metaMap;

  try {
    const raw = readFileSync(scaffoldPath, 'utf-8');
    const parsed = parseYaml(raw) as any;
    if (parsed && Array.isArray(parsed.features)) {
      const globalStoriesList: { file: string; slug: string; epicIndex: number; storyIndex: number }[] = [];

      parsed.features.forEach((feature: any, epicIndex: number) => {
        if (feature && Array.isArray(feature.stories)) {
          feature.stories.forEach((story: any, storyIndex: number) => {
            if (story && story.file) {
              // Normalize path
              const cleanPath = story.file
                .replace(/^.*?\.factory\/stories\//, '')
                .replace(/^\.?\//, '');
              
              const slug = cleanPath.split('/').pop()?.replace(/\.ya?ml$/i, '') || '';
              globalStoriesList.push({
                file: cleanPath,
                slug,
                epicIndex,
                storyIndex
              });
            }
          });
        }
      });

      // Assign phase, priority, and dependsOn sequentially
      globalStoriesList.forEach((story, idx) => {
        const dependsOn: string[] = [];
        if (idx > 0) {
          dependsOn.push(globalStoriesList[idx - 1].slug);
        }

        metaMap.set(story.file, {
          phase: story.epicIndex,
          priority: 100 - story.storyIndex,
          dependsOn
        });
      });
    }
  } catch (e) {
    console.error('Error parsing scaffold.yaml for story meta:', e);
  }

  return metaMap;
}

/**
 * Resolve the stories directories — active project's .factory/stories/.
 */
function getStoriesDirs(): { stories: string; done: string; source: string } {
  try {
    const projectPath = getActiveProjectPath();
    if (projectPath) {
      const storiesDir = join(projectPath, '.factory', 'stories');
      const projectDone = join(projectPath, '.factory', 'stories', 'done');
      return {
        stories: storiesDir,
        done: projectDone,
        source: basename(projectPath),
      };
    }
  } catch {}

  return { stories: '', done: '', source: 'none' };
}

export async function GET() {
  try {
    const { stories: STORIES_DIR, done: DONE_DIR, source } = getStoriesDirs();
    const projectPath = getActiveProjectPath();
    const scaffoldMeta = projectPath ? loadScaffoldStoryMeta(projectPath) : new Map<string, ScaffoldStoryMeta>();

    let stories: any[] = [];
    let featureStories: any[] = [];

    // Active stories
    if (STORIES_DIR && existsSync(STORIES_DIR)) {
      const allFiles = walkDirSync(STORIES_DIR).filter(
        (f) => f.endsWith('.md') && !basename(f).startsWith('.') && !basename(f).startsWith('_') && !f.startsWith('done/')
      );

      for (const file of allFiles) {
        try {
          const raw = readFileSync(join(STORIES_DIR, file), 'utf-8');
          const { parsed, body } = parseFrontmatter(raw);

          // Default metadata values if they don't exist
          if (!parsed.name) {
            const match = body.match(/^#\s+(.+)$/m);
            parsed.name = match ? match[1] : basename(file, '.md');
          }
          if (!parsed.kind) {
            parsed.kind = (parsed.feature || parsed.target || 'phase' in parsed) ? 'feature' : 'app';
          }
          if (!parsed.status) {
            parsed.status = 'draft';
          }

          const isFeature = parsed.kind === 'feature';
          
          if (isFeature) {
             const meta = scaffoldMeta.get(`features/${file}`) || scaffoldMeta.get(file);
             featureStories.push({
               file,
               kind: 'FeatureStory' as const,
               valid: true,
               name: parsed.name || '',
               feature: parsed.feature || { description: body },
               target: parsed.target || {},
               status: parsed.status || 'unknown',
               pages: parsed.pages || [],
               model: parsed.model || {},
               navigation: parsed.navigation || {},
               phase: meta ? meta.phase : (parsed.phase ?? 1),
               dependsOn: meta ? meta.dependsOn : (parsed.dependsOn ?? []),
               priority: meta ? meta.priority : 0
             });
          } else {
             const meta = scaffoldMeta.get(`apps/${file}`) || scaffoldMeta.get(file);
             stories.push({
               file,
               kind: 'AppStory' as const,
               valid: true,
               metadata: parsed.metadata || { name: parsed.name, description: body },
               status: parsed.status || 'unknown',
               deployment: parsed.deployment || {},
               database: parsed.database || {},
               api: parsed.api || {},
               features: parsed.features || {},
               phase: meta ? meta.phase : 0,
               dependsOn: meta ? meta.dependsOn : [],
               priority: meta ? meta.priority : 100
             });
          }
        } catch {
          stories.push({ file, kind: 'AppStory' as const, valid: false, error: 'Failed to parse' });
        }
      }
    }

    // Completed/Done stories in 'done' directory
    if (DONE_DIR && existsSync(DONE_DIR)) {
      const doneFiles = walkDirSync(DONE_DIR).filter(
        (f) => f.endsWith('.md') && !basename(f).startsWith('.') && !basename(f).startsWith('_')
      );

      for (const file of doneFiles) {
        try {
          const raw = readFileSync(join(DONE_DIR, file), 'utf-8');
          const { parsed, body } = parseFrontmatter(raw);

          // Default metadata values if they don't exist
          if (!parsed.name) {
            const match = body.match(/^#\s+(.+)$/m);
            parsed.name = match ? match[1] : basename(file, '.md');
          }
          if (!parsed.kind) {
            parsed.kind = (parsed.feature || parsed.target || 'phase' in parsed) ? 'feature' : 'app';
          }
          if (!parsed.status) {
            parsed.status = 'done';
          }

          const isFeature = parsed.kind === 'feature';
          if (isFeature) {
            const meta = scaffoldMeta.get(`done/${file}`) || scaffoldMeta.get(`features/${file}`) || scaffoldMeta.get(file);
            featureStories.push({
              file: `done/${file}`,
              kind: 'FeatureStory' as const,
              valid: true,
              name: parsed.name || '',
              feature: parsed.feature || { description: body },
              target: parsed.target || {},
              status: parsed.status || 'unknown',
              pages: parsed.pages || [],
              model: parsed.model || {},
              navigation: parsed.navigation || {},
              phase: meta ? meta.phase : (parsed.phase ?? 1),
              dependsOn: meta ? meta.dependsOn : (parsed.dependsOn ?? []),
              priority: meta ? meta.priority : 0
            });
          } else {
            const meta = scaffoldMeta.get(`done/${file}`) || scaffoldMeta.get(`apps/${file}`) || scaffoldMeta.get(file);
            stories.push({
              file: `done/${file}`,
              kind: 'AppStory' as const,
              valid: true,
              metadata: parsed.metadata || { name: parsed.name, description: body },
              status: parsed.status || 'unknown',
              deployment: parsed.deployment || {},
              database: parsed.database || {},
              api: parsed.api || {},
              features: parsed.features || {},
              phase: meta ? meta.phase : 0,
              dependsOn: meta ? meta.dependsOn : [],
              priority: meta ? meta.priority : 100
            });
          }
        } catch {
          featureStories.push({ file: `done/${file}`, kind: 'FeatureStory' as const, valid: false, error: 'Failed to parse' });
        }
      }
    }

    featureStories.sort((a, b) => {
      if (a.phase !== b.phase) return a.phase - b.phase;
      return b.priority - a.priority;
    });

    return NextResponse.json({ stories, featureStories, source });
  } catch {
    return NextResponse.json({ stories: [], featureStories: [], source: 'error', error: 'stories directory not found' });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, content, kind } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    const filename = `${slug.replace(/_/g, '-')}.md`;

    const { stories: targetDir } = getStoriesDirs();

    if (!targetDir) {
      return NextResponse.json(
        { error: 'No active project. Connect a project first from the Projects page.' },
        { status: 400 }
      );
    }

    const { mkdirSync } = await import('node:fs');
    mkdirSync(targetDir, { recursive: true });

    const filePath = join(targetDir, filename);

    if (existsSync(filePath)) {
      return NextResponse.json(
        { error: `Story already exists: ${filename}` },
        { status: 409 }
      );
    }

    let storyContent = '';
    
    if (content && typeof content === 'string') {
      if (content.trim().startsWith('---')) {
        storyContent = content;
      } else {
        const cleanedYaml = content.trim();
        storyContent = `---\n${cleanedYaml}\n---\n\n# ${name}\n\nAutomated requirements.\n`;
      }
    } else {
      if (kind === 'feature') {
        storyContent = `---
name: "${name}"
kind: feature
target: root
status: ready-to-build
description: "Implement ${name}"
---

# ${name}

Write detailed requirements here.
`;
      } else {
        storyContent = `---
name: "${name}"
kind: app
status: ready-to-build
description: "A ${name.toLowerCase()} application"
stack:
  framework: nextjs
  language: TypeScript
---

# ${name}

Write detailed requirements here.
`;
      }
    }

    // Ensure status is standard ready-to-build in frontmatter
    if (storyContent.includes('status:')) {
      storyContent = storyContent.replace(/status:\s*["']?(pending|ready-to-build)["']?/g, 'status: ready-to-build');
    } else {
      const parts = storyContent.split('---');
      if (parts.length >= 3) {
        parts[1] = parts[1].trimEnd() + '\nstatus: ready-to-build\n';
        storyContent = parts.join('---');
      }
    }

    writeFileSync(filePath, storyContent, 'utf-8');

    return NextResponse.json({
      success: true,
      file: filename,
      path: filePath,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create story' },
      { status: 500 }
    );
  }
}
