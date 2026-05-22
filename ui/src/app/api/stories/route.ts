/**
 * GET /api/stories — List all story files (app stories + feature stories)
 *
 * Reads stories from the active project's .factory/stories/ directory.
 * Falls back to the factory's own stories/ directory if no project is active.
 */
import { homedir } from 'node:os';
import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
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
 * Resolve the stories directories — active project's .factory/stories/.
 */
function getStoriesDirs(): { apps: string; features: string; done: string; source: string } {
  try {
    const projectsPath = join(FACTORY_ROOT, 'projects.json');
    if (existsSync(projectsPath)) {
      const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
      if (config.activeProject) {
        const project = config.projects?.find(
          (p: any) => p.id === config.activeProject
        );
        if (project) {
          const projectApps = join(project.path, '.factory', 'stories', 'apps');
          const projectFeatures = join(project.path, '.factory', 'stories', 'features');
          const projectDone = join(project.path, '.factory', 'stories', 'done');
          return {
            apps: projectApps,
            features: projectFeatures,
            done: projectDone,
            source: project.name,
          };
        }
      }
    }
  } catch {}

  return { apps: '', features: '', done: '', source: 'none' };
}

export async function GET() {
  try {
    const { apps: APPS_DIR, features: FEATURES_DIR, done: DONE_DIR, source } = getStoriesDirs();

    let stories: any[] = [];
    let featureStories: any[] = [];

    // App stories
    if (APPS_DIR && existsSync(APPS_DIR)) {
      const appFiles = readdirSync(APPS_DIR).filter(
        (f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('.') && !f.startsWith('_')
      );

      stories = appFiles.map((file) => {
        try {
          const raw = readFileSync(join(APPS_DIR, file), 'utf-8');
          const { content: sanitized, fixed } = sanitizeYaml(raw);
          if (fixed) {
            try { writeFileSync(join(APPS_DIR, file), sanitized, 'utf-8'); } catch { /* ignore write errors */ }
          }
          const parsed = parseYaml(sanitized) as any;
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
          };
        } catch {
          return { file, kind: 'AppStory' as const, valid: false, error: 'Failed to parse' };
        }
      });
    }

    // Feature stories
    if (FEATURES_DIR && existsSync(FEATURES_DIR)) {
      const featureFiles = readdirSync(FEATURES_DIR).filter(
        (f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('.') && !f.startsWith('_')
      );

      featureStories = featureFiles.map((file) => {
        try {
          const raw = readFileSync(join(FEATURES_DIR, file), 'utf-8');
          const { content: sanitized, fixed } = sanitizeYaml(raw);
          if (fixed) {
            try { writeFileSync(join(FEATURES_DIR, file), sanitized, 'utf-8'); } catch { /* ignore write errors */ }
          }
          const parsed = parseYaml(sanitized) as any;
          return {
            file: `features/${file}`,
            kind: 'FeatureStory' as const,
            valid: true,
            feature: parsed.feature || {},
            target: parsed.target || {},
            status: parsed.status || 'unknown',
            pages: parsed.pages || [],
            model: parsed.model || {},
            navigation: parsed.navigation || {},
            phase: parsed.phase ?? 0,
            dependsOn: parsed.dependsOn ?? [],
          };
        } catch {
          return { file: `features/${file}`, kind: 'FeatureStory' as const, valid: false, error: 'Failed to parse' };
        }
      });
    }

    // Completed/Done stories in 'done' directory
    if (DONE_DIR && existsSync(DONE_DIR)) {
      const doneFiles = readdirSync(DONE_DIR).filter(
        (f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('.') && !f.startsWith('_')
      );

      for (const file of doneFiles) {
        try {
          const raw = readFileSync(join(DONE_DIR, file), 'utf-8');
          const { content: sanitized, fixed } = sanitizeYaml(raw);
          if (fixed) {
            try { writeFileSync(join(DONE_DIR, file), sanitized, 'utf-8'); } catch { /* ignore write errors */ }
          }
          const parsed = parseYaml(sanitized) as any;

          // Determine if it is a FeatureStory or AppStory
          const isFeature = parsed && (parsed.feature || parsed.target || 'phase' in parsed);
          if (isFeature) {
            featureStories.push({
              file: `done/${file}`,
              kind: 'FeatureStory' as const,
              valid: true,
              feature: parsed.feature || {},
              target: parsed.target || {},
              status: parsed.status || 'unknown',
              pages: parsed.pages || [],
              model: parsed.model || {},
              navigation: parsed.navigation || {},
              phase: parsed.phase ?? 0,
              dependsOn: parsed.dependsOn ?? [],
            });
          } else {
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
            });
          }
        } catch {
          featureStories.push({ file: `done/${file}`, kind: 'FeatureStory' as const, valid: false, error: 'Failed to parse' });
        }
      }
    }

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
    const storyContent = content || `metadata:
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
