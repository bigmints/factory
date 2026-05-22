import { homedir } from 'node:os';
import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, openSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';

const FACTORY_ROOT = resolve(homedir(), '.factory');
const PROJECTS_FILE = join(FACTORY_ROOT, 'projects.json');

// Store process mapping globally so they persist across hot-reloads in dev mode
const globalProcesses = global as any;
if (!globalProcesses.runAppProcesses) {
  globalProcesses.runAppProcesses = {};
}

function loadProjectsConfig() {
  if (!existsSync(PROJECTS_FILE)) {
    return { activeProject: null, projects: [] };
  }
  return JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
}

function getActiveProject() {
  const config = loadProjectsConfig();
  if (!config.activeProject) return null;
  return config.projects.find((p: any) => p.id === config.activeProject) || null;
}

function checkPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function extractPortFromLogs(log: string): number | null {
  // Matches localhost:XXXX or 127.0.0.1:XXXX or 0.0.0.0:XXXX
  const match = log.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i);
  if (match) {
    return parseInt(match[1]);
  }
  return null;
}

export async function GET() {
  try {
    const project = getActiveProject();
    if (!project) {
      return NextResponse.json({ status: 'stopped', error: 'No active project' });
    }

    const factoryDir = join(project.path, '.factory');
    const pidFile = join(factoryDir, 'run-app.pid');
    const logFile = join(factoryDir, 'run-app.log');

    let isRunning = false;
    let pid: number | null = null;
    let logContent = '';
    let port: number | null = null;

    if (existsSync(pidFile)) {
      try {
        pid = parseInt(readFileSync(pidFile, 'utf-8').trim());
        if (pid && checkPidAlive(pid)) {
          isRunning = true;
        } else {
          // Process is dead, clean up pid file
          try { unlinkSync(pidFile); } catch {}
          pid = null;
        }
      } catch {
        pid = null;
      }
    }

    if (existsSync(logFile)) {
      try {
        logContent = readFileSync(logFile, 'utf-8');
        // Get last 100 lines
        const lines = logContent.split('\n');
        logContent = lines.slice(-100).join('\n');
        port = extractPortFromLogs(logContent);
      } catch {}
    }

    return NextResponse.json({
      status: isRunning ? 'running' : 'stopped',
      pid,
      port,
      command: globalProcesses.runAppProcesses[project.id]?.command || null,
      logs: logContent,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const project = getActiveProject();
    if (!project) {
      return NextResponse.json({ error: 'No active project selected' }, { status: 400 });
    }

    const { action } = await request.json();
    const factoryDir = join(project.path, '.factory');
    const pidFile = join(factoryDir, 'run-app.pid');
    const logFile = join(factoryDir, 'run-app.log');

    if (!existsSync(factoryDir)) {
      writeFileSync(pidFile, ''); // creates dir / file
    }

    // --- STOP ACTION ---
    if (action === 'stop') {
      let stopped = false;
      if (existsSync(pidFile)) {
        try {
          const pid = parseInt(readFileSync(pidFile, 'utf-8').trim());
          if (pid) {
            // Kill entire process group by passing negative PID (since detached: true was used)
            try {
              process.kill(-pid, 'SIGINT');
              stopped = true;
            } catch {
              try {
                process.kill(pid, 'SIGINT');
                stopped = true;
              } catch {}
            }
          }
        } catch {}
      }

      // Cleanup
      try { unlinkSync(pidFile); } catch {}
      delete globalProcesses.runAppProcesses[project.id];

      return NextResponse.json({ success: true, status: 'stopped', stopped });
    }

    // --- START ACTION ---
    if (action === 'start') {
      // Check if already running
      if (existsSync(pidFile)) {
        try {
          const pid = parseInt(readFileSync(pidFile, 'utf-8').trim());
          if (pid && checkPidAlive(pid)) {
            return NextResponse.json({ error: 'Application is already running' }, { status: 400 });
          }
        } catch {}
      }

      // Auto-detect script and package manager from package.json
      const pkgPath = join(project.path, 'package.json');
      if (!existsSync(pkgPath)) {
        return NextResponse.json({ error: 'No package.json found in active project' }, { status: 400 });
      }

      let pkg: any = {};
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      } catch {
        return NextResponse.json({ error: 'Failed to parse package.json' }, { status: 400 });
      }

      const scripts = pkg.scripts || {};
      let devScript = '';
      if (scripts.dev) devScript = 'dev';
      else if (scripts.start) devScript = 'start';
      else if (scripts.watch) devScript = 'watch';
      else {
        return NextResponse.json({ error: 'No suitable scripts (dev, start, watch) found in package.json' }, { status: 400 });
      }

      // Detect package manager
      let pm = 'npm';
      const stackPm = project.stack?.packageManager || project.bridge?.stack?.packageManager;
      if (stackPm) {
        pm = stackPm.toLowerCase();
      } else {
        if (existsSync(join(project.path, 'pnpm-lock.yaml'))) pm = 'pnpm';
        else if (existsSync(join(project.path, 'yarn.lock'))) pm = 'yarn';
        else if (existsSync(join(project.path, 'bun.lockb')) || existsSync(join(project.path, 'bun.lock'))) pm = 'bun';
      }

      const command = `${pm} run ${devScript}`;

      // Open a write stream to overwrite logs
      const logFd = openSync(logFile, 'w');

      // Spawn background process detached
      const child = spawn(command, [], {
        cwd: project.path,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        shell: true,
        env: {
          ...process.env,
          PORT: '3000', // Standard default port
          FORCE_COLOR: '1',
        },
      });

      if (!child.pid) {
        return NextResponse.json({ error: 'Failed to spawn background process' }, { status: 500 });
      }

      // Save PID to file immediately
      writeFileSync(pidFile, String(child.pid));

      // Keep reference in global store
      globalProcesses.runAppProcesses[project.id] = {
        pid: child.pid,
        command,
        startedAt: new Date().toISOString(),
      };

      // Unreference the child process to let it run completely in background
      child.unref();

      return NextResponse.json({
        success: true,
        status: 'running',
        pid: child.pid,
        command,
      });
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
