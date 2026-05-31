/**
 * Health & Self-Healing — monitoring and recovery for the factory engine.
 */

import { timestamp, updateItem, loadQueue, loadQueueState, saveQueueState } from './queue.ts';
import { log } from './log.ts';

/**
 * Audit the engine state on startup.
 * 1. If is_running is true but no heartbeat recently, set it to false.
 * 2. Find any tasks stuck in 'running' and reset them to 'pending'.
 */
export async function performStateAudit(): Promise<void> {
    // 1. Check for stale is_running flag
    const state = loadQueueState();
    
    if (state.is_running && state.last_heartbeat_at) {
        const lastHbTime = new Date(state.last_heartbeat_at).getTime();
        const now = Date.now();
        const HEARTBEAT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
        
        if (now - lastHbTime > HEARTBEAT_TIMEOUT) {
            log('🔧', 'Detected stale queue runner (no heartbeat) — resetting state');
            state.is_running = false;
            saveQueueState(state);
        }
    }

    // 2. Find zombie tasks ('running' but runner isn't active)
    const queue = loadQueue();
    const runningTasks = queue.filter(item => item.status === 'building');
    
    if (runningTasks.length > 0) {
        log('🔧', `Found ${runningTasks.length} interrupted task(s) — resetting to pending`);
        for (const task of runningTasks) {
            await updateItem(task.id, { 
                status: 'ready-to-build', 
                startedAt: null, 
                error: 'Interrupted by process exit' 
            });
            log('↻', `  Reset: ${task.storyFile}`);
        }
    }
}

/**
 * Update the heartbeat timestamp in the database.
 */
export function updateHeartbeat(): void {
    const state = loadQueueState();
    state.last_heartbeat_at = timestamp();
    saveQueueState(state);
}

/**
 * Categorize an error into 'transient' (retryable) or 'permanent'.
 */
export function categorizeError(error: any): 'transient' | 'permanent' {
    const msg = String(error).toLowerCase();
    
    // Transient errors: Rate limits, timeouts, temporary network issues
    if (
        msg.includes('429') || 
        msg.includes('rate limit') || 
        msg.includes('timeout') || 
        msg.includes('connection reset') || 
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('503') ||
        msg.includes('service unavailable')
    ) {
        return 'transient';
    }
    
    return 'permanent';
}

/**
 * Wrap a function with retry logic for transient errors.
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: { maxAttempts: number; delayMs: number; name: string } = { maxAttempts: 3, delayMs: 5000, name: 'Operation' }
): Promise<T> {
    let lastErr: any;
    
    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const category = categorizeError(err);
            
            if (category === 'transient' && attempt < opts.maxAttempts) {
                const wait = opts.delayMs * attempt;
                log('⏳', `${opts.name} failed (transient): ${String(err).slice(0, 100)}...`);
                log('→', `  Attempt ${attempt}/${opts.maxAttempts} — Retrying in ${wait/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, wait));
                continue;
            }
            
            throw err;
        }
    }
    
    throw lastErr;
}
