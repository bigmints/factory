/**
 * Build, validate, and status handlers for the Factory CLI.
 */

import { resolve, basename, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { loadStory, listStories, validateStory, updateStoryBuildMeta, resolveStoryPath, updateStoryStatus, updateStoryExecution } from '../story.ts';
import { getActiveProject, loadBridgeConfig, loadSettings } from '../config.ts';
import { gatherBlueprint } from '../blueprint.ts';
import { runPipeline } from '../generate.ts';
import { log, logStep, logHeader, logError } from '../log.ts';
import { storySlug, storyPort } from '../types.ts';
import type { StoryExecution } from '../types.ts';
import { requireTarget } from '../cli.ts';
import { preflightDgx, isDgxInfrastructureFailure, resolvePiDgxProvider } from '../dgx.ts';
import { claimStoryWorktree, DeliveryError, startStoryHeartbeat, submitStoryPullRequest } from '../delivery.ts';

export async function handleBuild(storyPath?: string): Promise<void> {
    requireTarget('build');
    const story = loadStory(storyPath!);
    const project = getActiveProject();

    logHeader(`Build: ${story.name}`);

    // Step 1: Validate
    logStep(1, 4, 'Validating story...');
    const validation = validateStory(story);
    if (!validation.passed) {
        logError('Story validation failed:');
        for (const err of validation.errors) {
            log('  ', `  ✗ ${err}`);
        }
        process.exit(1);
    }
    log('✓', 'Story is valid');

    const settings = loadSettings();
    const piExecution = resolvePiDgxProvider(settings, project.piConfig, story.agentModel);
    let dgx;
    try {
        log('→', 'Checking local DGX model endpoint...');
        dgx = await preflightDgx(piExecution.provider, piExecution.model);
        log('✓', `DGX ready: ${dgx.model} on ${dgx.endpointHost} (${dgx.latencyMs}ms)`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateStoryStatus(storyPath!, 'queued');
        logError(message);
        process.exit(1);
    }

    // Step 2: Gather blueprint (TOON state, knowledgebase, conventions)
    logStep(2, 4, 'Gathering blueprint...');
    const bridge = loadBridgeConfig(project.path);
    const blueprint = gatherBlueprint(project.path, bridge);

    // Determine the target directory for execution.
    // Features should run inside the target app's directory, not a new folder named after the feature.
    let targetDir = project.path;
    const targetApp = typeof story.target === 'string' ? story.target : (story.target as any)?.app;

    if (bridge.apps_dir && targetApp) {
        targetDir = resolve(project.path, bridge.apps_dir, targetApp);
    } else if (targetApp && targetApp !== project.name && targetApp !== basename(project.path)) {
        // Monorepo without explicit apps_dir, or the folder exists
        const potentialAppDir = resolve(project.path, targetApp);
        if (existsSync(potentialAppDir)) {
            targetDir = potentialAppDir;
        }
    } else if (story.kind === 'app') {
        // For app generation stories without a specific target, legacy fallback to story slug
        const slug = storySlug(story);
        if (slug !== project.name && slug !== basename(project.path)) {
            targetDir = resolve(project.path, slug);
        }
    }

    const targetRelative = relative(project.path, targetDir);
    if (targetRelative.startsWith('..')) {
        logError(`Target directory escapes the project repository: ${targetDir}`);
        process.exit(1);
    }

    let claim;
    try {
        claim = claimStoryWorktree({
            repoPath: project.path,
            storyId: storySlug(story),
            storyPath: resolveStoryPath(storyPath!),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateStoryStatus(storyPath!, error instanceof DeliveryError && error.code === 'dirty_product' ? 'review' : 'queued', message);
        logError(`Delivery claim failed: ${message}`);
        process.exit(1);
    }

    const execution: StoryExecution = {
        executor: 'pi-sdk',
        model: dgx.model,
        provider: dgx.provider,
        endpointHost: dgx.endpointHost,
        branch: claim.branch,
        worktree: claim.worktree,
        baseBranch: claim.baseBranch,
        claimedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        leaseUntil: new Date(Date.now() + (bridge.delivery?.leaseMinutes || 10) * 60_000).toISOString(),
        state: 'building',
        lastEvent: claim.resumed ? 'Resumed owned worktree.' : 'Claimed story worktree.',
    };
    updateStoryStatus(storyPath!, 'running');
    const stopHeartbeat = startStoryHeartbeat(storyPath!, execution, bridge.delivery?.leaseMinutes || 10);
    const deliveryTargetDir = resolve(claim.worktree, targetRelative);

    // Step 3: Pi SDK runs only in the claimed worktree.
    logStep(3, 4, 'Orchestrating build...');
    let result;
    try {
        result = await runPipeline(story, blueprint, deliveryTargetDir, storyPath!);
    } finally {
        stopHeartbeat();
    }

    if (!result.success) {
        if (result.status === 'review') {
            const reviewSummary = [
                `Factory verification requires review for ${story.name}.`,
                '',
                result.verification?.summary || 'Delivery was not verified.',
                '',
                ...(result.verification?.missing || []).slice(0, 8).map(item => `- ${item}`),
            ].join('\n');

            updateStoryStatus(storyPath!, 'review', reviewSummary);
            logError(`Build needs review: ${story.name}`);
            for (const item of (result.verification?.missing || []).slice(0, 5)) {
                log('  ', `  • ${item.slice(0, 200)}`);
            }
            console.log('');
            process.exit(1);
        }

        const failureSummary = [
            `Factory build failed for ${story.name}.`,
            '',
            ...(result.errors || ['Pipeline returned success=false without a detailed error.']).slice(0, 8),
        ].join('\n');

        const infrastructureFailure = isDgxInfrastructureFailure(failureSummary);
        updateStoryStatus(storyPath!, infrastructureFailure ? 'queued' : 'failed', failureSummary);
        logError(`Build failed: ${story.name}`);
        for (const e of (result.errors || []).slice(0, 5)) {
            log('  ', `  • ${e.slice(0, 200)}`);
        }
        console.log('');
        process.exit(1);
    }

    let submission;
    try {
        submission = submitStoryPullRequest({
            claim,
            storyName: story.name,
            verification: result.verification,
            limits: {
                maxChangedFiles: bridge.delivery?.unattended?.maxChangedFiles || 25,
                maxChangedLines: bridge.delivery?.unattended?.maxChangedLines || 2000,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateStoryStatus(storyPath!, 'review', `Delivery is preserved in ${claim.worktree}, but PR submission needs attention: ${message}`);
        logError(`PR submission needs review: ${message}`);
        process.exit(1);
    }

    execution.prNumber = submission.prNumber;
    execution.prUrl = submission.prUrl;
    execution.heartbeatAt = new Date().toISOString();
    execution.leaseUntil = execution.heartbeatAt;
    execution.state = 'review';
    execution.lastEvent = 'Pull request submitted; awaiting human review.';
    execution.changedFiles = submission.changedFiles;
    execution.verification = result.verification ? {
        status: result.verification.status,
        summary: result.verification.summary,
        evidence: result.verification.evidence,
        productFilesChanged: result.verification.productFilesChanged,
        userReachable: result.verification.userReachable,
    } : undefined;
    updateStoryExecution(storyPath!, execution);
    updateStoryStatus(storyPath!, 'review', `Awaiting human review: ${submission.prUrl}`);

    // Write build metadata back into the source story. Archival happens only after merge.
    updateStoryBuildMeta(storyPath!, {
        outputDir: deliveryTargetDir,
        commitHash: submission.commit.slice(0, 12),
        filesGenerated: result.files.length,
        iterations: result.iterations,
        taskType: result.plan.decisions.find(d => d.startsWith('executor:')) || 'orchestrator',
    }, claim.worktree);

    logStep(4, 4, 'Pull request submitted for human review');

    // Summary
    console.log('');
    console.log('═'.repeat(50));
    log('✓', `Build ${result.success ? 'COMPLETE' : 'DONE (with warnings)'}`);
    log('→', `App: ${story.name} (${storySlug(story)})`);
    log('→', `Files: ${result.files.length}`);
    log('→', `Worktree: ${claim.worktree}`);
    log('→', `Pull request: ${submission.prUrl}`);
    if (result.errors && result.errors.length > 0) {
        log('!', `${result.errors.length} warning(s) remaining`);
        for (const e of result.errors.slice(0, 3)) log('  ', `  • ${e.slice(0, 120)}`);
    }
    console.log('');

    process.exit(result.success ? 0 : 1);
}

export function handleValidate(storyPath?: string): void {
    requireTarget('validate');
    const story = loadStory(storyPath!);

    logHeader(`Validate: ${story.name}`);

    const result = validateStory(story);
    if (result.passed) {
        log('✓', 'All checks passed!');
    } else {
        for (const err of result.errors) {
            log('✗', err);
        }
        log('✗', `${result.errors.length} error(s) found`);
    }

    process.exit(result.passed ? 0 : 1);
}

export function handleStatus(): void {
    logHeader('Status');

    try {
        const project = getActiveProject();
        log('→', `Active project: ${project.name} (${project.path})`);
        console.log('');

        const stories = listStories(project.path);

        if (stories.apps.length === 0 && stories.features.length === 0) {
            log('!', 'No stories found. Add .md files to .factory/stories/');
            return;
        }

        if (stories.apps.length > 0) {
            console.log('App Stories:');
            for (const file of stories.apps) {
                try {
                    const story = loadStory(resolve(project.path, '.factory', 'stories', file));
                    const slug = storySlug(story);
                    const port = storyPort(story as any); // cast for now if storyPort relies on AppStory fields
                    const status = story.status || 'draft';
                    const icon = status === 'done' ? '✅' : status === 'review' ? '⚠️' : status === 'running' ? '🔄' : status === 'queued' ? '⏳' : '📝';
                    log('  ', `  ${icon} ${slug} — ${story.name} (port ${port}) [${status}]`);
                } catch {
                    log('  ', `  ❌ ${file} — failed to parse`);
                }
            }
        }

        if (stories.features.length > 0) {
            console.log('');
            console.log('Feature Stories:');
            for (const file of stories.features) {
                try {
                    const story = loadStory(resolve(project.path, '.factory', 'stories', file));
                    log('  ', `  📋 ${story.name} → ${story.target}`);
                } catch {
                    log('  ', `  ❌ ${file} — failed to parse`);
                }
            }
        }
    } catch (error) {
        if (error instanceof Error) {
            logError(error.message);
        }
        process.exit(1);
    }

    console.log('');
}
