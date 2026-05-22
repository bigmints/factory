/**
 * Skills Engine — file-based registry, matcher, and resolver.
 *
 * Skills are markdown files with YAML frontmatter stored in `.factory/skills/`.
 * The engine scans the directory, parses frontmatter, and builds an in-memory
 * index for relevance matching during builds.
 *
 * Skill file format:
 * ```markdown
 * ---
 * name: Scaffold shadcn Layout
 * category: layout
 * tags: [shadcn, layout, sidebar]
 * trigger: shadcn|layout|sidebar
 * enabled: true
 * ---
 *
 * ## Instructions
 * ...
 *
 * ## Template
 * ```tsx
 * ...
 * ```
 * ```
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { log } from './log.ts';
import type { Skill, ScoredSkill, SkillMatchBlueprint, SkillCategory, AppStory, ProjectBlueprint } from './types.ts';

// ─── Paths ───────────────────────────────────────────────

import { FACTORY_ROOT, loadMcpConfig } from './config.ts';

/** Global skills directory */
const SKILLS_DIR = join(FACTORY_ROOT, 'skills');

/** Ensure the skills directory exists */
function ensureSkillsDir(): string {
    if (!existsSync(SKILLS_DIR)) {
        mkdirSync(SKILLS_DIR, { recursive: true });
    }
    return SKILLS_DIR;
}

// ─── Parsing ─────────────────────────────────────────────

/** Parse a skill markdown file into a Skill object. */
function parseSkillFile(filePath: string): Skill | null {
    try {
        const raw = readFileSync(filePath, 'utf-8');
        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!fmMatch) return null;

        const frontmatter = parseYaml(fmMatch[1]) as Record<string, unknown>;
        const body = fmMatch[2].trim();

        // Extract template section if present
        const templateMatch = body.match(/## Template\s*\n+```[\w]*\n([\s\S]*?)```/);
        const template = templateMatch ? templateMatch[1].trim() : '';

        // Instructions is everything except the template section
        const instructions = body
            .replace(/## Template\s*\n+```[\w]*\n[\s\S]*?```/, '')
            .replace(/## Instructions\s*\n+/, '')
            .trim();

        const fileName = basename(filePath, '.md');
        const id = `skill_${fileName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;

        return {
            id,
            name: (frontmatter.name as string) || fileName,
            description: (frontmatter.description as string) || '',
            tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
            trigger: (frontmatter.trigger as string) || '',
            instructions,
            template,
            category: ((frontmatter.category as string) || 'general') as SkillCategory,
            enabled: frontmatter.enabled !== false,
            createdAt: (frontmatter.createdAt as string) || '',
            updatedAt: (frontmatter.updatedAt as string) || '',
        };
    } catch {
        return null;
    }
}

/** Serialize a Skill back to a markdown file. */
function serializeSkill(skill: Omit<Skill, 'id'>): string {
    const frontmatter: Record<string, unknown> = {
        name: skill.name,
        description: skill.description,
        category: skill.category,
        tags: skill.tags,
        trigger: skill.trigger,
        enabled: skill.enabled,
        createdAt: skill.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    let body = `## Instructions\n\n${skill.instructions}`;
    if (skill.template) {
        body += `\n\n## Template\n\n\`\`\`tsx\n${skill.template}\n\`\`\``;
    }

    return `---\n${toYaml(frontmatter).trim()}\n---\n\n${body}\n`;
}

/** Convert a skill name to a safe filename slug */
function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// ─── Skills Registry (File-Based) ────────────────────────

/** Load all skills from the skills directory. */
export function loadAllSkills(): Skill[] {
    const dir = ensureSkillsDir();
    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    const skills: Skill[] = [];

    for (const file of files) {
        const skill = parseSkillFile(join(dir, file));
        if (skill) skills.push(skill);
    }

    // Merge active dynamic MCP skills
    try {
        const mcpConfig = loadMcpConfig();
        if (mcpConfig.mcpServers) {
            for (const [serverId, server] of Object.entries<any>(mcpConfig.mcpServers)) {
                if (server.enabled && Array.isArray(server.tools)) {
                    for (const tool of server.tools) {
                        const name = `${serverId} - ${tool.name}`;
                        const trigger = `mcp__${serverId}__${tool.name}`;
                        
                        let paramsDoc = '';
                        if (tool.inputSchema && tool.inputSchema.properties) {
                            paramsDoc = '\n\n**Parameters:**\n' + Object.entries(tool.inputSchema.properties)
                                .map(([pName, pSchema]: [string, any]) => {
                                    const req = tool.inputSchema.required?.includes(pName) ? ' (required)' : '';
                                    return `- \`${pName}\`: ${pSchema.type || 'any'}${req} - ${pSchema.description || 'No description provided.'}`;
                                }).join('\n');
                        }

                        const instructions = `Call the dynamic MCP tool "${tool.name}" on server "${serverId}".\n\n**Description:** ${tool.description || 'No description provided.'}${paramsDoc}`;
                        
                        const argKeys = tool.inputSchema && tool.inputSchema.properties 
                            ? Object.keys(tool.inputSchema.properties) 
                            : [];
                        const templateArgs = argKeys.map(k => `  "${k}": "value"`).join(',\n');
                        const template = `await callMcpTool("${trigger}", {\n${templateArgs}\n});`;

                        skills.push({
                            id: `mcp_${serverId}_${tool.name}`,
                            name,
                            description: tool.description || `Dynamic MCP tool from server "${serverId}".`,
                            tags: ['mcp', serverId, tool.name],
                            trigger,
                            instructions,
                            template,
                            category: 'mcp',
                            enabled: true,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        });
                    }
                }
            }
        }
    } catch (e) {
        // Silently ignore or log
    }

    return skills.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/** Save (create or update) a skill as a markdown file. */
export function saveSkill(skill: Omit<Skill, 'id'> & { id?: string }): Skill {
    const dir = ensureSkillsDir();
    const slug = slugify(skill.name);
    const filePath = join(dir, `${slug}.md`);

    const content = serializeSkill({
        ...skill,
        createdAt: skill.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });

    writeFileSync(filePath, content, 'utf-8');

    return parseSkillFile(filePath)!;
}

/** Remove a skill file by name slug. */
export function removeSkill(nameOrId: string): boolean {
    const dir = ensureSkillsDir();

    // Try to find by exact filename slug
    const slug = slugify(nameOrId);
    const directPath = join(dir, `${slug}.md`);
    if (existsSync(directPath)) {
        unlinkSync(directPath);
        return true;
    }

    // Try to find by ID match across all files
    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
        const skill = parseSkillFile(join(dir, file));
        if (skill && (skill.id === nameOrId || skill.name === nameOrId)) {
            unlinkSync(join(dir, file));
            return true;
        }
    }

    return false;
}

/** Get a single skill by ID or name. */
export function getSkill(nameOrId: string): Skill | null {
    const all = loadAllSkills();
    return all.find(s => s.id === nameOrId || s.name === nameOrId || slugify(s.name) === slugify(nameOrId)) || null;
}

/** Toggle a skill's enabled state. */
export function toggleSkill(nameOrId: string, enabled: boolean): boolean {
    const skill = getSkill(nameOrId);
    if (!skill) return false;

    saveSkill({ ...skill, enabled });
    return true;
}

/** List skills with optional filters. */
export function listSkills(opts?: {
    category?: SkillCategory;
    enabled?: boolean;
    search?: string;
}): Skill[] {
    let skills = loadAllSkills();

    if (opts?.category) {
        skills = skills.filter(s => s.category === opts.category);
    }
    if (opts?.enabled !== undefined) {
        skills = skills.filter(s => s.enabled === opts.enabled);
    }
    if (opts?.search) {
        const q = opts.search.toLowerCase();
        skills = skills.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.tags.some((t: string) => t.toLowerCase().includes(q)) ||
            s.instructions.toLowerCase().includes(q)
        );
    }

    return skills;
}

// ─── Skill Matcher ───────────────────────────────────────

const RELEVANCE_THRESHOLD = 0.3;

/**
 * Match skills against a build context.
 * Returns skills sorted by relevance score (descending).
 */
export function matchSkills(ctx: SkillMatchBlueprint): ScoredSkill[] {
    const allSkills = listSkills({ enabled: true });
    const scored: ScoredSkill[] = [];

    // Combine all context into a searchable corpus
    const corpus = [
        ctx.storyName,
        ctx.storyDescription,
        ctx.stack,
        ctx.taskDescription || '',
        ...ctx.tags,
    ].join(' ').toLowerCase();

    for (const skill of allSkills) {
        let score = 0;
        const reasons: string[] = [];

        // 1. Tag matching — each matching tag adds 0.25
        const matchedTags = skill.tags.filter((tag: string) => corpus.includes(tag.toLowerCase()));
        if (matchedTags.length > 0) {
            score += Math.min(matchedTags.length * 0.25, 0.75);
            reasons.push(`tags: ${matchedTags.join(', ')}`);
        }

        // 2. Trigger pattern matching — regex match adds 0.4
        if (skill.trigger) {
            try {
                const re = new RegExp(skill.trigger, 'i');
                if (re.test(corpus)) {
                    score += 0.4;
                    reasons.push(`trigger: "${skill.trigger}"`);
                }
            } catch {
                // Invalid regex, try as plain keyword
                if (corpus.includes(skill.trigger.toLowerCase())) {
                    score += 0.3;
                    reasons.push(`keyword: "${skill.trigger}"`);
                }
            }
        }

        // 3. Name/description word overlap — up to 0.3
        const nameWords = skill.name.toLowerCase().split(/\s+/);
        const descWords = skill.description.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        const nameHits = nameWords.filter((w: string) => corpus.includes(w) && w.length > 2).length;
        const descHits = descWords.filter((w: string) => corpus.includes(w)).length;
        const wordScore = Math.min((nameHits * 0.1 + descHits * 0.05), 0.3);
        if (wordScore > 0) {
            score += wordScore;
            reasons.push('word overlap');
        }

        // 4. Category matching — if story tags or description mention the category
        if (corpus.includes(skill.category)) {
            score += 0.1;
            reasons.push(`category: ${skill.category}`);
        }

        if (score >= RELEVANCE_THRESHOLD) {
            scored.push({
                skill,
                score: Math.min(score, 1),
                matchReason: reasons.join('; '),
            });
        }
    }

    return scored.sort((a, b) => b.score - a.score);
}

// ─── Pipeline Integration ────────────────────────────────

/**
 * Resolve relevant skills for a build and return scored matches.
 */
export function resolveSkillsForBuild(
    story: AppStory,
    blueprint: ProjectBlueprint,
): ScoredSkill[] {
    const matchBlueprint: SkillMatchBlueprint = {
        storyName: story.appName,
        storyDescription: story.description || '',
        stack: blueprint.stack?.framework || story.stack?.framework || '',
        tags: [
            ...(story.stack ? [story.stack.framework, story.stack.database || '', story.stack.testing || ''] : []),
            ...(story.frontend?.ui ? [story.frontend.ui] : []),
            ...(story.auth?.provider ? [story.auth.provider] : []),
        ].filter(Boolean),
    };

    return matchSkills(matchBlueprint);
}

/**
 * Format matched skills into a prompt section for the LLM.
 */
export function formatSkillsForPrompt(scoredSkills: ScoredSkill[]): string {
    if (scoredSkills.length === 0) return '';

    const sections = scoredSkills.map(({ skill, score }) => {
        let section = `### ${skill.name} (relevance: ${(score * 100).toFixed(0)}%)\n\n`;
        section += skill.instructions;
        if (skill.template) {
            section += `\n\n**Template:**\n\`\`\`\n${skill.template}\n\`\`\``;
        }
        return section;
    });

    return `## Relevant Skills\n\nThe following skills matched the current build context. Apply their instructions where applicable.\n\n${sections.join('\n\n---\n\n')}`;
}

// ─── Seed Default Skills ─────────────────────────────────

/** Seed the skills directory by copying defaults from the repo's skills/defaults/. */
export function seedDefaultSkills(): void {
    const dir = ensureSkillsDir();
    const existing = readdirSync(dir).filter((f: string) => f.endsWith('.md'));
    if (existing.length > 0) return;

    // Locate the packaged defaults relative to the engine directory
    const engineDir = new URL('.', import.meta.url).pathname;
    const repoRoot = join(engineDir, '..');
    const defaultsDir = join(repoRoot, 'skills', 'defaults');

    if (!existsSync(defaultsDir)) {
        log('!', `Default skills directory not found at ${defaultsDir}`);
        return;
    }

    log('→', 'Seeding default skills from repo...');

    const defaults = readdirSync(defaultsDir).filter((f: string) => f.endsWith('.md'));
    for (const file of defaults) {
        const content = readFileSync(join(defaultsDir, file), 'utf-8');
        writeFileSync(join(dir, file), content, 'utf-8');
    }

    log('✓', `Seeded ${defaults.length} default skills`);
}

