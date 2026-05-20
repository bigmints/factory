#!/usr/bin/env node

/**
 * Factory CLI — thin dispatcher.
 *
 * Usage:
 *   factory build <spec.yaml>                Full pipeline (gather → validate → plan → build → test → iterate → push)
 *   factory validate <spec.yaml>             Validate a spec
 *   factory status                           Show spec statuses
 *   factory project add <repo-path>          Connect a repo
 *   factory project list                     List connected repos
 *   factory project switch <id>              Switch active project
 *   factory project remove <id>              Disconnect a repo
 *   factory feature build <spec.yaml>        Build a feature
 *   factory feature validate <spec.yaml>     Validate a feature spec
 */

import { resolve, basename, dirname, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn, SpawnOptions, execSync } from 'node:child_process';
import { loadSpec, loadFeatureSpec, listSpecs, validateSpec, validateFeatureSpec, updateSpecStatus, updateSpecBuildMeta, archiveSpec } from './spec.ts';
import { loadProjects, getActiveProject, addProject, removeProject, switchProject, loadBridgeConfig } from './config.ts';
import { gatherContext } from './context.ts';
import { runPipeline, runFeaturePipeline } from './generate.ts';
import { runMinionsBuild, runMinionsFeatureBuild } from './minions-engine.ts';
import { writeFiles, setupProject, gitCommit, gitPush, writeKnowledgeEntry, writeAppAgentsMd, buildDebrief } from './writer.ts';
import { autoFixSpec } from './autofix.ts';
import { log, logHeader, logStep, logError } from './log.ts';
import { specSlug, specPort, type ProjectStack } from './types.ts';
import {
    enqueue, dequeue, listQueue, getQueueStats,
    markRunning, markCompleted, markFailed,
    removeItem, clearCompleted, retryItem,
    isQueueRunning, setQueueRunning, areDependenciesMet,
} from './queue.ts';
import { closeDb, logBuild } from './db.ts';
import { performStateAudit, updateHeartbeat, withRetry, categorizeError } from './health.ts';

const args = process.argv.slice(2);
const command = args[0];
const target = args[1];

/** Resolve a script path relative to factory/scripts/.
 * Scripts live at factory/factory/scripts/ because there is a factory/ subdir.
 * @param scriptName - e.g. "heartbeat/pulse.sh" or "minions/scripts/minions"
 * @returns absolute path to the script
 */
export function resolveScript(scriptName: string): string {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return resolve(__dirname, '..', 'factory', 'scripts', scriptName);
}

/** Check if a resolved script exists and is executable */
export function hasScript(scriptName: string): boolean {
    return existsSync(resolveScript(scriptName));
}

async function main(): Promise<void> {
    switch (command) {
        case 'build':
            return handleBuild(target);
        case 'validate':
            return handleValidate(target);
        case 'status':
            return handleStatus();
        case 'sync':
            return handleSync(target);
        case 'init-bridge':
            return handleInitBridge(target);
        case 'project':
            return handleProject(target, args[2]);
        case 'feature':
            return handleFeature(target, args[2]);
        case 'queue':
            return handleQueue(target, args[2]);
        case 'start':
            return handleStart();
        case 'stop':
            return handleStop();
        case 'restart':
            handleStop();
            return handleStart();
        // ─── CLI Facade (us_004) ─────────────────────────────
        case 'pulse':
            return handlePulse();
        case 'task':
            return handleTask();
        case 'context':
            return handleContext();
        case 'compress':
            return handleCompress();
        case 'minions':
            return handleMinions();
        case 'hooks':
            return handleHooks();
        default:
            printUsage();
            process.exit(command ? 1 : 0);
    }
}

// ─── Build ───────────────────────────────────────────────

async function handleBuild(specPath?: string): Promise<void> {
    requireTarget('build');
    const spec = loadSpec(specPath!);
    const project = getActiveProject();

    logHeader(`Build: ${spec.appName}`);

    // Step 1: Validate
    logStep(1, 7, 'Validating spec...');
    const validation = validateSpec(spec);
    if (!validation.passed) {
        logError('Spec validation failed:');
        for (const err of validation.errors) {
            log('  ', `  ✗ ${err}`);
        }
        process.exit(1);
    }
    log('✓', 'Spec is valid');

    // Step 2: Gather context
    logStep(2, 7, 'Gathering context...');
    const bridge = loadBridgeConfig(project.path);
    const context = gatherContext(project.path, bridge);

    // Steps 3-5: Plan → Build → Test → Iterate (or minions engine)
    const engineFlag = parseFlags(args.slice(2)).engine as string | undefined;
    const effectiveEngine = engineFlag || spec.engine || 'factory';
    const useMinions = effectiveEngine === 'minions';

    let result;
    if (useMinions) {
        logStep(3, 7, 'Generating with minions engine...');
        result = await runMinionsBuild(spec, context);
    } else {
        result = await runPipeline(spec, context);
    }

    // Step 6: Write files
    const slug = specSlug(spec);
    const targetDir = bridge.apps_dir
        ? resolve(project.path, bridge.apps_dir, slug)
        : resolve(project.path, slug);
    logStep(6, 7, 'Writing files to repo...');
    writeFiles(targetDir, result.files);
    setupProject(targetDir, spec.stack.packageManager);

    // Knowledge feedback + AGENTS.md
    writeKnowledgeEntry(project.path, spec.appName, result, spec.stack, specPath!);
    writeAppAgentsMd(targetDir, spec.appName, spec.stack, result.files);

    // Step 7: Git commit + push
    logStep(7, 7, 'Committing and pushing...');
    gitCommit(project.path, `factory: generate ${spec.appName}`);
    gitPush(project.path);

    // Step 8: Write build metadata back into spec + archive
    updateSpecBuildMeta(specPath!, {
        outputDir: targetDir,
        filesGenerated: result.files.length,
        iterations: result.iterations,
        taskType: result.plan.decisions[0] || 'unknown',
    }, project.path);
    if (result.success) {
        archiveSpec(specPath!);
    }

    // Summary
    console.log('');
    console.log('═'.repeat(50));
    log('✓', `Build ${result.success ? 'COMPLETE' : 'DONE (with warnings)'}`);
    log('→', `App: ${spec.appName} (${slug})`);
    log('→', `Files: ${result.files.length}`);
    log('→', `Iterations: ${result.iterations}`);
    log('→', `Output: ${targetDir}`);
    if (result.errors && result.errors.length > 0) {
        log('!', `${result.errors.length} warning(s) remaining`);
    }
    console.log('');

    process.exit(result.success ? 0 : 1);
}

// ─── Validate ────────────────────────────────────────────

function handleValidate(specPath?: string): void {
    requireTarget('validate');
    const spec = loadSpec(specPath!);

    logHeader(`Validate: ${spec.appName}`);

    const result = validateSpec(spec);
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

// ─── Status ──────────────────────────────────────────────

function handleStatus(): void {
    logHeader('Status');

    try {
        const project = getActiveProject();
        log('→', `Active project: ${project.name} (${project.path})`);
        console.log('');

        const specs = listSpecs(project.path);

        if (specs.apps.length === 0 && specs.features.length === 0) {
            log('!', 'No specs found. Add YAML files to .factory/specs/apps/ or .factory/specs/features/');
            return;
        }

        if (specs.apps.length > 0) {
            console.log('App Specs:');
            for (const file of specs.apps) {
                try {
                    const spec = loadSpec(resolve(project.path, '.factory', 'specs', 'apps', file));
                    const slug = specSlug(spec);
                    const port = specPort(spec);
                    const status = spec.status || 'draft';
                    const icon = status === 'done' ? '✅' : status === 'in-progress' ? '🔄' : '📝';
                    log('  ', `  ${icon} ${slug} — ${spec.appName} (port ${port}) [${status}]`);
                } catch {
                    log('  ', `  ❌ ${file} — failed to parse`);
                }
            }
        }

        if (specs.features.length > 0) {
            console.log('');
            console.log('Feature Specs:');
            for (const file of specs.features) {
                try {
                    const spec = loadFeatureSpec(resolve(project.path, '.factory', 'specs', 'features', file));
                    log('  ', `  📋 ${spec.feature.slug} — ${spec.feature.name} → ${spec.target.app}`);
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

// ─── Sync & Init Bridge ──────────────────────────────────

function handleSync(repoPath?: string): void {
    requireTarget('sync');
    const absPath = resolve(repoPath!);
    logHeader(`Sync: ${absPath}`);

    if (!existsSync(absPath)) {
        logError(`Path does not exist: ${absPath}`);
        process.exit(1);
    }

    // In the new engine, sync just ensures .factory exists
    // Context is gathered on-demand during build
    const factoryDir = resolve(absPath, '.factory');
    if (existsSync(factoryDir)) {
        log('✓', '.factory directory found');
    } else {
        log('!', 'No .factory directory — run: factory project add <path>');
    }

    log('✓', 'Sync complete');
}

function handleInitBridge(repoPath?: string): void {
    requireTarget('init-bridge');
    const absPath = resolve(repoPath!);
    logHeader(`Init Bridge: ${absPath}`);
    addProject(absPath);
}

// ─── Project ─────────────────────────────────────────────

function handleProject(subcommand?: string, arg?: string): void {
    if (!subcommand) {
        console.error('Usage: factory project <add|list|switch|remove> [argument]');
        process.exit(1);
    }

    switch (subcommand) {
        case 'add': {
            if (!arg) {
                console.error('Usage: factory project add <repo-path>');
                process.exit(1);
            }

            // Parse optional flags
            const flags = parseFlags(args.slice(3));
            const stack: ProjectStack | undefined = flags.framework
                ? {
                    framework: flags.framework as string,
                    packageManager: (flags.pm as string) || 'npm',
                    linter: flags.linter as string | undefined,
                    testing: flags.testing as string | undefined,
                }
                : undefined;

            addProject(resolve(arg), stack);
            // Auto-install git hooks into the connected repo (us_094)
            installGitHooks(resolve(arg));
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
        default:
            console.error(`Unknown project command: ${subcommand}`);
            process.exit(1);
    }
}

// ─── Feature ─────────────────────────────────────────────

async function handleFeature(subcommand?: string, specPath?: string): Promise<void> {
    if (!subcommand) {
        console.error('Usage: factory feature <build|validate> <spec.yaml>');
        process.exit(1);
    }

    switch (subcommand) {
        case 'validate': {
            if (!specPath) { console.error('Usage: factory feature validate <spec.yaml>'); process.exit(1); }
            const spec = loadFeatureSpec(specPath);

            logHeader(`Validate Feature: ${spec.feature.name}`);
            const result = validateFeatureSpec(spec);
            if (result.passed) {
                log('✓', 'Feature spec is valid');
            } else {
                for (const err of result.errors) log('✗', err);
            }
            process.exit(result.passed ? 0 : 1);
            break;
        }
        case 'build': {
            if (!specPath) { console.error('Usage: factory feature build <spec.yaml>'); process.exit(1); }
            const spec = loadFeatureSpec(specPath);
            const project = getActiveProject();

            logHeader(`Feature Build: ${spec.feature.name}`);

            const bridge = loadBridgeConfig(project.path);
            const context = gatherContext(project.path, bridge);

            // Check for --engine flag
            const featureFlags = parseFlags(args.slice(3));
            const effectiveFeatureEngine = featureFlags.engine || spec.engine || 'factory';
            const useMinionsFeature = effectiveFeatureEngine === 'minions';

            const targetDir = bridge.apps_dir
                ? resolve(project.path, bridge.apps_dir, spec.target.app)
                : resolve(project.path, spec.target.app);

            let result;
            if (useMinionsFeature) {
                log('→', 'Using minions engine for feature...');
                result = await runMinionsFeatureBuild(spec, context, targetDir);
            } else {
                result = await runFeaturePipeline(spec, context);
                writeFiles(targetDir, result.files);
                setupProject(targetDir, bridge.stack?.packageManager);
            }

            // Knowledge feedback + AGENTS.md (per-feature naming)
            const featureStack = bridge.stack || { framework: 'unknown', packageManager: 'npm' };
            const featureKbName = `${spec.target.app}--${spec.feature.slug}`;
            writeKnowledgeEntry(project.path, featureKbName, result, featureStack, specPath);
            writeAppAgentsMd(targetDir, spec.feature.name, featureStack, result.files);

            // Archive completed spec + update status
            updateSpecStatus(specPath, 'done');
            archiveSpec(specPath);

            // Git commit + push
            gitCommit(project.path, `factory: add feature ${spec.feature.name} to ${spec.target.app}`);
            gitPush(project.path);

            log('✓', `Feature built: ${result.files.length} files`);
            console.log('');
            break;
        }
        default:
            console.error(`Unknown feature command: ${subcommand}`);
            process.exit(1);
    }
}

// ─── Queue ───────────────────────────────────────────────

async function handleQueue(subcommand?: string, arg?: string): Promise<void> {
    if (!subcommand) {
        console.error('Usage: factory queue <list|add|start|stats|clear|retry|remove> [argument]');
        process.exit(1);
    }

    switch (subcommand) {
        case 'list': {
            const items = listQueue();
            if (items.length === 0) {
                log('!', 'Queue is empty');
            } else {
                logHeader('Build Queue');
                for (const item of items) {
                    const icon = item.status === 'completed' ? '✅'
                        : item.status === 'running' ? '🔄'
                        : item.status === 'failed' ? '❌'
                        : item.status === 'needs-attention' ? '⚠️'
                        : '⏳';
                    const phaseTag = item.phase ? ` [P${item.phase}]` : '';
                    const depsTag = item.dependsOn.length > 0
                        ? ` ← depends on: ${item.dependsOn.join(', ')}` : '';
                    const depsMetTag = item.dependsOn.length > 0 && item.status === 'pending'
                        ? (areDependenciesMet(item.dependsOn) ? ' ✅deps met' : ' ⏳deps pending')
                        : '';
                    log('  ', `${icon} [${item.id}] ${item.specFile} (${item.kind})${phaseTag} — ${item.status}${depsMetTag}`);
                    if (depsTag) {
                        log('  ', `    ${depsTag}`);
                    }
                    if (item.error) {
                        log('  ', `    Error: ${item.error.slice(0, 100)}`);
                    }
                    if (item.durationMs) {
                        log('  ', `    Duration: ${(item.durationMs / 1000).toFixed(1)}s`);
                    }
                }
            }
            console.log('');
            break;
        }

        case 'add': {
            if (!arg) { console.error('Usage: factory queue add <spec.yaml>'); process.exit(1); }
            const specPath = resolve(arg);
            if (!existsSync(specPath)) {
                logError(`Spec file not found: ${specPath}`);
                process.exit(1);
            }

            // Detect kind and parse phase/dependsOn/engine
            let kind: 'AppSpec' | 'FeatureSpec' = 'AppSpec';
            let phase: number | undefined;
            let dependsOn: string[] | undefined;
            let specEngine: 'factory' | 'minions' | undefined;
            try {
                const fSpec = loadFeatureSpec(specPath);
                kind = 'FeatureSpec';
                phase = fSpec.phase;
                dependsOn = fSpec.dependsOn;
                specEngine = fSpec.engine;
            } catch {
                try {
                    const aSpec = loadSpec(specPath);
                    specEngine = aSpec.engine;
                } catch { /* assume AppSpec */ }
            }

            // Detect engine flag from CLI args
            const queueFlags = parseFlags(args.slice(3));
            const engine = (queueFlags.engine || specEngine || 'factory') === 'minions' ? 'minions' as const : 'factory' as const;

            const item = enqueue(specPath, kind, { phase, dependsOn, engine });
            const phaseInfo = phase ? ` [phase ${phase}]` : '';
            const depsInfo = dependsOn && dependsOn.length > 0 ? ` (depends on: ${dependsOn.join(', ')})` : '';
            const engineInfo = engine !== 'factory' ? ` [engine: ${engine}]` : '';
            log('✓', `Queued: ${item.specFile} (${item.kind})${phaseInfo}${depsInfo}${engineInfo} → ${item.id}`);
            break;
        }

        case 'start': {
            return handleQueueStart();
        }

        case 'daemon': {
            return handleDaemon(args[3]);
        }

        case 'watch': {
            return handleWatch(args[3]);
        }



        case 'stats': {
            const stats = getQueueStats();
            logHeader('Queue Stats');
            log('  ', `  Pending:      ${stats.pending}`);
            log('  ', `  Running:      ${stats.running}`);
            log('  ', `  Completed:    ${stats.completed}`);
            log('  ', `  Failed:       ${stats.failed}`);
            log('  ', `  Needs Attn:   ${stats['needs-attention']}`);
            log('  ', `  ─────────────`);
            log('  ', `  Total:        ${stats.total}`);
            log('  ', `  Running:      ${isQueueRunning() ? 'YES' : 'no'}`);
            console.log('');
            break;
        }

        case 'clear': {
            const removed = clearCompleted();
            log('✓', `Cleared ${removed} completed item(s)`);
            break;
        }

        case 'retry': {
            if (!arg) { console.error('Usage: factory queue retry <id>'); process.exit(1); }
            const item = retryItem(arg);
            if (item) {
                log('✓', `Reset to pending: ${item.specFile}`);
            } else {
                logError(`Item not found: ${arg}`);
            }
            break;
        }

        case 'remove': {
            if (!arg) { console.error('Usage: factory queue remove <id>'); process.exit(1); }
            const removed = removeItem(arg);
            if (removed) {
                log('✓', `Removed: ${arg}`);
            } else {
                logError(`Item not found: ${arg}`);
            }
            break;
        }

        default:
            console.error(`Unknown queue command: ${subcommand}`);
            process.exit(1);
    }

    closeDb();
}

/**
 * Process all pending queue items autonomously.
 * This is the "run while I sleep" mode.
 */
async function handleQueueStart(): Promise<void> {
    if (isQueueRunning()) {
        logError('Queue is already running');
        process.exit(1);
    }
    
    // Recovery Audit: Check for zombie tasks/stale runner flag
    performStateAudit();

    logHeader('🏭 Autonomous Build — Starting');

    setQueueRunning(true);
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    
    // Heartbeat: Update database periodically to signal liveness
    const heartbeatTimer = setInterval(updateHeartbeat, 30 * 1000); // 30s
    updateHeartbeat(); // First one now

    try {
        const project = getActiveProject();
        const bridge = loadBridgeConfig(project.path);
        const context = gatherContext(project.path, bridge);

        let item = dequeue();

        while (item) {
            processed++;
            const startTime = Date.now();

            console.log('');
            const current = item; // capture for TS narrowing
            logHeader(`[${processed}] Processing: ${current.specFile}`);
            markRunning(current.id);

            // Set spec status to in-progress
            updateSpecStatus(current.specFile, 'in-progress');

            try {
                if (current.kind === 'FeatureSpec') {
                    // Feature build — validate YAML first, auto-fix if broken
                    let spec;
                    try {
                        spec = loadFeatureSpec(current.specFile);
                    } catch (parseErr) {
                        const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
                        log('⚠', `YAML parse error in ${current.specFile}: ${errMsg}`);

                        // Try LLM auto-fix
                        const specAbsPath = resolve(current.specFile);
                        const fixResult = await withRetry(
                            () => autoFixSpec(specAbsPath, errMsg),
                            { maxAttempts: 3, delayMs: 2000, name: 'Auto-fix' }
                        );

                        if (fixResult.fixed) {
                            // Retry loading the fixed spec
                            try {
                                spec = loadFeatureSpec(current.specFile);
                                log('✓', `Spec auto-fixed and reloaded: ${current.specFile}`);
                            } catch (retryErr) {
                                const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                                const durationMs = Date.now() - startTime;
                                markFailed(current.id, `YAML still broken after auto-fix: ${retryMsg}`, '', durationMs);
                                logBuild(current.specFile, 'FeatureSpec', 'failed', `# Build Debrief\n\n> YAML Parse Error (auto-fix failed)\n\n## Error\n\n${retryMsg}`, [], durationMs, {
                                    errorSource: 'engine',
                                    tokensIn: fixResult.tokensIn,
                                    tokensOut: fixResult.tokensOut,
                                    engine: current.engine,
                                    errorCategory: categorizeError(retryMsg),
                                    });
                                updateSpecStatus(current.specFile, 'review');
                                failed++;
                                item = dequeue();
                                continue;
                            }
                        } else {
                            const durationMs = Date.now() - startTime;
                            markFailed(current.id, `YAML parse error (auto-fix exhausted): ${errMsg}`, '', durationMs);
                            logBuild(current.specFile, 'FeatureSpec', 'failed', `# Build Debrief\n\n> YAML Parse Error\n\nAuto-fix was attempted but failed.\n\n## Original Error\n\n${errMsg}`, [], durationMs, {
                                errorSource: 'engine',
                                tokensIn: fixResult.tokensIn,
                                tokensOut: fixResult.tokensOut,
                                engine: current.engine,
                                errorCategory: categorizeError(parseErr),
                                });
                            updateSpecStatus(current.specFile, 'review');
                            failed++;
                            item = dequeue();
                            continue;
                        }
                    }
                    const targetDir = bridge.apps_dir
                        ? resolve(project.path, bridge.apps_dir, spec.target.app)
                        : resolve(project.path, spec.target.app);

                    const result = await withRetry(
                        () => (current.engine === 'minions')
                            ? runMinionsFeatureBuild(spec, context, targetDir)
                            : runFeaturePipeline(spec, context),
                        { maxAttempts: 3, delayMs: 5000, name: 'Feature Pipeline' }
                    );

                    if (current.engine !== 'minions') {
                        writeFiles(targetDir, result.files);
                        setupProject(targetDir, bridge.stack?.packageManager);
                    }

                    // Knowledge feedback + AGENTS.md
                    const featureStack = bridge.stack || { framework: 'unknown', packageManager: 'npm' };
                    const featureKbName = `${spec.target.app}--${spec.feature.slug}`;
                    writeKnowledgeEntry(project.path, featureKbName, result, featureStack, current.specFile);
                    writeAppAgentsMd(targetDir, spec.feature.name, featureStack, result.files);

                    const durationMs = Date.now() - startTime;
                    const featureSummary = buildDebrief(spec.feature.name, result, featureStack, current.specFile, durationMs);

                    if (result.success) {
                        markCompleted(current.id, `${result.files.length} files generated`, durationMs);
                        logBuild(current.specFile, 'FeatureSpec', 'completed', featureSummary, result.files.map(f => f.filename), durationMs, {
                            model: result.model,
                            provider: result.provider,
                            engine: current.engine,
                            tokensIn: result.tokenUsage?.promptTokens,
                            tokensOut: result.tokenUsage?.completionTokens,
                        });
                        updateSpecStatus(current.specFile, 'done');
                        archiveSpec(current.specFile);
                        gitCommit(project.path, `factory: add feature ${spec.feature.name} to ${spec.target.app}`);
                        succeeded++;
                    } else {
                        markFailed(
                            current.id,
                            result.errors?.join('; ') || 'Feature build had errors',
                            `${result.files.length} files generated with errors`,
                            durationMs
                        );
                        logBuild(current.specFile, 'FeatureSpec', 'failed', featureSummary, result.files.map(f => f.filename), durationMs, {
                            model: result.model,
                            provider: result.provider,
                            engine: current.engine,
                            tokensIn: result.tokenUsage?.promptTokens,
                            tokensOut: result.tokenUsage?.completionTokens,
                            errorSource: 'engine',
                        });
                        updateSpecStatus(current.specFile, 'review');
                        failed++;
                    }
                } else {
                    // App build — full pipeline
                    const spec = loadSpec(current.specFile);
                    const validation = validateSpec(spec);

                    if (!validation.passed) {
                        // Try LLM auto-fix on the spec
                        log('⚠', `AppSpec validation failed: ${validation.errors.join(', ')}`);
                        const specAbsPath = resolve(current.specFile);
                        const fixResult = await withRetry(
                            () => autoFixSpec(specAbsPath, `Validation errors: ${validation.errors.join('; ')}`),
                            { maxAttempts: 3, delayMs: 2000, name: 'Auto-fix' }
                        );

                        if (fixResult.fixed) {
                            // Retry validation with fixed spec
                            try {
                                const fixedSpec = loadSpec(current.specFile);
                                const reValidation = validateSpec(fixedSpec);
                                if (reValidation.passed) {
                                    log('✓', `AppSpec auto-fixed and re-validated: ${current.specFile}`);
                                    // Replace spec variable and continue with the pipeline
                                    Object.assign(spec, fixedSpec);
                                } else {
                                    const durationMs = Date.now() - startTime;
                                    markFailed(current.id, `Validation still fails after auto-fix: ${reValidation.errors.join(', ')}`, '', durationMs);
                                    logBuild(current.specFile, 'AppSpec', 'failed', `# Build Debrief\n\n> Validation failed (auto-fix didn't resolve)\n\n## Issues\n\n${reValidation.errors.map(e => `- ${e}`).join('\n')}`, [], durationMs, {
                                        errorSource: 'engine',
                                        tokensIn: fixResult.tokensIn,
                                        tokensOut: fixResult.tokensOut,
                                        engine: current.engine,
                                        errorCategory: categorizeError(reValidation.errors),
                                        });
                                    updateSpecStatus(current.specFile, 'review');
                                    failed++;
                                    item = dequeue();
                                    continue;
                                }
                            } catch {
                                const durationMs = Date.now() - startTime;
                                markFailed(current.id, `Auto-fix broke the spec further`, '', durationMs);
                                logBuild(current.specFile, 'AppSpec', 'failed', `# Build Debrief\n\n> Auto-fix produced invalid YAML`, [], durationMs, {
                                    errorSource: 'engine',
                                });
                                updateSpecStatus(current.specFile, 'review');
                                failed++;
                                item = dequeue();
                                continue;
                            }
                        } else {
                            const durationMs = Date.now() - startTime;
                            markFailed(current.id, `Validation failed (auto-fix exhausted): ${validation.errors.join(', ')}`, '', durationMs);
                            logBuild(current.specFile, 'AppSpec', 'failed', `# Build Debrief\n\n> Validation failed\n\nAuto-fix was attempted but failed.\n\n## Issues\n\n${validation.errors.map(e => `- ${e}`).join('\n')}`, [], durationMs, {
                                errorSource: 'engine',
                                tokensIn: fixResult.tokensIn,
                                tokensOut: fixResult.tokensOut,
                                engine: current.engine,
                                errorCategory: categorizeError(validation.errors),
                                });
                            updateSpecStatus(current.specFile, 'review');
                            failed++;
                            item = dequeue();
                            continue;
                        }
                    }

                    // Mark as validating
                    updateSpecStatus(current.specFile, 'validation');

                    const slug = specSlug(spec);
                    const targetDir = bridge.apps_dir
                        ? resolve(project.path, bridge.apps_dir, slug)
                        : resolve(project.path, slug);

                    const result = await withRetry(
                        () => (current.engine === 'minions')
                            ? runMinionsBuild(spec, context)
                            : runPipeline(spec, context),
                        { maxAttempts: 3, delayMs: 5000, name: 'App Pipeline' }
                    );

                    if (current.engine !== 'minions') {
                        writeFiles(targetDir, result.files);
                        setupProject(targetDir, spec.stack.packageManager);
                    }

                    // Knowledge feedback + AGENTS.md
                    writeKnowledgeEntry(project.path, spec.appName, result, spec.stack, current.specFile);
                    writeAppAgentsMd(targetDir, spec.appName, spec.stack, result.files);

                    const durationMs = Date.now() - startTime;
                    const fileNames = result.files.map(f => f.filename);

                    const appSummary = buildDebrief(spec.appName, result, spec.stack, current.specFile, durationMs);

                    if (result.success) {
                        markCompleted(current.id, `${result.files.length} files, ${result.iterations} iteration(s)`, durationMs);
                        logBuild(current.specFile, 'AppSpec', 'completed', appSummary, fileNames, durationMs, {
                            model: result.model,
                            provider: result.provider,
                            engine: current.engine,
                            tokensIn: result.tokenUsage?.promptTokens,
                            tokensOut: result.tokenUsage?.completionTokens,
                        });
                        updateSpecStatus(current.specFile, 'done');
                        gitCommit(project.path, `factory: generate ${spec.appName}`);

                        // Write build metadata + archive spec
                        updateSpecBuildMeta(current.specFile, {
                            outputDir: targetDir,
                            filesGenerated: result.files.length,
                            iterations: result.iterations,
                            taskType: result.plan.decisions[0] || 'unknown',
                        }, project.path);
                        archiveSpec(current.specFile);
                        succeeded++;
                    } else {
                        markFailed(
                            current.id,
                            result.errors?.join('; ') || 'Build had warnings',
                            `${result.files.length} files generated with errors`,
                            durationMs
                        );
                        logBuild(current.specFile, 'AppSpec', 'failed', appSummary, fileNames, durationMs, {
                            model: result.model,
                            provider: result.provider,
                            engine: current.engine,
                            tokensIn: result.tokenUsage?.promptTokens,
                            tokensOut: result.tokenUsage?.completionTokens,
                            errorSource: 'engine',
                        });
                        updateSpecStatus(current.specFile, 'review');
                        failed++;
                    }
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                const durationMs = Date.now() - startTime;
                const category = categorizeError(error);
                markFailed(current.id, msg, '', durationMs, category);
                logBuild(current.specFile, current.kind, 'failed', `# Build Debrief\n\n> Build failed\n\n## Error\n\n${msg}`, [], durationMs, {
                    errorSource: msg.includes('API error') || msg.includes('returned empty') ? 'llm' : 'engine',
                    engine: current.engine,
                    errorCategory: category,
                });
                updateSpecStatus(current.specFile, 'review');
                logError(`Failed: ${msg}`);
                failed++;
            }

            // Dequeue the next one — keep going
            item = dequeue();
        }

        // Check for specs blocked by dependencies
        const remainingStats = getQueueStats();
        if (remainingStats.pending > 0) {
            console.log('');
            log('!', `${remainingStats.pending} spec(s) still pending — blocked by unmet dependencies:`);
            const allItems = listQueue();
            for (const blocked of allItems.filter(i => i.status === 'pending')) {
                const unmetDeps = blocked.dependsOn.filter(dep => !areDependenciesMet([dep]));
                if (unmetDeps.length > 0) {
                    log('  ', `  ⏳ ${blocked.specFile} — waiting for: ${unmetDeps.join(', ')}`);
                }
            }
        }

        // Push all changes at once at the end
        if (succeeded > 0) {
            log('●', 'Pushing all changes...');
            gitPush(project.path);
        }
    } finally {
        clearInterval(heartbeatTimer);
        setQueueRunning(false);
        closeDb();
    }

    // Summary
    console.log('');
    console.log('═'.repeat(50));
    log('✓', `Autonomous build complete`);
    log('→', `Processed: ${processed}`);
    log('→', `Succeeded: ${succeeded}`);
    log('→', `Failed:    ${failed}`);
    console.log('');
}

// ─── Helpers ─────────────────────────────────────────────

function requireTarget(cmd: string): void {
    if (!target) {
        console.error(`Usage: factory ${cmd} <spec.yaml>`);
        process.exit(1);
    }
}

function parseFlags(flagArgs: string[]): Record<string, string> {
    const flags: Record<string, string> = {};
    for (let i = 0; i < flagArgs.length; i += 2) {
        const key = flagArgs[i]?.replace(/^--/, '');
        const val = flagArgs[i + 1];
        if (key && val) flags[key] = val;
    }
    return flags;
}

function printUsage(): void {
    console.log(`
Usage: factory <command> [options]

Commands:
  build <spec.yaml> [--engine minions]   Full pipeline (or minions engine)
  validate <spec.yaml>       Validate a spec
  status                     Show spec statuses
  sync <repo-path>           Sync .factory from repo
  init-bridge <repo-path>    Init .factory bridge in repo

  start                      Start the Factory UI background service
  stop                       Stop the Factory UI background service
  restart                    Restart the Factory UI background service

  project add <repo-path>    Connect a repo
  project list               List connected repos
  project switch <id>        Switch active project
  project remove <id>        Disconnect a repo

  feature build <spec.yaml> [--engine minions]  Build a feature
  feature validate <spec.yaml>  Validate a feature spec

  queue list                    List all queue items
  queue add <spec.yaml> [--engine minions]  Add to queue
  queue start                   Process all pending items autonomously
  queue stats                   Show queue statistics
  queue clear                   Clear completed items
  queue retry <id>              Retry a failed item
  queue remove <id>             Remove an item from queue
`);
}

// ─── Service Management ──────────────────────────────────

function handleStart(): void {
    import('node:child_process').then(({ spawn }) => {
        import('node:fs').then(({ writeFileSync, readFileSync, openSync }) => {
            import('./config.ts').then(({ FACTORY_ROOT }) => {
                const uiServer = resolve(FACTORY_ROOT, 'ui', 'server.js');
                const pidFile = resolve(FACTORY_ROOT, 'ui.pid');

                if (!existsSync(uiServer)) {
                    logError(`UI server not found at ${uiServer}`);
                    logError('Have you run install.sh yet?');
                    process.exit(1);
                }

                if (existsSync(pidFile)) {
                    try {
                        const oldPid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
                        process.kill(oldPid, 0); // Check if process exists
                        log('!', `Factory UI is already running (PID: ${oldPid})`);
                        process.exit(0);
                    } catch {
                        // Process doesn't exist, stale PID file
                    }
                }

                logHeader('Starting Factory UI...');
                
                const out = openSync(resolve(FACTORY_ROOT, 'ui.log'), 'a');
                const err = openSync(resolve(FACTORY_ROOT, 'ui.err'), 'a');

                const child = spawn(process.execPath, [uiServer], {
                    cwd: resolve(FACTORY_ROOT, 'ui'),
                    detached: true,
                    stdio: ['ignore', out, err],
                    env: { ...process.env, PORT: '11498' }
                });

                if (child.pid) {
                    writeFileSync(pidFile, child.pid.toString(), 'utf8');
                }
                
                child.unref();

                log('✓', `Started Factory UI background service (PID: ${child.pid})`);
                log('→', 'Dashboard available at http://localhost:11498');
                console.log('');
            });
        });
    });
}

function handleStop(): void {
    import('node:fs').then(({ existsSync, readFileSync, unlinkSync }) => {
        import('./config.ts').then(({ FACTORY_ROOT }) => {
            const pidFile = resolve(FACTORY_ROOT, 'ui.pid');

            if (!existsSync(pidFile)) {
                log('!', 'Factory UI is not running (no PID file found)');
                return;
            }

            try {
                const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
                process.kill(pid, 'SIGINT');
                log('✓', `Stopped Factory UI (PID: ${pid})`);
            } catch (e) {
                log('!', `Process might already be dead (${(e as Error).message})`);
            } finally {
                unlinkSync(pidFile);
            }
        });
    });
}

// ─── CLI Facade Handlers (us_004) ────────────────────────

/** Spawn a script with remaining CLI args, passing through stdout/stderr */
function spawnScript(scriptPath: string, scriptArgs: string[]): void {
    if (!existsSync(scriptPath)) {
        logError(`Script not found: ${scriptPath}`);
        process.exit(1);
    }
    const child = spawn(scriptPath, scriptArgs, {
        stdio: 'inherit',
        env: {
            ...process.env,
            FACTORY_PROJECT_ROOT: process.env.FACTORY_PROJECT_ROOT || process.cwd(),
        },
    });
    child.on('close', (code: number | null) => {
        process.exit(code ?? 0);
    });
}

/** factory pulse "<msg>" — write heartbeat */
function handlePulse(): void {
    const script = resolveScript('heartbeat/pulse.sh');
    const msg = args.slice(1).join(' ') || 'pulse';
    spawnScript(script, [msg]);
}

/** factory task <list|start|complete|add> [args...] — manage tasks */
function handleTask(): void {
    const script = resolve(process.cwd(), '.factory/task-manager/manage.sh');
    const subcommand = args[1];
    if (!subcommand) {
        console.error('Usage: factory task <list|start|complete|add> [args...]');
        process.exit(1);
    }
    const todoYaml = resolve(process.cwd(), '.factory/task-manager/todo.yaml');
    const todoToon = resolve(process.cwd(), '.factory/task-manager/todo.toon');
    const env = {
        ...process.env,
        FACTORY_PROJECT_ROOT: process.env.FACTORY_PROJECT_ROOT || process.cwd(),
        TASKS_FILE: existsSync(todoYaml) ? todoYaml : todoToon,
    };
    const child = spawn(script, args.slice(1), {
        stdio: 'inherit',
        env,
    });
    child.on('close', (code: number | null) => {
        process.exit(code ?? 0);
    });
}

/** factory context update "<msg>" — append to worklog */
function handleContext(): void {
    const subcommand = args[1];
    if (!subcommand || subcommand !== 'update') {
        console.error('Usage: factory context update "<message>"');
        process.exit(1);
    }
    const script = resolveScript('auto-context/update-context.sh');
    const msg = args.slice(2).join(' ') || 'context update';
    spawnScript(script, [msg]);
}

/** factory compress — compress worklog */
function handleCompress(): void {
    const script = resolveScript('compress-worklog/compress.sh');
    spawnScript(script, []);
}

/** factory minions [--queue <file>] [options...] — run minions queue */
function handleMinions(): void {
    const script = resolveScript('minions/scripts/minions');
    spawnScript(script, args.slice(1));
}

/** factory hooks install — install git hooks into the active/target project */
function handleHooks(): void {
    const subcommand = args[1];
    if (!subcommand || subcommand !== 'install') {
        console.error('Usage: factory hooks install');
        process.exit(1);
    }

    // Prefer the active project root, fallback to cwd
    let projectRoot = process.cwd();
    try {
        const project = getActiveProject();
        projectRoot = project.path;
    } catch { /* no active project, use cwd */ }

    installGitHooks(projectRoot);
}

/** Install git hooks into a project directory. */
function installGitHooks(projectRoot: string): void {
    const gitDir = join(projectRoot, '.git');
    if (!existsSync(gitDir)) {
        log('!', `No .git directory in ${projectRoot} — skipping hooks`);
        return;
    }

    const hooksDir = join(gitDir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    // post-commit hook — writes heartbeat + appends worklog entry
    const postCommit = join(hooksDir, 'post-commit');
    const factoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const pulseScript = join(factoryRoot, 'factory', 'scripts', 'heartbeat', 'pulse.sh');
    const contextScript = join(factoryRoot, 'factory', 'scripts', 'auto-context', 'update-context.sh');

    const hookContent = [
        '#!/usr/bin/env bash',
        '# Factory post-commit hook — auto-generated by factory hooks install',
        `export FACTORY_PROJECT_ROOT="${projectRoot}"`,
        `COMMIT_MSG=$(git log -1 --pretty=%B 2>/dev/null || echo 'commit')`,
        `CHANGED=$(git diff-tree --no-commit-id -r --name-only HEAD 2>/dev/null | tr '\n' ', ' | sed 's/,$//') `,
        existsSync(pulseScript)  ? `bash "${pulseScript}" "post-commit: $COMMIT_MSG"` : '',
        existsSync(contextScript) ? `bash "${contextScript}" "committed: $COMMIT_MSG FILES:$CHANGED"` : '',
        '',
    ].filter(l => l !== null).join('\n');

    writeFileSync(postCommit, hookContent);
    try { execSync(`chmod +x "${postCommit}"`); } catch { /* ignore */ }

    log('✓', `Git hooks installed in ${projectRoot}`);
    log('→', 'post-commit: heartbeat + worklog auto-updated on every commit');
}


// ─── Run ─────────────────────────────────────────────────

main().catch(err => {
    logError(err.message || String(err));
    process.exit(1);
});

// ─── Daemon Management ───────────────────────────────────

/**
 * Handle daemon start/stop/status/restart commands.
 */
async function handleDaemon(command?: string): Promise<void> {
    const pidFile = join(process.cwd(), '.factory', 'daemon.pid');

    switch (command) {
        case 'start': {
            if (existsSync(pidFile)) {
                const oldPid = parseInt(readFileSync(pidFile, 'utf-8'));
                try {
                    process.kill(oldPid, 0);
                    log('!', `Daemon already running (PID ${oldPid})`);
                    process.exit(0);
                } catch {
                    // Old PID is stale, continue
                }
            }

            // Spawn queue.ts in daemon mode (not a separate daemon.ts file)
            const child = spawn('npx', ['tsx', 'engine/cli.ts', 'queue', 'daemon'], {
                detached: true,
                stdio: 'ignore',
                cwd: dirname(dirname(fileURLToPath(import.meta.url))),
            });

            writeFileSync(pidFile, String(child.pid));
            child.unref();
            log('✓', `Daemon started (PID ${child.pid})`);
            break;
        }

        case 'stop': {
            if (!existsSync(pidFile)) {
                logError('No daemon running (no PID file)');
                process.exit(1);
            }
            const pid = parseInt(readFileSync(pidFile, 'utf-8'));
            try {
                process.kill(pid, 'SIGTERM');
                log('✓', `Daemon stopped (PID ${pid})`);
            } catch {
                logError(`Failed to stop daemon (PID ${pid})`);
            }
            break;
        }

        case 'status': {
            if (!existsSync(pidFile)) {
                log('  ', 'Daemon: stopped');
                break;
            }
            const pid = parseInt(readFileSync(pidFile, 'utf-8'));
            try {
                process.kill(pid, 0);
                log('✓', `Daemon: running (PID ${pid})`);
            } catch {
                log('✗', 'Daemon: stalled (PID file exists but process dead)');
            }
            break;
        }

        case 'restart': {
            log('●', 'Restarting daemon...');
            const pid = parseInt(readFileSync(pidFile, 'utf-8'));
            try { process.kill(pid, 'SIGTERM'); } catch { /* Ignore */ }

            const child = spawn('npx', ['tsx', 'engine/cli.ts', 'queue', 'daemon'], {
                detached: true,
                stdio: 'ignore',
                cwd: dirname(dirname(fileURLToPath(import.meta.url))),
            });
            writeFileSync(pidFile, String(child.pid));
            child.unref();
            log('✓', `Daemon restarted (PID ${child.pid})`);
            break;
        }

        case 'install': {
            // Install as macOS launchd service (auto-start on login)
            const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.factory.daemon.plist');
            const factoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
            const plist = [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
                '<plist version="1.0">',
                '<dict>',
                '    <key>Label</key>',
                '    <string>com.factory.daemon</string>',
                '    <key>ProgramArguments</key>',
                '    <array>',
                '        <string>/usr/local/bin/npx</string>',
                '        <string>tsx</string>',
                `        <string>${join(factoryRoot, 'engine', 'cli.ts')}</string>`,
                '        <string>queue</string>',
                '        <string>daemon</string>',
                '    </array>',
                '    <key>WorkingDirectory</key>',
                `    <string>${factoryRoot}</string>`,
                '    <key>EnvironmentVariables</key>',
                '    <dict>',
                `        <key>FACTORY_PROJECT_ROOT</key>`,
                `        <string>${factoryRoot}</string>`,
                '    </dict>',
                '    <key>RunAtLoad</key>',
                '    <true/>',
                '    <key>KeepAlive</key>',
                '    <true/>',
                '    <key>StandardOutPath</key>',
                `    <string>${join(factoryRoot, '.factory', 'daemon.log')}</string>`,
                '    <key>StandardErrorPath</key>',
                `    <string>${join(factoryRoot, '.factory', 'daemon.err')}</string>`,
                '</dict>',
                '</plist>',
            ].join('\n');

            mkdirSync(dirname(plistPath), { recursive: true });
            writeFileSync(plistPath, plist);

            try {
                execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
                log('✓', `Daemon installed as launchd service`);
                log('→', `Plist: ${plistPath}`);
                log('→', 'Daemon will auto-start on login. Run: factory daemon status');
            } catch (e) {
                log('✓', `Plist written: ${plistPath}`);
                log('!', `launchctl load failed (may need sudo): ${e}`);
                log('→', `To activate manually: launchctl load "${plistPath}"`);
            }
            break;
        }

        case 'uninstall': {
            const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.factory.daemon.plist');
            if (!existsSync(plistPath)) {
                log('!', 'launchd plist not found — daemon was not installed as a service');
                break;
            }
            try {
                execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
            } catch { /* ignore */ }
            try { execSync(`rm "${plistPath}"`, { stdio: 'pipe' }); } catch { /* ignore */ }
            log('✓', 'Daemon service uninstalled');
            break;
        }

        default:
            logError(`Unknown daemon command: ${command}. Use: start|stop|status|restart`);
            process.exit(1);
    }
}

// ─── Spec Watcher ─────────────────────────────────────────

/**
 * Handle spec watch command — watches specs directory for new YAML files.
 */
async function handleWatch(watchDir?: string): Promise<void> {
    if (!watchDir) {
        logError('Usage: factory queue watch <dir>');
        process.exit(1);
    }

    const { watch } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { resolve } = await import('node:path');

    const resolvedDir = resolve(watchDir);
    if (!existsSync(resolvedDir)) {
        logError(`Directory not found: ${resolvedDir}`);
        process.exit(1);
    }

    log('●', `Watching specs directory: ${resolvedDir}`);

    const watcher = watch(resolvedDir, { persistent: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.yaml')) return;
        if (eventType === 'rename' || eventType === 'change') {
            const specPath = join(resolvedDir, filename);
            log('→', `New spec detected: ${filename}`);
            // Auto-add to queue
            try {
                const { enqueue } = require('./queue.ts');
                enqueue(specPath, 'AppSpec');
                log('✓', `Enqueued: ${filename}`);
            } catch (error) {
                logError(`Failed to enqueue: ${error}`);
            }
        }
    });

    log('✓', `Spec watcher started (press Ctrl+C to stop)`);

    process.on('SIGTERM', () => {
        watcher.close();
        log('✓', 'Spec watcher stopped');
    });
    process.on('SIGINT', () => {
        watcher.close();
        process.exit(0);
    });
}
