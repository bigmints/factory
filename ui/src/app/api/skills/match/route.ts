import { NextResponse } from 'next/server';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

// ─── Skills directory ────────────────────────────────────
const SKILLS_DIR = resolve(homedir(), '.factory', 'skills');

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
        };
    } catch {
        return null;
    }
}

function loadEnabledSkills(): Skill[] {
    if (!existsSync(SKILLS_DIR)) return [];
    return readdirSync(SKILLS_DIR)
        .filter((f: string) => f.endsWith('.md'))
        .map((f: string) => parseSkillFile(join(SKILLS_DIR, f)))
        .filter((s: Skill | null): s is Skill => s !== null && s.enabled);
}

/**
 * POST /api/skills/match — Find skills relevant to a build context
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { specName, specDescription, stack, tags, taskDescription } = body;

        if (!specName) {
            return NextResponse.json({ error: 'specName is required' }, { status: 400 });
        }

        const skills = loadEnabledSkills();
        const corpus = [specName, specDescription || '', stack || '', taskDescription || '', ...(tags || [])].join(' ').toLowerCase();
        const THRESHOLD = 0.3;

        const matches = skills.map((skill: Skill) => {
            let score = 0;
            const reasons: string[] = [];

            // Tag matching
            const matchedTags = skill.tags.filter((tag: string) => corpus.includes(tag.toLowerCase()));
            if (matchedTags.length > 0) {
                score += Math.min(matchedTags.length * 0.25, 0.75);
                reasons.push(`tags: ${matchedTags.join(', ')}`);
            }

            // Trigger matching
            if (skill.trigger) {
                try {
                    if (new RegExp(skill.trigger, 'i').test(corpus)) {
                        score += 0.4;
                        reasons.push(`trigger: "${skill.trigger}"`);
                    }
                } catch {
                    if (corpus.includes(skill.trigger.toLowerCase())) {
                        score += 0.3;
                        reasons.push(`keyword: "${skill.trigger}"`);
                    }
                }
            }

            // Word overlap
            const nameHits = skill.name.toLowerCase().split(/\s+/).filter((w: string) => corpus.includes(w) && w.length > 2).length;
            if (nameHits > 0) {
                score += Math.min(nameHits * 0.1, 0.3);
                reasons.push('word overlap');
            }

            return { skill, score: Math.min(score, 1), matchReason: reasons.join('; ') };
        }).filter((m: { score: number }) => m.score >= THRESHOLD).sort((a: { score: number }, b: { score: number }) => b.score - a.score);

        return NextResponse.json({ matches, total: matches.length });
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to match skills' }, { status: 500 });
    }
}
