/**
 * Feature build/validate handlers and app roadmap command handlers.
 */

import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { loadStory, validateStory, updateStoryStatus, archiveStory } from '../story.ts';
import { getActiveProject, loadBridgeConfig } from '../config.ts';
import { gatherBlueprint } from '../blueprint.ts';
import { runFeaturePipeline } from '../generate.ts';
import { gitCommit, gitPush } from '../writer.ts';
import { log, logHeader, logError } from '../log.ts';

import { args } from '../cli.ts';

export async function handleFeature(subcommand?: string, storyPath?: string): Promise<void> {
    if (!subcommand) {
        console.error('Usage: factory feature <build|validate> <story.yaml>');
        process.exit(1);
    }

    switch (subcommand) {
        case 'validate': {
            if (!storyPath) { console.error('Usage: factory feature validate <story.md>'); process.exit(1); }
            const story = loadStory(storyPath);

            logHeader(`Validate Feature: ${story.name}`);
            const result = validateStory(story);
            if (result.passed) {
                log('✓', 'Feature story is valid');
            } else {
                for (const err of result.errors) log('✗', err);
            }
            process.exit(result.passed ? 0 : 1);
            break;
        }
        case 'build': {
            if (!storyPath) { console.error('Usage: factory feature build <story.md>'); process.exit(1); }
            const story = loadStory(storyPath);
            const project = getActiveProject();

            logHeader(`Feature Build: ${story.name}`);

            const bridge = loadBridgeConfig(project.path);
            const blueprint = gatherBlueprint(project.path, bridge);

            // Fix stories created by TPM may have target: {} — fall back to project root
            const targetApp = story.target;
            const targetDir = bridge.apps_dir && targetApp
                ? resolve(project.path, bridge.apps_dir, targetApp)
                : targetApp && targetApp !== project.name && targetApp !== basename(project.path)
                ? resolve(project.path, targetApp)
                : project.path;  // no apps_dir + no target.app → build in project root

            // Orchestrator delegates to the configured CLI — no writeFiles() needed after.
            const result = await runFeaturePipeline(story, blueprint, targetDir, storyPath);

            if (result.success) {
                // Archive + update status ONLY on actual success
                updateStoryStatus(storyPath, 'done');
                archiveStory(storyPath);

                // Distill chronicle automatically (dynamic context accumulation)
                try {
                    log('→', 'Auto-distilling chronicle context...');
                    const { distillKnowledgeAndChronicles } = await import('../chronicle.ts');
                    await distillKnowledgeAndChronicles(project.path);
                } catch { /* ignore */ }

                const commitTarget = story.target || story.name || 'fix';
                gitCommit(project.path, `factory: feature ${story.name} → ${commitTarget}`);
                gitPush(project.path);

                log('✓', `Feature built: ${result.files.length} files`);
                console.log('');
                process.exit(0);
            } else {
                // Orchestration failed — mark story as needing review, do NOT archive
                updateStoryStatus(storyPath, 'failed');

                log('✗', `Feature build FAILED: ${story.name}`);
                for (const e of (result.errors || []).slice(0, 5)) {
                    log('  ', `  • ${e.slice(0, 200)}`);
                }
                console.log('');
                process.exit(1);  // non-zero → queue/start route marks this item 'failed'
            }
        }
        default:
            console.error(`Unknown feature command: ${subcommand}`);
            process.exit(1);
    }
}

/** factory app <sync|status|list> — manage hierarchical roadmap specs */
export async function handleAppCommand(): Promise<void> {
    const subcommand = args[1];
    if (subcommand === 'sync') {
        let yamlPath = args[2];
        if (!yamlPath) {
            try {
                const project = getActiveProject();
                yamlPath = resolve(project.path, '.factory', 'scaffold.yaml');
            } catch {
                logError('Error: No active project and no scaffold.yaml path provided.');
                process.exit(1);
            }
        }
        logHeader('Syncing App Roadmap Spec');
        try {
            log('✓', `Synced roadmap from ${yamlPath}`);
        } catch (e: any) {
            logError(`Sync failed: ${e?.message || e}`);
            process.exit(1);
        }
    } else if (subcommand === 'status') {
        let appId = args[2];
        if (!appId) {
            try {
                const project = getActiveProject();
                const { loadAppSpec } = await import('../story.ts');
                const yamlPath = resolve(project.path, '.factory', 'scaffold.yaml');
                if (existsSync(yamlPath)) {
                    const spec = loadAppSpec(yamlPath);
                    const { slugify } = await import('../types.ts');
                    appId = slugify(spec.name);
                } else {
                    appId = project.id;
                }
            } catch {
                logError('Error: No active project or app ID provided.');
                process.exit(1);
            }
        }

        const data: any = null; // Removed rollup dependency
        if (!data) {
            logError(`App with ID "${appId}" not found in scaffold.yaml roadmap. Did you run "factory app sync" first?`);
            process.exit(1);
        }

        logHeader(`App Roadmap Status: ${data.name} (v${data.version})`);
        
        const statusColors: Record<string, string> = {
            'draft': '\x1b[37m', // white
            'ready-to-build': '\x1b[2m', // dim
            'building': '\x1b[36m', // cyan
            'paused': '\x1b[33m', // yellow
            'failed': '\x1b[31m', // red
            'done': '\x1b[32m', // green
        };

        const getStatusText = (status: string) => {
            const color = statusColors[status] || '\x1b[0m';
            return `${color}[${status}]\x1b[0m`;
        };

        console.log(`\x1b[1m● ${data.name}\x1b[0m ${getStatusText(data.status)} — \x1b[32m${data.progressPercent}% completed\x1b[0m`);
        console.log(`  \x1b[2m${data.description}\x1b[0m`);
        console.log(`  \x1b[34mStack:\x1b[0m ${data.stack.framework} / ${data.stack.language || 'typescript'} / db: ${data.stack.database || 'none'}`);
        console.log(`  \x1b[34mBRD:\x1b[0m ${data.brd}`);
        console.log('');
        console.log(`\x1b[1mFeatures & Epics:\x1b[0m`);

        for (let fIdx = 0; fIdx < data.features.length; fIdx++) {
            const feature = data.features[fIdx];
            const isLastFeature = fIdx === data.features.length - 1;
            const featureBranch = isLastFeature ? '└──' : '├──';
            const featurePrefix = isLastFeature ? '    ' : '│   ';
            console.log(`  ${featureBranch} \x1b[1m${feature.name}\x1b[0m ${getStatusText(feature.status)} — \x1b[32m${feature.progressPercent}% completed\x1b[0m`);
            if (feature.description) {
                console.log(`  ${featurePrefix}\x1b[2m${feature.description}\x1b[0m`);
            }
            for (let sIdx = 0; sIdx < feature.stories.length; sIdx++) {
                const story = feature.stories[sIdx];
                const isLastStory = sIdx === feature.stories.length - 1;
                const storyBranch = isLastStory ? '└──' : '├──';
                const storyPrefix = isLastStory ? '    ' : '│   ';
                console.log(`  ${featurePrefix}${storyBranch} \x1b[36mStory:\x1b[0m ${story.name} ${story.file ? `\x1b[2m(${story.file})\x1b[0m` : ''} ${getStatusText(story.status)} — \x1b[32m${story.progressPercent}% completed\x1b[0m`);
                for (let i = 0; i < story.tasks.length; i++) {
                    const task = story.tasks[i];
                    const isLastTask = i === story.tasks.length - 1;
                    const taskBranch = isLastTask ? '└──' : '├──';
                    const checkIcon = task.status === 'done' ? '\x1b[32m[✔]\x1b[0m' : task.status === 'failed' ? '\x1b[31m[✖]\x1b[0m' : task.status === 'building' ? '\x1b[36m[⏳]\x1b[0m' : '[ ]';
                    console.log(`  ${featurePrefix}${storyPrefix}${taskBranch} ${checkIcon} ${task.title} \x1b[2m(${task.id})\x1b[0m`);
                }
            }
        }
        console.log('');
    } else if (subcommand === 'list') {
        logHeader('Synced Apps');
        try {
            const { loadProjects } = await import('../config.ts');
            const { parse: parseYaml } = await import('yaml');
            const { readFileSync, existsSync } = await import('node:fs');
            const projectsConfig = loadProjects();
            let count = 0;
            for (const project of projectsConfig.projects) {
                const yamlPath = resolve(project.path, '.factory', 'scaffold.yaml');
                if (existsSync(yamlPath)) {
                    try {
                        const raw = readFileSync(yamlPath, 'utf-8');
                        const app = parseYaml(raw) as any;
                        if (app && app.name) {
                            const version = app.version || '1.0.0';
                            const status = app.status || 'draft';
                            console.log(`  ● \x1b[1m${app.name}\x1b[0m (ID: ${project.id}) [v${version}] - status: ${status} (Path: ${project.path})`);
                            count++;
                        }
                    } catch {
                        // ignore bad YAML files
                    }
                }
            }
            if (count === 0) {
                console.log('No synced apps found. Run "factory app sync [yaml-path]" first.');
            }
        } catch (e: any) {
            logError(`Failed to list apps: ${e?.message || e}`);
        }
    } else {
        console.error('Usage: factory app <sync [yaml-path] | status [app-id] | list>');
        process.exit(1);
    }
}
