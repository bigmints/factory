import { homedir } from 'node:os';
/**
 * POST /api/feature-build — Build a feature from a feature story
 * Body: { storyFile: "features/filename.yaml" }
 */
import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FACTORY_ROOT = resolve(homedir(), '.factory');

const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * Resolve a feature story filename to its absolute path.
 */
function resolveFeatureStoryPath(storyFile: string): string | null {
  const cleanFile = storyFile.replace(/^features\//, '');

  const projectsPath = join(FACTORY_ROOT, 'projects.json');
  if (existsSync(projectsPath)) {
    try {
      const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
      const activeId = config.activeProject;
      const project = config.projects?.find((p: { id: string }) => p.id === activeId);

      if (project?.path) {
        const candidates = [
          join(project.path, '.factory', 'stories', 'features', cleanFile),
          join(project.path, '.factory', 'stories', storyFile),
        ];
        for (const candidate of candidates) {
          if (existsSync(candidate)) return candidate;
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: factory root
  const fallback = join(FACTORY_ROOT, 'stories', storyFile);
  if (existsSync(fallback)) return fallback;

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const storyFile = body.storyFile || body.specFile;
    const { action = 'build' } = body;

    if (!storyFile) {
      return NextResponse.json({ error: 'storyFile is required' }, { status: 400 });
    }

    const storyPath = resolveFeatureStoryPath(storyFile);
    if (!storyPath) {
      return NextResponse.json(
        { success: false, error: `Feature story not found: ${storyFile}` },
        { status: 404 }
      );
    }

    const cmd = action === 'validate' ? 'validate' : 'build';

    const execOptions = {
      encoding: 'utf-8' as BufferEncoding,
      timeout: 300000,
      env: { ...process.env, npm_config_cache: '/tmp/factory-npm-cache', TMPDIR: '/tmp/factory-npm-cache' }
    };

    const result = stripAnsi(execFileSync(
      'factory', ['feature', cmd, storyPath],
      { ...execOptions, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString());

    const success = result.includes('COMPLETE') || result.includes('PASSED');

    return NextResponse.json({ success, output: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Feature build failed';
    const output = (err as any)?.stdout || (err as any)?.stderr || message;
    return NextResponse.json(
      { success: false, error: message, output: stripAnsi(String(output)) },
      { status: 500 }
    );
  }
}
