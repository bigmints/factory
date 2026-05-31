/**
 * Queue API — list, enqueue, remove items
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import {
  listQueue,
  getQueueStats,
  isQueueRunning,
  loadQueue,
  enqueue,
  removeItem,
  QueueItem
} from '@engine/queue';
import { getActiveProject } from '@engine/config';

/**
 * Resolve the active project's path
 */
function getActiveProjectPath(): string | null {
  try {
    const activeProject = getActiveProject();
    return activeProject ? activeProject.path : null;
  } catch {}
  return null;
}

/**
 * Check if the app story for the given target slug is already in the queue OR already built.
 * Feature stories can only be enqueued after their parent app story exists and is accounted for.
 */
function isAppStoryQueued(targetApp: string, queue: QueueItem[]): boolean {
  const projectPath = getActiveProjectPath();
  if (!projectPath) return true; // Fail open if no project

  // Check apps/ dir
  const appsDir = join(projectPath, '.factory', 'stories', 'apps');
  if (existsSync(appsDir)) {
    const appFiles = readdirSync(appsDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml')
    );
    for (const file of appFiles) {
      try {
        const raw = readFileSync(join(appsDir, file), 'utf-8');
        const parsed = parseYaml(raw) as any;
        const slug = parsed.metadata?.slug || file.replace(/\.ya?ml$/, '');
        if (slug === targetApp) {
          // Found in apps/ — check if it's been queued at any point
          return queue.some(
            item => (item.storyFile === file || item.storyFile === `apps/${file}`)
          );
        }
      } catch {}
    }
  }

  // Check done/ dir — already built means it's acceptable to queue features
  const doneDir = join(projectPath, '.factory', 'stories', 'done');
  if (existsSync(doneDir)) {
    const doneFiles = readdirSync(doneDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml')
    );
    for (const file of doneFiles) {
      try {
        const raw = readFileSync(join(doneDir, file), 'utf-8');
        const parsed = parseYaml(raw) as any;
        const slug = parsed.metadata?.slug || file.replace(/\.ya?ml$/, '');
        if (slug === targetApp) {
          // App story is in done/ — already completed, allow features
          return true;
        }
      } catch {}
    }
  }

  return false;
}

/**
 * Resolve a human-readable display name for a queue item by reading the active project's scaffold.yaml
 * (the absolute source of truth for the Kanban board) or falling back to the parsed name/slug from the story YAML.
 */
function resolveDisplayName(storyFile: string, projectPath: string | null): string {
  const slug = storyFile.split('/').pop()?.replace(/\.ya?ml$/i, '') ?? storyFile;
  if (!projectPath) return slug;

  // Helper to normalize paths for robust comparison
  const normalizePath = (p: string) => {
    return p
      .replace(/^.*?\.factory\/stories\//, '') // strip starting directories up to stories/
      .replace(/^(done|apps|features)\//, '')  // strip starting folders
      .replace(/^\.?\//, '')                  // strip leading ./
      .replace(/\.ya?ml$/i, '')               // strip yaml extensions
      .toLowerCase()
      .trim();
  };

  const normalizedStoryFile = normalizePath(storyFile);

  // 1. Try to load and match from scaffold.yaml (the absolute source of truth)
  const scaffoldYamlPath = join(projectPath, '.factory', 'scaffold.yaml');
  if (existsSync(scaffoldYamlPath)) {
    try {
      const raw = readFileSync(scaffoldYamlPath, 'utf-8');
      const parsed = parseYaml(raw) as any;
      if (parsed && Array.isArray(parsed.features)) {
        for (const feature of parsed.features) {
          if (Array.isArray(feature.stories)) {
            for (const story of feature.stories) {
              if (story.file && normalizePath(story.file) === normalizedStoryFile) {
                if (story.name && typeof story.name === 'string') {
                  return story.name;
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // Fall through to physical file checks on parse failure
    }
  }

  // 2. Fallback: check physical story YAML files
  const storiesRoot = join(projectPath, '.factory', 'stories');
  const candidates = [
    join(storiesRoot, storyFile),                                  // exact relative path
    join(storiesRoot, 'features', storyFile.replace(/^features\//, '')),
    join(storiesRoot, 'apps', storyFile.replace(/^apps\//, '')),
    join(storiesRoot, 'done', storyFile.replace(/^done\//, '')),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, 'utf-8');
      const parsed = parseYaml(raw) as any;
      // Feature/App story: first try story name, fallback to feature.name (epic name), fallback to appName
      const storyName = parsed?.name || parsed?.metadata?.name || parsed?.feature?.name || parsed?.feature?.title || parsed?.appName;
      if (storyName && typeof storyName === 'string') return storyName;
    } catch { /* keep trying */ }
  }

  return slug;
}

/** GET — list all queue items + stats */
export async function GET() {
  try {
    const items = listQueue();
    const statsObj = getQueueStats();
    const isRunning = isQueueRunning();
    const projectPath = getActiveProjectPath();

    // Enrich each item with a human-readable displayName
    const enrichedItems = items.map(item => ({
      ...item,
      displayName: resolveDisplayName(item.storyFile, projectPath),
    }));

    return NextResponse.json({
      items: enrichedItems,
      stats: statsObj,
      isRunning,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** POST — enqueue a new story */
/**
 * Helper to normalize story file paths and kinds
 */
function normalizeStoryFilePath(fileRaw: string, projectPath: string): { file: string; kind: 'AppStory' | 'FeatureStory' } {
  // Strip any leading path including .factory/stories/
  const cleanFile = fileRaw.replace(/^.*?\.factory\/stories\//, '');
  const filename = cleanFile.replace(/^(features|apps|done)\//, '');
  const featuresPath = join(projectPath, '.factory', 'stories', 'features', filename);
  const appsPath = join(projectPath, '.factory', 'stories', 'apps', filename);
  const donePath = join(projectPath, '.factory', 'stories', 'done', filename);

  if (existsSync(featuresPath)) {
    return { file: `features/${filename}`, kind: 'FeatureStory' };
  } else if (existsSync(appsPath)) {
    return { file: `apps/${filename}`, kind: 'AppStory' };
  } else if (existsSync(donePath)) {
    try {
      const raw = readFileSync(donePath, 'utf-8');
      const parsed = parseYaml(raw) as any;
      const isFeature = parsed && (parsed.feature || parsed.target || 'phase' in parsed);
      return { file: `done/${filename}`, kind: isFeature ? 'FeatureStory' : 'AppStory' };
    } catch {}
  }
  return { file: cleanFile, kind: cleanFile.startsWith('features/') ? 'FeatureStory' : 'AppStory' };
}

interface EnqueueItemDescriptor {
  file: string;
  kind: 'AppStory' | 'FeatureStory';
  phase: number;
  dependsOn: string[];
  displayName: string;
}

/**
 * Recursively resolves all missing app and feature dependencies for a given story
 * to establish a complete and valid chronological queue.
 */
function resolveAllDependencies(
  storyFile: string,
  kind: 'AppStory' | 'FeatureStory',
  projectPath: string,
  queue: QueueItem[]
): EnqueueItemDescriptor[] {
  const toEnqueue: EnqueueItemDescriptor[] = [];
  const visitedFiles = new Set<string>();

  // Map slug -> story details for all physical story files in the project
  const slugToStory = new Map<string, EnqueueItemDescriptor>();

  const scanDir = (dir: string, defaultKind: 'AppStory' | 'FeatureStory') => {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir, { recursive: true }) as string[];
    const validFiles = files.filter(f => typeof f === 'string' && (f.endsWith('.yaml') || f.endsWith('.yml')));
    for (const f of validFiles) {
      try {
        const fullPath = join(dir, f);
        const raw = readFileSync(fullPath, 'utf-8');
        const parsed = parseYaml(raw) as any;
        
        const dirName = dir.split(/[\\/]/).pop() || '';
        const relativeFile = dirName === 'done' 
          ? `done/${f}` 
          : (dirName === 'apps' ? `apps/${f}` : `features/${f}`);
        
        // Detect kind from YAML content — never guess based on folder name alone.
        // AppStory has appName at the top level.
        // FeatureStory has feature.slug or target.app.
        // Stories in done/ are already built — skip them from dependency resolution.
        if (dirName === 'done') continue; // already built, not a build candidate

        const isAppStory = Boolean(parsed?.appName && !parsed?.feature && !parsed?.target);
        const storyKind: 'AppStory' | 'FeatureStory' = isAppStory ? 'AppStory' : defaultKind;
        
        const fileStem = f.split(/[\\/]/).pop()?.replace(/\.ya?ml$/, '') || '';
        const slug = parsed.feature?.slug || parsed.metadata?.slug || fileStem;
        const displayName = parsed.feature?.name || parsed.metadata?.name || parsed.appName || slug;
        const phase = parsed.phase ?? (storyKind === 'AppStory' ? 0 : 1);
        const dependsOn = parsed.dependsOn || [];
        
        const spec = {
          file: relativeFile,
          kind: storyKind,
          phase,
          dependsOn,
          displayName
        };
        slugToStory.set(slug, spec);
        if (fileStem && fileStem !== slug) {
          slugToStory.set(fileStem, spec);
        }
      } catch {}
    }
  };

  const storiesRoot = join(projectPath, '.factory', 'stories');
  scanDir(join(storiesRoot, 'apps'), 'AppStory');
  scanDir(join(storiesRoot, 'features'), 'FeatureStory');
  // done/ intentionally excluded — those stories are already built

  // Helper to check if already in queue or physically completed
  const isAlreadyQueuedOrBuilt = (file: string, rawSlug: string) => {
    const slug = rawSlug.split(/[\\/]/).pop()?.replace(/\.ya?ml$/i, '') || rawSlug;
    // 1. Check the current queue (pending/running/completed)
    const inQueue = queue.some(
      item => (item.storyFile === file || item.storyFile.split(/[\\/]/).pop()?.replace(/\.ya?ml$/i, '') === slug)
    );
    if (inQueue) return true;

    // 2. Check if the story YAML itself has status:done OR lives in the done/ directory
    // This survives "clear done" — the queue has no memory but the filesystem does.
    const candidates = [
      join(projectPath, '.factory', 'stories', file),
      join(projectPath, '.factory', 'stories', 'done', slug + '.yaml'),
      join(projectPath, '.factory', 'stories', 'done', slug + '.yml'),
    ];
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      try {
        const raw = readFileSync(candidate, 'utf-8');
        const parsed = parseYaml(raw) as any;
        if (parsed?.status === 'done' || candidate.includes('/done/')) return true;
      } catch { /* ignore */ }
    }
    return false;
  };

  // Walk dependency graph recursively
  const visit = (file: string, itemKind: 'AppStory' | 'FeatureStory') => {
    if (visitedFiles.has(file)) return;
    visitedFiles.add(file);

    try {
      const fullPath = join(projectPath, '.factory', 'stories', file);
      if (!existsSync(fullPath)) return;
      const raw = readFileSync(fullPath, 'utf-8');
      const parsed = parseYaml(raw) as any;

      const slug = parsed.feature?.slug || parsed.metadata?.slug || file.split('/').pop()?.replace(/\.ya?ml$/i, '') || '';
      const displayName = parsed.feature?.name || parsed.metadata?.name || parsed.appName || slug;
      const phase = parsed.phase ?? (itemKind === 'AppStory' ? 0 : 1);
      const dependsOn: string[] = parsed.dependsOn || [];

      // 1. Visit parent AppStory if it is a FeatureStory and not yet queued or built
      if (itemKind === 'FeatureStory') {
        const targetApp = parsed.target?.app;
        if (targetApp) {
          const parentStory = slugToStory.get(targetApp);
          if (parentStory && !isAlreadyQueuedOrBuilt(parentStory.file, targetApp)) {
            visit(parentStory.file, parentStory.kind);
          }
        }
      }

      // 2. Visit defined dependsOn features that are not yet queued or built
      for (const depSlugRaw of dependsOn) {
        const depSlugStem = depSlugRaw.split(/[\\/]/).pop()?.replace(/\.ya?ml$/, '') || '';
        const depStory = slugToStory.get(depSlugRaw) || slugToStory.get(depSlugStem);
        if (depStory && !isAlreadyQueuedOrBuilt(depStory.file, depSlugRaw)) {
          visit(depStory.file, depStory.kind);
        }
      }

      // Add self to the list if not queued/built
      if (!isAlreadyQueuedOrBuilt(file, slug)) {
        toEnqueue.push({
          file,
          kind: itemKind,
          phase,
          dependsOn,
          displayName
        });
      }
    } catch {}
  };

  visit(storyFile, kind);
  return toEnqueue;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let storyFileRaw = body.storyFile || body.specFile;
    const kindRaw = body.kind === 'AppSpec' ? 'AppStory' : body.kind === 'FeatureSpec' ? 'FeatureStory' : body.kind;
    const { buildAll, engine } = body;

    if (!storyFileRaw || !kindRaw) {
      return NextResponse.json({ error: 'storyFile and kind are required' }, { status: 400 });
    }

    const projectPath = getActiveProjectPath();
    if (!projectPath) {
      return NextResponse.json({ error: 'No active project' }, { status: 400 });
    }

    // Always strip `.factory/stories/` prefix to match queue.yaml storage format
    storyFileRaw = storyFileRaw.replace(/^\.?\/?\.factory\/stories\//, '');

    const { file: storyFile, kind } = normalizeStoryFilePath(storyFileRaw, projectPath);
    const queue = loadQueue();

    let enqueuedItem: any = null;
    const autoEnqueued: EnqueueItemDescriptor[] = [];

    if (!buildAll) {
      const resolved = resolveAllDependencies(storyFile, kind, projectPath, queue);
      if (resolved.length === 0) {
        return NextResponse.json({ error: 'Story and all dependencies are already in the queue or built' }, { status: 409 });
      }

      // Enqueue resolved missing items in correct topological order!
      for (let i = 0; i < resolved.length; i++) {
        const spec = resolved[i];
        const item = await enqueue(spec.file, spec.kind, { 
          phase: spec.phase, 
          dependsOn: spec.dependsOn, 
          engine: engine || 'factory' 
        });

        // The last item in the resolved list is the main story requested
        if (i === resolved.length - 1) {
          enqueuedItem = item;
        } else {
          autoEnqueued.push(spec);
        }
      }
    } else {
      // Check if already in queue (regardless of status - to prevent duplicating failed/paused items)
      const existing = queue.some(
        item => item.storyFile === storyFile
      );

      if (existing) {
        return NextResponse.json({ error: 'Story is already in the queue' }, { status: 409 });
      }

      const bodyPhase = body.phase;
      const bodyDependsOn = body.dependsOn;
      
      let resolvedPhase = bodyPhase;
      let resolvedDeps = bodyDependsOn;
      try {
        const fullPath = join(projectPath, '.factory', 'stories', storyFile);
        if (existsSync(fullPath)) {
          const raw = readFileSync(fullPath, 'utf-8');
          const parsed = parseYaml(raw) as any;
          if (resolvedPhase === undefined) {
            resolvedPhase = parsed.phase ?? (kind === 'AppStory' ? 0 : 1);
          }
          if (resolvedDeps === undefined) {
            resolvedDeps = parsed.dependsOn || [];
          }
        }
      } catch {}

      enqueuedItem = await enqueue(storyFile, kind, { 
        phase: resolvedPhase ?? (kind === 'AppStory' ? 0 : 1), 
        dependsOn: resolvedDeps ?? [], 
        engine: engine || 'factory' 
      });
    }

    return NextResponse.json({ 
      item: enqueuedItem,
      autoEnqueued 
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** DELETE — remove a queue item */
export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    if (isQueueRunning()) {
      return NextResponse.json({ error: 'Cannot delete items while queue is running' }, { status: 409 });
    }

    // Only allow deleting pending items
    const queue = loadQueue();
    const item = queue.find(i => i.id === id);
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    if (item.status === 'building') {
      return NextResponse.json(
        { error: 'Cannot delete currently running items.' },
        { status: 409 }
      );
    }

    const removed = await removeItem(id);

    return NextResponse.json({ removed });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
