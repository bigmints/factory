import {
  Activity, Brain, FlaskConical, FolderOpen, ShieldCheck, Wrench,
} from 'lucide-react';
import type { ActivityStep } from './types';

// ─── Utility Functions ───

export function getStepIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes('validate') || l.includes('lint') || l.includes('check')) return ShieldCheck;
  if (l.includes('plan')) return Brain;
  if (l.includes('build') || l.includes('scaffold')) return Wrench;
  if (l.includes('test')) return FlaskConical;
  if (l.includes('git') || l.includes('commit') || l.includes('push')) return FolderOpen;
  return Activity;
}

export function parseActivities(output: string): ActivityStep[] {
  if (!output || output.trim().length === 0) return [];
  const lines = output.split('\n');
  const steps: ActivityStep[] = [];
  let current: ActivityStep | null = null;
  let stepCounter = 0;

  const pushCurrent = () => { if (current) steps.push(current); };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const stepMatch = line.match(/^●\s*\[(\d+)\/(\d+)\]\s*(.+)/);
    if (stepMatch) {
      pushCurrent();
      stepCounter++;
      const label = stepMatch[3].replace(/\.{3}$/, '');
      current = { id: `step-${stepCounter}`, label, status: 'running', icon: getStepIcon(label), details: [], substeps: [] };
      continue;
    }

    const genericStepMatch = line.match(/^●\s+(.+)/);
    if (genericStepMatch) {
      const text = genericStepMatch[1];
      if (current && (text.startsWith('Testing in ') || text.startsWith('Feeding errors') || text.startsWith('Using '))) {
        current.substeps.push({ text, status: 'info' });
      } else {
        pushCurrent();
        stepCounter++;
        current = { id: `step-${stepCounter}`, label: text.replace(/\.{3}$/, ''), status: 'running', icon: getStepIcon(text), details: [], substeps: [] };
      }
      continue;
    }

    const successMatch = line.match(/^✓\s+(.+)/);
    if (successMatch && current) { current.status = 'success'; current.substeps.push({ text: successMatch[1], status: 'success' }); }

    const errorMatch = line.match(/^[✗✘]\s+(.+)/);
    if (errorMatch && current) { current.status = 'error'; current.substeps.push({ text: errorMatch[1], status: 'error' }); }

    const warningMatch = line.match(/^!\s+(.+)/);
    if (warningMatch && current) { current.status = 'warning'; current.substeps.push({ text: warningMatch[1], status: 'warning' }); }

    const arrowMatch = line.match(/^→\s+(.+)/);
    if (arrowMatch && current) { current.substeps.push({ text: arrowMatch[1], status: 'info' }); }
  }

  pushCurrent();
  return steps;
}

export const getBasename = (path: string) => {
  if (!path) return '';
  return path.split('/').pop() || '';
};

/** Strip directory prefix + yaml extension for slug-level comparison. */
export const getSlug = (path: string) => getBasename(path).replace(/\.ya?ml$/i, '');

/**
 * Resolves all possible identifier slugs for a given story.
 * Handles file paths (stripping directories and extensions), metadata slugs, and feature slugs.
 */
export function getStorySlugs(story: any): string[] {
  if (!story) return [];
  const slugs = new Set<string>();
  
  if (story.file) {
    slugs.add(getSlug(story.file));
  }
  if (story.metadata?.slug) {
    slugs.add(story.metadata.slug);
  }
  if (story.feature?.slug) {
    slugs.add(story.feature.slug);
  }
  if (story.slug) {
    slugs.add(story.slug);
  }
  
  return Array.from(slugs);
}

/**
 * Calculate the family of related stories for a given story.
 * Prerequisites: Stories that the current story directly depends on.
 * Dependents: Stories that directly depend on the current story.
 * Peers: Stories that share at least one dependency, or target the same AppStory, or are within the same Epic/feature group.
 */
export function getRelatedStories(item: any, allStories: any[]) {
  if (!item) return { prerequisites: [], dependents: [], peers: [] };

  const itemSlugs = getStorySlugs(item);

  // Prerequisites: Stories in item.dependsOn (matching any of s's slugs)
  const prerequisites = allStories.filter(s => {
    const sSlugs = getStorySlugs(s);
    return item.dependsOn && item.dependsOn.some((dep: string) => sSlugs.includes(dep));
  });

  // Dependents: Stories that depend on any of item's slugs
  const dependents = allStories.filter(s => 
    s.dependsOn && s.dependsOn.some((dep: string) => itemSlugs.includes(dep))
  );

  // Peers:
  // 1. Share at least one dependency with this story.
  // 2. Belong to the same Epic/feature group (excluding prerequisites and dependents).
  const currentDeps = item.dependsOn || [];
  const currentEpicId = item.epicParent?.id;

  const peers = allStories.filter(s => {
    const sSlugs = getStorySlugs(s);
    
    // Exclude self (if any slugs overlap)
    if (sSlugs.some(slug => itemSlugs.includes(slug))) return false;
    
    // Check if it's already in prerequisites or dependents
    const isPrereq = item.dependsOn && item.dependsOn.some((dep: string) => sSlugs.includes(dep));
    const isDep = s.dependsOn && s.dependsOn.some((dep: string) => itemSlugs.includes(dep));
    if (isPrereq || isDep) return false;

    // Condition 1: Share a dependency
    const sDeps = s.dependsOn || [];
    const shareDependency = sDeps.some((d: string) => currentDeps.includes(d));

    // Condition 2: Belong to the same Epic
    const shareEpic = currentEpicId && s.epicParent?.id === currentEpicId;

    return shareDependency || shareEpic;
  });

  return { prerequisites, dependents, peers };
}

export const getEffectiveStatus = (item: any) => {
  // If the story file is in the 'done' directory, it is completed/done by definition
  if (item.file && (item.file.startsWith('done/') || item.file.includes('/done/'))) return 'done';

  // Queue status is authoritative only while a build is actively running
  if (item.queueStatus === 'building') return 'building';
  if (item.queueStatus === 'done') return 'done';
  if (item.queueStatus === 'failed' || item.queueStatus === 'paused') return 'failed';

  // YAML status is the source of truth for everything else
  if (item.status && item.status !== 'unknown') return item.status;
  return 'unknown';
};

// ─── Topological Dependency Sort ─────────────────────────────────────────────

/**
 * Returns stories sorted so every story appears AFTER all its unbuilt prerequisites.
 *
 * Algorithm: recursive DFS — for each story in `targets`, first visit its
 * dependsOn stories (looking them up in `allStories`), then emit the story
 * itself. Stories already at a "done" status are skipped (they don't need to
 * be re-built). Cycles are broken by the `visiting` guard set.
 *
 * @param targets  The stories the caller wants to build (subset of allStories)
 * @param allStories  Full story pool used for dependency lookup
 * @returns Deduplicated, topologically-ordered list ready for sequential queuing
 */
export function topoSort(targets: any[], allStories: any[]): any[] {
  const DONE_STATUSES = new Set(['done']);
  const visited  = new Set<string>();   // fully processed
  const visiting = new Set<string>();   // in the current DFS stack (cycle guard)
  const result: any[] = [];

  function visit(story: any) {
    const key = story.file;
    if (visited.has(key)) return;
    if (visiting.has(key)) return; // cycle — skip to avoid infinite loop

    visiting.add(key);

    // Recurse into each unbuilt prerequisite first
    const deps: string[] = story.dependsOn || [];
    for (const dep of deps) {
      // Find the story that matches this dep slug
      const depStory = allStories.find(s => {
        const slugs = getStorySlugs(s);
        return slugs.includes(dep);
      });
      if (depStory && !DONE_STATUSES.has(getEffectiveStatus(depStory))) {
        visit(depStory);
      }
    }

    visiting.delete(key);
    visited.add(key);

    // Only emit if not already done
    if (!DONE_STATUSES.has(getEffectiveStatus(story))) {
      result.push(story);
    }
  }

  for (const story of targets) {
    visit(story);
  }

  return result;
}

/**
 * For a single story: returns the full ordered chain of unbuilt prerequisites
 * followed by the story itself.  If story is already done, returns [].
 */
export function resolveDependencyChain(story: any, allStories: any[]): any[] {
  if (!story) return [];
  const DONE_STATUSES = new Set(['done']);
  if (DONE_STATUSES.has(getEffectiveStatus(story))) return [];
  return topoSort([story], allStories);
}
