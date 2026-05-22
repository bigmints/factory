import { NextResponse } from 'next/server';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import {
    existsSync, readFileSync, writeFileSync,
    readdirSync, mkdirSync, unlinkSync,
} from 'node:fs';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { loadMcpConfig } from '@engine/config';

// ─── Skills directory ────────────────────────────────────
const SKILLS_DIR = resolve(homedir(), '.factory', 'skills');

function ensureSkillsDir() {
    if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
    return SKILLS_DIR;
}

// ─── Skill parsing ───────────────────────────────────────

interface Skill {
    id: string;
    name: string;
    description: string;
    tags: string[];
    trigger: string;
    instructions: string;
    template: string;
    category: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

function parseSkillFile(filePath: string): Skill | null {
    try {
        const raw = readFileSync(filePath, 'utf-8');
        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!fmMatch) return null;

        const fm = parseYaml(fmMatch[1]) as Record<string, unknown>;
        const body = fmMatch[2].trim();

        const templateMatch = body.match(/## Template\s*\n+```[\w]*\n([\s\S]*?)```/);
        const template = templateMatch ? templateMatch[1].trim() : '';
        const instructions = body
            .replace(/## Template\s*\n+```[\w]*\n[\s\S]*?```/, '')
            .replace(/## Instructions\s*\n+/, '')
            .trim();

        const fileName = basename(filePath, '.md');
        return {
            id: `skill_${fileName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
            name: (fm.name as string) || fileName,
            description: (fm.description as string) || '',
            tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
            trigger: (fm.trigger as string) || '',
            instructions,
            template,
            category: (fm.category as string) || 'general',
            enabled: fm.enabled !== false,
            createdAt: (fm.createdAt as string) || '',
            updatedAt: (fm.updatedAt as string) || '',
        };
    } catch {
        return null;
    }
}

function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function serializeSkill(skill: Omit<Skill, 'id'>): string {
    const fm: Record<string, unknown> = {
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
    if (skill.template) body += `\n\n## Template\n\n\`\`\`tsx\n${skill.template}\n\`\`\``;
    return `---\n${toYaml(fm).trim()}\n---\n\n${body}\n`;
}

function loadAllSkills(): Skill[] {
    const dir = ensureSkillsDir();
    return readdirSync(dir)
        .filter((f: string) => f.endsWith('.md'))
        .map((f: string) => parseSkillFile(join(dir, f)))
        .filter((s: Skill | null): s is Skill => s !== null)
        .sort((a: Skill, b: Skill) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

// ─── Seed defaults from repo ─────────────────────────────

function seedDefaults() {
    const dir = ensureSkillsDir();
    if (readdirSync(dir).filter((f: string) => f.endsWith('.md')).length > 0) return;

    // Copy packaged default skills from the repo into the user's skills dir
    const repoRoot = resolve(process.cwd(), '..');
    const defaultsDir = join(repoRoot, 'skills', 'defaults');

    if (!existsSync(defaultsDir)) return;

    const defaults = readdirSync(defaultsDir).filter((f: string) => f.endsWith('.md'));
    for (const file of defaults) {
        const src = readFileSync(join(defaultsDir, file), 'utf-8');
        writeFileSync(join(dir, file), src, 'utf-8');
    }
}

// ─── Route Handlers ──────────────────────────────────────

export async function GET(request: Request) {
    try {
        seedDefaults();
        const { searchParams } = new URL(request.url);
        const category = searchParams.get('category');
        const search = searchParams.get('search');

        const mcpSkills: Skill[] = [];
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

                            mcpSkills.push({
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
            console.error('Failed to load dynamic MCP skills:', e);
        }

        let skills = [...loadAllSkills(), ...mcpSkills];

        if (category) skills = skills.filter((s: Skill) => s.category === category);
        if (search) {
            const q = search.toLowerCase();
            skills = skills.filter((s: Skill) =>
                s.name.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q) ||
                s.tags.some((t: string) => t.toLowerCase().includes(q)) ||
                s.instructions.toLowerCase().includes(q)
            );
        }

        return NextResponse.json({ skills, total: skills.length });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load skills' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        if (!body.name || !body.instructions) {
            return NextResponse.json({ error: 'name and instructions are required' }, { status: 400 });
        }

        const dir = ensureSkillsDir();
        const now = new Date().toISOString();
        const content = serializeSkill({
            name: body.name,
            description: body.description || '',
            category: body.category || 'general',
            tags: body.tags || [],
            trigger: body.trigger || '',
            instructions: body.instructions,
            template: body.template || '',
            enabled: body.enabled !== false,
            createdAt: now,
            updatedAt: now,
        });

        const filePath = join(dir, `${slugify(body.name)}.md`);
        writeFileSync(filePath, content, 'utf-8');
        const skill = parseSkillFile(filePath);

        return NextResponse.json({ skill }, { status: 201 });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create skill' }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        if (!body.name || !body.instructions) {
            return NextResponse.json({ error: 'name and instructions are required' }, { status: 400 });
        }

        const dir = ensureSkillsDir();
        const content = serializeSkill({
            name: body.name,
            description: body.description || '',
            category: body.category || 'general',
            tags: body.tags || [],
            trigger: body.trigger || '',
            instructions: body.instructions,
            template: body.template || '',
            enabled: body.enabled !== false,
            createdAt: body.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        const filePath = join(dir, `${slugify(body.name)}.md`);
        writeFileSync(filePath, content, 'utf-8');
        const skill = parseSkillFile(filePath);

        return NextResponse.json({ skill });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update skill' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

        const dir = ensureSkillsDir();
        const slug = slugify(id);
        const filePath = join(dir, `${slug}.md`);

        if (existsSync(filePath)) {
            unlinkSync(filePath);
            return NextResponse.json({ success: true });
        }

        // Try matching by name across all files
        const files = readdirSync(dir).filter((f: string) => f.endsWith('.md'));
        for (const file of files) {
            const skill = parseSkillFile(join(dir, file));
            if (skill && (skill.id === id || skill.name === id)) {
                unlinkSync(join(dir, file));
                return NextResponse.json({ success: true });
            }
        }

        return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to delete skill' }, { status: 500 });
    }
}
