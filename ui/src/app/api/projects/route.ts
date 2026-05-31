import { homedir } from 'node:os';
/**
 * GET  /api/projects — List all connected projects + active project
 * POST /api/projects — Add a new project (body: { path: string })
 */
import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FACTORY_ROOT = resolve(homedir(), '.factory');
const PROJECTS_FILE = join(FACTORY_ROOT, 'projects.json');

function loadProjectsConfig() {
  if (!existsSync(PROJECTS_FILE)) {
    return { activeProject: null, projects: [] };
  }
  return JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
}

function stripAnsi(str: string) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export async function GET() {
  try {
    const config = loadProjectsConfig();

    // Enrich each project with its factory.yaml bridge data
    const enrichedProjects = config.projects.map((project: any) => {
      const bridgePath = join(project.path, '.factory', 'factory.yaml');
      let bridge = null;
      if (existsSync(bridgePath)) {
        try {
          const { parse: parseYaml } = require('yaml');
          const raw = parseYaml(readFileSync(bridgePath, 'utf-8'));

          // Data can live at top-level or under raw.monorepo
          const mono = raw.monorepo || {};
          const apps = raw.apps || mono.apps || {};
          const packages = raw.packages || mono.packages || {};
          const conventions = raw.conventions || mono.conventions || {};
          const scripts = raw.scripts || mono.scripts || [];
          const skills = raw.skills || mono.skills || {};

          // Count nested category objects: { superapp: [...], independent: [...] }
          const countNested = (obj: any) => {
            if (Array.isArray(obj)) return obj.length;
            if (obj && typeof obj === 'object') {
              return Object.values(obj).reduce((sum: number, v: any) => sum + (Array.isArray(v) ? v.length : 0), 0);
            }
            return 0;
          };

          bridge = {
            name: raw.appName || raw.name || mono.name || null,
            description: raw.description || null,
            stack: raw.stack || project.stack || null,
            stats: {
              apps: countNested(apps),
              packages: countNested(packages),
              conventions: Array.isArray(conventions.rules) ? conventions.rules.length : (conventions.rules ? 1 : 0),
              scripts: Array.isArray(scripts) ? scripts.length : 0,
            },
            hasSkills: !!(skills.files?.length || skills.discovery === 'auto'),
          };
        } catch {
          // Silently skip malformed yaml
        }
      }
      return { ...project, bridge };
    });

    return NextResponse.json({
      projects: enrichedProjects,
      activeId: config.activeProject,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const repoPath = body.path;

    if (!repoPath || typeof repoPath !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: path' },
        { status: 400 }
      );
    }

    const isUrl = repoPath.startsWith('http://') || repoPath.startsWith('https://') || repoPath.startsWith('git@');
    let targetArg = repoPath;
    let projectDir = repoPath;

    if (isUrl) {
      const repoNameMatch = repoPath.match(/([^\/]+)(?:\.git)?$/);
      const repoName = repoNameMatch ? repoNameMatch[1].replace(/\.git$/, '') : 'factory-project';
      projectDir = resolve(process.cwd(), repoName);
    } else {
      targetArg = resolve(repoPath);
      projectDir = targetArg;
      if (!existsSync(projectDir)) {
        return NextResponse.json(
          { error: `Path does not exist: ${projectDir}` },
          { status: 400 }
        );
      }
    }

    const stack = body.stack || {};
    const addArgs: string[] = ['project', 'add', targetArg];
    if (stack.framework) { addArgs.push('--framework', stack.framework); }
    if (stack.packageManager) { addArgs.push('--pm', stack.packageManager); }
    if (stack.linter) { addArgs.push('--linter', stack.linter); }
    if (stack.testing) { addArgs.push('--testing', stack.testing); }

    // Run engine CLI to add project (this handles bridge init + project registration)
    const execOptions = { 
      encoding: 'utf-8' as BufferEncoding, 
      timeout: 600000, // increased timeout for cloning + LLM analysis
      stdio: 'pipe',
      env: { ...process.env, npm_config_cache: '/tmp/factory-npm-cache', TMPDIR: '/tmp/factory-npm-cache' }
    };

    const output = stripAnsi(execFileSync(
      'factory', addArgs,
      execOptions as any
    ).toString());

    // Now sync reference from the new project
    const syncOutput = stripAnsi(execFileSync(
      'factory', ['sync', projectDir],
      execOptions as any
    ).toString());

    // Re-read projects.json to get the result
    const config = loadProjectsConfig();
    const project = config.projects.find((p: any) => p.path === projectDir);

    // Read bridge config if available
    let bridge = null;
    const bridgePath = join(projectDir, '.factory', 'factory.yaml');
    if (existsSync(bridgePath)) {
      const { parse: parseYaml } = require('yaml');
      bridge = parseYaml(readFileSync(bridgePath, 'utf-8'));
    }

    return NextResponse.json({
      success: true,
      project,
      bridge,
      output: output + '\n' + syncOutput,
    });
  } catch (err: any) {
    const stdout = err.stdout ? stripAnsi(err.stdout.toString()) : '';
    const stderr = err.stderr ? stripAnsi(err.stderr.toString()) : '';
    const combinedOutput = `${err.message}\n${stdout}\n${stderr}`.trim();
    
    return NextResponse.json(
      { error: 'Failed to add project', details: combinedOutput, output: stdout },
      { status: 500 }
    );
  }
}
