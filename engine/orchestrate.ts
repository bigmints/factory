/**
 * orchestrate.ts — Deterministic TPM-driven story delivery.
 *
 * Architecture (inspired by Minimill):
 *   Story YAML → Template Brief → Pi SDK Session → Result → Done/Failed
 *
 * The TPM is deterministic — no LLM in the orchestration layer.
 * It reads the story, formats a brief, delegates to the Pi SDK session,
 * and marks done/failed based on the result.
 *
 * The LLM is ONLY used inside the CLI (pi/claude/gemini/agy) — never here.
 *
 * Previous version: 1,245 lines with LLM-driven tool loop.
 * This version: ~280 lines, deterministic pipeline.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stringify as toYaml } from 'yaml';
import { log } from './log.ts';
import { updateStoryStatus } from './story.ts';
import { loadSettings, getActiveProject, getActiveProvider, loadBridgeConfig } from './config.ts';
import { runCliSession, runPiVerificationViaWorker as _runPiVerificationViaWorker } from './cli-session.ts';
import { resolveSkillsForBuild, formatSkillsForPrompt } from './skills.ts';
import { resolvePiDgxProvider } from './dgx.ts';
import type {
    Story, ProjectBlueprint,
    BuildResult, DeliveryVerification, GeneratedFile, FactorySettings,
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
    const executor = resolveExecutorName(settings);
    log('●', `Orchestrating story: ${story.name} via executor: ${executor}`);
    return runDeterministicPipeline(story, blueprint, targetDir, storyFile, executor);
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
    const executor = resolveExecutorName(settings);
    log('●', `Orchestrating feature: ${story.name} via executor: ${executor}`);
    return runDeterministicPipeline(story, blueprint, targetDir, storyFile, executor);
}

// ─── Executor Resolution ─────────────────────────────────

/**
 * Factory is Pi SDK-first. Keep the executor explicit so the rest of the
 * pipeline does not pretend there are interchangeable codegen backends.
 */
function resolveExecutorName(_settings: FactorySettings): 'pi' {
    return 'pi';
}

// ─── Deterministic Pipeline ──────────────────────────────

async function runDeterministicPipeline(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
    executorName: string,
): Promise<BuildResult> {
    const ctx: OrchestratorContext = {
        targetDir,
        storyFile,
        repoPath: blueprint.repoPath,
        cliName: executorName,
        terminal: false,
        success: false,
        files: [],
        logs: [],
        threadId: (story as any).threadId,
    };

    mkdirSync(targetDir, { recursive: true });

    // ── Step 1: Build brief from template ────────────────
    const brief = buildBrief(story, blueprint, targetDir, executorName);
    log('→', `Brief built (${brief.length} chars)`);
    ctx.logs.push({ level: 'info', message: `Brief: ${brief.length} chars` });

    let activeProject;
    try {
        activeProject = getActiveProject();
    } catch {
        activeProject = null;
    }
    const settings = loadSettings();
    const piExecution = resolvePiDgxProvider(settings, activeProject?.piConfig, story.agentModel);
    const agentModel = piExecution.model;
    const deliveryConfig = loadBridgeConfig(blueprint.repoPath).delivery;
    const initialGitHead = getCurrentGitHead(targetDir);

    // ── Step 2: Delegate to CLI ──────────────────────────
    log('●', `Delegating to ${executorName}...`);
    const result = await runCliSession({
        cliName: executorName,
        prompt: brief,
        cwd: targetDir,
        repoPath: blueprint.repoPath,
        storyFile,
        threadId: ctx.threadId,
        model: agentModel,
        providerId: piExecution.provider.id,
        piConfig: activeProject?.piConfig,
        limits: {
            maxRuntimeMinutes: deliveryConfig?.unattended?.maxRuntimeMinutes || 30,
            maxToolCalls: deliveryConfig?.unattended?.maxToolCalls || 150,
        },
    });

    ctx.files = result.files.length > 0 ? result.files : scanChangedProductFiles(targetDir, initialGitHead);
    if (result.threadId) ctx.threadId = result.threadId;

    // ── Step 3: Process result ───────────────────────────
    let buildStatus: BuildResult['status'] = 'failed';
    let verification: DeliveryVerification | undefined;
    const finalResult = result;

    switch (finalResult.status) {
        case 'delivered':
            log('✓', `Executor produced candidate delivery`);
            ctx.logs.push({ level: 'info', message: 'Executor produced candidate delivery' });

            if (isReviewOnlyStory(story) && finalResult.files.length === 0) {
                ctx.success = true;
                buildStatus = 'done';
                const reviewSummary = finalResult.output || finalResult.textOutput || `Review completed for ${story.name}.`;
                ctx.logs.push({ level: 'info', message: reviewSummary });
                try { updateStoryStatus(storyFile, 'done', reviewSummary); } catch { /* non-fatal */ }
                writeBuildReceipt(ctx, reviewSummary, true, {
                    status: 'verified',
                    summary: reviewSummary,
                    evidence: ['Review-only story completed by Pi.'],
                    missing: [],
                    productFilesChanged: false,
                    userReachable: false,
                });
                break;
            }

            {
                const validation = runTargetValidation(targetDir);
                if (!validation.ok) {
                    const failureSummary = [
                        'Candidate delivery failed deterministic validation.',
                        '',
                        validation.output.slice(-3000).trim(),
                    ].join('\n');
                    verification = {
                        status: 'failed',
                        summary: 'Candidate delivery failed deterministic validation.',
                        evidence: [],
                        missing: ['Fix validation errors before product verification.'],
                        productFilesChanged: hasProductChanges(targetDir, initialGitHead),
                        userReachable: false,
                    };
                    buildStatus = 'failed';
                    ctx.success = false;
                    ctx.logs.push({ level: 'error', message: failureSummary });
                    try { updateStoryStatus(storyFile, 'failed', failureSummary); } catch { /* non-fatal */ }
                    writeBuildReceipt(ctx, failureSummary, false, verification);
                    break;
                }

                verification = verifyDeliveryDeterministically(story, targetDir, validation.output, initialGitHead);

                if (verification.status !== 'verified') {
                    const reviewSummary = formatVerificationSummary(verification);
                    buildStatus = verification.status === 'failed' ? 'failed' : 'review';
                    ctx.success = false;
                    ctx.logs.push({ level: 'error', message: reviewSummary });
                    try { updateStoryStatus(storyFile, buildStatus, reviewSummary); } catch { /* non-fatal */ }
                    writeBuildReceipt(ctx, reviewSummary, false, verification);
                    log(buildStatus === 'review' ? '!' : '✗', `${buildStatus === 'review' ? 'Needs review' : 'Verification failed'}: ${verification.summary}`);
                    break;
                }
            }

            log('✓', `Delivery verified successfully`);
            ctx.success = true;
            buildStatus = 'done';
            ctx.logs.push({ level: 'info', message: 'Delivery verified successfully' });

            try {
                const summaryLines = [
                    ...(finalResult.textOutput ? [finalResult.textOutput, '', '---', ''] : []),
                    verification ? [formatVerificationSummary(verification), '', '---', ''].join('\n') : '',
                    `**Date**: ${new Date().toISOString()}`,
                    `**Executor**: ${executorName}`,
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

            writeBuildReceipt(ctx, 'Delivery verified successfully', true, verification);

            break;

        case 'failed':
            log('✗', `Executor failed (exit ${finalResult.exitCode})`);
            ctx.success = false;
            ctx.logs.push({ level: 'error', message: `Executor failed (exit ${finalResult.exitCode}): ${finalResult.output.slice(-500)}` });

            {
                const failureSummary = [
                    `Executor failed with exit ${finalResult.exitCode ?? 'unknown'}.`,
                    '',
                    finalResult.output.slice(-3000).trim() || 'No executor output was captured.',
                ].join('\n');
                try { updateStoryStatus(storyFile, 'failed', failureSummary); } catch { /* non-fatal */ }
                writeBuildReceipt(ctx, `Executor failed (exit ${finalResult.exitCode})`, false);
            }
            break;

        case 'intervention':
            log('⚠', `Executor intervention: ${result.interventionReason}`);
            ctx.success = false;
            ctx.logs.push({ level: 'error', message: `Intervention: ${result.interventionReason}` });

            {
                const failureSummary = [
                    `Executor intervention required: ${result.interventionReason || 'unknown reason'}.`,
                    '',
                    result.output.slice(-3000).trim() || 'No executor output was captured.',
                ].join('\n');
                try { updateStoryStatus(storyFile, 'failed', failureSummary); } catch { /* non-fatal */ }
                writeBuildReceipt(ctx, `Intervention: ${result.interventionReason}`, false);
            }

            break;
    }

    const errors = ctx.logs.filter(l => l.level === 'error').map(l => l.message);

    return {
        success: ctx.success,
        status: buildStatus,
        files: ctx.files,
        plan: {
            files: ctx.files.map(f => f.filename),
            architecture: story.name,
            decisions: ['engine:deterministic-tpm', `executor:${executorName}`],
        },
        iterations: 1,
        errors: errors.length > 0 ? errors : undefined,
        verification,
        tokenUsage: { promptTokens: 0, completionTokens: 0 },
        model: agentModel || 'unconfigured',
        provider: piExecution.provider.id,
        engine: 'pi-sdk',
    };
}

// ─── Text Patch Fallback ─────────────────────────────────

const TEXT_PATCH_FALLBACK_TIMEOUT_MS = 900_000;
const TEXT_PATCH_FALLBACK_ATTEMPTS = 1;

function _shouldAttemptTextPatchFallback(output: string): boolean {
    if (/SDK_TURN_ERROR|SDK_STALL|SDK_WORKER_STALL|502[\s\S]{0,80}upstream error/i.test(output)) {
        return false;
    }
    return /PI_PATCH_EMPTY_PATCH|PI_PATCH_NO_PATCH|TOOL_SCHEMA_LOOP|PLANNING_LOOP|Validation failed for tool "(write|edit)"/i.test(output);
}

async function _runTextPatchFallback(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
    brief: string,
    failureOutput: string,
) {
    const settings = loadSettings();
    const provider = getActiveProvider(settings);
    const model = settings.buildModel || provider?.defaultModel || provider?.models?.[0]?.id;
    if (!provider || !model) return null;

    log('●', 'Pi tool-call mutation failed; attempting text-diff fallback...');
    const prompt = buildTextPatchPrompt(story, targetDir, brief, failureOutput);
    let text: string;
    try {
        text = await callProviderTextOnlyLocal(provider, model, 'You produce only valid unified diffs. No markdown.', prompt);
    } catch (err: any) {
        return {
            status: 'failed' as const,
            exitCode: 1,
            output: `TEXT_PATCH_FALLBACK_PROVIDER_ERROR: Text-diff fallback provider call failed: ${err.message}`,
            textOutput: '',
            files: scanChangedProductFiles(targetDir),
        };
    }
    const rawPatch = extractUnifiedDiff(text);
    if (!rawPatch) {
        return {
            status: 'failed' as const,
            exitCode: 1,
            output: `TEXT_PATCH_FALLBACK_NO_DIFF: Text-diff fallback did not return a unified diff.\n\n${text.slice(-3000)}`,
            textOutput: text,
            files: scanChangedProductFiles(targetDir),
        };
    }
    const sanitized = sanitizeUnifiedDiff(rawPatch);
    if (!sanitized.patch) {
        return {
            status: 'failed' as const,
            exitCode: 1,
            output: sanitized.removedPaths.length > 0
                ? `TEXT_PATCH_FALLBACK_INVALID_PATCH: Text-diff fallback only touched forbidden paths.\n\nForbidden paths:\n${sanitized.removedPaths.map(path => `- ${path}`).join('\n')}\n\nPatch tail:\n${rawPatch.slice(-3000)}`
                : `TEXT_PATCH_FALLBACK_INVALID_PATCH: Text-diff fallback patch could not be normalized.\n\nPatch tail:\n${rawPatch.slice(-3000)}`,
            textOutput: text,
            files: scanChangedProductFiles(targetDir),
        };
    }

    const apply = spawnSync('git', ['apply', '--whitespace=nowarn', '--recount', '-'], {
        cwd: targetDir,
        input: sanitized.patch,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
    });
    if (apply.status !== 0) {
        return {
            status: 'failed' as const,
            exitCode: apply.status ?? 1,
            output: `TEXT_PATCH_FALLBACK_APPLY_FAILED: Text-diff fallback patch failed to apply.\n\n${apply.stderr || apply.stdout}\n\nRemoved forbidden paths:\n${sanitized.removedPaths.length > 0 ? sanitized.removedPaths.map(path => `- ${path}`).join('\n') : '- none'}\n\nPatch tail:\n${sanitized.patch.slice(-3000)}`,
            textOutput: text,
            files: scanChangedProductFiles(targetDir),
        };
    }

    const validation = runTargetValidation(targetDir);
    if (!validation.ok) {
        return {
            status: 'failed' as const,
            exitCode: validation.exitCode,
            output: `Text-diff fallback applied, but validation failed.\n\n${validation.output.slice(-3000)}`,
            textOutput: text,
            files: scanChangedProductFiles(targetDir),
        };
    }

    return {
        status: 'delivered' as const,
        exitCode: 0,
        output: `Text-diff fallback applied successfully.\n\n${validation.output.slice(-3000)}`,
        textOutput: `Text-diff fallback applied successfully for ${story.name}.`,
        files: scanChangedProductFiles(targetDir),
    };
}

function buildTextPatchPrompt(story: Story, targetDir: string, brief: string, failureOutput: string): string {
    const files = collectFallbackContextFiles(story, targetDir);
    const fileSections = files.map(({ path, content }) => [
        `### ${path}`,
        '```',
        content,
        '```',
    ].join('\n')).join('\n\n');

    return [
        'Factory attempted this story through Pi SDK tools, but the selected model failed to emit valid mutation tool arguments.',
        'Continue by producing a plain unified diff that implements the story.',
        '',
        'Rules:',
        '- Output ONLY a unified diff that `git apply` can apply from the project root.',
        '- Use `diff --git a/path b/path` headers.',
        '- Prefer modifying files shown in Source Context. New files are allowed when required by the story.',
        '- Keep the patch focused; satisfy the acceptance criteria without broad rewrites.',
        '- Never modify `.factory/`, `.git/`, `node_modules/`, `.next/`, build artifacts, logs, or story status files.',
        '- Do not include markdown fences, explanation, or prose.',
        '- If you cannot produce a patch, output exactly: FACTORY_PATCH_FAILED: <reason>',
        '',
        '## Story Brief',
        brief.slice(0, 15000),
        '',
        '## Previous Tool Failure',
        failureOutput.slice(-3000),
        '',
        '## Source Context',
        fileSections,
    ].join('\n');
}

function collectFallbackContextFiles(story: Story, targetDir: string): Array<{ path: string; content: string }> {
    const candidates = new Set<string>();
    const storyText = [story.name, (story as any).content, JSON.stringify(story)].filter(Boolean).join('\n');
    const filePattern = /\b(?:src|app|pages|components|lib|test|tests|integration_test|web|android|ios)\/[A-Za-z0-9_./\[\]-]+\.[A-Za-z0-9_]+|(?:package\.json|tsconfig\.json|next\.config\.[cm]?[jt]s|eslint\.config\.[cm]?[jt]s|pubspec\.yaml|firestore\.rules)/g;
    for (const match of storyText.matchAll(filePattern)) {
        candidates.add(match[0].replace(/[.,;:)]+$/, ''));
    }

    if (existsSync(join(targetDir, 'package.json'))) {
        [
            'package.json',
            'tsconfig.json',
            'next.config.js',
            'next.config.mjs',
            'eslint.config.js',
            'src/app/api/xtara/[entity]/route.ts',
            'src/lib/admin/registry.ts',
            'src/lib/services/adminService.ts',
            'src/lib/firebase.ts',
            'src/types/admin.ts',
        ].forEach(path => candidates.add(path));
        addExistingFilesUnder(targetDir, 'src/lib/admin', candidates, 30);
        addExistingFilesUnder(targetDir, 'src/lib/services', candidates, 30);
        addExistingFilesUnder(targetDir, 'src/types', candidates, 20);
        addExistingFilesUnder(targetDir, 'src/app/api', candidates, 80);
    }

    if (existsSync(join(targetDir, 'pubspec.yaml'))) {
        [
            'lib/features/events/domain/event_model.dart',
            'lib/features/events/data/event_repository.dart',
            'lib/features/events/presentation/create/create_event_screen.dart',
            'lib/core/routing/app_router.dart',
            'lib/core/widgets/event_card.dart',
            'lib/features/events/presentation/widgets/event_details_panel.dart',
            'lib/features/events/presentation/event_details_screen.dart',
            'lib/features/events/presentation/controllers/event_controller.dart',
            'lib/features/events/presentation/tabs/events_tab.dart',
            'lib/features/dashboard/presentation/dashboard_shell.dart',
            'lib/features/dashboard/presentation/create_post_screen.dart',
            'lib/core/utils/image_picker_utils.dart',
            'firestore.rules',
            'pubspec.yaml',
        ].forEach(path => candidates.add(path));
    }

    const result: Array<{ path: string; content: string }> = [];
    let total = 0;
    for (const path of candidates) {
        if (path.includes('..')) continue;
        const abs = join(targetDir, path);
        if (!existsSync(abs)) continue;
        const content = readFileSync(abs, 'utf-8');
        const capped = content.length > 7000
            ? `${content.slice(0, 7000)}\n... [truncated ${content.length - 7000} chars]`
            : content;
        if (total + capped.length > 45000) break;
        total += capped.length;
        result.push({ path, content: capped });
    }
    return result;
}

function addExistingFilesUnder(targetDir: string, relDir: string, candidates: Set<string>, limit: number): void {
    const absDir = join(targetDir, relDir);
    if (!existsSync(absDir) || limit <= 0) return;

    let added = 0;
    const walk = (dir: string) => {
        if (added >= limit) return;
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (added >= limit) return;
            if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
            const abs = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(abs);
                continue;
            }
            if (!/\.(ts|tsx|js|jsx|json)$/.test(entry.name)) continue;
            candidates.add(abs.slice(targetDir.length + 1));
            added++;
        }
    };
    walk(absDir);
}

function extractUnifiedDiff(text: string): string | null {
    const fenced = text.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i);
    const candidate = (fenced?.[1] || text).trim();
    if (/^FACTORY_PATCH_FAILED:/i.test(candidate)) return null;
    const diffIndex = candidate.indexOf('diff --git ');
    if (diffIndex >= 0) return candidate.slice(diffIndex).trim() + '\n';
    const unifiedIndex = candidate.search(/^---\s+a\//m);
    if (unifiedIndex >= 0) return candidate.slice(unifiedIndex).trim() + '\n';
    return null;
}

const FORBIDDEN_PATCH_PREFIXES = ['.factory/', '.git/', 'node_modules/', '.next/', 'dist/', 'build/'];

function sanitizeUnifiedDiff(patch: string): { patch: string | null; removedPaths: string[] } {
    const sections = splitDiffSections(patch);
    if (sections.length === 0) {
        const path = extractPatchPath(patch);
        if (path && isForbiddenPatchPath(path)) {
            return { patch: null, removedPaths: [path] };
        }
        return { patch, removedPaths: [] };
    }

    const kept: string[] = [];
    const removedPaths: string[] = [];
    for (const section of sections) {
        const path = extractPatchPath(section);
        if (path && isForbiddenPatchPath(path)) {
            removedPaths.push(path);
            continue;
        }
        kept.push(section);
    }

    return {
        patch: kept.length > 0 ? `${kept.join('\n')}\n` : null,
        removedPaths,
    };
}

function splitDiffSections(patch: string): string[] {
    const lines = patch.split('\n');
    const sections: string[] = [];
    let current: string[] = [];

    for (const line of lines) {
        if (line.startsWith('diff --git ')) {
            if (current.length > 0) {
                sections.push(current.join('\n'));
            }
            current = [line];
            continue;
        }
        if (current.length > 0) {
            current.push(line);
        }
    }

    if (current.length > 0) {
        sections.push(current.join('\n'));
    }
    return sections;
}

function extractPatchPath(section: string): string | null {
    const diffMatch = section.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    if (diffMatch?.[2] && diffMatch[2] !== '/dev/null') {
        return diffMatch[2];
    }
    const plusMatch = section.match(/^\+\+\+ b\/(.+)$/m);
    if (plusMatch?.[1] && plusMatch[1] !== '/dev/null') {
        return plusMatch[1];
    }
    const minusMatch = section.match(/^--- a\/(.+)$/m);
    if (minusMatch?.[1] && minusMatch[1] !== '/dev/null') {
        return minusMatch[1];
    }
    return null;
}

function isForbiddenPatchPath(path: string): boolean {
    return FORBIDDEN_PATCH_PREFIXES.some(prefix => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

function runTargetValidation(targetDir: string): { ok: boolean; exitCode: number; output: string } {
    if (existsSync(join(targetDir, 'pubspec.yaml'))) {
        const res = spawnSync('flutter', ['analyze'], {
            cwd: targetDir,
            encoding: 'utf-8',
            timeout: 180_000,
            maxBuffer: 10 * 1024 * 1024,
        });
        const output = `${res.stdout || ''}${res.stderr || ''}`;
        return {
            ok: res.status === 0 || !/\berror\s+•/i.test(output),
            exitCode: res.status ?? 1,
            output,
        };
    }
    if (existsSync(join(targetDir, 'package.json'))) {
        const res = spawnSync('npm', ['run', 'lint'], {
            cwd: targetDir,
            encoding: 'utf-8',
            timeout: 180_000,
            maxBuffer: 10 * 1024 * 1024,
        });
        return {
            ok: res.status === 0,
            exitCode: res.status ?? 1,
            output: `${res.stdout || ''}${res.stderr || ''}`,
        };
    }
    return { ok: true, exitCode: 0, output: 'No known validation command found.' };
}

function getCurrentGitHead(targetDir: string): string | null {
    const res = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: targetDir,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
    });
    return res.status === 0 ? res.stdout.trim() : null;
}

function getChangedProductFiles(targetDir: string, baseRef?: string | null): string[] {
    const changed = new Set<string>();

    const statusRes = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: targetDir,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
    });
    if (statusRes.status === 0) {
        for (const file of parseGitPathList(statusRes.stdout)) {
            changed.add(file);
        }
    }

    if (baseRef) {
        const diffRes = spawnSync('git', ['diff', '--name-only', `${baseRef}..HEAD`], {
            cwd: targetDir,
            encoding: 'utf-8',
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
        });
        if (diffRes.status === 0) {
            for (const file of parseGitPathList(diffRes.stdout, false)) {
                changed.add(file);
            }
        }
    }

    return [...changed].filter(isProductFile);
}

function parseGitPathList(output: string, porcelain = true): string[] {
    return output
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean)
        .map(line => {
            const rawPath = porcelain ? line.slice(3).trim() : line.trim();
            return rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()!.trim() : rawPath;
        });
}

function isProductFile(path: string): boolean {
    return Boolean(path)
        && !path.startsWith('.factory/')
        && path !== '.factory';
}

function scanChangedProductFiles(targetDir: string, baseRef?: string | null): GeneratedFile[] {
    return getChangedProductFiles(targetDir, baseRef).map(filename => ({ filename, content: '' }));
}

function hasProductChanges(targetDir: string, baseRef?: string | null): boolean {
    return getChangedProductFiles(targetDir, baseRef).length > 0;
}

function verifyDeliveryDeterministically(
    story: Story,
    targetDir: string,
    validationOutput: string,
    baseRef?: string | null,
): DeliveryVerification {
    const productFiles = getChangedProductFiles(targetDir, baseRef);
    const reviewOnly = isReviewOnlyStory(story);
    const changed = productFiles.length > 0;
    const status: DeliveryVerification['status'] = changed || reviewOnly ? 'verified' : 'review';
    return {
        status,
        summary: status === 'verified'
            ? `Pi delivered ${story.name}; deterministic validation passed.`
            : `Pi reported delivery for ${story.name}, but Factory did not detect product-code changes.`,
        evidence: [
            `Validation output: ${validationOutput.slice(-500).trim() || 'Validation passed with no output.'}`,
            ...productFiles.map(file => `Changed product file: ${file}`),
        ],
        missing: status === 'verified'
            ? []
            : ['Make or commit product-code changes before marking this story done.'],
        productFilesChanged: changed,
        userReachable: reviewOnly || productFiles.some(isUserReachableFile),
    };
}

function isUserReachableFile(file: string): boolean {
    return file.startsWith('src/app/')
        || file.startsWith('app/')
        || file.startsWith('pages/')
        || file === 'index.html'
        || file === 'public/index.html'
        || file.startsWith('public/pages/')
        || file.startsWith('public/app/');
}

async function _verifyDeliveryWithPi(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    storyFile: string,
    executorOutput: string,
    validationOutput: string,
    model?: string,
    baseRef?: string | null,
): Promise<DeliveryVerification> {
    const productFiles = getChangedProductFiles(targetDir, baseRef);
    const prompt = buildVerificationPrompt(story, targetDir, productFiles, executorOutput, validationOutput);
    const result = await _runPiVerificationViaWorker({
        prompt,
        cwd: targetDir,
        repoPath: blueprint.repoPath,
        storyFile,
        model,
        productFilesChanged: productFiles.length > 0,
    });
    return {
        status: result.status,
        summary: result.summary,
        evidence: result.evidence,
        missing: result.missing,
        productFilesChanged: result.productFilesChanged,
        userReachable: result.userReachable,
    };
}

function buildVerificationPrompt(
    story: Story,
    targetDir: string,
    productFiles: string[],
    executorOutput: string,
    validationOutput: string,
): string {
    const isFlutter = existsSync(join(targetDir, 'pubspec.yaml'));
    return [
        '# Factory Delivery Verification',
        '',
        'You are the read-only Factory verifier. Do not edit files. Do not write code.',
        'Your job is to decide whether this story is genuinely delivered to a user.',
        '',
        'You MUST call `factory_verdict` exactly once. Do not answer only in prose.',
        '',
        '## Verdict Rules',
        '- Return `verified` only when product code changed and the feature is reachable from the app UI or route flow.',
        '- Return `review` when code exists but wiring, route, CTA, screen placement, or proof is missing.',
        '- Return `failed` only when execution/validation is broken, not merely incomplete integration.',
        '- Models, repositories, generated files, services, or widgets alone are not enough for `verified`.',
        '- Evidence must include concrete file paths and a human-readable user flow.',
        '',
        ...(isFlutter ? [
            '## Flutter Reachability Checks',
            '- Inspect router/navigation.',
            '- Inspect event details screens and dashboard/create flows.',
            '- Inspect tab/shell navigation and relevant widgets.',
            '- Verify the user can actually reach the feature from a visible screen, button, section, or route.',
            '',
        ] : []),
        '## Story',
        `Name: ${story.name}`,
        `Kind: ${story.kind}`,
        `Target: ${String((story as any).target || '')}`,
        '',
        '## Story Content',
        String((story as any).content || '').slice(0, 6000),
        '',
        '## Product Files Changed',
        productFiles.length > 0 ? productFiles.map(file => `- ${file}`).join('\n') : 'None',
        '',
        '## Deterministic Validation Output',
        validationOutput.slice(-3000),
        '',
        '## Executor Output Tail',
        executorOutput.slice(-3000),
        '',
        'Call factory_verdict with:',
        '- status',
        '- summary',
        '- evidence: file paths plus user-flow proof',
        '- missing: concrete missing integration work',
        '- productFilesChanged',
        '- userReachable',
    ].join('\n');
}

function formatVerificationSummary(verification: DeliveryVerification): string {
    return [
        `Factory verification: ${verification.status}`,
        '',
        verification.summary,
        '',
        `Product files changed: ${verification.productFilesChanged ? 'yes' : 'no'}`,
        `User reachable: ${verification.userReachable ? 'yes' : 'no'}`,
        '',
        'Evidence:',
        ...(verification.evidence.length > 0 ? verification.evidence.map(item => `- ${item}`) : ['- None provided']),
        '',
        'Missing:',
        ...(verification.missing.length > 0 ? verification.missing.map(item => `- ${item}`) : ['- None']),
    ].join('\n');
}

async function callProviderTextOnlyLocal(
    provider: any,
    model: string,
    systemInstruction: string,
    prompt: string,
): Promise<string> {
    if (provider.kind === 'builtin' && provider.id === 'ollama') {
        const baseUrl = provider.baseUrl || 'http://localhost:11434';
        const res = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: prompt },
                ],
                stream: false,
                options: { temperature: 0.1 },
            }),
        });
        if (!res.ok) throw new Error(`Ollama text call failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
        const data = await res.json();
        return data.message?.content || '';
    }

    const baseUrl = provider.baseUrl || 'https://api.openai.com/v1';
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= TEXT_PATCH_FALLBACK_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                signal: AbortSignal.timeout(TEXT_PATCH_FALLBACK_TIMEOUT_MS),
                headers: {
                    'Content-Type': 'application/json',
                    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemInstruction },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.1,
                    max_tokens: 12000,
                    stream: true,
                }),
            });
            if (!res.ok) throw new Error(`Text fallback failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
            return await readOpenAIStreamText(res);
        } catch (err: any) {
            lastError = err;
            if (attempt < TEXT_PATCH_FALLBACK_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            }
        }
    }
    if (lastError?.name === 'TimeoutError' || /aborted|timeout/i.test(lastError?.message || '')) {
        throw new Error(`Text fallback timed out after ${Math.round(TEXT_PATCH_FALLBACK_TIMEOUT_MS / 1000)}s`);
    }
    throw lastError || new Error('Text fallback failed');
}

async function readOpenAIStreamText(res: Response): Promise<string> {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
                const parsed = JSON.parse(data);
                text += parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || '';
            } catch {
                // Ignore malformed SSE bookkeeping lines.
            }
        }
    }
    return text;
}

// ─── Brief Template Builder ──────────────────────────────

/**
 * Build a complete, self-contained brief for the Pi SDK engineer.
 * This is a deterministic template — no LLM involved.
 * All context (story, stack, conventions, knowledge) is injected directly.
 */
function buildBrief(
    story: Story,
    blueprint: ProjectBlueprint,
    targetDir: string,
    _executorName: string,
): string {
    const sections: string[] = [];

    sections.push(`# Execution Brief\n\nYou are Pi running as the autonomous implementation worker for Factory. Factory/TPM is the supervisor and the user's point of contact. Factory has selected exactly one queued story for you. Use your normal coding capabilities to inspect the repo, edit files, run commands, and validate the result.\n\n## Worker Contract\n\n- Implement only the selected story in this run.\n- Treat Factory/TPM as your supervisor: do not ask the user questions; make reasonable engineering decisions from the repo context.\n- Read the selected story first, then read relevant Factory knowledge, conventions, chronicle, and product code before editing.\n- Keep the story lifecycle visible: confirm or set the story to \`running\`/\`in-progress\` while working when the repo's story format supports it, and leave final status notes in the story/worklog before completion.\n- Make concrete product changes, run the relevant validation, and fix errors introduced by this story.\n- Leave the repo commit-ready. If the repo policy and tooling clearly support committing from the worker, make a focused commit; otherwise leave a clear changed-file summary for Factory to commit.\n- Notify Factory by printing \`DELIVERY COMPLETE\` only after the story is actually delivered, with a short summary and changed files.`);

    // ── Phase 1: Context Gathering ──
    const contextSteps: string[] = [];
    if (blueprint.conventions.length > 0) {
        contextSteps.push(`- **Conventions:** Read \`.factory/AGENTS.md\` and other convention files in the codebase.`);
    }
    if (blueprint.toonSnapshot) {
        contextSteps.push(`- **State:** Read \`.factory/logs/state.yaml\` (or \`.toon\`) to understand the current architecture and stack.`);
    }
    
    const kfList = blueprint.knowledgeFiles.map(k => k.path);
    const kbList = loadKnowledgeFiles(blueprint.repoPath).map(k => `.factory/knowledge/${k.name}.md`);
    const allKb = [...kfList, ...kbList];
    if (allKb.length > 0) {
        contextSteps.push(`- **Knowledge Base:** Review relevant files from the following list to ensure you follow past architectural decisions:\n  ${allKb.join('\n  ')}`);
    }

    sections.push(`## Required Workflow\n\n1. Read this selected story and confirm its current status.\n2. Read the relevant KB/conventions/chronicle files listed below.\n3. Inspect the existing implementation paths needed for this story.\n4. Update story/worklog status to show work has started when the repo format supports it.\n5. Implement the feature as a small vertical slice.\n6. Run validation and fix regressions caused by this story.\n7. Update story/worklog status with the delivery summary.\n8. Commit the product changes if the repo's current workflow clearly expects the worker to commit; otherwise leave a commit-ready diff.\n9. Print \`DELIVERY COMPLETE\` so Factory can verify, mark final status, notify the queue, and perform any remaining commit/push step.`);

    if (contextSteps.length > 0) {
        sections.push(`## Required Context\n\nUse your read/search tools to gather necessary context:\n${contextSteps.join('\n')}`);
    }

    // ── Phase 2: Implementation ──
    const { storyMeta, storyBody } = formatStoryForBrief(story);
    sections.push(`## Phase 2: Implementation\n\nImplement the story exactly as requested.\n\n### Target Directory\n\`${targetDir}\`\n\n### Story Metadata\n\`\`\`yaml\n${toYaml(storyMeta).trim()}\n\`\`\`\n\n### Story Body\n${storyBody}`);

    if (story.stack) {
        sections.push(`### Stack\n\`\`\`json\n${JSON.stringify(story.stack, null, 2)}\n\`\`\``);
    }

    const criteria = (story as any).acceptance_criteria;
    if (Array.isArray(criteria) && criteria.length > 0) {
        sections.push(`### Acceptance Criteria\nYou MUST satisfy ALL of these:\n${criteria.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}`);
    }

    // ── Skills ──
    const scoredSkills = resolveSkillsForBuild(story, blueprint);
    if (scoredSkills.length > 0) {
        sections.push(`### Required Skills\n\n${formatSkillsForPrompt(scoredSkills)}`);
    }

    // ── BTW (urgent user overrides) ──
    if ((story as any).btw && Array.isArray((story as any).btw) && (story as any).btw.length > 0) {
        sections.push(`### URGENT OVERRIDES\n\nThese take highest priority:\n${(story as any).btw.map((b: string) => `- ${b}`).join('\n')}`);
    }

    // ── Phase 3: Validation ──
    sections.push(`## Phase 3: Validation & Delivery\n
- Install any necessary dependencies using the package manager appropriate for the stack when needed.
- Fix compilation, type, lint, and runtime errors introduced by this story.
- Verify the build passes locally with the repo's existing commands where available.
- When done, print \`DELIVERY COMPLETE\` and a summary of what was built.

Do not ask for help. Complete the story autonomously.`);

    return sections.join('\n\n');
}

function formatStoryForBrief(story: Story): { storyMeta: Record<string, unknown>; storyBody: string } {
    const {
        content,
        build: _build,
        failureReason: _failureReason,
        threadId: _threadId,
        ...storyMeta
    } = story as any;

    return {
        storyMeta,
        storyBody: stripGeneratedBuildSummary(String(content || '').trim()) || story.name,
    };
}

function stripGeneratedBuildSummary(content: string): string {
    return content
        .replace(/\n{2,}## Build Summary[\s\S]*$/i, '')
        .trim();
}

function isReviewOnlyStory(story: Story): boolean {
    const text = [story.name, story.description || '', String((story as any).content || '')].join('\n');
    return /^(Review|Audit|Assess|Inspect)\b/i.test(story.name)
        || /(?:^|\n)\s*name:\s*["']?(?:Review|Audit|Assess|Inspect)\b/i.test(text)
        || /\breview-only\b|\baudit-only\b|\breview\/audit\b/i.test(text);
}

// ─── Helpers ─────────────────────────────────────────────

function writeBuildReceipt(
    ctx: OrchestratorContext,
    summary: string,
    success: boolean,
    verification?: DeliveryVerification,
): void {
    const receiptDir = join(ctx.repoPath, '.factory', 'logs', success ? 'builds' : 'failures');
    mkdirSync(receiptDir, { recursive: true });

    const slug = ctx.storyFile
        .split('/')
        .pop()
        ?.replace(/\.(?:md|ya?ml)$/, '')
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
        ...(verification ? [
            '## Verification',
            '',
            `**Status**: ${verification.status}`,
            `**Product files changed**: ${verification.productFilesChanged ? 'yes' : 'no'}`,
            `**User reachable**: ${verification.userReachable ? 'yes' : 'no'}`,
            '',
            '### Evidence',
            ...(verification.evidence.length > 0 ? verification.evidence.map(item => `- ${item}`) : ['- None provided']),
            '',
            '### Missing',
            ...(verification.missing.length > 0 ? verification.missing.map(item => `- ${item}`) : ['- None']),
            '',
        ] : []),
        '## Files Written',
        ...ctx.files.slice(0, 50).map(f => `- ${f.filename}`),
        ctx.files.length > 50 ? `...and ${ctx.files.length - 50} more` : '',
    ].join('\n');

    writeFileSync(receiptPath, content);
    log('✓', `Build receipt: ${receiptDir}/${slug}-${timestamp}.md`);
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
