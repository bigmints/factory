/**
 * Build, validate, and status handlers for the Factory CLI.
 */

import { resolve, basename, join } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import { loadStory, listStories, validateStory, updateStoryBuildMeta, archiveStory, resolveStoryPath, updateStoryStatus } from '../story.ts';
import { getActiveProject, loadBridgeConfig } from '../config.ts';
import { gatherBlueprint } from '../blueprint.ts';
import { runPipeline } from '../generate.ts';
import { gitCommit, gitPush } from '../writer.ts';
import { log, logStep, logHeader, logError } from '../log.ts';
import { storySlug, storyPort } from '../types.ts';
import { requireTarget } from '../cli.ts';

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

    // Step 2: Gather blueprint (TOON state, knowledgebase, conventions)
    logStep(2, 4, 'Gathering blueprint...');
    const bridge = loadBridgeConfig(project.path);
    const blueprint = gatherBlueprint(project.path, bridge);

    // Determine the target directory for execution.
    // Features should run inside the target app's directory, not a new folder named after the feature.
    let targetDir = project.path;
    const targetApp = (story.target as any)?.app;
    
    if (bridge.apps_dir && targetApp) {
        targetDir = resolve(project.path, bridge.apps_dir, targetApp);
    } else if (targetApp && targetApp !== project.name && targetApp !== basename(project.path)) {
        // Monorepo without explicit apps_dir, or the folder exists
        const potentialAppDir = resolve(project.path, targetApp);
        if (existsSync(potentialAppDir)) {
            targetDir = potentialAppDir;
        }
    } else if (!(story as any).feature) {
        // For app generation stories without a specific target, legacy fallback to story slug
        const slug = storySlug(story);
        if (slug !== project.name && slug !== basename(project.path)) {
            targetDir = resolve(project.path, slug);
        }
    }

    // Step 3: Run orchestrator — LLM delegates to the configured CLI
    // The CLI agent writes files directly; no post-pipeline writeFiles() needed.
    logStep(3, 4, 'Orchestrating build...');
    const result = await runPipeline(story, blueprint, targetDir, storyPath!);

    // Distill chronicle automatically (dynamic context accumulation)
    try {
        log('→', 'Auto-distilling chronicle context...');
        const { distillKnowledgeAndChronicles } = await import('../chronicle.ts');
        await distillKnowledgeAndChronicles(project.path);
    } catch { /* ignore */ }

    // Step 4: Git commit + push
    logStep(4, 4, 'Committing and pushing...');
    gitCommit(project.path, `factory: ${story.name}`);
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

        // Resolve associated stories symmetrically:
        try {
            const absStoryPath = resolveStoryPath(storyPath!);

            // Case A: The story built was a fix story. Resolve and archive the original story.
            if ((story as any).original_story) {
                const absOriginalPath = resolveStoryPath((story as any).original_story);
                if (existsSync(absOriginalPath)) {
                    log('→', `Auto-resolving original story: ${basename(absOriginalPath)}`);
                    updateStoryStatus(absOriginalPath, 'done', `Resolved because fix story ${basename(absStoryPath)} was successfully built.`);
                    archiveStory(absOriginalPath);
                }
            }

            // Case B: The story built was an original story. Resolve and archive any active fix stories pointing to it.
            const storiesDir = join(project.path, '.factory', 'stories');
            if (existsSync(storiesDir)) {
                const files = readdirSync(storiesDir).filter(f => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.yml'));
                for (const file of files) {
                    const filePath = join(storiesDir, file);
                    try {
                        const activeStory = loadStory(filePath);
                        if ((activeStory as any).original_story) {
                            const absOriginalPath = resolveStoryPath((activeStory as any).original_story);
                            if (absOriginalPath === absStoryPath) {
                                log('→', `Auto-resolving associated fix story: ${file}`);
                                updateStoryStatus(filePath, 'done', `Resolved because original story ${basename(absStoryPath)} was successfully built.`);
                                archiveStory(filePath);
                            }
                        }
                    } catch {
                        // ignore malformed stories
                    }
                }
            }
        } catch (err) {
            log('!', `Failed to clean up associated stories: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // Summary
    console.log('');
    console.log('═'.repeat(50));
    log('✓', `Build ${result.success ? 'COMPLETE' : 'DONE (with warnings)'}`);
    log('→', `App: ${story.name} (${storySlug(story)})`);
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
                    const icon = status === 'done' ? '✅' : status === 'building' ? '🔄' : '📝';
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
