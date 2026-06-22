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
 * Auto-fix common YAML issues before parsing.
 * - Quotes unquoted @-scoped package names (e.g. `- @types/cheerio` → `- "@types/cheerio"`)
 * Returns the sanitized string and whether any fixes were applied.
 */
function sanitizeYaml(raw: string): { content: string; fixed: boolean } {
  // Match lines like `  - @scope/package` (unquoted @ at start of a list value)
  const fixed = raw.replace(/^(\s*-\s+)(@\S+)\s*$/gm, (_, indent, pkg) => {
    return `${indent}"${pkg}"`;
  });
  return { content: fixed, fixed: fixed !== raw };
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
function getStoriesDirs(): { apps: string; features: string; done: string; source: string } {
  try {
    const projectPath = getActiveProjectPath();
    if (projectPath) {
      const projectApps = join(projectPath, '.factory', 'stories', 'apps');
      const projectFeatures = join(projectPath, '.factory', 'stories', 'features');
      const projectDone = join(projectPath, '.factory', 'stories', 'done');
      return {
        apps: projectApps,
        features: projectFeatures,
        done: projectDone,
        source: basename(projectPath),
      };
    }
  } catch {}

  return { apps: '', features: '', done: '', source: 'none' };
}

export async function GET() {
  try {
    const { apps: APPS_DIR, features: FEATURES_DIR, done: DONE_DIR, source } = getStoriesDirs();
    const projectPath = getActiveProjectPath();
    const scaffoldMeta = projectPath ? loadScaffoldStoryMeta(projectPath) : new Map<string, ScaffoldStoryMeta>();

    let stories: any[] = [];
    let featureStories: any[] = [];

    // App stories
    if (APPS_DIR && existsSync(APPS_DIR)) {
      const appFiles = walkDirSync(APPS_DIR).filter(
        (f) => (f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.md')) && !basename(f).startsWith('.') && !basename(f).startsWith('_')
      );

      stories = appFiles.map((file) => {
        try {
          const isMarkdown = file.endsWith('.md');
          const raw = readFileSync(join(APPS_DIR, file), 'utf-8');
          let parsed: any = {};
          
          if (isMarkdown) {
            const match = raw.match(/^#\s+(.+)$/m);
            parsed = {
              metadata: {
                name: match ? match[1] : basename(file, '.md'),
                description: raw,
              },
              status: 'draft',
            };
          } else {
            const { content: sanitized, fixed } = sanitizeYaml(raw);
            if (fixed) {
              try { writeFileSync(join(APPS_DIR, file), sanitized, 'utf-8'); } catch { /* ignore write errors */ }
            }
            parsed = parseYaml(sanitized) as any;
          }
          
          const meta = scaffoldMeta.get(`apps/${file}`) || scaffoldMeta.get(file);
          return {
            file,
            kind: 'AppStory' as const,
            valid: true,
            metadata: parsed.metadata || {},
            status: parsed.status || 'unknown',
            deployment: parsed.deployment || {},
            database: parsed.database || {},
            api: parsed.api || {},
            features: parsed.features || {},
            phase: meta ? meta.phase : 0,
            dependsOn: meta ? meta.dependsOn : [],
            priority: meta ? meta.priority : 100
          };
        } catch {
          return { file, kind: 'AppStory' as const, valid: false, error: 'Failed to parse' };
        }
      });
    }

    // Feature stories
    if (FEATURES_DIR && existsSync(FEATURES_DIR)) {
      const featureFiles = walkDirSync(FEATURES_DIR).filter(
        (f) => (f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.md')) && !basename(f).startsWith('.') && !basename(f).startsWith('_')
      );

      featureStories = featureFiles.map((file) => {
        try {
          const isMarkdown = file.endsWith('.md');
          const raw = readFileSync(join(FEATURES_DIR, file), 'utf-8');
          let parsed: any = {};

          if (isMarkdown) {
            const match = raw.match(/^#\s+(.+)$/m);
            parsed = {
              name: match ? match[1] : basename(file, '.md'),
              feature: { description: raw },
              status: 'draft',
            };
          } else {
            const { content: sanitized, fixed } = sanitizeYaml(raw);
            if (fixed) {
              try { writeFileSync(join(FEATURES_DIR, file), sanitized, 'utf-8'); } catch { /* ignore write errors */ }
            }
            parsed = parseYaml(sanitized) as any;
          }

          const meta = scaffoldMeta.get(`features/${file}`) || scaffoldMeta.get(file);
          return {
            file: `features/${file}`,
            kind: 'FeatureStory' as const,
            valid: true,
            name: parsed.name || '',
            feature: parsed.feature || {},
            target: parsed.target || {},
            status: parsed.status || 'unknown',
            pages: parsed.pages || [],
            model: parsed.model || {},
            navigation: parsed.navigation || {},
            phase: meta ? meta.phase : (parsed.phase ?? 1),
            dependsOn: meta ? meta.dependsOn : (parsed.dependsOn ?? []),
            priority: meta ? meta.priority : 0
          };
        } catch {
          return { file: `features/${file}`, kind: 'FeatureStory' as const, valid: false, error: 'Failed to parse' };
        }
      });
    }

    // Completed/Done stories in 'done' directory
    if (DONE_DIR && existsSync(DONE_DIR)) {
      const doneFiles = walkDirSync(DONE_DIR).filter(
        (f) => (f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.md')) && !basename(f).startsWith('.') && !basename(f).startsWith('_')
      );

      for (const file of doneFiles) {
        try {
          const isMarkdown = file.endsWith('.md');
          const raw = readFileSync(join(DONE_DIR, file), 'utf-8');
          let parsed: any = {};

          if (isMarkdown) {
            const match = raw.match(/^#\s+(.+)$/m);
            parsed = {
              name: match ? match[1] : basename(file, '.md'),
              feature: { description: raw },
              status: 'done',
            };
          } else {
            const { content: sanitized, fixed } = sanitizeYaml(raw);
            if (fixed) {
              try { writeFileSync(join(DONE_DIR, file), sanitized, 'utf-8'); } catch { /* ignore write errors */ }
            }
            parsed = parseYaml(sanitized) as any;
          }

          // Determine if it is a FeatureStory or AppStory
          const isFeature = isMarkdown || (parsed && (parsed.feature || parsed.target || 'phase' in parsed));
          if (isFeature) {
            const meta = scaffoldMeta.get(`done/${file}`) || scaffoldMeta.get(`features/${file}`) || scaffoldMeta.get(file);
            featureStories.push({
              file: `done/${file}`,
              kind: 'FeatureStory' as const,
              valid: true,
              name: parsed.name || '',
              feature: parsed.feature || {},
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
              metadata: parsed.metadata || {},
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

    // Sort featureStories by phase (epic order), then by priority DESC (story order within epic)
    featureStories.sort((a, b) => {
      if (a.phase !== b.phase) return a.phase - b.phase;
      return b.priority - a.priority;
    });

    return NextResponse.json({ stories, featureStories, source });
  } catch {
    return NextResponse.json({ stories: [], featureStories: [], source: 'error', error: 'stories directory not found' });
  }
}

/**
 * POST /api/stories — Create a new story file
 * Body: { name: string, content?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, content, kind } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Derive slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    const filename = `${slug.replace(/_/g, '-')}.yaml`;

    // Resolve target directory — features go to stories/features/, apps go to stories/apps/
    const { apps: appsDir, features: featuresDir } = getStoriesDirs();
    const targetDir = kind === 'feature' ? featuresDir : appsDir;

    if (!targetDir) {
      return NextResponse.json(
        { error: 'No active project. Connect a project first from the Projects page.' },
        { status: 400 }
      );
    }

    // Ensure directory exists
    const { mkdirSync } = await import('node:fs');
    mkdirSync(targetDir, { recursive: true });

    const filePath = join(targetDir, filename);

    // Don't overwrite existing
    if (existsSync(filePath)) {
      return NextResponse.json(
        { error: `Story already exists: ${filename}` },
        { status: 409 }
      );
    }

    // Use custom content or generate template
    let storyContent = content || `metadata:
  name: "${name}"
  slug: "${slug}"
  description: "A ${name.toLowerCase()} application"
  icon: "📦"
  color: "#6366f1"
  status: ready

deployment:
  port: 3050
  region: us-central1

database:
  collections:
    - items
  databaseId: ${slug}-db

api:
  resources:
    - name: Item
      collection: items
      fields:
        name:
          type: string
          required: true
        description:
          type: string
        status:
          type: string
          default: active
`;

    // Force status to ready in the metadata block of the YAML
    if (storyContent.includes('metadata:')) {
      if (/^  status:\s*.*$/m.test(storyContent)) {
        storyContent = storyContent.replace(/^  status:\s*.*$/m, '  status: ready-to-build');
      } else {
        storyContent = storyContent.replace(/(metadata:[\s\S]*?)([\r\n]+)/, '$1$2  status: ready-to-build$2');
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
