import { NextResponse } from 'next/server';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

import { getActiveProject } from '@engine/config';
import { listQueue, getQueueStats, enqueue } from '@engine/queue';
import { getBuildLogs } from '@engine/db';

const FACTORY_ROOT = resolve(homedir(), '.factory');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Recursively collect all .yaml/.yml files under a directory */
function collectYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      results.push(...collectYamlFiles(abs));
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      results.push(abs);
    }
  }
  return results;
}

/** Read blueprint/worklog.yaml (TOON format) and return last N entries */
function readBlueprintWorklog(projectPath: string, limit = 8): string {
  const blueprintPath = join(projectPath, '.factory', 'blueprint', 'worklog.yaml');
  const legacyPath    = join(projectPath, '.factory', 'logs', 'worklog.yaml');
  const filePath = existsSync(blueprintPath) ? blueprintPath : legacyPath;
  if (!existsSync(filePath)) return 'No worklog found.';
  try {
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return 'Worklog is empty.';
    // TOON format rows look like: "2026-06-08 20:52:37","factory init complete"
    const lines = raw.split('\n').filter(Boolean);
    const entries: Array<{date: string; message: string}> = [];
    for (const line of lines) {
      if (!line.trimStart().startsWith('"')) continue;
      const parts = line.match(/"([^"]*)","([^"]*)"/);
      if (parts) entries.push({ date: parts[1], message: parts[2] });
    }
    if (entries.length === 0) {
      try {
        const parsed = parseYaml(raw) as any;
        const ents = parsed?.entries || [];
        return ents.slice(-limit).reverse()
          .map((e: any) => `- [${e.date || e.timestamp || ''}] ${e.message || ''}`)
          .join('\n') || 'No entries.';
      } catch { return 'Worklog parse error.'; }
    }
    return entries.slice(-limit).reverse()
      .map(e => `- [${e.date}] ${e.message}`)
      .join('\n');
  } catch {
    return 'Could not read worklog.';
  }
}

/** Load skill-index.yaml from the active project or ~/.factory/ */
function loadSkillIndex(projectPath: string): string {
  const projectIdx = join(projectPath, '.factory', 'skill-index.yaml');
  const globalIdx  = join(homedir(), '.factory', 'skill-index.yaml');
  const filePath = existsSync(projectIdx) ? projectIdx
                 : existsSync(globalIdx)  ? globalIdx : null;
  if (!filePath) return '';
  try {
    const parsed = parseYaml(readFileSync(filePath, 'utf-8')) as any;
    const skills: any[] = parsed?.skills || [];
    if (!skills.length) return '';
    return skills
      .map((s: any) => `- **${s.name}**: ${s.description || ''}${s.trigger ? ` (trigger: ${(s.trigger as string[]).join(', ')})` : ''}`)
      .join('\n');
  } catch { return ''; }
}

/** Load the story-generator SKILL.md for injection into decompose_requirements */
function loadStoryGeneratorSkill(): string {
  const p = join(homedir(), '.factory', 'skills', 'story-generator', 'SKILL.md');
  if (existsSync(p)) { try { return readFileSync(p, 'utf-8'); } catch {} }
  return '';
}

/**
 * Load a skill's full content by name from the global skill-index.yaml.
 * Handles both SKILL.md paths and ~/ expansions.
 * This is the core runtime for the "LLM is the runtime" philosophy:
 * the TypeScript only reads the file — the LLM decides how to apply it.
 */
function loadSkillRaw(name: string): { skill: any; content: string } | null {
  const indexPath = join(homedir(), '.factory', 'skill-index.yaml');
  let skills: any[] = [];
  if (existsSync(indexPath)) {
    try {
      const parsed = parseYaml(readFileSync(indexPath, 'utf-8')) as any;
      skills = parsed?.skills || [];
    } catch { /* fall through */ }
  }

  const q = name.toLowerCase().trim();
  const skill =
    skills.find((s: any) => s.name?.toLowerCase() === q) ||
    skills.find((s: any) => s.name?.toLowerCase().startsWith(q)) ||
    skills.find((s: any) => s.name?.toLowerCase().includes(q)) ||
    skills.find((s: any) => (s.description || '').toLowerCase().includes(q));

  if (!skill) return null;

  const rawPath: string = skill.path || '';
  // Resolve ~/... paths
  const filePath = rawPath.startsWith('~/') ? join(homedir(), rawPath.slice(2)) : rawPath;

  // If path is a factory CLI command (not a file), return the command description
  if (rawPath.startsWith('factory ')) {
    return {
      skill,
      content: `## Skill: ${skill.name}\n\n**Description:** ${skill.description || 'No description'}\n\n**CLI command:** \`${rawPath}\`\n\nThis skill is executed via the Factory CLI. Run this command in the project directory when needed.`,
    };
  }

  if (!filePath || !existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    return { skill, content };
  } catch {
    return null;
  }
}

// ─── TPM Tool Definitions ───────────────────────────────────────────────────
export const TPM_TOOLS = [
  {
    name: 'get_project_status',
    description:
      'Fetch the active project progress: scaffold.yaml epics, build queue status, recent heartbeats, and session worklogs. Call whenever the user asks about project health, progress, or status.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_stories',
    description:
      'List all feature and app stories in the active project with their names, slugs, statuses, and phases. Use when user wants to see what stories exist.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['all', 'feature', 'app'],
          description: 'Filter by story type. Default: all.',
        },
        status: {
          type: 'string',
          description: 'Optional status filter (draft, in-progress, done).',
        },
      },
    },
  },
  {
    name: 'get_story',
    description:
      'Get the full YAML content of a specific story by its slug or file path. Use when the user asks about a specific feature or story details.',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'The story slug (kebab-case filename without .yaml extension) or partial name to search for.',
        },
      },
      required: ['slug'],
    },
  },
  {
    name: 'update_story_status',
    description:
      'Update the status field of a story. Valid statuses: draft, in-progress, done, review. Use when the user wants to mark progress on a story.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The story slug or filename.' },
        status: {
          type: 'string',
          enum: ['draft', 'in-progress', 'done', 'review'],
          description: 'The new status to set.',
        },
      },
      required: ['slug', 'status'],
    },
  },
  {
    name: 'update_story_field',
    description:
      'Update an arbitrary top-level field in a story YAML file. Use to modify description, acceptance_criteria, dependencies, phase, or any other field.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The story slug or filename.' },
        field: { type: 'string', description: 'The YAML field name to update (e.g. "description", "name", "phase").' },
        value: { description: 'The new value to set for the field (can be string, number, array, or object).' },
      },
      required: ['slug', 'field', 'value'],
    },
  },
  {
    name: 'get_scaffold',
    description:
      'Return the full scaffold.yaml planning structure, including all feature epics, their stories, and statuses. Use when user wants to see the full project plan.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_queue',
    description:
      'List all build queue items with their statuses, phases, and dependencies. Use when user asks about the build queue.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'pending', 'running', 'completed', 'failed'],
          description: 'Filter by queue item status. Default: all.',
        },
      },
    },
  },
  {
    name: 'get_build_logs',
    description:
      'Retrieve recent build logs and build receipts for the project. Use when the user asks about what was recently built or build history.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number of log entries to return. Default: 10.' },
      },
    },
  },
  {
    name: 'search_knowledge',
    description:
      'Search the project knowledge base (.factory/knowledge/) for architectural decision records (ADRs) and engineering decisions. Use when user asks about decisions, conventions, or why something was built a certain way.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or topic to find in the knowledge base.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_heartbeat',
    description:
      'Read the latest heartbeat signal and recent worklog session entries. Use when user asks what the agent was last doing or wants a liveness check.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'decompose_requirements',
    description:
      'Decompose user requirements into modular feature stories in Factory YAML format. Use when user wants to plan new features.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The exact user requirement to plan and decompose.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'apply_story',
    description:
      'Write a proposed YAML story to disk (.factory/stories/features/) and automatically enqueue it in the SQLite build queue.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The feature or app story name.' },
        content: {
          type: 'string',
          description: 'The clean, schema-compliant YAML story content.',
        },
        kind: {
          type: 'string',
          enum: ['app', 'feature'],
          description: 'Whether it is an app story or a feature story.',
        },
        phase: {
          type: 'number',
          description: 'Phase number (1 = foundation, 2 = core, 3 = polish).',
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'Slugs of feature stories this story depends on.',
        },
        threadId: {
          type: 'string',
          description: 'Optional thread/conversation ID to associate with this story and task (for running in the same context).',
        },
      },
      required: ['name', 'content', 'kind'],
    },
  },
  {
    name: 'add_adr_decision',
    description:
      'Write an Architectural Decision Record (ADR) or key decision to the project knowledgebase (.factory/knowledge/) for future context.',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'A unique kebab-case slug for the ADR file.',
        },
        content: {
          type: 'string',
          description: 'Detailed markdown describing the architectural decision.',
        },
      },
      required: ['slug', 'content'],
    },
  },
  {
    name: 'list_skills',
    description:
      'List all skills available in the global Factory skill library (~/.factory/skill-index.yaml). Use to discover what skills exist before reading one.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_skill',
    description:
      'Read the full instructions of a skill from the global Factory skill library. The LLM reads the skill content and decides how to apply it. ' +
      'Use this when the user asks you to apply a skill, follow a pattern, or when you need guidance on how to implement something. ' +
      'Examples: read_skill("story-generator") to get story writing instructions, read_skill("scaffold-shadcn-layout") for layout patterns.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the skill to read. Exact or fuzzy match against skill-index.yaml names.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'invoke_skill',
    description:
      'Read a skill and apply it to a given context. Returns the full skill instructions so the LLM can use them to respond. ' +
      'Similar to read_skill but also accepts a context string to help the LLM frame its application of the skill.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the skill to invoke.',
        },
        context: {
          type: 'string',
          description: 'Optional context or user intent to frame how the skill should be applied.',
        },
      },
      required: ['name'],
    },
  },
];


// ─── Settings ───────────────────────────────────────────────────────────────

function getSettings() {
  const file = resolve(FACTORY_ROOT, 'settings.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── Story path resolution helpers ──────────────────────────────────────────

function findStoryPath(projectPath: string, slug: string): string | null {
  const folders = ['features', 'apps', 'done'];
  const normalizedSlug = slug.toLowerCase().replace(/\s+/g, '-').replace(/\.yaml?$/, '');

  for (const folder of folders) {
    const dir = join(projectPath, '.factory', 'stories', folder);
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    // Exact match first
    const exact = files.find(
      (f) => f.replace(/\.ya?ml$/, '') === normalizedSlug || f.replace(/\.ya?ml$/, '') === slug
    );
    if (exact) return join(dir, exact);

    // Partial / fuzzy match
    const partial = files.find((f) => {
      const name = f.replace(/\.ya?ml$/, '').toLowerCase();
      return name.includes(normalizedSlug) || normalizedSlug.includes(name);
    });
    if (partial) return join(dir, partial);
  }
  return null;
}

// ─── Tool Implementations ────────────────────────────────────────────────────

async function handleGetProjectStatus(projectPath: string) {
  let scaffoldInfo = 'No scaffold.yaml found. Please generate stories first.';
  const scaffoldPath = join(projectPath, '.factory', 'scaffold.yaml');
  if (existsSync(scaffoldPath)) {
    try {
      const raw = readFileSync(scaffoldPath, 'utf-8');
      const parsed = parseYaml(raw) as any;
      const features = parsed.features || [];
      let totalStories = 0;
      let completedStories = 0;
      let inProgressStories = 0;
      let draftStories = 0;

      for (const feature of features) {
        const stories = feature.stories || [];
        totalStories += stories.length;
        for (const story of stories) {
          const status = story.status || 'draft';
          if (['done', 'completed'].includes(status)) completedStories++;
          else if (status === 'in-progress') inProgressStories++;
          else draftStories++;
        }
      }
      scaffoldInfo = `Project: ${parsed.name || 'factory-app'}
Features Epic Count: ${features.length}
Total Stories: ${totalStories}
- Completed: ${completedStories}
- In Progress: ${inProgressStories}
- Draft/Ready: ${draftStories}
Progress: ${parsed.progressPercent || 0}%`;
    } catch (e: any) {
      scaffoldInfo = `Error reading scaffold.yaml: ${e.message}`;
    }
  }

  const queueStats = getQueueStats();
  const queueInfo = `Build Queue Status:
- Total Queue Items: ${queueStats.total}
- Pending: ${queueStats.pending}
- Running: ${queueStats.running}
- Completed: ${queueStats.completed}
- Failed: ${queueStats.failed}`;

  let heartbeatMsg = 'No heartbeat registered yet.';
  const heartbeatPath = join(projectPath, '.factory', 'logs', 'heartbeat.yaml');
  if (existsSync(heartbeatPath)) {
    try {
      const raw = readFileSync(heartbeatPath, 'utf-8');
      const parsed = parseYaml(raw) as any;
      heartbeatMsg = `Last Heartbeat: [${parsed.timestamp || 'N/A'}] ${parsed.message || 'No message'}`;
    } catch {}
  }

  // Read from blueprint/worklog.yaml (TOON format) — the actual agent session log
  const worklogSnippet = 'Recent Session Logs:\n' + readBlueprintWorklog(projectPath, 5);

  return JSON.stringify(
    { scaffold: scaffoldInfo, queue: queueInfo, heartbeat: heartbeatMsg, worklog: worklogSnippet },
    null,
    2
  );
}

async function handleListStories(projectPath: string, kind?: string, status?: string) {
  const results: string[] = [];

  const folders: Array<{ key: string; label: string }> = [];
  if (!kind || kind === 'all' || kind === 'app') {
    folders.push({ key: 'apps', label: 'App Stories' });
  }
  if (!kind || kind === 'all' || kind === 'feature') {
    folders.push({ key: 'features', label: 'Feature Stories' });
    folders.push({ key: 'done', label: 'Completed Stories' });
  }

  for (const { key, label } of folders) {
    const dir = join(projectPath, '.factory', 'stories', key);
    // Recursively collect so subdirectories (e.g. features/antigravity/) are included
    const allFiles = collectYamlFiles(dir);
    if (allFiles.length === 0) continue;

    results.push(`\n## ${label} (${allFiles.length})`);

    for (const filePath of allFiles) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = parseYaml(raw) as any;
        const storyStatus = parsed.status || parsed.metadata?.status || 'draft';

        // Filter by status if provided
        if (status && storyStatus !== status) continue;

        const name =
          parsed.name ||
          parsed.metadata?.name ||
          parsed.feature?.name ||
          parsed.appName ||
          filePath.split('/').pop()?.replace(/\.ya?ml$/, '') || 'unknown';
        // Show subdir-relative slug so it's meaningful
        const slug = filePath.replace(dir + '/', '').replace(/\.ya?ml$/, '');
        const phase = parsed.phase ?? parsed.metadata?.phase ?? '—';
        const description =
          (parsed.description || parsed.metadata?.description || '').slice(0, 100);

        results.push(
          `- **${name}** (${slug}) | Status: ${storyStatus} | Phase: ${phase}${description ? `\n  ${description}` : ''}`
        );
      } catch {
        results.push(`- ${filePath.split('/').pop()} (parse error)`);
      }
    }
  }

  if (results.length === 0) {
    return 'No stories found matching the criteria.';
  }

  return results.join('\n');
}

async function handleGetStory(projectPath: string, slug: string) {
  const storyPath = findStoryPath(projectPath, slug);
  if (!storyPath) {
    return `Story not found: "${slug}". Use list_stories to see all available stories.`;
  }

  try {
    const content = readFileSync(storyPath, 'utf-8');
    const relativePath = storyPath.replace(projectPath, '').replace(/^\//, '');
    return `## Story: ${slug}\nPath: ${relativePath}\n\n\`\`\`yaml\n${content}\n\`\`\``;
  } catch (err: any) {
    return `Failed to read story: ${err.message}`;
  }
}

async function handleUpdateStoryStatus(projectPath: string, slug: string, status: string) {
  const storyPath = findStoryPath(projectPath, slug);
  if (!storyPath) {
    return `Story not found: "${slug}". Use list_stories to see all available stories.`;
  }

  try {
    const raw = readFileSync(storyPath, 'utf-8');
    const parsed = parseYaml(raw) as any;
    parsed.status = status;
    writeFileSync(storyPath, toYaml(parsed), 'utf-8');

    const relativePath = storyPath.replace(projectPath, '').replace(/^\//, '');
    return `✅ Updated status of "${slug}" to "${status}" in ${relativePath}`;
  } catch (err: any) {
    return `Failed to update story status: ${err.message}`;
  }
}

async function handleUpdateStoryField(
  projectPath: string,
  slug: string,
  field: string,
  value: any
) {
  const storyPath = findStoryPath(projectPath, slug);
  if (!storyPath) {
    return `Story not found: "${slug}". Use list_stories to see all available stories.`;
  }

  try {
    const raw = readFileSync(storyPath, 'utf-8');
    const parsed = parseYaml(raw) as any;
    parsed[field] = value;
    writeFileSync(storyPath, toYaml(parsed), 'utf-8');

    const relativePath = storyPath.replace(projectPath, '').replace(/^\//, '');
    return `✅ Updated field "${field}" in story "${slug}" at ${relativePath}`;
  } catch (err: any) {
    return `Failed to update story field: ${err.message}`;
  }
}

async function handleGetScaffold(projectPath: string) {
  const scaffoldPath = join(projectPath, '.factory', 'scaffold.yaml');
  if (!existsSync(scaffoldPath)) {
    return 'No scaffold.yaml found. The project planning scaffold has not been created yet.';
  }

  try {
    const content = readFileSync(scaffoldPath, 'utf-8');
    return `## Scaffold Plan\n\n\`\`\`yaml\n${content}\n\`\`\``;
  } catch (err: any) {
    return `Failed to read scaffold.yaml: ${err.message}`;
  }
}

async function handleListQueue(statusFilter?: string) {
  try {
    const items = listQueue();
    const stats = getQueueStats();

    const filtered =
      statusFilter && statusFilter !== 'all'
        ? items.filter((item: any) => item.status === statusFilter)
        : items;

    if (filtered.length === 0) {
      return `Build queue is empty (filter: ${statusFilter || 'all'}).\n\nStats: ${JSON.stringify(stats, null, 2)}`;
    }

    const lines = filtered.map(
      (item: any) =>
        `- [${item.status.toUpperCase()}] ${item.storyFile} | Phase: ${item.phase || '?'} | Priority: ${item.priority || 0}${item.dependsOn?.length ? ` | Depends: ${item.dependsOn.join(', ')}` : ''}`
    );

    return `Queue Items (${filtered.length}):\n${lines.join('\n')}\n\nStats:\n${JSON.stringify(stats, null, 2)}`;
  } catch (err: any) {
    return `Failed to list queue: ${err.message}`;
  }
}

async function handleGetBuildLogs(projectPath: string, limit: number = 10) {
  const results: string[] = [];

  // DB build logs
  try {
    const allLogs = getBuildLogs();
    const logs = allLogs.slice(0, limit);
    if (logs && logs.length > 0) {
      results.push(`## Recent Build Logs (${logs.length})`);
      for (const log of logs) {
        const isSuccess = log.status !== 'failed';
        results.push(
          `- [${log.status || 'unknown'}] ${log.storyFile || '?'} | ${log.timestamp || ''} | ${isSuccess ? 'Success' : `Failed: ${log.notes || ''}`}`
        );
      }
    }
  } catch {}

  // Build receipts from .factory/logs/builds/
  const buildsDir = join(projectPath, '.factory', 'logs', 'builds');
  if (existsSync(buildsDir)) {
    try {
      const files = readdirSync(buildsDir)
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
        .slice(-limit)
        .reverse();

      if (files.length > 0) {
        results.push(`\n## Build Receipts (${files.length})`);
        for (const file of files) {
          try {
            const raw = readFileSync(join(buildsDir, file), 'utf-8');
            const parsed = parseYaml(raw) as any;
            results.push(
              `- ${file.replace(/\.ya?ml$/, '')}: ${parsed.status || 'unknown'} | ${parsed.timestamp || ''}`
            );
          } catch {}
        }
      }
    } catch {}
  }

  return results.length > 0 ? results.join('\n') : 'No build logs found.';
}

async function handleSearchKnowledge(projectPath: string, query: string) {
  const knowledgeDir = join(projectPath, '.factory', 'knowledge');
  if (!existsSync(knowledgeDir)) {
    return 'No knowledge base found at .factory/knowledge/. Add ADRs using add_adr_decision.';
  }

  try {
    const files = readdirSync(knowledgeDir).filter(
      (f) => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.txt')
    );

    if (files.length === 0) {
      return 'Knowledge base is empty. Add decisions using add_adr_decision.';
    }

    const q = query.toLowerCase();
    const matches: string[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(knowledgeDir, file), 'utf-8');
        if (content.toLowerCase().includes(q)) {
          const preview = content.slice(0, 400).replace(/\n{3,}/g, '\n\n');
          matches.push(`### ${file}\n${preview}${content.length > 400 ? '\n...' : ''}`);
        }
      } catch {}
    }

    if (matches.length === 0) {
      return `No knowledge entries match "${query}". Available files: ${files.join(', ')}`;
    }

    return `Found ${matches.length} matching knowledge entries:\n\n${matches.join('\n\n---\n\n')}`;
  } catch (err: any) {
    return `Failed to search knowledge base: ${err.message}`;
  }
}

async function handleReadHeartbeat(projectPath: string) {
  const results: string[] = [];

  const heartbeatPath = join(projectPath, '.factory', 'logs', 'heartbeat.yaml');
  if (existsSync(heartbeatPath)) {
    try {
      const raw = readFileSync(heartbeatPath, 'utf-8');
      const parsed = parseYaml(raw) as any;
      results.push(
        `## Latest Heartbeat\n- Timestamp: ${parsed.timestamp || 'N/A'}\n- Message: ${parsed.message || 'No message'}\n- Status: ${parsed.status || 'unknown'}`
      );
    } catch {
      results.push('Could not read heartbeat file.');
    }
  } else {
    results.push('No heartbeat file found. Agent has not been run recently.');
  }

  // Read from blueprint/worklog.yaml (TOON format) — the actual agent session log
  const wl = readBlueprintWorklog(projectPath, 8);
  results.push(`\n## Recent Worklog (blueprint)\n${wl}`);

  return results.join('\n') || 'No heartbeat or worklog data available.';
}

async function handleDecomposeRequirements(
  prompt: string,
  projectPath: string,
  provider: any,
  model: string
) {
  const appName = projectPath.split(/[\\\/]/).pop() || 'app';
  const systemPrompt = `You are an expert software architect for Factory.
The user wants to plan new feature requirements. Decompose their request into clean, schema-compliant FEATURE STORIES.

Use this EXACT output format with delimiters:

=== FEATURE_STORY: feature-slug.yaml ===
\`\`\`yaml
name: "Build feature-slug feature"
description: "Detailed description of feature"
status: draft
feature:
  name: "Feature Name"
  slug: "feature-slug"
target:
  app: "${appName}"
phase: 1
dependsOn: []
dependencies: []
acceptance_criteria:
  - "Core: happy path criterion"
  - "Edge: invalid scenario handling"
  - "UI: UI state representation"
  - "State: state/data boundary"
\`\`\`
=== END_STORY ===

RULES:
- Keep stories focused and small.
- Return between 1 to 4 story blocks.
- Set phase logically (1=foundational, 2=core).
- Always quote dependency list array items.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  let resultText = '';
  if (provider.id === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.apiKey}`;
    const body = {
      contents: messages.map((m) => ({
        role: m.role === 'system' ? 'user' : m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature: 0.2 },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  } else {
    const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, temperature: 0.2 }),
    });
    if (res.ok) {
      const data = await res.json();
      resultText = data.choices?.[0]?.message?.content || '';
    }
  }

  return resultText || 'Failed to generate spec decomposition.';
}

async function handleApplyStory(
  name: string,
  content: string,
  kind: string,
  phase: number,
  dependsOn: string[],
  projectPath: string,
  threadId?: string
) {
  try {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const folder = kind === 'app' ? 'apps' : 'features';
    const relativePath = `stories/${folder}/${slug}.yaml`;
    const fullPath = join(projectPath, '.factory', relativePath);

    // Inject threadId into the content YAML if provided
    let finalContent = content;
    if (threadId) {
      try {
        const parsed = parseYaml(content) as any;
        if (parsed) {
          parsed.threadId = threadId;
          finalContent = toYaml(parsed);
        }
      } catch {}
    }

    mkdirSync(join(projectPath, '.factory', 'stories', folder), { recursive: true });
    writeFileSync(fullPath, finalContent, 'utf-8');

    if (kind === 'feature') {
      try {
        await enqueue(relativePath, 'FeatureStory', {
          phase: phase || 1,
          dependsOn: dependsOn || [],
          engine: 'factory',
          threadId: threadId,
        });
      } catch (e: any) {
        return `Story saved to ${relativePath} but failed to auto-enqueue: ${e.message}`;
      }
    }

    return `✅ Successfully saved story to .factory/${relativePath} and enqueued in build queue.`;
  } catch (err: any) {
    return `Error saving story: ${err.message}`;
  }
}

async function handleAddAdrDecision(slug: string, content: string, projectPath: string) {
  try {
    const cleanSlug = slug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-|-$/g, '');
    const dir = join(projectPath, '.factory', 'knowledge');
    mkdirSync(dir, { recursive: true });
    const fullPath = join(dir, `${cleanSlug}.md`);
    const timestamp = new Date().toISOString();
    const formatted = `# ADR: ${slug}
> Registered via Ask TPM Chat on ${timestamp}

${content}
`;
    writeFileSync(fullPath, formatted, 'utf-8');
    return `✅ Architectural Decision Record saved successfully to .factory/knowledge/${cleanSlug}.md`;
  } catch (err: any) {
    return `Failed to save ADR: ${err.message}`;
  }
}

// ─── Skill Tools ─────────────────────────────────────────────────────────────
// Philosophy: "The LLM is the runtime. Code is just the execution boundary."
// These tools expose the skill library to the TPM. The LLM reads the skill
// content and decides how to apply it — no business logic lives here.

/** List all skills in the global library */
function handleListSkills(): string {
  const indexPath = join(homedir(), '.factory', 'skill-index.yaml');
  if (!existsSync(indexPath)) {
    return `No skill library found at ${indexPath}. Run factory init to set up skills.`;
  }
  try {
    const parsed = parseYaml(readFileSync(indexPath, 'utf-8')) as any;
    const skills: any[] = parsed?.skills || [];
    if (!skills.length) return 'Skill library is empty.';
    const lines = skills.map((s: any) => {
      const triggers = Array.isArray(s.trigger) ? ` | triggers: ${s.trigger.slice(0, 3).join(', ')}` : '';
      return `- **${s.name}**: ${s.description || 'No description'}${triggers}`;
    });
    return `## Factory Skill Library (${skills.length} skills)\n\n${lines.join('\n')}\n\nUse \`read_skill(name)\` to get the full instructions for any skill.`;
  } catch (err: any) {
    return `Failed to read skill index: ${err.message}`;
  }
}

/** Read a skill's full instructions by name (exact or fuzzy match) */
function handleReadSkill(name: string): string {
  if (!name) return 'name is required — pass the skill name to look up.';
  const result = loadSkillRaw(name);
  if (!result) {
    // Build a helpful error showing what's available
    const indexPath = join(homedir(), '.factory', 'skill-index.yaml');
    let available = '';
    try {
      const parsed = parseYaml(readFileSync(indexPath, 'utf-8')) as any;
      available = (parsed?.skills || []).map((s: any) => s.name).join(', ');
    } catch { /* ignore */ }
    return `Skill "${name}" not found.${available ? ` Available skills: ${available}` : ' Run list_skills to see what exists.'}`;
  }
  return `## Skill: ${result.skill.name}\n\n> ${result.skill.description || ''}\n\n---\n\n${result.content}`;
}

/** Invoke a skill: reads its instructions and frames them against user context */
function handleInvokeSkill(name: string, context?: string): string {
  if (!name) return 'name is required.';
  const result = loadSkillRaw(name);
  if (!result) return handleReadSkill(name); // will return the not-found error
  const header = context
    ? `## Invoking Skill: ${result.skill.name}\n\n**Context:** ${context}\n\n> ${result.skill.description || ''}\n\nApply the following instructions to the context above:\n\n---\n\n`
    : `## Skill: ${result.skill.name}\n\n> ${result.skill.description || ''}\n\n---\n\n`;
  return `${header}${result.content}`;
}



// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages list required' }, { status: 400 });
    }

    const settings = getSettings();

    let activeProject: any;
    try {
      activeProject = getActiveProject();
    } catch {
      return NextResponse.json(
        { error: 'No active project selected. Configure one in the Projects tab.' },
        { status: 400 }
      );
    }

    if (!settings?.activeProvider) {
      return NextResponse.json(
        { error: 'No active LLM provider configured. Go to Settings.' },
        { status: 400 }
      );
    }

    const provider = settings.providers?.find((p: any) => p.id === settings.activeProvider);
    if (!provider?.enabled) {
      return NextResponse.json(
        { error: `LLM provider "${settings.activeProvider}" is not enabled.` },
        { status: 400 }
      );
    }

    const model = settings.buildModel || provider.defaultModel || 'gemini-2.5-flash';
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendSSE = (type: string, data: any) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`)
            );
          } catch {
            // client disconnected
          }
        };

        try {
          // Inject skill-index at request time so the LLM knows available skills
          const skillIndexText = loadSkillIndex(activeProject.path);
          const skillSection = skillIndexText
            ? `\n\n**Available project skills** (reference these when relevant):\n${skillIndexText}`
            : '';

          const tpmSystemPrompt = `You are the Factory Technical Program Manager (TPM) agent — an expert project orchestrator for the **${activeProject.name}** project.

You have access to the following tools. Use them proactively to fulfill user requests:

**Query tools:**
- get_project_status() — project progress, queue stats, heartbeat, worklog
- list_stories(kind?, status?) — all stories with statuses
- get_story(slug) — full YAML of a specific story
- get_scaffold() — full planning scaffold
- list_queue(status?) — build queue items
- get_build_logs(limit?) — build history and receipts
- search_knowledge(query) — search ADRs and engineering decisions
- read_heartbeat() — latest agent liveness signal and worklog

**Write tools:**
- update_story_status(slug, status) — update story status (draft/in-progress/done/review)
- update_story_field(slug, field, value) — update any story field
- apply_story(name, content, kind, phase?, dependsOn?) — save and enqueue a new story
- add_adr_decision(slug, content) — record an architectural decision
- decompose_requirements(prompt) — decompose requirements into feature story YAMLs

**Orchestration rules:**
- Always call tools when user asks about status, stories, queue, or logs — never guess from memory.
- When user references @story-name in their message, call get_story to get its details first.
- For "what's the status?" type questions, call get_project_status AND list_stories together.
- After write operations, confirm the action with the returned result.
- When writing stories, always use userStory + acceptanceCriteria (Given/When/Then) format.
- Speak professionally and concisely. Be the intelligent conductor.${skillSection}`;

          const localMessages: any[] = [
            { role: 'system', content: tpmSystemPrompt },
            ...messages.map((m: any) => ({
              role: m.role,
              content: m.content,
              tool_calls: m.toolCalls,
            })),
          ];

          let loopCount = 0;
          const MAX_AGENT_LOOPS = 8;
          let shouldContinue = true;

          while (shouldContinue && loopCount < MAX_AGENT_LOOPS) {
            loopCount++;

            let responseText = '';
            let toolCalls: any[] = [];

            if (provider.id === 'gemini') {
              // ── Gemini native function calling ────────────────────────────
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.apiKey}`;
              const contentsFormatted = localMessages
                .filter((m) => m.role !== 'system')
                .map((m) => {
                  const parts: any[] = [];
                  if (m.content) parts.push({ text: m.content });
                  if (m.tool_calls) {
                    for (const tc of m.tool_calls) {
                      parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
                    }
                  }
                  if (m.role === 'tool') {
                    parts.length = 0;
                    parts.push({
                      functionResponse: {
                        name: m.tool_calls?.[0]?.name || 'unknown',
                        response: { content: m.content },
                      },
                    });
                  }
                  return {
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts,
                  };
                });

              const systemMessage = localMessages.find((m) => m.role === 'system');
              const geminiBody = {
                contents: contentsFormatted,
                systemInstruction: systemMessage
                  ? { parts: [{ text: systemMessage.content }] }
                  : undefined,
                tools: [{ functionDeclarations: TPM_TOOLS }],
                toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
              };

              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(geminiBody),
              });

              if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Gemini LLM Call failed: ${txt}`);
              }

              const data = await res.json();
              const candidate = data.candidates?.[0];
              const parts = candidate?.content?.parts || [];

              responseText = parts
                .filter((p: any) => p.text)
                .map((p: any) => p.text)
                .join('');
              const geminiCalls = parts.filter((p: any) => p.functionCall);
              if (geminiCalls.length > 0) {
                toolCalls = geminiCalls.map((p: any, idx: number) => ({
                  id: `call_${Date.now()}_${idx}`,
                  name: p.functionCall.name,
                  arguments: p.functionCall.args || {},
                }));
              }
            } else {
              // ── OpenAI-compatible with tools ──────────────────────────────
              const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
              const apiMessages = localMessages.map((m) => ({
                role: m.role,
                content: m.content,
                tool_calls: m.tool_calls
                  ? m.tool_calls.map((tc: any) => ({
                      id: tc.id,
                      type: 'function',
                      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                    }))
                  : undefined,
                tool_call_id: m.role === 'tool' ? m.tool_calls?.[0]?.id : undefined,
              }));

              const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
                },
                body: JSON.stringify({
                  model,
                  messages: apiMessages,
                  tools: TPM_TOOLS.map((t) => ({ type: 'function', function: t })),
                  temperature: 0.2,
                }),
              });

              if (!res.ok) {
                const txt = await res.text();
                throw new Error(`OpenAI LLM Call failed: ${txt}`);
              }

              const data = await res.json();
              const choice = data.choices?.[0]?.message;
              responseText = choice?.content || '';
              if (choice?.tool_calls) {
                toolCalls = choice.tool_calls.map((tc: any) => {
                  let args = {};
                  try {
                    args = JSON.parse(tc.function.arguments);
                  } catch {}
                  return { id: tc.id, name: tc.function.name, arguments: args };
                });
              }
            }

            if (toolCalls.length > 0) {
              // LLM is calling tools — run them sequentially
              localMessages.push({
                role: 'assistant',
                content: responseText || null,
                tool_calls: toolCalls,
              });

              // Stream intermediate text if the model also returned text alongside tool calls
              if (responseText) {
                sendSSE('text', { content: responseText });
              }

              for (const tc of toolCalls) {
                sendSSE('tool_start', {
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments,
                });

                let result = '';
                try {
                  switch (tc.name) {
                    case 'get_project_status':
                      result = await handleGetProjectStatus(activeProject.path);
                      break;
                    case 'list_stories':
                      result = await handleListStories(
                        activeProject.path,
                        tc.arguments.kind,
                        tc.arguments.status
                      );
                      break;
                    case 'get_story':
                      result = await handleGetStory(activeProject.path, tc.arguments.slug);
                      break;
                    case 'update_story_status':
                      result = await handleUpdateStoryStatus(
                        activeProject.path,
                        tc.arguments.slug,
                        tc.arguments.status
                      );
                      break;
                    case 'update_story_field':
                      result = await handleUpdateStoryField(
                        activeProject.path,
                        tc.arguments.slug,
                        tc.arguments.field,
                        tc.arguments.value
                      );
                      break;
                    case 'get_scaffold':
                      result = await handleGetScaffold(activeProject.path);
                      break;
                    case 'list_queue':
                      result = await handleListQueue(tc.arguments.status);
                      break;
                    case 'get_build_logs':
                      result = await handleGetBuildLogs(
                        activeProject.path,
                        tc.arguments.limit ?? 10
                      );
                      break;
                    case 'search_knowledge':
                      result = await handleSearchKnowledge(
                        activeProject.path,
                        tc.arguments.query
                      );
                      break;
                    case 'read_heartbeat':
                      result = await handleReadHeartbeat(activeProject.path);
                      break;
                    case 'decompose_requirements':
                      result = await handleDecomposeRequirements(
                        tc.arguments.prompt,
                        activeProject.path,
                        provider,
                        model
                      );
                      break;
                    case 'apply_story':
                      result = await handleApplyStory(
                        tc.arguments.name,
                        tc.arguments.content,
                        tc.arguments.kind,
                        tc.arguments.phase || 1,
                        tc.arguments.dependsOn || [],
                        activeProject.path,
                        tc.arguments.threadId
                      );
                      break;
                    case 'add_adr_decision':
                      result = await handleAddAdrDecision(
                        tc.arguments.slug,
                        tc.arguments.content,
                        activeProject.path
                      );
                      break;
                    case 'list_skills':
                      result = handleListSkills();
                      break;
                    case 'read_skill':
                      result = handleReadSkill(tc.arguments.name);
                      break;
                    case 'invoke_skill':
                      result = handleInvokeSkill(tc.arguments.name, tc.arguments.context);
                      break;
                    default:
                      result = `Tool "${tc.name}" is not implemented.`;
                  }

                  sendSSE('tool_end', {
                    id: tc.id,
                    name: tc.name,
                    status: 'success',
                    result,
                  });
                } catch (err: any) {
                  result = `Tool execution failed: ${err.message}`;
                  sendSSE('tool_end', {
                    id: tc.id,
                    name: tc.name,
                    status: 'failed',
                    result,
                  });
                }

                localMessages.push({
                  role: 'tool',
                  content: result,
                  tool_calls: [tc],
                });
              }
              // Continue the loop so LLM can produce the final text response
            } else {
              // No more tool calls — stream the final text response in chunks
              if (responseText) {
                // Chunk by sentence boundaries for a streaming feel
                const CHUNK_SIZE = 40;
                for (let i = 0; i < responseText.length; i += CHUNK_SIZE) {
                  sendSSE('text', { content: responseText.slice(i, i + CHUNK_SIZE) });
                  // Tiny yield to allow flush
                  await new Promise((r) => setTimeout(r, 0));
                }
              }
              shouldContinue = false;
            }
          }

          sendSSE('done', {});
        } catch (e: any) {
          sendSSE('error', { error: e.message || 'TPM Chat Error occurred' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to process TPM request' },
      { status: 500 }
    );
  }
}
