/**
 * Knowledge API — ADRs, project context, worklog, failures, and workflows.
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { parse as yamlParse } from 'yaml';
import { homedir } from 'os';

interface ADR {
  id: string;
  title: string;
  status: string;
  date: string;
  content: string;
  file: string;
}

interface WorklogEntry {
  date: string;
  message: string;
}

interface FailureEntry {
  id: string;
  title: string;
  date: string;
  category: string;
  duration: string;
  error: string;
  action: string;
  content: string;
  file: string;
}

interface WorkflowEntry {
  id: string;
  title: string;
  content: string;
  file: string;
}

const FACTORY_ROOT = path.resolve(homedir(), '.factory');

function getProjectRoot(): string {
  // 1. Read active project from projects.json in FACTORY_ROOT
  const projectsPath = path.join(FACTORY_ROOT, 'projects.json');
  if (fs.existsSync(projectsPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(projectsPath, 'utf-8'));
      if (config.activeProject) {
        const project = config.projects?.find((p: any) => p.id === config.activeProject);
        if (project && project.path) {
          return project.path;
        }
      }
    } catch { /* ignore */ }
  }

  // 2. Try to get from engine config relative to process.cwd() (ui/)
  const engineConfig = path.resolve(process.cwd(), '../.factory/factory.yaml');
  if (fs.existsSync(engineConfig)) {
    try {
      const c = yamlParse(fs.readFileSync(engineConfig, 'utf8')) as Record<string, string>;
      if (c?.factory_home) return c.factory_home as string;
    } catch { /* ignore */ }
  }

  // 3. Fallback to process.cwd() / .. if running within the factory repo
  const possibleLocalRoot = path.resolve(process.cwd(), '..');
  if (fs.existsSync(path.join(possibleLocalRoot, '.factory'))) {
    return possibleLocalRoot;
  }

  // 4. Default: two levels up from ui/ (e.g. /Users/pretheesh/Projects)
  return path.resolve(process.cwd(), '../..');
}

function readAdrs(projectRoot: string): ADR[] {
  const adrs: ADR[] = [];
  const adrDirs = [
    { path: path.join(projectRoot, 'docs', 'adr'), type: 'docs' },
    { path: path.join(projectRoot, '.factory', 'knowledge'), type: 'factory' },
    { path: path.join(projectRoot, '.factory', 'knowledge', 'ADRs'), type: 'factory' },
    { path: path.join(projectRoot, '.factory', 'knowledge', 'design-system'), type: 'factory' }
  ];

  for (const dirInfo of adrDirs) {
    const dir = dirInfo.path;
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const mdFiles = entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => entry.name)
        .sort();

      for (const file of mdFiles) {
        const fullPath = path.join(dir, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        // Extract title from first H1
        const titleMatch = content.match(/^# (.+)$/m);
        const title = titleMatch?.[1] || file.replace('.md', '');
        // Extract status
        const statusMatch = content.match(/^(?:\*\*)?Status(?:\*\*)?:\s*(.+)$/im);
        const status = statusMatch?.[1]?.trim() || 'Unknown';
        // Extract date
        const dateMatch = content.match(/^(?:\*\*)?Date(?:\*\*)?:\s*(.+)$/im);
        const date = dateMatch?.[1]?.trim() || '';
        const id = file.replace('.md', '');
        adrs.push({ id, title, status, date, content, file: path.join(dirInfo.type, file) });
      }
    } catch { /* ignore */ }
  }
  return adrs;
}

function readContext(projectRoot: string): Record<string, unknown> {
  const contextCandidates = [
    path.join(projectRoot, '.factory', 'logs', 'state.yaml'),
    path.join(projectRoot, '.factory', 'context', 'context.yaml'),
    path.join(projectRoot, '.factory', 'logs', 'state.toon'),
    path.join(projectRoot, '.factory', 'context', 'context.toon'),
  ];

  for (const file of contextCandidates) {
    if (fs.existsSync(file)) {
      try {
        return yamlParse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      } catch { /* ignore */ }
    }
  }
  return {};
}

function readWorklog(projectRoot: string): WorklogEntry[] {
  const worklogCandidates = [
    path.join(projectRoot, '.factory', 'logs', 'worklog.yaml'),
    path.join(projectRoot, '.factory', 'context', 'worklog.yaml'),
    path.join(projectRoot, '.factory', 'logs', 'worklog.toon'),
    path.join(projectRoot, '.factory', 'context', 'worklog.toon'),
  ];

  for (const file of worklogCandidates) {
    if (fs.existsSync(file)) {
      try {
        const raw = yamlParse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (Array.isArray(raw)) return raw as WorklogEntry[];
        const text = fs.readFileSync(file, 'utf8');
        const lines = text.split('\n');
        const entries: WorklogEntry[] = [];
        for (const line of lines) {
          const m = line.match(/^\s+"([^"]+)","([^"]+)"/);
          if (m) entries.push({ date: m[1], message: m[2] });
        }
        if (entries.length > 0) return entries.reverse();
      } catch { /* ignore */ }
    }
  }
  return [];
}

function readHeartbeat(projectRoot: string): Record<string, unknown> {
  const heartbeatCandidates = [
    path.join(projectRoot, '.factory', 'logs', 'heartbeat.yaml'),
    path.join(projectRoot, '.factory', 'context', 'heartbeat.yaml'),
    path.join(projectRoot, '.factory', 'logs', 'heartbeat.toon'),
    path.join(projectRoot, '.factory', 'context', 'heartbeat.toon'),
  ];

  for (const file of heartbeatCandidates) {
    if (fs.existsSync(file)) {
      try {
        return yamlParse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      } catch { /* ignore */ }
    }
  }
  return {};
}

function readFailures(projectRoot: string): FailureEntry[] {
  const failDirs = [
    path.join(projectRoot, '.factory', 'logs', 'failures'),
    path.join(projectRoot, '.factory', 'knowledge', 'failures')
  ];

  for (const failDir of failDirs) {
    if (!fs.existsSync(failDir)) continue;
    try {
      const files = fs.readdirSync(failDir).filter(f => f.endsWith('.md')).sort().reverse();
      if (files.length === 0) continue;
      return files.map(file => {
        const content = fs.readFileSync(path.join(failDir, file), 'utf8');
        const titleMatch = content.match(/^# (.+)$/m);
        const title = titleMatch?.[1] || file.replace('.md', '');
        const dateMatch = content.match(/\*\*Date:\*\*\s*(.+)/i);
        const date = dateMatch?.[1]?.trim() || '';
        const catMatch = content.match(/\*\*Category:\*\*\s*(.+)/i);
        const category = catMatch?.[1]?.trim() || '';
        const durMatch = content.match(/\*\*Duration:\*\*\s*(.+)/i);
        const duration = durMatch?.[1]?.trim() || '';
        const errorMatch = content.match(/## Error\s*```[\w]*\n([\s\S]+?)```/i);
        const error = errorMatch?.[1]?.trim() || '';
        const actionMatch = content.match(/## Action\n([\s\S]+?)(?:\n##|$)/i);
        const action = actionMatch?.[1]?.trim() || '';
        const id = file.replace('.md', '');
        return { id, title, date, category, duration, error, action, content, file };
      });
    } catch { /* ignore */ }
  }
  return [];
}

function readWorkflows(projectRoot: string): WorkflowEntry[] {
  const wfDir = path.join(projectRoot, '.factory', 'workflows');
  if (!fs.existsSync(wfDir)) return [];
  try {
    const files = fs.readdirSync(wfDir).filter(f => f.endsWith('.md')).sort();
    return files.map(file => {
      const content = fs.readFileSync(path.join(wfDir, file), 'utf8');
      const titleMatch = content.match(/^#+ (.+)$/m);
      const title = titleMatch?.[1] || file.replace('.md', '');
      const id = file.replace('.md', '');
      return { id, title, content, file };
    });
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';

    const projectRoot = getProjectRoot();

    const adrs = readAdrs(projectRoot);
    const context = readContext(projectRoot);
    const worklog = readWorklog(projectRoot);
    const heartbeat = readHeartbeat(projectRoot);
    const failures = readFailures(projectRoot);
    const workflows = readWorkflows(projectRoot);

    // Apply search filter
    const qLower = query.toLowerCase();
    const filterText = (text: string) => !qLower || text.toLowerCase().includes(qLower);

    const filtered = {
      adrs: adrs.filter(a => filterText(a.title + ' ' + a.content)),
      failures: failures.filter(f => filterText(f.title + ' ' + f.error + ' ' + f.action)),
      workflows: workflows.filter(w => filterText(w.title + ' ' + w.content)),
      worklog: worklog.filter(e => filterText(e.message + ' ' + e.date)),
    };

    return NextResponse.json({
      adrs: filtered.adrs,
      context,
      heartbeat,
      worklog: filtered.worklog,
      failures: filtered.failures,
      workflows: filtered.workflows,
      projectRoot,
      stats: {
        adrs: adrs.length,
        failures: failures.length,
        workflows: workflows.length,
        worklogEntries: worklog.length,
      }
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
