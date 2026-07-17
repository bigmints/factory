import { homedir } from 'node:os';
/**
 * POST /api/build — Run full build pipeline for a story
 * Body: { storyFile: "filename.yaml" }
 */
import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildSpawnEnv } from '@engine/cli-adapter';

const FACTORY_ROOT = resolve(homedir(), '.factory');

/**
 * Resolve a story filename to its absolute path.
 * Searches the active project's .factory/stories/apps/ and .factory/stories/features/.
 * Falls back to the factory root stories/ for backward compat.
 */
function resolveStoryPath(storyFile: string): string | null {
  // Read active project from projects.json
  const projectsPath = join(FACTORY_ROOT, 'projects.json');
  if (existsSync(projectsPath)) {
    try {
      const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
      const activeId = config.activeProject;
      const project = config.projects?.find((p: { id: string }) => p.id === activeId);

      if (project?.path) {
        // Check apps/ first, then features/, then root stories/
        const candidates = [
          join(project.path, '.factory', 'stories', 'apps', storyFile),
          join(project.path, '.factory', 'stories', 'features', storyFile),
          join(project.path, '.factory', 'stories', storyFile),
        ];
        for (const candidate of candidates) {
          if (existsSync(candidate)) return candidate;
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: look in factory root stories/
  const fallback = join(FACTORY_ROOT, 'stories', storyFile);
  if (existsSync(fallback)) return fallback;

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const storyFile = body.storyFile || body.specFile;
    if (!storyFile) {
      return NextResponse.json({ error: 'storyFile is required' }, { status: 400 });
    }

    const storyPath = resolveStoryPath(storyFile);
    if (!storyPath) {
      return NextResponse.json(
        { success: false, error: `Story file not found: ${storyFile}` },
        { status: 404 }
      );
    }

    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');
    const execOptions = {
      encoding: 'utf-8' as BufferEncoding,
      timeout: 1_200_000,
      env: { ...buildSpawnEnv(), npm_config_cache: '/tmp/factory-npm-cache', TMPDIR: '/tmp/factory-npm-cache' }
    };

    const result = stripAnsi(execFileSync(
      'factory', ['build', storyPath],
      { ...execOptions, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString());

    const success = result.includes('BUILD COMPLETE') || result.includes('All tests passed');

    return NextResponse.json({ success, output: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Build failed';
    const stdout = (err as { stdout?: string })?.stdout || '';
    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');
    return NextResponse.json(
      { success: false, error: message, output: stripAnsi(stdout) },
      { status: 500 }
    );
  }
}
