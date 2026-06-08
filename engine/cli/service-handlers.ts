/**
 * Service management handlers (start/stop UI background service).
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { log, logHeader, logError } from '../log.ts';

export function handleStart(): void {
    import('node:child_process').then(({ spawn }) => {
        import('node:fs').then(({ writeFileSync, readFileSync, openSync }) => {
            import('../config.ts').then(({ FACTORY_ROOT }) => {
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

export function handleStop(): void {
    import('node:fs').then(({ existsSync, readFileSync, unlinkSync }) => {
        import('../config.ts').then(({ FACTORY_ROOT }) => {
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
