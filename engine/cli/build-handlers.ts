/**
 * Build, validate, and status handlers for the Factory CLI.
 */

import { resolve, basename } from 'node:path';
import { loadStory, loadFeatureStory, listStories, validateStory, updateStoryStatus, updateStoryBuildMeta, archiveStory } from '../story.ts';
import { getActiveProject, loadBridgeConfig } from '../config.ts';
import { gatherBlueprint } from '../blueprint.ts';
import { runPipeline } from '../generate.ts';
import { gitCommit, gitPush } from '../writer.ts';
import { log, logStep, logHeader, logError } from '../log.ts';
import { storySlug, storyPort } from '../types.ts';
import { args, target, requireTarget } from '../cli.ts';

export async function handleBuild(storyPath?: string): Promise<void> {
    requireTarget('build');
    const story = loadStory(storyPath!);
    const project = getActiveProject();

    logHeader(`Build: ${story.appName}`);

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

    // Step 2: Gather blueprint (TOON state, knowledgebase, conventions)
    logStep(2, 4, 'Gathering blueprint...');
    const bridge = loadBridgeConfig(project.path);
    const blueprint = gatherBlueprint(project.path, bridge);

    const slug = storySlug(story);
    const targetDir = bridge.apps_dir
        ? resolve(project.path, bridge.apps_dir, slug)
        : slug !== project.name && slug !== basename(project.path)
        ? resolve(project.path, slug)
        : project.path;

    // Step 3: Run orchestrator — LLM delegates to the configured CLI
    // The CLI agent writes files directly; no post-pipeline writeFiles() needed.
    logStep(3, 4, 'Orchestrating build...');
    const result = await runPipeline(story, blueprint, targetDir, storyPath!);

    // Distill chronicle automatically (dynamic context accumulation)
    try {
        log('→', 'Auto-distilling chronicle context...');
        const { distillChronicle } = await import('../chronicle.ts');
        await distillChronicle(project.path);
    } catch { /* ignore */ }

    // Step 4: Git commit + push
    logStep(4, 4, 'Committing and pushing...');
    gitCommit(project.path, `factory: ${story.appName}`);
    gitPush(project.path);

    // Write build metadata back into story + archive
    updateStoryBuildMeta(storyPath!, {
        outputDir: targetDir,
        filesGenerated: result.files.length,
        iterations: result.iterations,
        taskType: result.plan.decisions.find(d => d.startsWith('cli:')) || 'orchestrator',
    }, project.path);
    if (result.success) {
        archiveStory(storyPath!);
    }

    // Summary
    console.log('');
    console.log('═'.repeat(50));
    log('✓', `Build ${result.success ? 'COMPLETE' : 'DONE (with warnings)'}`);
    log('→', `App: ${story.appName} (${slug})`);
    log('→', `Files: ${result.files.length}`);
    log('→', `Output: ${targetDir}`);
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

    logHeader(`Validate: ${story.appName}`);

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
            log('!', 'No stories found. Add YAML files to .factory/stories/apps/ or .factory/stories/features/');
            return;
        }

        if (stories.apps.length > 0) {
            console.log('App Stories:');
            for (const file of stories.apps) {
                try {
                    const story = loadStory(resolve(project.path, '.factory', 'stories', 'apps', file));
                    const slug = storySlug(story);
                    const port = storyPort(story);
                    const status = story.status || 'draft';
                    const icon = status === 'done' ? '✅' : status === 'building' ? '🔄' : '📝';
                    log('  ', `  ${icon} ${slug} — ${story.appName} (port ${port}) [${status}]`);
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
                    const story = loadFeatureStory(resolve(project.path, '.factory', 'stories', 'features', file));
                    log('  ', `  📋 ${story.feature.slug} — ${story.feature.name} → ${story.target.app}`);
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
