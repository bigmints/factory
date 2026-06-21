import { homedir } from 'node:os';
import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, openSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { createConnection } from 'node:net';

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

function resolveAppDir(projectPath: string): string {
  if (existsSync(join(projectPath, 'package.json'))) {
    return projectPath;
  }

  try {
    const entries = readdirSync(projectPath);
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const fullPath = join(projectPath, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          if (existsSync(join(fullPath, 'package.json'))) {
            return fullPath;
          }
        }
      } catch {}
    }
  } catch (err) {
    console.error('Error scanning subdirectories for package.json:', err);
  }

  return projectPath;
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
  const match = log.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i);
  if (match) {
    return parseInt(match[1]);
  }
  return null;
}

function checkPortActive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.setTimeout(250);
    socket.on('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function getPidOnPort(port: number): number | null {
  try {
    const output = execSync(`lsof -t -i :${port}`, { encoding: 'utf8' }).trim();
    if (output) {
      const pids = output.split('\n').map(p => parseInt(p.trim())).filter(p => !isNaN(p));
      return pids[0] || null;
    }
  } catch {}
  return null;
}

function killPid(pid: number): boolean {
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    try {
      execSync(`kill -9 ${pid}`);
      return true;
    } catch {}
  }
  return false;
}

function killPidsOnPort(port: number): boolean {
  try {
    const output = execSync(`lsof -t -i :${port}`, { encoding: 'utf8' }).trim();
    if (output) {
      const pids = output.split('\n').map(p => parseInt(p.trim())).filter(p => !isNaN(p));
      let killedAny = false;
      for (const pid of pids) {
        if (killPid(pid)) {
          killedAny = true;
        }
      }
      return killedAny;
    }
  } catch {}
  return false;
}

export async function GET() {
  try {
    const project = getActiveProject();
    if (!project) {
      return NextResponse.json({ status: 'stopped', error: 'No active project' });
    }

    // Check if package.json exists in project or subdirectories
    let hasPackageJson = false;
    try {
      const appDir = resolveAppDir(project.path);
      hasPackageJson = existsSync(join(appDir, 'package.json'));
    } catch {}

    if (!hasPackageJson) {
      return NextResponse.json({
        status: 'unsupported',
        error: 'Local run is currently supported only for Node / React apps'
      });
    }

    const factoryDir = join(project.path, '.factory');
    const pidFile = join(factoryDir, 'run-app.pid');
    const logFile = join(factoryDir, 'run-app.log');

    let pid: number | null = null;
    let logContent = '';
    let port: number | null = null;

    if (existsSync(logFile)) {
      try {
        logContent = readFileSync(logFile, 'utf-8');
        const lines = logContent.split('\n');
        logContent = lines.slice(-100).join('\n');
        port = extractPortFromLogs(logContent);
      } catch {}
    }

    // Read stored PID if it exists
    if (existsSync(pidFile)) {
      try {
        pid = parseInt(readFileSync(pidFile, 'utf-8').trim());
      } catch {
        pid = null;
      }
    }

    const checkPort = port || 3000;
    const hasGlobalRecord = !!globalProcesses.runAppProcesses[project.id];
    
    // We only check if the port is active if we actually have a running or starting process
    const isPortActive = (pid || hasGlobalRecord) ? await checkPortActive(checkPort) : false;

    let status = 'stopped';
    if (isPortActive) {
      status = 'running';
      if (!pid) {
        pid = getPidOnPort(checkPort);
      }
    } else if (pid && checkPidAlive(pid)) {
      status = 'starting';
    } else {
      // Process is dead and port is inactive, clean up pid file
      if (existsSync(pidFile)) {
        try { unlinkSync(pidFile); } catch {}
      }
      pid = null;
    }

    return NextResponse.json({
      status,
      pid,
      port: isPortActive ? checkPort : null,
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
      mkdirSync(factoryDir, { recursive: true });
    }

    // --- STOP ACTION ---
    if (action === 'stop') {
      let stopped = false;

      // 1. Try to kill stored process and its group
      if (existsSync(pidFile)) {
        try {
          const pid = parseInt(readFileSync(pidFile, 'utf-8').trim());
          if (pid) {
            try {
              process.kill(-pid, 'SIGKILL');
              stopped = true;
            } catch {
              try {
                process.kill(pid, 'SIGKILL');
                stopped = true;
              } catch {}
            }
          }
        } catch {}
      }

      // 2. Also locate process by active port and kill it to clean up runaway grandchild Next.js processes
      try {
        let port: number | null = null;
        if (existsSync(logFile)) {
          const logContent = readFileSync(logFile, 'utf-8');
          port = extractPortFromLogs(logContent);
        }
        const activePort = port || 3000;
        const killedOnPort = killPidsOnPort(activePort);
        if (killedOnPort) {
          stopped = true;
        }
      } catch {}

      // Cleanup
      try { unlinkSync(pidFile); } catch {}
      delete globalProcesses.runAppProcesses[project.id];

      return NextResponse.json({ success: true, status: 'stopped', stopped });
    }

    // --- START ACTION ---
    if (action === 'start') {
      // 1. Clear any existing process on target port (default 3000) to avoid EADDRINUSE conflicts
      let port: number | null = null;
      if (existsSync(logFile)) {
        try {
          const logContent = readFileSync(logFile, 'utf-8');
          port = extractPortFromLogs(logContent);
        } catch {}
      }
      const targetPort = port || 3000;
      
      const killedOnPort = killPidsOnPort(targetPort);
      if (killedOnPort) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Delay to let OS free the port
      }

      // 2. Clear any lingering pid file processes
      if (existsSync(pidFile)) {
        try {
          const oldPid = parseInt(readFileSync(pidFile, 'utf-8').trim());
          if (oldPid) {
            try { process.kill(oldPid, 'SIGKILL'); } catch {}
          }
          try { unlinkSync(pidFile); } catch {}
        } catch {}
      }

      const appDir = resolveAppDir(project.path);

      // Auto-detect script and package manager from package.json
      const pkgPath = join(appDir, 'package.json');
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
        if (existsSync(join(appDir, 'pnpm-lock.yaml'))) pm = 'pnpm';
        else if (existsSync(join(appDir, 'yarn.lock'))) pm = 'yarn';
        else if (existsSync(join(appDir, 'bun.lockb')) || existsSync(join(appDir, 'bun.lock'))) pm = 'bun';
      }

      const command = `${pm} run ${devScript}`;

      // Open a write stream to overwrite logs
      const logFd = openSync(logFile, 'w');

      // Spawn background process detached
      const child = spawn(command, [], {
        cwd: appDir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        shell: true,
        env: {
          ...process.env,
          PORT: String(targetPort),
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
        status: 'starting',
        pid: child.pid,
        command,
      });
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
