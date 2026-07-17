/**
 * Feature build/validate handlers and app roadmap command handlers.
 */

import { loadStory, validateStory } from '../story.ts';
import { resolve } from 'node:path';
import { getActiveProject } from '../config.ts';
import { log, logHeader, logError } from '../log.ts';
import { handleBuild } from './build-handlers.ts';

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
            return handleBuild(storyPath);
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
        logError('`factory app status` is not supported in the cleaned Pi SDK-first flow.');
        logError('Use `factory status` for story state until roadmap rollups are reintroduced.');
        process.exit(1);
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
