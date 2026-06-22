/**
 * orchestrate.ts — Deterministic TPM-driven story delivery.
 *
 * Architecture (inspired by Minimill):
 *   Story YAML → Template Brief → CLI Session → Result → Done/Failed
 *
 * The TPM is deterministic — no LLM in the orchestration layer.
 * It reads the story, formats a brief using a template, delegates to the CLI,
 * monitors the session, and marks done/failed based on the result.
 *
 * The LLM is ONLY used inside the CLI (pi/claude/gemini/agy) — never here.
 *
 * Previous version: 1,245 lines with LLM-driven tool loop.
 * This version: ~280 lines, deterministic pipeline.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as toYaml, parse as parseYaml } from 'yaml';
import { log, logError } from './log.ts';
import { writeHeartbeat } from './toon.ts';
import { updateStoryStatus, loadStory } from './story.ts';
import { loadSettings } from './config.ts';
import { detectAvailableCli, verifyCli } from './cli-adapter.ts';
import { runCliSession } from './cli-session.ts';
import { resolveSkillsForBuild, formatSkillsForPrompt } from './skills.ts';
import type {
    Story, ProjectBlueprint,
    BuildResult, GeneratedFile, FactorySettings,
} from './types.ts';

// ─── Types ───────────────────────────────────────────────

export interface OrchestratorContext {
    targetDir: string;
    storyFile: string;
    repoPath: string;
    cliName: string;
    terminal: boolean;  // retained for backward compat with tools/tpm/*
    success: boolean;
    files: GeneratedFile[];
    logs: Array<{ level: 'info' | 'error'; message: string }>;
    threadId?: string;
}

// ─── Public Entry Points ─────────────────────────────────

/**
 * Orchestrate an AppStory build.
 * Deterministic: brief → CLI session → done/failed.
 */
export async function orchestrateStory(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
): Promise<BuildResult> {
    const settings = loadSettings();
    const cliName = resolveCliName(settings);
    log('●', `Orchestrating story: ${story.name} via CLI: ${cliName}`);
    return runDeterministicPipeline(story, blueprint, targetDir, storyFile, cliName);
}

/**
 * Orchestrate a FeatureStory build.
 */
export async function orchestrateFeatureStory(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
): Promise<BuildResult> {
    const settings = loadSettings();
    const cliName = resolveCliName(settings);
    log('●', `Orchestrating feature: ${story.name} via CLI: ${cliName}`);
    return runDeterministicPipeline(story, blueprint, targetDir, storyFile, cliName);
}

// ─── CLI Resolution ──────────────────────────────────────

/**
 * Resolve the CLI to use from user settings.
 * Order: settings.defaultCli → auto-detect.
 * The user chooses the CLI — no LLM involvement.
 */
function resolveCliName(settings: FactorySettings): string {
    if (settings.defaultCli) {
        log('→', `Using configured CLI: ${settings.defaultCli}`);
        try { verifyCli(settings.defaultCli); } catch (e) {
            logError(`Configured CLI "${settings.defaultCli}" not found: ${(e as Error).message}`);
            throw e;
        }
        return settings.defaultCli;
    }
    const detected = detectAvailableCli();
    log('→', `Auto-detected CLI: ${detected}`);
    return detected;
}

// ─── Deterministic Pipeline ──────────────────────────────

async function runDeterministicPipeline(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
    cliName: string,
): Promise<BuildResult> {
    const ctx: OrchestratorContext = {
        targetDir,
        storyFile,
        repoPath: blueprint.repoPath,
        cliName,
        terminal: false,
        success: false,
        files: [],
        logs: [],
        threadId: (story as any).threadId,
    };

    mkdirSync(targetDir, { recursive: true });

    // ── Step 1: Build brief from template ────────────────
    const brief = buildBrief(story, blueprint, targetDir, cliName);
    log('→', `Brief built (${brief.length} chars)`);
    ctx.logs.push({ level: 'info', message: `Brief: ${brief.length} chars` });

    // Write heartbeat so UI knows we're alive
    try { writeHeartbeat(blueprint.repoPath, `delegating to ${cliName}`); } catch { /* non-fatal */ }

    // ── Step 2: Delegate to CLI ──────────────────────────
    log('●', `Delegating to ${cliName}...`);
    const result = await runCliSession({
        cliName,
        prompt: brief,
        cwd: targetDir,
        repoPath: blueprint.repoPath,
        storyFile,
        threadId: ctx.threadId,
    });

    ctx.files = result.files;
    if (result.threadId) ctx.threadId = result.threadId;

    // ── Step 3: Process result ───────────────────────────
    switch (result.status) {
        case 'delivered':
            log('✓', `CLI delivered successfully`);
            ctx.success = true;
            ctx.logs.push({ level: 'info', message: 'CLI delivered successfully' });

            try {
                const summaryLines = [
                    `**Date**: ${new Date().toISOString()}`,
                    `**CLI**: ${cliName}`,
                    `**Files Generated**: ${ctx.files.length}`,
                    '',
                    ...ctx.files.slice(0, 20).map(f => `- \`${f.filename}\``),
                    ctx.files.length > 20 ? `...and ${ctx.files.length - 20} more` : '',
                ].filter(Boolean).join('\n');
                updateStoryStatus(storyFile, 'done', summaryLines);
                log('✓', `Story status → done: ${storyFile}`);
            } catch (e) {
                log('!', `Could not update story status: ${e}`);
            }

            writeBuildReceipt(ctx, 'CLI delivered successfully', true);
            break;

        case 'failed':
            log('✗', `CLI failed (exit ${result.exitCode})`);
            ctx.success = false;
            ctx.logs.push({ level: 'error', message: `CLI failed (exit ${result.exitCode}): ${result.output.slice(-500)}` });

            try { updateStoryStatus(storyFile, 'failed'); } catch { /* non-fatal */ }
            writeBuildReceipt(ctx, `CLI failed (exit ${result.exitCode})`, false);

            // Auto-create fix story for retry
            try {
                const fixPath = createFixStoryFile(ctx, `CLI exit ${result.exitCode}`, result.output.slice(-1000));
                if (fixPath) log('→', `Fix story created: ${fixPath}`);
            } catch (e) {
                log('!', `Could not create fix story: ${e}`);
            }
            break;

        case 'intervention':
            log('⚠', `CLI intervention: ${result.interventionReason}`);
            ctx.success = false;
            ctx.logs.push({ level: 'error', message: `Intervention: ${result.interventionReason}` });

            try { updateStoryStatus(storyFile, 'failed'); } catch { /* non-fatal */ }
            writeBuildReceipt(ctx, `Intervention: ${result.interventionReason}`, false);

            try {
                const fixPath = createFixStoryFile(ctx, `Intervention: ${result.interventionReason}`, result.output.slice(-1000));
                if (fixPath) log('→', `Fix story created: ${fixPath}`);
            } catch (e) {
                log('!', `Could not create fix story: ${e}`);
            }
            break;
    }

    // Write heartbeat with result
    try { writeHeartbeat(blueprint.repoPath, ctx.success ? 'story delivered' : 'story failed'); } catch { /* non-fatal */ }

    const errors = ctx.logs.filter(l => l.level === 'error').map(l => l.message);

    return {
        success: ctx.success,
        files: ctx.files,
        plan: {
            files: ctx.files.map(f => f.filename),
            architecture: story.name,
            decisions: ['engine:deterministic-tpm', `cli:${cliName}`],
        },
        iterations: 1,
        errors: errors.length > 0 ? errors : undefined,
        tokenUsage: { promptTokens: 0, completionTokens: 0 },
        model: 'none',
        provider: 'deterministic',
        engine: 'orchestrator',
    };
}

// ─── Brief Template Builder ──────────────────────────────

/**
 * Build a complete, self-contained brief for the CLI engineer.
 * This is a deterministic template — no LLM involved.
 * All context (story, stack, conventions, knowledge) is injected directly.
 */
function buildBrief(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    _cliName: string,
): string {
    const sections: string[] = [];

    // ── Story ──
    sections.push(`# Story to Implement\n\n\`\`\`yaml\n${toYaml(story)}\`\`\``);

    // ── Target Directory ──
    sections.push(`# Target Directory\n\n\`${targetDir}\`\n\nAll work happens in this directory. Create it if it doesn't exist.`);

    // ── Stack ──
    if (story.stack) {
        sections.push(`# Stack\n\n\`\`\`json\n${JSON.stringify(story.stack, null, 2)}\n\`\`\``);
    }

    // ── Acceptance Criteria ──
    const criteria = (story as any).acceptance_criteria;
    if (Array.isArray(criteria) && criteria.length > 0) {
        sections.push(`# Acceptance Criteria\n\nYou MUST satisfy ALL of these:\n\n${criteria.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}`);
    }

    // ── Conventions ──
    if (blueprint.conventions.length > 0) {
        sections.push(`# Project Conventions\n\n${blueprint.conventions.join('\n\n---\n\n')}`);
    }

    // ── Knowledge Files ──
    if (blueprint.knowledgeFiles.length > 0) {
        const kf = blueprint.knowledgeFiles.map(k => `## ${k.app} / ${k.filename}\n${k.content}`).join('\n\n');
        sections.push(`# Project Knowledge\n\n${kf}`);
    }

    // ── .factory/knowledge/ ──
    const knowledgeFiles = loadKnowledgeFiles(blueprint.repoPath);
    if (knowledgeFiles.length > 0) {
        const kb = knowledgeFiles.map(k => `## ${k.name}\n${k.content}`).join('\n\n');
        sections.push(`# Architecture Decisions & Past Builds\n\n${kb}`);
    }

    // ── TOON state ──
    if (blueprint.toonSnapshot) {
        sections.push(`# Current Project State\n\n${blueprint.toonSnapshot}`);
    }

    // ── Skills ──
    const scoredSkills = resolveSkillsForBuild(story, blueprint);
    if (scoredSkills.length > 0) {
        sections.push(formatSkillsForPrompt(scoredSkills));
    }

    // ── BTW (urgent user overrides) ──
    if ((story as any).btw && Array.isArray((story as any).btw) && (story as any).btw.length > 0) {
        sections.push(`# URGENT ADDITIONAL INSTRUCTIONS\n\nThese take highest priority:\n\n${(story as any).btw.map((b: string) => `- ${b}`).join('\n')}`);
    }

    // ── Self-sufficiency instruction ──
    sections.push(`# Instructions

Complete the full implementation without asking questions.
- Run \`npm install\` if needed
- Fix any TypeScript or lint errors
- Verify the build passes
- When done, print \`DELIVERY COMPLETE\` and a summary of what was built

Do NOT ask for help. Do NOT ask questions. Complete everything autonomously.`);

    return sections.join('\n\n');
}

// ─── Helpers ─────────────────────────────────────────────

function writeBuildReceipt(ctx: OrchestratorContext, summary: string, success: boolean): void {
    const receiptDir = join(ctx.repoPath, '.factory', 'logs', success ? 'builds' : 'failures');
    mkdirSync(receiptDir, { recursive: true });

    const slug = ctx.storyFile
        .split('/')
        .pop()
        ?.replace(/\.ya?ml$/, '')
        ?.replace(/[^a-z0-9-]/gi, '-') || 'story';

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const receiptPath = join(receiptDir, `${slug}-${timestamp}.md`);

    const content = [
        `# ${success ? 'Build' : 'Failure'}: ${slug}`,
        '',
        `**Date**: ${new Date().toISOString()}`,
        `**Story**: ${ctx.storyFile}`,
        `**CLI**: ${ctx.cliName}`,
        `**Files**: ${ctx.files.length}`,
        '',
        `## ${success ? 'Summary' : 'Failure Reason'}`,
        summary,
        '',
        '## Files Written',
        ...ctx.files.slice(0, 50).map(f => `- ${f.filename}`),
        ctx.files.length > 50 ? `...and ${ctx.files.length - 50} more` : '',
    ].join('\n');

    writeFileSync(receiptPath, content);
    log('✓', `Build receipt: ${receiptDir}/${slug}-${timestamp}.md`);
}

function createFixStoryFile(ctx: OrchestratorContext, issue: string, fixInstructions: string): string | null {
    try {
        const slug = ctx.storyFile.split('/').pop()?.replace(/\.ya?ml$/, '') || 'story';
        const fixSlug = `fix-${slug}`;
        const storiesDir = join(ctx.repoPath, '.factory', 'stories');
        mkdirSync(storiesDir, { recursive: true });
        const fixPath = join(storiesDir, `${fixSlug}.md`);

        let originalStory: any = {};
        try {
            const originalPath = join(ctx.repoPath, '.factory', 'stories', ctx.storyFile);
            if (existsSync(originalPath)) {
                originalStory = loadStory(originalPath) || {};
            }
        } catch { /* use empty */ }

        const fixStory: any = {
            name: `Fix: ${originalStory.name || slug}`,
            description: `Automated fix task.\n\nOriginal story: ${ctx.storyFile}\nIssue: ${issue}`,
            status: 'ready-to-build',
            feature: originalStory.feature || { name: 'Fix', slug: 'fix' },
            acceptance_criteria: originalStory.acceptance_criteria || [],
            fix_instructions: fixInstructions || issue,
            original_story: ctx.storyFile,
            dependsOn: [],
            createdBy: 'factory-tpm',
            createdAt: new Date().toISOString(),
        };

        if (originalStory.target) {
            fixStory.target = originalStory.target;
        }
        if (originalStory.stack && Object.keys(originalStory.stack).length > 0) {
            fixStory.stack = originalStory.stack;
        }
        if (typeof originalStory.phase === 'number' && originalStory.phase >= 1) {
            fixStory.phase = originalStory.phase;
        }

        const frontmatter = `---\n${toYaml(fixStory)}---\n`;
        writeFileSync(fixPath, frontmatter);
        log('✓', `Fix story written: ${fixPath}`);
        return `${fixSlug}.md`;
    } catch (e) {
        logError(`createFixStoryFile failed: ${e}`);
        return null;
    }
}

function loadKnowledgeFiles(repoPath: string): Array<{ name: string; content: string }> {
    const knowledgeDir = join(repoPath, '.factory', 'knowledge');
    if (!existsSync(knowledgeDir)) return [];

    try {
        return readdirSync(knowledgeDir)
            .filter(f => f.endsWith('.md'))
            .sort()
            .map(f => ({
                name: f.replace(/\.md$/, ''),
                content: readFileSync(join(knowledgeDir, f), 'utf-8').slice(0, 3000),
            }));
    } catch {
        return [];
    }
}

