/**
 * Project management handlers: add, list, switch, remove, reset.
 * Also handles sync and init-bridge.
 */

import { resolve, join, isAbsolute, basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { addProject, removeProject, switchProject, loadProjects, getActiveProject, loadBridgeConfig } from '../config.ts';
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
    const appsDir = join(storiesDir, 'apps');
    const featuresDir = join(storiesDir, 'features');
    
    const { existsSync: ex, mkdirSync: mk, readdirSync: rd, unlinkSync: rm, writeFileSync: wr } = await import('node:fs');
    const { parse: parseYaml, stringify: stringifyYaml } = await import('yaml');
    
    if (!ex(appsDir)) mk(appsDir, { recursive: true });
    if (!ex(featuresDir)) mk(featuresDir, { recursive: true });
    
    let storiesReset = 0;
    
    // Move and reset 'done' stories
    if (ex(doneDir)) {
        const doneFiles = rd(doneDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of doneFiles) {
            const filePath = join(doneDir, file);
            try {
                const raw = readFileSync(filePath, 'utf-8');
                const doc = parseYaml(raw) as any;
                if (doc) {
                    doc.status = 'draft';
                    const isFeature = !!(doc.feature || doc.target || 'phase' in doc);
                    const targetDir = isFeature ? featuresDir : appsDir;
                    const destPath = join(targetDir, file);
                    wr(destPath, stringifyYaml(doc, { lineWidth: 120 }), 'utf-8');
                    rm(filePath);
                    storiesReset++;
                    log('✓', `Restored archived story to draft: ${file} → ${isFeature ? 'features' : 'apps'}`);
                }
            } catch (err: any) {
                logError(`Failed to restore archived story ${file}: ${err?.message || err}`);
            }
        }
    }
    
    // Reset stories in 'apps'
    if (ex(appsDir)) {
        const appFiles = rd(appsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of appFiles) {
            const filePath = join(appsDir, file);
            try {
                const raw = readFileSync(filePath, 'utf-8');
                const doc = parseYaml(raw) as any;
                if (doc && doc.status !== 'draft') {
                    doc.status = 'draft';
                    wr(filePath, stringifyYaml(doc, { lineWidth: 120 }), 'utf-8');
                    storiesReset++;
                    log('✓', `Reset app story status to draft: ${file}`);
                }
            } catch (err: any) {
                logError(`Failed to reset app story ${file}: ${err?.message || err}`);
            }
        }
    }
    
    // Reset stories in 'features'
    if (ex(featuresDir)) {
        const featureFiles = rd(featuresDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of featureFiles) {
            const filePath = join(featuresDir, file);
            try {
                const raw = readFileSync(filePath, 'utf-8');
                const doc = parseYaml(raw) as any;
                if (doc && doc.status !== 'draft') {
                    doc.status = 'draft';
                    wr(filePath, stringifyYaml(doc, { lineWidth: 120 }), 'utf-8');
                    storiesReset++;
                    log('✓', `Reset feature story status to draft: ${file}`);
                }
            } catch (err: any) {
                logError(`Failed to reset feature story ${file}: ${err?.message || err}`);
            }
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
