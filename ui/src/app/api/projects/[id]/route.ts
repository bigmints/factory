import { homedir } from 'node:os';
/**
 * PATCH  /api/projects/:id — Set as active project
 * DELETE /api/projects/:id — Remove a project
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

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const execOptions = {
      encoding: 'utf-8' as BufferEncoding,
      timeout: 30000,
      env: { ...process.env, npm_config_cache: '/tmp/factory-npm-cache', TMPDIR: '/tmp/factory-npm-cache' }
    };

    // Switch active project via CLI
    const output = stripAnsi(execFileSync(
      'factory', ['project', 'switch', id],
      { ...execOptions, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString());

    // Re-read to get the project data
    const config = loadProjectsConfig();
    const project = config.projects.find((p: any) => p.id === id);

    if (project) {
      // Re-sync reference for the new active project
      try {
        execFileSync(
          'factory', ['sync', project.path],
          { ...execOptions, stdio: ['pipe', 'pipe', 'pipe'] }
        );
      } catch {
        // Sync failure shouldn't block switching
      }
    }

    return NextResponse.json({ success: true, project, output });
  } catch (err: any) {
    const stdout = err.stdout ? stripAnsi(err.stdout.toString()) : '';
    const stderr = err.stderr ? stripAnsi(err.stderr.toString()) : '';
    const combinedOutput = `${err.message}\n${stdout}\n${stderr}`.trim();
    return NextResponse.json(
      { error: 'Failed to switch project', details: combinedOutput, output: stdout },
      { status: err.message?.includes('not found') ? 404 : 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    const config = loadProjectsConfig();
    const projectIndex = config.projects.findIndex((p: any) => p.id === id);
    if (projectIndex === -1) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    config.projects[projectIndex] = { ...config.projects[projectIndex], ...body };
    
    const { writeFileSync } = require('node:fs');
    writeFileSync(PROJECTS_FILE, JSON.stringify(config, null, 2) + '\n');
    
    return NextResponse.json({ success: true, project: config.projects[projectIndex] });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to update project', details: err.message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const execOptions = {
      encoding: 'utf-8' as BufferEncoding,
      timeout: 30000,
      env: { ...process.env, npm_config_cache: '/tmp/factory-npm-cache', TMPDIR: '/tmp/factory-npm-cache' }
    };

    const output = stripAnsi(execFileSync(
      'factory', ['project', 'remove', id],
      { ...execOptions, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString());

    return NextResponse.json({ success: true, output });
  } catch (err: any) {
    const stdout = err.stdout ? stripAnsi(err.stdout.toString()) : '';
    const stderr = err.stderr ? stripAnsi(err.stderr.toString()) : '';
    const combinedOutput = `${err.message}\n${stdout}\n${stderr}`.trim();
    return NextResponse.json(
      { error: 'Failed to remove project', details: combinedOutput, output: stdout },
      { status: err.message?.includes('not found') ? 404 : 500 }
    );
  }
}
