/**
 * Queue management handlers: list, add, start, stats, clear, retry, remove.
 * Also handles daemon and story watcher.
 */

import { resolve, dirname, join, basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { loadStory, loadFeatureStory, validateStory, updateStoryStatus, updateStoryBuildMeta, archiveStory } from '../story.ts';
import { getActiveProject, loadBridgeConfig } from '../config.ts';
import { gatherBlueprint } from '../blueprint.ts';
import { runPipeline, runFeaturePipeline } from '../generate.ts';
import { gitCommit, gitPush, buildDebrief } from '../writer.ts';
import { log, logHeader, logError } from '../log.ts';
import { storySlug } from '../types.ts';
import { updateStoryStatusInApp } from '../rollup.ts';
import {
    enqueue, dequeue, listQueue, getQueueStats,
    markRunning, markCompleted, markFailed,
    removeItem, clearCompleted, retryItem,
    isQueueRunning, setQueueRunning, areDependenciesMet,
    loadQueue,
} from '../queue.ts';
import { closeDb, logBuild } from '../db.ts';
import { performStateAudit, updateHeartbeat, categorizeError } from '../health.ts';
import { args, parseFlags } from '../cli.ts';

export async function handleQueue(subcommand?: string, arg?: string): Promise<void> {
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
                    const icon = item.status === 'done' ? '✅'
                        : item.status === 'building' ? '🔄'
                        : item.status === 'failed' ? '❌'
                        : '⏳';
                    const phaseTag = item.phase ? ` [P${item.phase}]` : '';
                    const depsTag = item.dependsOn.length > 0
                        ? ` ← depends on: ${item.dependsOn.join(', ')}` : '';
                    const depsMetTag = item.dependsOn.length > 0 && item.status === 'ready-to-build'
                        ? (areDependenciesMet(item.dependsOn) ? ' ✅deps met' : ' ⏳deps ready-to-build')
                        : '';
                    log('  ', `${icon} [${item.id}] ${item.storyFile} (${item.kind})${phaseTag} — ${item.status}${depsMetTag}`);
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
            if (!arg) { console.error('Usage: factory queue add <story.yaml>'); process.exit(1); }
            const storyPath = resolve(arg);
            if (!existsSync(storyPath)) {
                logError(`Story file not found: ${storyPath}`);
                process.exit(1);
            }

            // Detect kind and parse phase/dependsOn/engine
            let kind: 'AppStory' | 'FeatureStory' = 'AppStory';
            let phase: number | undefined;
            let dependsOn: string[] | undefined;
            let storyEngine: 'factory' | 'worker' | undefined;
            try {
                const fStory = loadFeatureStory(storyPath);
                if (fStory.feature) {
                    kind = 'FeatureStory';
                    phase = fStory.phase;
                    dependsOn = fStory.dependsOn;
                    storyEngine = fStory.engine;
                } else {
                    const aStory = loadStory(storyPath);
                    kind = 'AppStory';
                    storyEngine = aStory.engine;
                }
            } catch {
                try {
                    const aStory = loadStory(storyPath);
                    storyEngine = aStory.engine;
                } catch { /* assume AppStory */ }
            }

            // Detect engine flag from CLI args
            const queueFlags = parseFlags(args.slice(3));
            const engine = (queueFlags.engine || storyEngine || 'factory') === 'worker' ? 'worker' as const : 'factory' as const;

            const item = await enqueue(storyPath, kind, { phase, dependsOn, engine });
            const phaseInfo = phase ? ` [phase ${phase}]` : '';
            const depsInfo = dependsOn && dependsOn.length > 0 ? ` (depends on: ${dependsOn.join(', ')})` : '';
            const engineInfo = engine !== 'factory' ? ` [engine: ${engine}]` : '';
            log('✓', `Queued: ${item.storyFile} (${item.kind})${phaseInfo}${depsInfo}${engineInfo} → ${item.id}`);
            break;
        }

        case 'start': {
            return handleQueueStart();
        }

        case 'daemon': {
            return handleDaemon(arg);
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
            const removed = await clearCompleted();
            log('✓', `Cleared ${removed} completed item(s)`);
            break;
        }

        case 'retry': {
            if (!arg) { console.error('Usage: factory queue retry <id>'); process.exit(1); }
            const item = await retryItem(arg);
            if (item) {
                log('✓', `Reset to pending: ${item.storyFile}`);
            } else {
                logError(`Item not found: ${arg}`);
            }
            break;
        }

        case 'remove': {
            if (!arg) { console.error('Usage: factory queue remove <id>'); process.exit(1); }
            const removed = await removeItem(arg);
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
    await performStateAudit();

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
        const blueprint = gatherBlueprint(project.path, bridge);

        let item = await dequeue();

        while (item) {
            processed++;
            const startTime = Date.now();

            console.log('');
            const current = item; // capture for TS narrowing
            logHeader(`[${processed}] Processing: ${current.storyFile}`);
            await markRunning(current.id);

            // Set story status to in-progress
            updateStoryStatus(current.storyFile, 'building');
            await updateStoryStatusInApp(current.storyFile, 'building');

            try {
                if (current.kind === 'FeatureStory') {
                    // Feature build
                    const story = loadFeatureStory(current.storyFile);
                    // Fix stories created by TPM may have target: {} — fall back to project root
                    const targetApp = story.target?.app;
                    const targetDir = bridge.apps_dir && targetApp
                        ? resolve(project.path, bridge.apps_dir, targetApp)
                        : targetApp && targetApp !== project.name && targetApp !== basename(project.path)
                        ? resolve(project.path, targetApp)
                        : project.path;  // no apps_dir + no target.app → build in project root
                    
                    const result = await runFeaturePipeline(story, blueprint, targetDir, current.storyFile);

                    const durationMs = Date.now() - startTime;
                    const featureSummary = buildDebrief(story.feature.name, result, bridge.stack || { framework: 'unknown', packageManager: 'npm' }, current.storyFile, durationMs);

                    if (result.success) {
                        await markCompleted(current.id, `${result.files.length} files generated`, durationMs);
                        logBuild(current.storyFile, 'FeatureStory', 'completed', featureSummary, result.files.map(f => f.filename), durationMs, {
                            model: result.model,
                            provider: result.provider,
                            engine: current.engine,
                            tokensIn: result.tokenUsage?.promptTokens,
                            tokensOut: result.tokenUsage?.completionTokens,
                        });
                        updateStoryStatus(current.storyFile, 'done');
                        await updateStoryStatusInApp(current.storyFile, 'done');
                        archiveStory(current.storyFile);
                        const commitTarget = story.target?.app || story.feature.name || 'fix';
                        gitCommit(project.path, `factory: add feature ${story.feature.name} to ${commitTarget}`);
                        succeeded++;
                    } else {
                        await markFailed(
                            current.id,
                            result.errors?.join('; ') || 'Feature build had errors',
                            `${result.files.length} files generated with errors`,
                            durationMs
                        );
                        logBuild(current.storyFile, 'FeatureStory', 'failed', featureSummary, result.files.map(f => f.filename), durationMs, {
                            model: result.model,
                            provider: result.provider,
                            engine: current.engine,
                            tokensIn: result.tokenUsage?.promptTokens,
                            tokensOut: result.tokenUsage?.completionTokens,
                            errorSource: 'engine',
                        });
                        updateStoryStatus(current.storyFile, 'failed');
                        await updateStoryStatusInApp(current.storyFile, 'failed');
                        failed++;
                    }
                } else {
                    // App build — full pipeline
                    const story = loadStory(current.storyFile);
                    const validation = validateStory(story);

                    if (!validation.passed) {
                        const durationMs = Date.now() - startTime;
                        const errMsg = `Validation failed: ${validation.errors.join(', ')}`;
                        await markFailed(current.id, errMsg, '', durationMs);
                        updateStoryStatus(current.storyFile, 'failed');
                        await updateStoryStatusInApp(current.storyFile, 'failed');
                        failed++;
                        item = await dequeue();
                        continue;
                    }

                    // Mark as validating
                    updateStoryStatus(current.storyFile, 'building');
                    await updateStoryStatusInApp(current.storyFile, 'building');

                    const slug = storySlug(story);
                    const targetDir = bridge.apps_dir
                        ? resolve(project.path, bridge.apps_dir, slug)
                        : slug !== project.name && slug !== basename(project.path)
                        ? resolve(project.path, slug)
                        : project.path;

                    // Orchestrator writes files directly — no writeFiles() needed
                    const result = await runPipeline(story, blueprint, targetDir, current.storyFile);

                    const durationMs = Date.now() - startTime;
                    const fileNames = result.files.map(f => f.filename);

                    const appSummary = buildDebrief(story.appName, result, story.stack, current.storyFile, durationMs);

                    if (result.success) {
                        await markCompleted(current.id, `${result.files.length} files, ${result.iterations} iteration(s)`, durationMs);
                        logBuild(current.storyFile, 'AppStory', 'completed', appSummary, fileNames, durationMs, {
                            model: result.model,
                            provider: result.provider,
                            engine: current.engine,
                            tokensIn: result.tokenUsage?.promptTokens,
                            tokensOut: result.tokenUsage?.completionTokens,
                        });
                        updateStoryStatus(current.storyFile, 'done');
                        await updateStoryStatusInApp(current.storyFile, 'done');
                        gitCommit(project.path, `factory: generate ${story.appName}`);

                        // Write build metadata + archive story
                        updateStoryBuildMeta(current.storyFile, {
                            outputDir: targetDir,
                            filesGenerated: result.files.length,
                            iterations: result.iterations,
                            taskType: result.plan.decisions[0] || 'unknown',
                        }, project.path);
                        archiveStory(current.storyFile);
                        succeeded++;
                    } else {
                        await markFailed(
                            current.id,
                            result.errors?.join('; ') || 'Build had warnings',
                            `${result.files.length} files generated with errors`,
                            durationMs
                        );
                        logBuild(current.storyFile, 'AppStory', 'failed', appSummary, fileNames, durationMs, {
                            model: result.model,
                            provider: result.provider,
                            engine: current.engine,
                            tokensIn: result.tokenUsage?.promptTokens,
                            tokensOut: result.tokenUsage?.completionTokens,
                            errorSource: 'engine',
                        });
                        updateStoryStatus(current.storyFile, 'failed');
                        await updateStoryStatusInApp(current.storyFile, 'failed');
                        failed++;
                    }
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                const durationMs = Date.now() - startTime;
                const category = categorizeError(error);
                await markFailed(current.id, msg, '', durationMs, category);
                logBuild(current.storyFile, current.kind, 'failed', `# Build Debrief\n\n> Build failed\n\n## Error\n\n${msg}`, [], durationMs, {
                    errorSource: msg.includes('API error') || msg.includes('returned empty') ? 'llm' : 'engine',
                    engine: current.engine,
                    errorCategory: category,
                });
                updateStoryStatus(current.storyFile, 'failed');
                await updateStoryStatusInApp(current.storyFile, 'failed');
                logError(`Failed: ${msg}`);
                failed++;
            }

            // Dequeue the next one — keep going
            item = await dequeue();
        }

        // Check for stories blocked by dependencies
        const remainingStats = getQueueStats();
        if (remainingStats['ready-to-build'] > 0) {
            console.log('');
            log('!', `${remainingStats['ready-to-build']} story/stories still ready-to-build — blocked by unmet dependencies:`);
            const allItems = listQueue();
            for (const blocked of allItems.filter(i => i.status === 'ready-to-build')) {
                const unmetDeps = blocked.dependsOn.filter(dep => !areDependenciesMet([dep]));
                if (unmetDeps.length > 0) {
                    log('  ', `  ⏳ ${blocked.storyFile} — waiting for: ${unmetDeps.join(', ')}`);
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

/**
 * Handle daemon start/stop/status/restart commands.
 */
export async function handleDaemon(command?: string): Promise<void> {
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

/**
 * Handle story watch command — watches stories directory for new YAML files.
 */
export async function handleWatch(watchDir?: string): Promise<void> {
    if (!watchDir) {
        logError('Usage: factory queue watch <dir>');
        process.exit(1);
    }

    const { watch } = await import('node:fs');
    const resolvedDir = resolve(watchDir);
    if (!existsSync(resolvedDir)) {
        logError(`Directory not found: ${resolvedDir}`);
        process.exit(1);
    }

    log('●', `Watching stories directory: ${resolvedDir}`);

    const watcher = watch(resolvedDir, { persistent: true }, async (eventType, filename) => {
        if (!filename || !filename.endsWith('.yaml')) return;
        if (eventType === 'rename' || eventType === 'change') {
            log('→', `New story detected: ${filename}`);
            // Auto-add to queue
            try {
                const storyPath = join(resolvedDir, filename);
                let kind: 'AppStory' | 'FeatureStory' = 'AppStory';
                try {
                    const loaded = loadStory(storyPath);
                    if (loaded && loaded.appName) kind = 'AppStory';
                } catch {
                    try {
                        const loaded = loadFeatureStory(storyPath);
                        if (loaded && loaded.feature) kind = 'FeatureStory';
                    } catch { /* default to AppStory */ }
                }
                await enqueue(storyPath, kind);
                log('✓', `Enqueued ${kind}: ${filename}`);
            } catch (error) {
                logError(`Failed to enqueue: ${error}`);
            }
        }
    });

    log('✓', `Story watcher started (press Ctrl+C to stop)`);

    process.on('SIGTERM', () => {
        watcher.close();
        log('✓', 'Spec watcher stopped');
    });
    process.on('SIGINT', () => {
        watcher.close();
        process.exit(0);
    });
}
