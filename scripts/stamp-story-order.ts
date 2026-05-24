#!/usr/bin/env npx tsx
/**
 * stamp-story-order.ts
 *
 * Reads scaffold.yaml and stamps phase, priority, dependsOn into every
 * feature story YAML file so the Factory queue processes them in the
 * correct epic / story order.
 *
 * Logic:
 *  - phase     = epic index (0-based, skipping scaffold epic)
 *  - priority  = 1000 - globalStoryIndex (so earlier = higher priority)
 *  - dependsOn = [slug of the immediately preceding story, globally]
 *
 * Usage:
 *   npx tsx scripts/stamp-story-order.ts <project-path>
 *   e.g.  npx tsx scripts/stamp-story-order.ts /home/bigmints/Projects/pi-app
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

const projectPath = resolve(process.argv[2] || process.cwd());
const scaffoldPath = join(projectPath, '.factory', 'scaffold.yaml');

if (!existsSync(scaffoldPath)) {
  console.error(`❌ scaffold.yaml not found at: ${scaffoldPath}`);
  process.exit(1);
}

console.log(`\n📋 Reading scaffold: ${scaffoldPath}`);

const scaffoldRaw = readFileSync(scaffoldPath, 'utf-8');
const scaffold = parseYaml(scaffoldRaw) as any;

if (!scaffold || !Array.isArray(scaffold.features)) {
  console.error('❌ scaffold.yaml has no features array');
  process.exit(1);
}

// Filter out the scaffold/bootstrap epic (scaffold: true)
const featureEpics = scaffold.features.filter((f: any) => !f.scaffold);

// Build a global ordered list of all stories
interface StoryEntry {
  file: string;       // relative path from .factory/stories/: e.g. features/login-screen.yaml
  slug: string;       // e.g. login-screen
  epicIndex: number;  // 0-based within non-scaffold epics
  epicName: string;
  storyIndex: number; // 0-based within the epic
  globalIndex: number;
}

const allStories: StoryEntry[] = [];

featureEpics.forEach((epic: any, epicIndex: number) => {
  if (!Array.isArray(epic.stories)) return;
  epic.stories.forEach((story: any, storyIndex: number) => {
    if (!story.file) return;
    // Normalize: strip leading .factory/stories/ prefix
    const cleanPath = story.file
      .replace(/^.*?\.factory\/stories\//, '')
      .replace(/^\.\//, '');
    const slug = cleanPath.split('/').pop()?.replace(/\.ya?ml$/i, '') || '';
    allStories.push({
      file: cleanPath,
      slug,
      epicIndex,
      epicName: epic.name,
      storyIndex,
      globalIndex: allStories.length,
    });
  });
});

console.log(`\n📦 Found ${featureEpics.length} epics, ${allStories.length} stories\n`);

let stamped = 0;
let skipped = 0;
let missing = 0;

allStories.forEach((entry, idx) => {
  const absPath = join(projectPath, '.factory', 'stories', entry.file);

  if (!existsSync(absPath)) {
    console.warn(`  ⚠  Missing: ${entry.file}`);
    missing++;
    return;
  }

  // Determine dependsOn: the slug of the previous story (globally)
  const dependsOn: string[] = idx > 0 ? [allStories[idx - 1].slug] : [];

  // phase = epicIndex, priority = 1000 - globalIndex (earlier = higher priority)
  const phase = entry.epicIndex;
  const priority = 1000 - entry.globalIndex;

  // Read the story YAML
  const raw = readFileSync(absPath, 'utf-8');
  let parsed: any;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    console.warn(`  ⚠  Parse error in ${entry.file}: ${e}`);
    skipped++;
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    console.warn(`  ⚠  Empty/invalid YAML: ${entry.file}`);
    skipped++;
    return;
  }

  // Check if already correct to avoid unnecessary writes
  if (
    parsed.phase === phase &&
    parsed.priority === priority &&
    JSON.stringify(parsed.dependsOn ?? []) === JSON.stringify(dependsOn)
  ) {
    console.log(`  ✓  Already correct: ${entry.file}`);
    skipped++;
    return;
  }

  // Stamp the fields
  parsed.phase = phase;
  parsed.priority = priority;
  parsed.dependsOn = dependsOn;

  // Write back
  const updated = toYaml(parsed, { lineWidth: 120 });
  writeFileSync(absPath, updated, 'utf-8');

  console.log(
    `  ✅ [epic ${entry.epicIndex} story ${entry.storyIndex}] phase=${phase} priority=${priority} dependsOn=${JSON.stringify(dependsOn)} → ${entry.file}`
  );
  stamped++;
});

console.log(`\n──────────────────────────────`);
console.log(`✅  Stamped:  ${stamped}`);
console.log(`✓   Already correct: ${skipped}`);
console.log(`⚠   Missing:  ${missing}`);
console.log(`\nDone. Re-enqueue the queue with correct order.\n`);
