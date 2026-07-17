import { resolve } from 'node:path';
import { getActiveProject } from '../config.ts';
import { reconcileProjectDeliveries, reconcileStoryDelivery } from '../delivery.ts';
import { log, logError, logHeader } from '../log.ts';

export function handleDelivery(subcommand?: string, storyPath?: string): void {
    const project = getActiveProject();
    if (subcommand !== 'reconcile') {
        logError('Usage: factory delivery reconcile [story.md]');
        process.exitCode = 1;
        return;
    }
    logHeader('Delivery Reconciliation');
    const results = storyPath
        ? [reconcileStoryDelivery(project.path, resolve(project.path, '.factory', 'stories', storyPath))]
        : reconcileProjectDeliveries(project.path);
    for (const result of results.filter(item => item.action !== 'none')) {
        log(result.action === 'merged' ? '✓' : '→', `${result.action}: ${result.detail}`);
    }
    if (results.every(item => item.action === 'none')) log('✓', 'No delivery state changes required.');
}
