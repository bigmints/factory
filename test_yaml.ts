import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';

const FACTORY_ROOT = resolve(homedir(), '.factory');
const QUEUE_YAML = resolve(FACTORY_ROOT, 'queue.yaml');
const APP_STORIES_DIR = '/Users/pretheesh/Projects/simpleapp/.factory/stories/apps';
const FEATURE_STORIES_DIR = '/Users/pretheesh/Projects/simpleapp/.factory/stories/features';

function test() {
  console.log("=== QUEUE ITEMS ===");
  if (existsSync(QUEUE_YAML)) {
    const queue = parseYaml(readFileSync(QUEUE_YAML, 'utf-8'));
    console.log(JSON.stringify(queue, null, 2));
  } else {
    console.log("Queue file not found");
  }

  console.log("=== PHYSICAL APP STORIES ===");
  if (existsSync(APP_STORIES_DIR)) {
    const files = readdirSync(APP_STORIES_DIR);
    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const raw = readFileSync(resolve(APP_STORIES_DIR, file), 'utf-8');
        const parsed = parseYaml(raw);
        console.log(`- File: ${file}`);
        console.log(JSON.stringify(parsed, null, 2));
      }
    }
  }

  console.log("=== PHYSICAL FEATURE STORIES ===");
  if (existsSync(FEATURE_STORIES_DIR)) {
    const files = readdirSync(FEATURE_STORIES_DIR);
    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const raw = readFileSync(resolve(FEATURE_STORIES_DIR, file), 'utf-8');
        const parsed = parseYaml(raw);
        console.log(`- File: ${file}`);
        console.log(JSON.stringify(parsed, null, 2));
      }
    }
  }
}

test();
