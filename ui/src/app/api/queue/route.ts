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
            item => (item.storyFile === file || item.storyFile === `apps/${file}`) &&
              ['pending', 'running', 'completed'].includes(item.status)
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
 * Resolve a human-readable display name for a queue item by reading the active project's app.yaml
 * (the absolute source of truth for the Kanban board) or falling back to the parsed name/slug from the story YAML.
 */
function resolveDisplayName(storyFile: string, projectPath: string | null): string {
  const slug = storyFile.split('/').pop()?.replace(/\.ya?ml$/i, '') ?? storyFile;
  if (!projectPath) return slug;

  // Helper to normalize paths for robust comparison
  const normalizePath = (p: string) => {
    return p
      .replace(/^(done|apps|features)\//, '') // strip starting folders
      .replace(/^\.?\//, '')                 // strip leading ./
      .replace(/\.ya?ml$/i, '')              // strip yaml extensions
      .toLowerCase()
      .trim();
  };

  const normalizedStoryFile = normalizePath(storyFile);

  // 1. Try to load and match from app.yaml (the absolute source of truth)
  const appYamlPath = join(projectPath, '.factory', 'app.yaml');
  if (existsSync(appYamlPath)) {
    try {
      const raw = readFileSync(appYamlPath, 'utf-8');
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
      // Feature story: feature.name / feature.title
      const featureName = parsed?.feature?.name || parsed?.feature?.title;
      // App story: appName / metadata.name
      const appName = parsed?.appName || parsed?.metadata?.name;
      const resolved = featureName || appName;
      if (resolved && typeof resolved === 'string') return resolved;
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
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const storyFileRaw = body.storyFile || body.specFile;
    const kindRaw = body.kind === 'AppSpec' ? 'AppStory' : body.kind === 'FeatureSpec' ? 'FeatureStory' : body.kind;
    const { phase, dependsOn, buildAll, engine } = body;

    if (!storyFileRaw || !kindRaw) {
      return NextResponse.json({ error: 'storyFile and kind are required' }, { status: 400 });
    }

    let storyFile = storyFileRaw;
    let kind = kindRaw;

    const projectPath = getActiveProjectPath();
    if (projectPath) {
      const filename = storyFileRaw.replace(/^(features|apps|done)\//, '');
      const featuresPath = join(projectPath, '.factory', 'stories', 'features', filename);
      const appsPath = join(projectPath, '.factory', 'stories', 'apps', filename);
      const donePath = join(projectPath, '.factory', 'stories', 'done', filename);

      if (existsSync(featuresPath)) {
        kind = 'FeatureStory';
        storyFile = `features/${filename}`;
      } else if (existsSync(appsPath)) {
        kind = 'AppStory';
        storyFile = filename;
      } else if (existsSync(donePath)) {
        try {
          const raw = readFileSync(donePath, 'utf-8');
          const parsed = parseYaml(raw) as any;
          const isFeature = parsed && (parsed.feature || parsed.target || 'phase' in parsed);
          kind = isFeature ? 'FeatureStory' : 'AppStory';
          storyFile = `done/${filename}`;
        } catch {}
      }
    }

    const queue = loadQueue();

    // For FeatureStories, validate that the target app is already in the queue
    // Skip this check during Build All — ordering is handled by the caller
    if (kind === 'FeatureStory' && !buildAll) {
      const projectPath = getActiveProjectPath();
      if (projectPath) {
        try {
          const storyPath = join(projectPath, '.factory', 'stories', storyFile);
          if (existsSync(storyPath)) {
            const raw = readFileSync(storyPath, 'utf-8');
            const parsed = parseYaml(raw) as any;
            const targetApp = parsed.target?.app;
            if (targetApp && !isAppStoryQueued(targetApp, queue)) {
              return NextResponse.json(
                { error: `App "${targetApp}" must be in the queue first. Queue the app story before adding features.` },
                { status: 400 }
              );
            }

            // Validate all dependsOn stories are already in the queue
            const storyDeps: string[] = parsed.dependsOn ?? dependsOn ?? [];
            if (storyDeps.length > 0) {
              const featuresDir = join(projectPath, '.factory', 'stories', 'features');
              const featureFiles = existsSync(featuresDir)
                ? readdirSync(featuresDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
                : [];

              // Build a slug → filename map
              const slugToFile: Record<string, string> = {};
              for (const f of featureFiles) {
                try {
                  const fRaw = readFileSync(join(featuresDir, f), 'utf-8');
                  const fParsed = parseYaml(fRaw) as any;
                  const fSlug = fParsed.feature?.slug || f.replace(/\.ya?ml$/, '');
                  slugToFile[fSlug] = `features/${f}`;
                } catch {}
              }

              const missingDeps: string[] = [];
              for (const dep of storyDeps) {
                const depFile = slugToFile[dep];
                if (depFile) {
                  const depQueued = queue.some(
                    item => item.storyFile === depFile && ['pending', 'running', 'completed'].includes(item.status)
                  );
                  if (!depQueued) missingDeps.push(dep);
                }
              }

              if (missingDeps.length > 0) {
                return NextResponse.json(
                  { error: `Missing dependencies in queue: ${missingDeps.join(', ')}. Use Build All to queue in correct order.` },
                  { status: 400 }
                );
              }
            }
          }
        } catch {}
      }
    }

    // Check if already in queue
    const existing = queue.some(
      item => item.storyFile === storyFile && ['pending', 'running'].includes(item.status)
    );

    if (existing) {
      return NextResponse.json({ error: 'Story is already in the queue' }, { status: 409 });
    }

    const item = enqueue(storyFile, kind, { phase, dependsOn, engine });

    return NextResponse.json({ item });
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
    if (item.status === 'running') {
      return NextResponse.json(
        { error: 'Cannot delete currently running items.' },
        { status: 409 }
      );
    }

    const removed = removeItem(id);

    return NextResponse.json({ removed });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
