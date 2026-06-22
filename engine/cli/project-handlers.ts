/**
 * Project management handlers: add, list, switch, remove, reset.
 * Also handles sync and init-bridge.
 */

import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { addProject, removeProject, switchProject, loadProjects, getActiveProject } from '../config.ts';
import { syncBlueprint } from '../blueprint.ts';
import { log, logHeader, logError } from '../log.ts';
import { type ProjectStack } from '../types.ts';
import { args, requireTarget, parseFlags } from '../cli.ts';
import { installGitHooks } from './facade-handlers.ts';

export function handleSync(repoPath?: string): void {
    requireTarget('sync');
    const absPath = resolve(repoPath!);
    logHeader(`Sync: ${absPath}`);

    if (!existsSync(absPath)) {
        logError(`Path does not exist: ${absPath}`);
        process.exit(1);
    }

    const factoryDir = resolve(absPath, '.factory');
    if (existsSync(factoryDir)) {
        log('✓', '.factory directory found');
        syncBlueprint(absPath);
    } else {
        log('!', 'No .factory directory — run: factory project add <path>');
    }

    log('✓', 'Sync complete');
}

export function handleInitBridge(repoPath?: string): void {
    requireTarget('init-bridge');
    const absPath = resolve(repoPath!);
    logHeader(`Init Bridge: ${absPath}`);
    addProject(absPath);
}

export async function handleProject(subcommand?: string, arg?: string): Promise<void> {
    if (!subcommand) {
        console.error('Usage: factory project <add|list|switch|remove|reset> [argument]');
        process.exit(1);
    }

    switch (subcommand) {
        case 'add': {
            if (!arg) {
                console.error('Usage: factory project add <repo-path-or-url>');
                process.exit(1);
            }

            let targetPath = arg;
            if (arg.startsWith('http://') || arg.startsWith('https://') || arg.startsWith('git@')) {
                const repoNameMatch = arg.match(/([^\/]+)(?:\.git)?$/);
                const repoName = repoNameMatch ? repoNameMatch[1].replace(/\.git$/, '') : 'factory-project';
                targetPath = resolve(process.cwd(), repoName);
                
                log('→', `Cloning ${arg} into ${targetPath}...`);
                const { execSync } = await import('node:child_process');
                try {
                    execSync(`git clone ${arg} "${targetPath}"`, { stdio: 'inherit' });
                } catch (error: any) {
                    logError(`Failed to clone repository: ${error.message}`);
                    process.exit(1);
                }
            } else {
                targetPath = resolve(arg);
            }

            const flags = parseFlags(args.slice(3));
            const stack: ProjectStack | undefined = flags.framework
                ? {
                    framework: flags.framework as string,
                    packageManager: (flags.pm as string) || 'npm',
                    linter: flags.linter as string | undefined,
                    testing: flags.testing as string | undefined,
                }
                : undefined;

            await addProject(targetPath, stack);
            installGitHooks(targetPath);
            break;
        }
        case 'list': {
            const config = loadProjects();
            if (config.projects.length === 0) {
                log('!', 'No projects registered');
            } else {
                for (const p of config.projects) {
                    const marker = p.id === config.activeProject ? '● ' : '  ';
                    log('  ', `${marker}${p.name} (${p.id})`);
                    log('  ', `    ${p.path}`);
                }
            }
            break;
        }
        case 'switch': {
            if (!arg) { console.error('Usage: factory project switch <id>'); process.exit(1); }
            switchProject(arg);
            break;
        }
        case 'remove': {
            if (!arg) { console.error('Usage: factory project remove <id>'); process.exit(1); }
            removeProject(arg);
            break;
        }
        case 'reset': {
            const repoPath = arg ? resolve(arg) : undefined;
            await handleProjectReset(repoPath);
            break;
        }
        default:
            console.error(`Unknown project command: ${subcommand}`);
            process.exit(1);
    }
}

async function handleProjectReset(repoPathInput?: string): Promise<void> {
    logHeader('Resetting Project Stories & Queue');
    
    let targetRepoPath = repoPathInput;
    if (!targetRepoPath) {
        try {
            const project = getActiveProject();
            targetRepoPath = project.path;
        } catch {
            logError('Error: No active project found and no repo path provided.');
            process.exit(1);
        }
    }
    
    const resolvedPath = resolve(targetRepoPath);
    log('→', `Target repository: ${resolvedPath}`);
    
    // 2. Scan stories directory
    const storiesDir = join(resolvedPath, '.factory', 'stories');
    if (!existsSync(storiesDir)) {
        log('!', `No stories folder found at ${storiesDir}. Skipping story resetting.`);
        return;
    }
    
    const doneDir = join(storiesDir, 'done');
    
    const { existsSync: ex, readdirSync: rd, renameSync: rn, writeFileSync: wr } = await import('node:fs');
    const { parse: parseYaml, stringify: stringifyYaml } = await import('yaml');
    const { loadStory, updateStoryStatus } = await import('../story.ts');
    
    let storiesReset = 0;
    
    // Move and reset 'done' stories
    if (ex(doneDir)) {
        const doneFiles = rd(doneDir).filter(f => f.endsWith('.md'));
        for (const file of doneFiles) {
            const filePath = join(doneDir, file);
            const destPath = join(storiesDir, file);
            try {
                updateStoryStatus(filePath, 'draft');
                rn(filePath, destPath);
                storiesReset++;
                log('✓', `Restored archived story to draft: ${file}`);
            } catch (err: any) {
                logError(`Failed to restore archived story ${file}: ${err?.message || err}`);
            }
        }
    }
    
    // Reset active stories directly in storiesDir
    const activeFiles = rd(storiesDir).filter(f => f.endsWith('.md'));
    for (const file of activeFiles) {
        const filePath = join(storiesDir, file);
        try {
            const doc = loadStory(filePath);
            if (doc && doc.status !== 'draft') {
                updateStoryStatus(filePath, 'draft');
                storiesReset++;
                log('✓', `Reset story status to draft: ${file}`);
            }
        } catch (err: any) {
            logError(`Failed to reset story ${file}: ${err?.message || err}`);
        }
    }
    
    // 3. Reset scaffold.yaml
    const scaffoldYamlPath = join(resolvedPath, '.factory', 'scaffold.yaml');
    if (ex(scaffoldYamlPath)) {
        try {
            const raw = readFileSync(scaffoldYamlPath, 'utf-8');
            const app = parseYaml(raw) as any;
            if (app) {
                app.status = 'draft';
                app.progressPercent = 0;
                if (app.features) {
                    for (const feature of app.features) {
                        feature.status = 'ready-to-build';
                        feature.progressPercent = 0;
                        if (feature.stories) {
                            for (const story of feature.stories) {
                                story.status = 'draft';
                                story.progressPercent = 0;
                                if (story.tasks) {
                                    for (const task of story.tasks) {
                                        task.status = 'ready-to-build';
                                    }
                                }
                            }
                        }
                    }
                }
                
                wr(scaffoldYamlPath, stringifyYaml(app, { lineWidth: 120 }), 'utf-8');
                log('✓', `Reset scaffold.yaml roadmap progress and tasks to draft/pending.`);
            }
        } catch (err: any) {
            logError(`Failed to reset scaffold.yaml roadmap: ${err?.message || err}`);
        }
    }
    
    log('✓', `Project stories reset successfully. Total stories reset/restored: ${storiesReset}`);
}
