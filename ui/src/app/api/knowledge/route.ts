/**
 * Knowledge API — ADRs, project context, worklog, failures, and workflows.
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { parse as yamlParse } from 'yaml';

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

function getProjectRoot(): string {
  // Try to get from engine config
  const engineConfig = path.resolve(process.cwd(), '../../.factory/factory.yaml');
  if (fs.existsSync(engineConfig)) {
    try {
      const c = yamlParse(fs.readFileSync(engineConfig, 'utf8')) as Record<string, string>;
      if (c?.factory_home) return c.factory_home as string;
    } catch { /* ignore */ }
  }
  // Default: the factory project root (two levels up from ui/)
  return path.resolve(process.cwd(), '../..');
}

function readAdrs(projectRoot: string): ADR[] {
  const adrDir = path.join(projectRoot, 'docs', 'adr');
  if (!fs.existsSync(adrDir)) return [];
  const files = fs.readdirSync(adrDir).filter(f => f.endsWith('.md')).sort();
  return files.map(file => {
    const content = fs.readFileSync(path.join(adrDir, file), 'utf8');
    // Extract title from first H1
    const titleMatch = content.match(/^# (.+)$/m);
    const title = titleMatch?.[1] || file.replace('.md', '');
    // Extract status
    const statusMatch = content.match(/\*\*Status\*\*:\s*(.+)/);
    const status = statusMatch?.[1]?.trim() || 'Unknown';
    // Extract date
    const dateMatch = content.match(/\*\*Date\*\*:\s*(.+)/);
    const date = dateMatch?.[1]?.trim() || '';
    const id = file.replace('.md', '');
    return { id, title, status, date, content, file };
  });
}

function readContext(projectRoot: string): Record<string, unknown> {
  const contextFile = path.join(projectRoot, '.factory', 'context', 'context.yaml');
  if (!fs.existsSync(contextFile)) return {};
  try {
    return yamlParse(fs.readFileSync(contextFile, 'utf8')) as Record<string, unknown>;
  } catch { return {}; }
}

function readWorklog(projectRoot: string): WorklogEntry[] {
  const worklogFile = path.join(projectRoot, '.factory', 'context', 'worklog.yaml');
  if (!fs.existsSync(worklogFile)) return [];
  try {
    const raw = yamlParse(fs.readFileSync(worklogFile, 'utf8')) as Record<string, unknown>;
    // Handle both array format and YAML entries format
    if (Array.isArray(raw)) return raw as WorklogEntry[];
    // Handle "entries[N]{date,message}:" format by parsing the raw text
    const text = fs.readFileSync(worklogFile, 'utf8');
    const lines = text.split('\n');
    const entries: WorklogEntry[] = [];
    for (const line of lines) {
      const m = line.match(/^\s+"([^"]+)","([^"]+)"/);
      if (m) entries.push({ date: m[1], message: m[2] });
    }
    return entries.reverse(); // newest first
  } catch { return []; }
}

function readHeartbeat(projectRoot: string): Record<string, unknown> {
  const hbFile = path.join(projectRoot, '.factory', 'context', 'heartbeat.yaml');
  if (!fs.existsSync(hbFile)) return {};
  try {
    return yamlParse(fs.readFileSync(hbFile, 'utf8')) as Record<string, unknown>;
  } catch { return {}; }
}

function readFailures(projectRoot: string): FailureEntry[] {
  const failDir = path.join(projectRoot, '.factory', 'knowledge', 'failures');
  if (!fs.existsSync(failDir)) return [];
  const files = fs.readdirSync(failDir).filter(f => f.endsWith('.md')).sort().reverse();
  return files.map(file => {
    const content = fs.readFileSync(path.join(failDir, file), 'utf8');
    const titleMatch = content.match(/^# (.+)$/m);
    const title = titleMatch?.[1] || file.replace('.md', '');
    const dateMatch = content.match(/\*\*Date:\*\*\s*(.+)/);
    const date = dateMatch?.[1]?.trim() || '';
    const catMatch = content.match(/\*\*Category:\*\*\s*(.+)/);
    const category = catMatch?.[1]?.trim() || '';
    const durMatch = content.match(/\*\*Duration:\*\*\s*(.+)/);
    const duration = durMatch?.[1]?.trim() || '';
    const errorMatch = content.match(/## Error\s*```[\w]*\n([\s\S]+?)```/);
    const error = errorMatch?.[1]?.trim() || '';
    const actionMatch = content.match(/## Action\n([\s\S]+?)(?:\n##|$)/);
    const action = actionMatch?.[1]?.trim() || '';
    const id = file.replace('.md', '');
    return { id, title, date, category, duration, error, action, content, file };
  });
}

function readWorkflows(projectRoot: string): WorkflowEntry[] {
  const wfDir = path.join(projectRoot, '.factory', 'workflows');
  if (!fs.existsSync(wfDir)) return [];
  const files = fs.readdirSync(wfDir).filter(f => f.endsWith('.md')).sort();
  return files.map(file => {
    const content = fs.readFileSync(path.join(wfDir, file), 'utf8');
    const titleMatch = content.match(/^#+ (.+)$/m);
    const title = titleMatch?.[1] || file.replace('.md', '');
    const id = file.replace('.md', '');
    return { id, title, content, file };
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const section = url.searchParams.get('section') || 'all';
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
