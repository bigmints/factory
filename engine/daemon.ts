#!/usr/bin/env node

/**
 * engine/daemon.ts — Queue daemon entry point.
 * 
 * Separate file so the daemon can be spawned as a detached process
 * without importing the entire cli.ts. The daemon loop polls SQLite
 * every 30s for new items and processes them with auto-retry.
 * 
 * Usage: npx tsx engine/daemon.ts
 */

import { startQueueDaemon } from './queue';

// Heartbeat before starting
import { writeHeartbeat } from './toon';
import { join } from 'node:path';

try {
    writeHeartbeat('factory', 'daemon-starting');
} catch {
    // Ignore heartbeat errors
}

// Run the daemon loop
startQueueDaemon().catch((error) => {
    console.error('Daemon crashed:', error);
    process.exit(1);
});
