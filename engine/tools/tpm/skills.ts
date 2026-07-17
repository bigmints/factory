/**
 * engine/tools/tpm/skills.ts
 *
 * Philosophy: "The LLM is the runtime. Code is just the execution boundary."
 *
 * This tool gives the autonomous TPM orchestrator the ability to read any skill
 * from the global skill library at runtime. The LLM decides which skills to apply
 * and how to apply them — the TypeScript only handles file I/O.
 */

import { tpmToolRegistry } from '../registry.ts';
import type { ToolResult } from '../types.ts';
import { loadAllSkills } from '../../skills.ts';

interface ToolContext {
  repoPath?: string;
}


/**
 * Find a skill by exact name or fuzzy match, then read its content.
 */
function execReadSkill(args: Record<string, unknown>, ctx?: ToolContext): ToolResult {
  const query = String(args.name || args.skill || '').toLowerCase().trim();
  if (!query) {
    return { content: 'name is required. Pass the skill name to look up.', isError: true };
  }

  const skills = loadAllSkills(ctx?.repoPath);
  if (skills.length === 0) {
    return {
      content: `No skills found. Run factory init to set up the skill library.`,
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

  // If the skill is an MCP dynamic command, its instructions inform the LLM how to call the tool
  if (skill.category === 'mcp') {
    return {
      content: `## Skill: ${skill.name}\n\n**Description:** ${skill.description || 'No description'}\n\n**Instructions:**\n${skill.instructions}`,
      isError: false,
    };
  }

  return { 
      content: `## Skill: ${skill.name}\n\n**Description:** ${skill.description || 'No description'}\n\n**Instructions:**\n${skill.instructions}${skill.template ? `\n\n**Template:**\n\`\`\`tsx\n${skill.template}\n\`\`\`` : ''}`, 
      isError: false 
  };
}

/**
 * List all available skills with names and descriptions.
 */
function execListSkills(args: Record<string, unknown>, ctx?: ToolContext): ToolResult {
  const skills = loadAllSkills(ctx?.repoPath);
  if (skills.length === 0) {
    return {
      content: `No skills registered.`,
      isError: false,
    };
  }

  const lines = skills.map(s => `- **${s.name}**: ${s.description || 'No description'}${s.trigger ? ` | triggers: ${s.trigger}` : ''}`);

  return {
    content: `## Available Skills (${skills.length})\n\n${lines.join('\n')}\n\nUse \`read_skill(name)\` to get the full instructions for any skill.`,
    isError: false,
  };
}

// ─── Register ────────────────────────────────────────────

tpmToolRegistry.register({
  name: 'tpm_read_skill',
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
  name: 'tpm_list_skills',
  description:
    'List all skills available in the global Factory skill library. Use to discover what skills exist before calling read_skill.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: execListSkills,
});
