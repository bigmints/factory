/**
 * engine/tools/tpm/skills.ts
 *
 * Philosophy: "The LLM is the runtime. Code is just the execution boundary."
 *
 * This tool gives the autonomous TPM orchestrator the ability to read any skill
 * from the global skill library at runtime. The LLM decides which skills to apply
 * and how to apply them — the TypeScript only handles file I/O.
 */

import { join } from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { tpmToolRegistry } from '../registry.ts';
import type { ToolResult } from '../types.ts';

const FACTORY_HOME = join(homedir(), '.factory');

interface SkillEntry {
  name: string;
  path: string;
  description?: string;
  trigger?: string[];
}

/**
 * Load all skills from the global skill-index.yaml.
 * Falls back to scanning ~/.factory/skills/ for SKILL.md files.
 */
function loadSkillIndex(): SkillEntry[] {
  const indexPath = join(FACTORY_HOME, 'skill-index.yaml');
  if (existsSync(indexPath)) {
    try {
      const parsed = parseYaml(readFileSync(indexPath, 'utf-8')) as any;
      return (parsed?.skills || []) as SkillEntry[];
    } catch {
      // fall through to scan
    }
  }

  // Fallback: scan skills directory for SKILL.md files
  const skillsDir = join(FACTORY_HOME, 'skills');
  if (!existsSync(skillsDir)) return [];
  const entries: SkillEntry[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const skillMd = join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(skillMd)) {
        entries.push({ name: entry.name, path: skillMd, description: '' });
      }
    } else if (entry.name.endsWith('.md')) {
      entries.push({ name: entry.name.replace(/\.md$/, ''), path: join(skillsDir, entry.name) });
    }
  }
  return entries;
}

/**
 * Resolve a skill path — handles both absolute paths and relative ~/.factory/... references.
 */
function resolveSkillPath(rawPath: string): string {
  if (rawPath.startsWith('~/')) {
    return join(homedir(), rawPath.slice(2));
  }
  // If it's a factory command, not a file
  if (rawPath.startsWith('factory ')) return '';
  return rawPath;
}

/**
 * Find a skill by exact name or fuzzy match, then read its content.
 */
function execReadSkill(args: Record<string, unknown>): ToolResult {
  const query = String(args.name || args.skill || '').toLowerCase().trim();
  if (!query) {
    return { content: 'name is required. Pass the skill name to look up.', isError: true };
  }

  const skills = loadSkillIndex();
  if (skills.length === 0) {
    return {
      content: `No skills found in ${FACTORY_HOME}/skill-index.yaml. Run factory init to set up the skill library.`,
      isError: true,
    };
  }

  // Exact match first, then starts-with, then includes
  const skill =
    skills.find(s => s.name.toLowerCase() === query) ||
    skills.find(s => s.name.toLowerCase().startsWith(query)) ||
    skills.find(s => s.name.toLowerCase().includes(query)) ||
    skills.find(s => (s.description || '').toLowerCase().includes(query));

  if (!skill) {
    const names = skills.map(s => s.name).join(', ');
    return {
      content: `Skill not found: "${args.name}". Available skills: ${names}`,
      isError: true,
    };
  }

  const filePath = resolveSkillPath(skill.path);
  if (!filePath) {
    // The path is a factory command, not a file — return the command description
    return {
      content: `## Skill: ${skill.name}\n\n**Description:** ${skill.description || 'No description'}\n\n**Execution command:** \`${skill.path}\`\n\nThis skill is executed via the Factory CLI. Run the command above in the project directory.`,
      isError: false,
    };
  }

  if (!existsSync(filePath)) {
    return {
      content: `Skill file not found at: ${filePath}. The skill is registered but the file is missing.`,
      isError: true,
    };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return {
      content: `## Skill: ${skill.name}\n\n> ${skill.description || ''}\n\n---\n\n${content}`,
      isError: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Failed to read skill file: ${msg}`, isError: true };
  }
}

/**
 * List all available skills with names and descriptions.
 */
function execListSkills(_args: Record<string, unknown>): ToolResult {
  const skills = loadSkillIndex();
  if (skills.length === 0) {
    return {
      content: `No skills registered. Skill index: ${FACTORY_HOME}/skill-index.yaml`,
      isError: false,
    };
  }
  const lines = skills.map(s => `- **${s.name}**: ${s.description || 'No description'}${s.trigger?.length ? ` | triggers: ${s.trigger.slice(0, 3).join(', ')}` : ''}`);
  return {
    content: `## Available Skills (${skills.length})\n\n${lines.join('\n')}\n\nUse \`read_skill(name)\` to get the full instructions for any skill.`,
    isError: false,
  };
}

// ─── Register ────────────────────────────────────────────

tpmToolRegistry.register({
  name: 'read_skill',
  description:
    'Read the full instructions of a skill from the global Factory skill library (~/.factory/skill-index.yaml). ' +
    'The LLM reads the skill content and decides how to apply it. ' +
    'Use this whenever the user asks you to apply a skill, follow a skill, or when you need guidance on how to implement a specific pattern.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the skill to read (exact or fuzzy match). Examples: "story-generator", "validate-code", "add-firebase-auth".',
      },
    },
    required: ['name'],
  },
  execute: execReadSkill,
});

tpmToolRegistry.register({
  name: 'list_skills',
  description:
    'List all skills available in the global Factory skill library. Use to discover what skills exist before calling read_skill.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: execListSkills,
});
