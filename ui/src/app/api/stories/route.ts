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
import { getActiveProject } from '@engine/config';
import { listStories as listEngineStories, loadStory as loadEngineStory } from '@engine/story';
import { readLifecycleStatus } from '@engine/schemas';

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
    const project = getActiveProject();
    const scaffoldMeta = loadScaffoldStoryMeta(project.path);
    const listed = listEngineStories(project.path);
    const stories: any[] = [];
    const featureStories: any[] = [];

    const pushStory = (file: string, isDone = false) => {
      const relFile = isDone ? `done/${file}` : file;
      const meta = scaffoldMeta.get(relFile) || scaffoldMeta.get(file);
      try {
        const story = loadEngineStory(join(project.path, '.factory', 'stories', relFile));
        if (story.kind === 'feature') {
          const status = readLifecycleStatus(story.status, isDone ? 'done' : 'draft');
          featureStories.push({
            file: relFile,
            kind: 'FeatureStory' as const,
            valid: true,
            name: story.name || '',
            feature: { name: story.name, description: story.description || story.content || '' },
            target: story.target || '',
            status,
            failureReason: story.failureReason || null,
            execution: story.execution || null,
            pages: story.pages || [],
            model: story.model || {},
            phase: meta ? meta.phase : (story.phase ?? 1),
            dependsOn: meta ? meta.dependsOn : (story.dependsOn ?? []),
            priority: meta ? meta.priority : 0,
          });
        } else {
          const status = readLifecycleStatus(story.status, isDone ? 'done' : 'draft');
          stories.push({
            file: relFile,
            kind: 'AppStory' as const,
            valid: true,
            metadata: { name: story.name, description: story.description || story.content || '' },
            status,
            failureReason: story.failureReason || null,
            execution: story.execution || null,
            deployment: story.deployment || {},
            database: story.data || {},
            api: {},
            features: {},
            phase: meta ? meta.phase : 0,
            dependsOn: meta ? meta.dependsOn : [],
            priority: meta ? meta.priority : 100,
          });
        }
      } catch {
        const target = isDone ? featureStories : stories;
        target.push({ file: relFile, valid: false, error: 'Failed to parse' });
      }
    };

    listed.apps.forEach((file) => pushStory(file));
    listed.features.forEach((file) => pushStory(file));

    featureStories.sort((a, b) => {
      if ((a.phase ?? 0) !== (b.phase ?? 0)) return (a.phase ?? 0) - (b.phase ?? 0);
      return (b.priority ?? 0) - (a.priority ?? 0);
    });

    return NextResponse.json({ stories, featureStories, source: project.name });
  } catch {
    return NextResponse.json({ stories: [], featureStories: [], source: 'error', error: 'stories directory not found' });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, content, kind, filename: requestedFilename } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const slug = String(requestedFilename || name)
      .toLowerCase()
      .replace(/\.(md|ya?ml)$/i, '')
      .split('/')
      .pop()!
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    const filename = `${slug.replace(/_/g, '-')}.md`;

    const { stories } = getStoriesDirs();

    if (!stories) {
      return NextResponse.json(
        { error: 'No active project. Connect a project first from the Projects page.' },
        { status: 400 }
      );
    }

    const { mkdirSync } = await import('node:fs');
    const folder = kind === 'app' ? 'apps' : 'features';
    const targetDir = join(stories, folder);
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
status: draft
description: "Implement ${name}"
---

# ${name}

Write detailed requirements here.
`;
      } else {
        storyContent = `---
name: "${name}"
kind: app
status: draft
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

    // Ensure new stories start as draft until explicitly queued
    if (storyContent.includes('status:')) {
      storyContent = storyContent.replace(/status:\s*["']?(draft|queued|running|review|failed|done)["']?/g, 'status: draft');
    } else {
      const parts = storyContent.split('---');
      if (parts.length >= 3) {
        parts[1] = parts[1].trimEnd() + '\nstatus: draft\n';
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
