'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { NewProjectGuide } from '@/components/new-project-guide';
import {
  Rocket, Play, Square, ExternalLink, Terminal, Settings, Activity,
  CheckCircle2, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronRight, Plus,
  Search, Filter, Tag, Columns, Layers, FileCode2, Brain, FlaskConical, Wrench,
  ShieldCheck, FolderOpen, RefreshCw, Sliders, X, Check, Package, ListTodo, Info,
  BookOpen, Code, TerminalSquare, Link2, Users, Network, Lock, Clock,
  Pencil, Trash2, Eye, FileText, Save, Copy
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StoryEditor } from '@/components/story-editor';
import { StoryChat } from '@/components/story-chat';

// ─── Interfaces ───

interface Task {
  id: string;
  fullId: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface Story {
  id: string;
  name: string;
  file: string;
  status: string;
  progressPercent: number;
  tasks: Task[];
}

interface FeatureEpic {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'blocked';
  progressPercent: number;
  stories: Story[];
}

interface AppRollupData {
  id: string;
  name: string;
  description: string;
  brd: string;
  version: string;
  status: string;
  stack: {
    framework: string;
    packageManager?: string;
    language?: string;
    linter?: string;
    testing?: string;
    database?: string;
    cloud?: string;
  };
  progressPercent: number;
  features: FeatureEpic[];
}

interface PhysicalStory {
  file: string;
  kind?: 'AppStory' | 'FeatureStory';
  valid: boolean;
  status: string;
  metadata?: {
    name?: string;
    slug?: string;
    description?: string;
    icon?: string;
    color?: string;
    group?: string;
  };
  deployment?: {
    port?: number;
    region?: string;
    customDomain?: string;
  };
  database?: {
    firestoreId?: string;
    collections?: string[];
  };
  api?: {
    resources?: Array<{ name: string }>;
  };
  feature?: {
    name?: string;
    description?: string;
  };
  target?: {
    app?: string;
  };
  pages?: any[];
  model?: {
    collection?: string;
  };
  phase?: number;
  dependsOn?: string[];
}

interface QueueItem {
  id: string;
  specFile?: string;
  storyFile?: string;
  kind: string;
  status: string;
  priority: number;
  engine?: string;
  addedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  output: string;
  error: string | null;
  durationMs: number | null;
}

interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

interface ActivityStep {
  id: string;
  label: string;
  status: 'success' | 'error' | 'running' | 'info' | 'warning';
  icon: any;
  details: string[];
  substeps: { text: string; status: 'success' | 'error' | 'info' | 'warning' }[];
}

interface NotionBoardProps {
  initialView?: 'board' | 'list' | 'queue';
  onNavigateToBuild?: () => void;
  /** Increment this key whenever the active project changes to force a full data reset. */
  projectRefreshKey?: number;
  /** When this flips to true, open the story-chat dialog. Parent resets it after. */
  externalOpenStoryChat?: boolean;
  onExternalStoryChatConsumed?: () => void;
}

// ─── Constants & Configurations ───

const storyStatusMap: Record<string, { label: string; bg: string; dot: string }> = {
  done:         { label: 'Done',          bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25 font-semibold', dot: 'bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.5)]' },
  completed:    { label: 'Done',          bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25 font-semibold', dot: 'bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.5)]' },
  review:       { label: 'In Review',     bg: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/25 font-semibold',   dot: 'bg-purple-500 shadow-[0_0_6px_rgba(192,132,252,0.5)]' },
  validation:   { label: 'Validation',    bg: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/25 font-semibold',            dot: 'bg-cyan-500 shadow-[0_0_6px_rgba(34,211,238,0.5)]' },
  'in-progress':{ label: 'In Progress',   bg: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25 font-semibold',            dot: 'bg-blue-500 shadow-[0_0_6px_rgba(96,165,250,0.5)]' },
  running:      { label: 'Building',      bg: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25 font-semibold',            dot: 'bg-blue-500 shadow-[0_0_8px_rgba(96,165,250,0.8)] animate-pulse' },
  ready:        { label: 'Ready to Build',bg: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/25 font-semibold',            dot: 'bg-teal-500 shadow-[0_0_6px_rgba(45,212,191,0.5)]' },
  failed:       { label: 'Failed',        bg: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25 font-semibold',            dot: 'bg-rose-500 shadow-[0_0_6px_rgba(248,113,113,0.5)]' },
  draft:        { label: 'Draft',         bg: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25 font-semibold',        dot: 'bg-amber-500 shadow-[0_0_6px_rgba(251,191,36,0.5)]' },
  unknown:      { label: 'Draft',         bg: 'bg-muted/50 border-border text-muted-foreground',                                              dot: 'bg-muted-foreground/60' }
};

const epicStatusMap: Record<string, { label: string; bg: string }> = {
  completed:    { label: 'Completed',  bg: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-700 dark:text-emerald-300' },
  'in-progress':{ label: 'In Progress',bg: 'bg-blue-500/15 border-blue-500/25 text-blue-700 dark:text-blue-300' },
  blocked:      { label: 'Blocked',    bg: 'bg-rose-500/15 border-rose-500/25 text-rose-700 dark:text-rose-300' },
  pending:      { label: 'Pending',    bg: 'bg-muted/50 border-border text-muted-foreground' }
};

// Rotating palette of epic accent colors (border-left + badge tints)
const EPIC_COLORS = [
  { border: 'border-l-violet-500',  badge: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25 font-medium' },
  { border: 'border-l-sky-500',     badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25 font-medium' },
  { border: 'border-l-emerald-500', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25 font-medium' },
  { border: 'border-l-rose-500',    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25 font-medium' },
  { border: 'border-l-teal-500',    badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/25 font-medium' },
  { border: 'border-l-fuchsia-500', badge: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/25 font-medium' },
  { border: 'border-l-amber-500',   badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25 font-medium' },
  { border: 'border-l-pink-500',    badge: 'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/25 font-medium' },
];

const taskStatusMap: Record<string, { label: string; bg: string; dot: string }> = {
  completed: { label: 'Completed', bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', dot: 'bg-emerald-500' },
  running:   { label: 'Running',   bg: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25',             dot: 'bg-blue-500 animate-pulse' },
  failed:    { label: 'Failed',    bg: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/25',             dot: 'bg-rose-500' },
  pending:   { label: 'Pending',   bg: 'bg-muted/50 text-muted-foreground border-border',                                dot: 'bg-muted-foreground' }
};

function getStepIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes('validate') || l.includes('lint') || l.includes('check')) return ShieldCheck;
  if (l.includes('plan')) return Brain;
  if (l.includes('build') || l.includes('scaffold')) return Wrench;
  if (l.includes('test')) return FlaskConical;
  if (l.includes('git') || l.includes('commit') || l.includes('push')) return FolderOpen;
  return Activity;
}

function parseActivities(output: string): ActivityStep[] {
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

const getBasename = (path: string) => {
  if (!path) return '';
  return path.split('/').pop() || '';
};

/** Strip directory prefix + yaml extension for slug-level comparison. */
const getSlug = (path: string) => getBasename(path).replace(/\.ya?ml$/i, '');

/**
 * Resolves all possible identifier slugs for a given story.
 * Handles file paths (stripping directories and extensions), metadata slugs, and feature slugs.
 */
function getStorySlugs(story: any): string[] {
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
function getRelatedStories(item: any, allStories: any[]) {
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

const getEffectiveStatus = (item: any) => {
  // Queue status is authoritative only while a build is actively running
  if (item.queueStatus === 'running') return 'running';
  if (item.queueStatus === 'completed') return 'done';
  if (item.queueStatus === 'failed' || item.queueStatus === 'needs-attention') return 'failed';

  // YAML status is the source of truth for everything else
  if (item.status && item.status !== 'unknown') return item.status;
  return 'unknown';
};


// ─── YAML Viewer ─────────────────────────────────────────────────────────────
function YamlViewer({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="p-4 font-mono text-[11px] leading-6 select-text overflow-auto">
      {lines.map((line, i) => {
        const isComment = line.trimStart().startsWith('#');
        const keyMatch = !isComment && line.match(/^(\s*)([a-zA-Z0-9_\-]+)(\s*:.*)$/);
        const isList = /^\s*-\s/.test(line);
        if (isComment) {
          return <div key={i} className="text-zinc-600 italic">{line || '\u00A0'}</div>;
        }
        if (keyMatch) {
          const [, indent, key, rest] = keyMatch;
          const valueRaw = rest.replace(/^\s*:\s*/, '');
          const isStr = /^["\']/.test(valueRaw);
          const isNum = /^[\d.]+$/.test(valueRaw);
          const isBool = /^(true|false|yes|no|null)$/.test(valueRaw);
          return (
            <div key={i}>
              <span>{indent}</span>
              <span className="text-sky-300 font-semibold">{key}</span>
              <span className="text-zinc-500">: </span>
              {valueRaw ? <span className={isStr ? 'text-emerald-400' : isNum ? 'text-amber-400' : isBool ? 'text-violet-400' : 'text-zinc-200'}>{valueRaw}</span> : null}
            </div>
          );
        }
        if (isList) {
          const m = line.match(/^(\s*-\s*)(.*)$/);
          if (m) return (
            <div key={i}>
              <span className="text-zinc-500">{m[1]}</span>
              <span className={/^["\']/.test(m[2]) ? 'text-emerald-400' : 'text-zinc-300'}>{m[2]}</span>
            </div>
          );
        }
        return <div key={i} className="text-zinc-300">{line || '\u00A0'}</div>;
      })}
    </div>
  );
}

export function NotionBoard({ initialView = 'board', onNavigateToBuild, projectRefreshKey = 0, externalOpenStoryChat, onExternalStoryChatConsumed }: NotionBoardProps) {
  // ─── State ───
  const [viewMode, setViewMode] = useState<'board' | 'list' | 'queue'>(initialView);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [draggingFile, setDraggingFile] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, file: string) => {
    e.dataTransfer.setData('text/plain', file);
    setDraggingFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    const file = e.dataTransfer.getData('text/plain') || draggingFile;
    setDraggingFile(null);

    if (!file) return;

    if (targetStatus !== 'ready' && targetStatus !== 'draft') {
      toast.error("Stories can only be manually moved to 'Ready to Build' or 'Backlog'. Other columns are managed automatically by the Factory engine.");
      return;
    }

    // Identify the dropped story
    const droppedStory = mergedStories.find(s => s.file === file || getSlug(s.file) === getSlug(file));
    let relatedStoriesToUpdate: any[] = [];
    if (droppedStory && targetStatus === 'ready') {
      const { prerequisites, dependents, peers } = getRelatedStories(droppedStory, mergedStories);
      const family = [...prerequisites, ...dependents, ...peers];
      
      // Filter out any stories that are already completed ('done' or 'completed') or already 'ready' or 'in-progress'
      relatedStoriesToUpdate = family.filter(s => {
        const status = getEffectiveStatus(s);
        return (
          status !== 'done' &&
          status !== 'completed' &&
          status !== 'ready' &&
          status !== 'in-progress' &&
          status !== 'running' &&
          status !== 'validation'
        );
      });
    }

    const toastId = toast.loading(
      relatedStoriesToUpdate.length > 0
        ? `Updating "${droppedStory?.metadata?.name || file}" and ${relatedStoriesToUpdate.length} related stories...`
        : `Updating story status to ${targetStatus}...`
    );

    try {
      const res = await fetch('/api/stories/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, status: targetStatus })
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to update status');
      }

      // If we have related stories to update, update them as well in parallel
      if (relatedStoriesToUpdate.length > 0) {
        await Promise.all(relatedStoriesToUpdate.map(s =>
          fetch('/api/stories/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: s.file, status: 'ready' })
          }).then(async (r) => {
            if (!r.ok) {
              const body = await r.json().catch(() => ({}));
              console.error(`Failed to update ${s.file}`, body);
            }
          })
        ));
      }

      toast.success(
        relatedStoriesToUpdate.length > 0
          ? `Moved "${droppedStory?.metadata?.name || file}" and grouped ${relatedStoriesToUpdate.length} related stories to Ready to Build!`
          : `Successfully updated status to "${targetStatus}"`,
        { id: toastId }
      );
      await Promise.all([fetchStories(), fetchRollup(true), fetchQueue()]);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status', { id: toastId });
    }
  };

  // ─── Active Project Tracking ───
  // We track the active project ID so we can detect project switches and
  // immediately clear stale data from a different project before refetching.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const fetchActiveProject = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setActiveProjectId(data.activeId || null);
    } catch {
      // Silently fail — not critical
    }
  }, []);

  // Core Data
  const [stories, setStories] = useState<PhysicalStory[]>([]);
  const [featureStories, setFeatureStories] = useState<PhysicalStory[]>([]);
  const [appRollup, setAppRollup] = useState<AppRollupData | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [buildLogsOpen, setBuildLogsOpen] = useState(false);

  // Dev Server Controls
  const [runStatus, setRunStatus] = useState<'stopped' | 'starting' | 'running'>('stopped');
  const [runPid, setRunPid] = useState<number | null>(null);
  const [runPort, setRunPort] = useState<number | null>(null);
  const [runLogs, setRunLogs] = useState<string>('');
  const [serverLogsOpen, setServerLogsOpen] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showDesktopFilters, setShowDesktopFilters] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Build Pipeline Logs
  const [buildOutput, setBuildOutput] = useState('');
  const logOffsetRef = useRef(0);

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [epicFilter, setEpicFilter] = useState<string>('all');
  const [showEpicLegend, setShowEpicLegend] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Auto-select the running item (or keep selection if user pinned one)
  useEffect(() => {
    const runningItem = queueItems.find(i => i.status === 'running');
    if (runningItem) {
      // Only auto-select if nothing is selected, or current selection is no longer in the list
      setSelectedQueueItemId(prev => {
        const prevStillExists = prev && queueItems.some(i => i.id === prev);
        return prevStillExists ? prev : runningItem.id;
      });
    } else if (!selectedQueueItemId || !queueItems.some(i => i.id === selectedQueueItemId)) {
      // Fall back to most recent item
      const latest = queueItems[0] ?? null;
      setSelectedQueueItemId(latest?.id ?? null);
    }
  }, [queueItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Interactive Checklist Toggling
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  // Expand states for List Hierarchy
  const [expandedFeatures, setExpandedFeatures] = useState<Record<string, boolean>>({});
  const [expandedStories, setExpandedStories] = useState<Record<string, boolean>>({});

  // Slide Drawer State
  const [selectedItem, setSelectedItem] = useState<{
    type: 'task' | 'story';
    data: any;
    parentStory?: any;
    parentFeature?: any;
  } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // YAML viewer/editor state for story drawer
  const [yamlContent, setYamlContent] = useState<string | null>(null);
  const [loadingYaml, setLoadingYaml] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedYaml, setEditedYaml] = useState('');
  const [savingYaml, setSavingYaml] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [storyTab, setStoryTab] = useState<'spec' | 'raw' | 'tasks'>('spec');
  const [copiedYaml, setCopiedYaml] = useState(false);

  // Story Creation & Editing overlays
  const [editingStory, setEditingStory] = useState<{ file: string; name: string } | null>(null);
  const [showStoryChat, setShowStoryChat] = useState(false);
  const [activeAction, setActiveAction] = useState<{ type: string; file: string } | null>(null);

  // External trigger from FAB
  useEffect(() => {
    if (externalOpenStoryChat) {
      setShowStoryChat(true);
      onExternalStoryChatConsumed?.();
    }
  }, [externalOpenStoryChat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Empty-state prompt banner dismiss (persisted in localStorage)
  const DISMISS_KEY = 'factory_empty_board_dismissed';
  const [promptDismissed, setPromptDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(DISMISS_KEY) === 'true';
  });
  const [showPromptModal, setShowPromptModal] = useState(false);

  const handleDismissBanner = () => {
    setPromptDismissed(true);
    localStorage.setItem(DISMISS_KEY, 'true');
  };

  // Reset dismiss whenever the project changes so new projects always see the banner
  useEffect(() => {
    setPromptDismissed(false);
    localStorage.removeItem(DISMISS_KEY);
  }, [projectRefreshKey]);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // ─── Data Sync Hooks ───

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      setQueueItems(data.items || []);
      const running = (data.items || []).some((i: any) => i.status === 'running');
      setQueueRunning(running || data.isRunning || false);
    } catch {
      console.error('Failed to fetch queue');
    }
  }, []);

  const fetchStories = useCallback(async () => {
    try {
      const res = await fetch('/api/stories');
      const data = await res.json();
      setStories(data.stories || []);
      setFeatureStories(data.featureStories || []);
    } catch {
      console.error('Failed to fetch stories');
    }
  }, []);

  const fetchRunStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/run-app');
      if (res.ok) {
        const json = await res.json();
        setRunStatus(json.status);
        setRunPid(json.pid);
        setRunPort(json.port);
        setRunLogs(json.logs || '');
      }
    } catch (err) {
      console.error('Failed to fetch run status:', err);
    }
  }, []);

  const fetchRollup = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/app-rollup');
      const json = await res.json();
      if (res.ok) {
        setAppRollup(json);
        if (json.features && json.features.length > 0) {
          setExpandedFeatures(prev => {
            if (Object.keys(prev).length === 0) {
              const all: Record<string, boolean> = {};
              json.features.forEach((f: FeatureEpic) => { all[f.id] = true; });
              return all;
            }
            return prev;
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch rollup:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Detect project changes and reset stale data immediately.
  // projectRefreshKey bumps when the user switches project from the sidebar.
  useEffect(() => {
    // Clear all project-scoped data so stale stories from the previous project
    // don't appear while fresh data is loading.
    setStories([]);
    setFeatureStories([]);
    setAppRollup(null);
    setQueueItems([]);
    setQueueRunning(false);
    // Re-fetch the active project ID so activeProjectId stays in sync.
    fetchActiveProject();
  }, [projectRefreshKey, fetchActiveProject]);

  // Combined Polling Orchestrator — restarts whenever the project changes.
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRollup(true), fetchStories(), fetchQueue(), fetchRunStatus()]).finally(() => setLoading(false));

    const dataInterval = setInterval(() => {
      fetchRollup(true);
      fetchStories();
      fetchQueue();
    }, 4000);

    const runInterval = setInterval(() => {
      fetchRunStatus();
    }, 3000);

    return () => {
      clearInterval(dataInterval);
      clearInterval(runInterval);
    };
    // Re-run when projectRefreshKey changes so the board reflects the new project immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRollup, fetchStories, fetchQueue, fetchRunStatus, projectRefreshKey]);

  // Dedicated Queue Log Polling
  useEffect(() => {
    if (!queueRunning) {
      logOffsetRef.current = 0;
      return;
    }
    setBuildOutput('Connecting to pipeline logs...\n');
    logOffsetRef.current = 0;

    const pollLog = async () => {
      try {
        const res = await fetch(`/api/queue/log?offset=${logOffsetRef.current}`);
        const data = await res.json();
        if (data.log) {
          setBuildOutput(prev => prev + data.log);
          logOffsetRef.current = data.offset;
        }
      } catch {}
    };

    pollLog();
    const interval = setInterval(pollLog, 1500);
    return () => clearInterval(interval);
  }, [queueRunning]);

  // Auto scroll logs
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildOutput]);

  // ─── Actions & Handlers ───

  const handleStartApp = async () => {
    setIsActionLoading(true);
    setRunStatus('starting');
    try {
      const res = await fetch('/api/run-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to start dev server');
      toast.success('Local dev server started successfully');
      setRunStatus(json.status || 'starting');
      if (json.pid) setRunPid(json.pid);
      setServerLogsOpen(true);
      fetchRunStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to start server');
      setRunStatus('stopped');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleStopApp = async () => {
    setIsActionLoading(true);
    try {
      const res = await fetch('/api/run-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to stop dev server');
      toast.success('Dev server stopped');
      setRunStatus('stopped');
      setRunPid(null);
      setRunPort(null);
      fetchRunStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to stop server');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSyncRoadmap = async () => {
    setSyncing(true);
    const toastId = toast.loading('Synchronizing spec models with app roadmap...');
    try {
      const res = await fetch('/api/app-rollup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Sync failed');
      }
      toast.success('Roadmap in sync with local storage', { id: toastId });
      await fetchRollup(true);
    } catch (err: any) {
      toast.error(err.message || 'Sync failed', { id: toastId });
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateTaskStatus = async (taskFullId: string, nextStatus: Task['status']) => {
    setUpdatingTaskId(taskFullId);
    try {
      const res = await fetch('/api/app-rollup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: taskFullId, status: nextStatus }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Update failed');
      }

      // Fast optimistic UI update
      if (appRollup) {
        const updatedFeatures = appRollup.features.map(f => ({
          ...f,
          stories: f.stories.map(s => {
            const hasTask = s.tasks.some(t => t.fullId === taskFullId);
            if (!hasTask) return s;

            const nextTasks = s.tasks.map(t =>
              t.fullId === taskFullId ? { ...t, status: nextStatus } : t
            );
            const comp = nextTasks.filter(t => t.status === 'completed').length;
            const progress = nextTasks.length > 0 ? Math.round((comp / nextTasks.length) * 100) : 0;
            return {
              ...s,
              progressPercent: progress,
              tasks: nextTasks
            };
          })
        }));
        setAppRollup({ ...appRollup, features: updatedFeatures });
      }

      await fetchRollup(true);
      toast.success(`Task marked as ${nextStatus}`);

      // Refresh drawer if viewing active item
      if (selectedItem && selectedItem.type === 'task' && selectedItem.data.fullId === taskFullId) {
        setSelectedItem(prev => prev ? {
          ...prev,
          data: { ...prev.data, status: nextStatus }
        } : null);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to update task');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const handleEnqueue = async (file: string, kind: string, extra?: any) => {
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyFile: file,
          specFile: file,
          kind,
          phase: extra?.phase,
          dependsOn: extra?.dependsOn,
          engine: 'factory'
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const baseName = getBasename(file);
        if (data.autoEnqueued && data.autoEnqueued.length > 0) {
          const names = data.autoEnqueued.map((x: any) => getBasename(x.file)).join(', ');
          toast.success(`Enqueued ${baseName}!`, {
            description: `Auto-enqueued ${data.autoEnqueued.length} prerequisite dependencies: ${names} to guarantee correct topological order.`,
            duration: 8000
          });
        } else {
          toast.success(`Enqueued build for ${baseName}`);
        }
        fetchQueue();
        return true;
      } else {
        toast.error('Failed to enqueue', { description: data.error });
        return false;
      }
    } catch {
      toast.error('Network error enqueuing story');
      return false;
    }
  };

  const handleSingleBuild = async (file: string, kind: string) => {
    const baseName = getBasename(file);
    toast.info(`Preparing build for ${baseName}...`);
    try {
      const enqueued = await handleEnqueue(file, kind);
      if (!enqueued) return;
      const res = await fetch('/api/queue/start', { method: 'POST' });
      if (res.ok) {
        toast.success('Build pipeline running...');
        fetchQueue();
        if (onNavigateToBuild) {
          onNavigateToBuild();
        } else {
          setViewMode('queue');
          setBuildLogsOpen(true);
        }
      } else {
        const err = await res.json();
        toast.error('Failed to launch pipeline', { description: err.error });
      }
    } catch {
      toast.error('Network error building story');
    }
  };

  // Rocket Build Ready Action
  const handleBuildReadyStories = async () => {
    // Collect all stories from specs and roadmap that are ready, failed, or review
    const readySpecs: Array<{ file: string; kind: string; phase?: number; dependsOn?: string[]; epicId?: string; epicIndex: number }> = [];

    // Build an epic → stable index map so we can group by epic
    const epicIndexMap = new Map<string, number>();
    (appRollup?.features || []).forEach((f: any, idx: number) => {
      epicIndexMap.set(f.id, idx);
    });

    mergedStories.forEach(item => {
      const status = getEffectiveStatus(item);
      if (status === 'ready' || status === 'failed' || status === 'review') {
        const epicId = item.epicParent?.id;
        readySpecs.push({
          file: item.file,
          kind: item.kind,
          phase: item.phase,
          dependsOn: item.dependsOn,
          epicId,
          // Stories without an epic go last (epicIndex = 999)
          epicIndex: epicId !== undefined ? (epicIndexMap.get(epicId) ?? 999) : 999
        });
      }
    });

    if (readySpecs.length === 0) {
      toast.info('All stories are fully built or clean! No pending items found.');
      return;
    }

    // Sort so same-epic stories appear consecutively:
    //   1. epicIndex ASC (group epics together)
    //   2. phase ASC within each epic (respect build ordering)
    //   3. file name ASC as a stable tie-breaker
    readySpecs.sort((a, b) => {
      if (a.epicIndex !== b.epicIndex) return a.epicIndex - b.epicIndex;
      const phaseA = a.phase ?? 0;
      const phaseB = b.phase ?? 0;
      if (phaseA !== phaseB) return phaseA - phaseB;
      return a.file.localeCompare(b.file);
    });

    const toastId = toast.loading(`Enqueuing ${readySpecs.length} stories into pipeline...`);
    let enqueued = 0;
    try {
      for (const spec of readySpecs) {
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyFile: spec.file,
            specFile: spec.file,
            kind: spec.kind,
            phase: spec.phase,
            dependsOn: spec.dependsOn,
            buildAll: true, // skip individual dependency pre-check; engine handles ordering
            engine: 'factory'
          })
        });
        if (res.ok) enqueued++;
      }

      if (enqueued > 0) {
        toast.loading(`Starting execution loop for ${enqueued} items...`, { id: toastId });
        const startRes = await fetch('/api/queue/start', { method: 'POST' });
        if (startRes.ok) {
          toast.success(`Success! Launched build for ${enqueued} stories.`, { id: toastId });
          fetchQueue();
          if (onNavigateToBuild) {
            onNavigateToBuild();
          } else {
            setViewMode('queue');
            setBuildLogsOpen(true);
          }
        } else {
          toast.error('Failed to trigger execution runner', { id: toastId });
        }
      } else {
        toast.error('No stories were enqueued', { id: toastId });
      }
    } catch {
      toast.error('Error starting ready builds', { id: toastId });
    }
  };

  const handleQueueRelatedStories = async (item: any) => {
    if (!item) return;
    const currentSlug = getSlug(item.file);
    const { prerequisites, dependents, peers } = getRelatedStories(item, mergedStories);
    
    // Family includes current story, prerequisites, dependents, peers.
    const family = [item, ...prerequisites, ...dependents, ...peers];
    
    // Filter to only incomplete stories
    const incompleteFamily = family.filter(s => {
      const status = getEffectiveStatus(s);
      return status !== 'done' && status !== 'completed';
    });

    if (incompleteFamily.length === 0) {
      toast.info('All stories in the related family are already completed!');
      return;
    }

    // Stable sort family by Epic Index and Phase
    const epicIndexMap = new Map<string, number>();
    (appRollup?.features || []).forEach((f: any, idx: number) => {
      epicIndexMap.set(f.id, idx);
    });

    const sortedSpecs = incompleteFamily.map(s => {
      const epicId = s.epicParent?.id;
      return {
        file: s.file,
        kind: s.kind || 'AppStory',
        phase: s.phase,
        dependsOn: s.dependsOn,
        epicId,
        epicIndex: epicId !== undefined ? (epicIndexMap.get(epicId) ?? 999) : 999
      };
    });

    sortedSpecs.sort((a, b) => {
      if (a.epicIndex !== b.epicIndex) return a.epicIndex - b.epicIndex;
      const phaseA = a.phase ?? 0;
      const phaseB = b.phase ?? 0;
      if (phaseA !== phaseB) return phaseA - phaseB;
      return a.file.localeCompare(b.file);
    });

    const toastId = toast.loading(`Enqueuing related family (${sortedSpecs.length} stories) into pipeline...`);
    let enqueued = 0;
    try {
      for (const spec of sortedSpecs) {
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyFile: spec.file,
            specFile: spec.file,
            kind: spec.kind,
            phase: spec.phase,
            dependsOn: spec.dependsOn,
            buildAll: true, // skip individual dependency pre-check; engine handles ordering
            engine: 'factory'
          })
        });
        if (res.ok) enqueued++;
      }

      if (enqueued > 0) {
        toast.loading(`Starting execution loop for ${enqueued} related items...`, { id: toastId });
        const startRes = await fetch('/api/queue/start', { method: 'POST' });
        if (startRes.ok) {
          toast.success(`Success! Launched builds for ${enqueued} related stories.`, { id: toastId });
          fetchQueue();
          setDrawerOpen(false);
          if (onNavigateToBuild) {
            onNavigateToBuild();
          } else {
            setViewMode('queue');
            setBuildLogsOpen(true);
          }
        } else {
          toast.error('Failed to trigger execution runner', { id: toastId });
        }
      } else {
        toast.error('No stories were enqueued', { id: toastId });
      }
    } catch {
      toast.error('Error starting builds', { id: toastId });
    }
  };

  const handleValidateStory = async (file: string, _kind: string) => {
    setActiveAction({ type: 'validate', file });
    const toastId = toast.loading(`Checking ${file.split('/').pop()}…`);
    try {
      // Quick validate: YAML parse + required field checks. No CLI subprocess needed.
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyFile: file, specFile: file, quick: true }),
      });
      const data = await res.json();
      if (data.passed) {
        toast.success('Spec looks good — ready to compile.', { id: toastId });
        fetchStories();
      } else {
        const failedChecks = (data.checks || []).filter((c: any) => !c.passed);
        const errMessage = failedChecks.length > 0
          ? failedChecks.map((c: any) => `${c.name}${c.message ? ': ' + c.message : ''}`).join(' · ')
          : data.error || 'Missing required fields in spec.';
        toast.error(errMessage, { id: toastId, duration: 6000 });
      }
    } catch {
      toast.error('Could not reach validation service.', { id: toastId });
    } finally {
      setActiveAction(null);
    }
  };

  const handleStopQueue = async () => {
    try {
      const res = await fetch('/api/queue/stop', { method: 'POST' });
      if (res.ok) {
        toast.success('Build runner stopped');
        fetchQueue();
      }
    } catch {
      toast.error('Failed to request queue stop');
    }
  };

  const handleClearQueue = async () => {
    try {
      const res = await fetch('/api/queue/clear', { method: 'POST' });
      if (res.ok) {
        toast.success('Cleaned queue timeline history');
        fetchQueue();
      }
    } catch {
      toast.error('Failed to clear queue');
    }
  };

  const handleRetryItem = async (id: string) => {
    try {
      const res = await fetch(`/api/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry' })
      });
      if (res.ok) {
        toast.success('Retrying item');
        fetchQueue();
        const startRes = await fetch('/api/queue/start', { method: 'POST' });
        if (startRes.ok) {
          if (onNavigateToBuild) {
            onNavigateToBuild();
          } else {
            setViewMode('queue');
            setBuildLogsOpen(true);
          }
        }
      }
    } catch {
      toast.error('Failed to retry queue item');
    }
  };

  const handleRemoveQueueItem = async (id: string) => {
    try {
      const res = await fetch('/api/queue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        toast.success('Removed item from queue');
        fetchQueue();
      }
    } catch {
      toast.error('Failed to remove item');
    }
  };

  // ─── Computed Rollups & Merging ───

  // Map physical story state with SQLite checklist tasks
  const mergedStories = useMemo(() => {
    const map = new Map<string, any>();

    // Load physical details
    stories.forEach(s => {
      map.set(getBasename(s.file), { ...s, checklistTasks: [] });
    });
    featureStories.forEach(fs => {
      map.set(getBasename(fs.file), { ...fs, checklistTasks: [] });
    });

    // Merge SQLite checklist data
    if (appRollup && appRollup.features) {
      appRollup.features.forEach(f => {
        f.stories.forEach(s => {
          const key = getBasename(s.file);
          const existing = map.get(key);
          if (existing) {
            map.set(key, {
              ...existing,
              dbId: s.id,
              dbName: s.name,
              dbStatus: s.status,
              dbProgress: s.progressPercent,
              checklistTasks: s.tasks || [],
              epicParent: f
            });
          } else {
            // Found in DB but no physical file yet! (Unscaffolded placeholders)
            map.set(key, {
              file: s.file,
              kind: s.file.startsWith('features/') ? 'FeatureStory' : 'AppStory',
              valid: false,
              status: s.status || 'draft',
              dbId: s.id,
              dbName: s.name,
              dbStatus: s.status,
              dbProgress: s.progressPercent,
              checklistTasks: s.tasks || [],
              epicParent: f,
              placeholder: true
            });
          }
        });
      });
    }

    // Merge active queue item status to resolve live swimlane states
    if (queueItems && queueItems.length > 0) {
      map.forEach((story, key) => {
        const matchingQueueItem = queueItems.find(qi => {
          const qiFile = qi.storyFile || qi.specFile || '';
          // Compare by slug (strip path prefix + .yaml) so done/ paths still match
          return getSlug(qiFile) === getSlug(key);
        });
        if (matchingQueueItem) {
          story.queueStatus = matchingQueueItem.status;
        }
      });
    }

    return Array.from(map.values());
  }, [stories, featureStories, appRollup, queueItems]);

  // Filter and search
  const filteredStoriesList = useMemo(() => {
    let list = mergedStories;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(item => {
        const name = item.metadata?.name || item.feature?.name || item.dbName || item.file;
        return name.toLowerCase().includes(q) || item.file.toLowerCase().includes(q);
      });
    }

    if (epicFilter !== 'all') {
      list = list.filter(item => item.epicParent?.id === epicFilter);
    }

    if (statusFilter !== 'all') {
      list = list.filter(item => {
        const status = getEffectiveStatus(item);
        return status === statusFilter;
      });
    }

    return list;
  }, [mergedStories, searchQuery, epicFilter, statusFilter]);

  // Backlog specs (Draft/Unknown)
  const backlogStories = useMemo(() => {
    const list = filteredStoriesList.filter(item => {
      const status = getEffectiveStatus(item);
      return status === 'draft' || status === 'unknown';
    });

    const epicIndexMap = new Map<string, number>();
    if (appRollup?.features) {
      appRollup.features.forEach((f: any, idx: number) => {
        epicIndexMap.set(f.id, idx);
      });
    }

    return [...list].sort((a, b) => {
      const epicIdA = a.epicParent?.id;
      const epicIdB = b.epicParent?.id;
      const epicIndexA = epicIdA !== undefined ? (epicIndexMap.get(epicIdA) ?? 999) : 999;
      const epicIndexB = epicIdB !== undefined ? (epicIndexMap.get(epicIdB) ?? 999) : 999;
      if (epicIndexA !== epicIndexB) return epicIndexA - epicIndexB;
      
      const phaseA = a.phase ?? 0;
      const phaseB = b.phase ?? 0;
      if (phaseA !== phaseB) return phaseA - phaseB;
      
      return a.file.localeCompare(b.file);
    });
  }, [filteredStoriesList, appRollup]);

  // Ready specs (Ready/Failed/Review)
  const readyStories = useMemo(() => {
    const list = filteredStoriesList.filter(item => {
      const status = getEffectiveStatus(item);
      return status === 'ready' || status === 'failed' || status === 'review';
    });

    const epicIndexMap = new Map<string, number>();
    if (appRollup?.features) {
      appRollup.features.forEach((f: any, idx: number) => {
        epicIndexMap.set(f.id, idx);
      });
    }

    return [...list].sort((a, b) => {
      const epicIdA = a.epicParent?.id;
      const epicIdB = b.epicParent?.id;
      const epicIndexA = epicIdA !== undefined ? (epicIndexMap.get(epicIdA) ?? 999) : 999;
      const epicIndexB = epicIdB !== undefined ? (epicIndexMap.get(epicIdB) ?? 999) : 999;
      if (epicIndexA !== epicIndexB) return epicIndexA - epicIndexB;
      
      const phaseA = a.phase ?? 0;
      const phaseB = b.phase ?? 0;
      if (phaseA !== phaseB) return phaseA - phaseB;
      
      return a.file.localeCompare(b.file);
    });
  }, [filteredStoriesList, appRollup]);

  // In-Progress/Building specs
  const buildingStories = useMemo(() => {
    return filteredStoriesList.filter(item => {
      const status = getEffectiveStatus(item);
      return status === 'in-progress' || status === 'validation' || status === 'running';
    });
  }, [filteredStoriesList]);

  // Done specs
  const doneStories = useMemo(() => {
    return filteredStoriesList.filter(item => {
      const status = getEffectiveStatus(item);
      return status === 'done' || status === 'completed';
    });
  }, [filteredStoriesList]);


  // Map each epic id → stable EPIC_COLORS entry
  const epicColorMap = useMemo(() => {
    const map = new Map<string, typeof EPIC_COLORS[0]>();
    (appRollup?.features || []).forEach((f: any, idx: number) => {
      map.set(f.id, EPIC_COLORS[idx % EPIC_COLORS.length]);
    });
    return map;
  }, [appRollup]);

  // Queue Item Stats
  const queueStats = useMemo<QueueStats>(() => {
    const stats = { pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
    queueItems.forEach(item => {
      stats.total++;
      if (item.status === 'running') stats.running++;
      else if (item.status === 'completed') stats.completed++;
      else if (item.status === 'failed') stats.failed++;
      else stats.pending++;
    });
    return stats;
  }, [queueItems]);

  const activeQueueLogs = useMemo(() => {
    const runningItem = queueItems.find(i => i.status === 'running');
    return runningItem?.output || '';
  }, [queueItems]);

  // Trigger Drawer View
  const handleOpenDrawer = (item: any, type: 'task' | 'story', parentStory?: any, parentFeature?: any) => {
    setSelectedItem({ type, data: item, parentStory, parentFeature });
    setDrawerOpen(true);
    setEditMode(false);
    setDeleteConfirm(false);
    setStoryTab('spec');
    setYamlContent(null);
    if (type === 'story' && item.file) {
      fetchStoryYaml(item.file);
    }
  };

  const fetchStoryYaml = async (file: string) => {
    setLoadingYaml(true);
    setYamlContent(null);
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(file)}`);
      if (res.ok) {
        const data = await res.json();
        setYamlContent(data.content);
        setEditedYaml(data.content);
      }
    } catch {}
    finally { setLoadingYaml(false); }
  };

  const handleSaveYaml = async (file: string) => {
    setSavingYaml(true);
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(file)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedYaml }),
      });
      if (res.ok) {
        toast.success('Story saved');
        setYamlContent(editedYaml);
        setEditMode(false);
        fetchStories();
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to save');
      }
    } catch { toast.error('Failed to save story'); }
    finally { setSavingYaml(false); }
  };

  const handleDeleteStory = async (file: string) => {
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(file)}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Story deleted');
        setDrawerOpen(false);
        setDeleteConfirm(false);
        fetchStories();
      } else {
        const d = await res.json();
        toast.error(d.error || 'Failed to delete story');
      }
    } catch { toast.error('Failed to delete story'); }
  };

  const handleUpdateStoryStatus = async (file: string, status: string) => {
    try {
      const res = await fetch('/api/stories/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, status }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Status set to “${status}”`);
        // If file moved (done/), update selectedItem ref
        if (data.file && data.file !== file && selectedItem) {
          setSelectedItem(prev => prev ? { ...prev, data: { ...prev.data, file: data.file, status } } : null);
        }
        fetchStories();
      } else {
        toast.error(data.error || 'Could not update status');
      }
    } catch { toast.error('Failed to update status'); }
  };

  // ─── Rendering Helpers ───

  const getStoryTitle = (item: any) => {
    if (item.kind === 'FeatureStory' || !!item.feature) {
      return item.feature?.name || item.dbName || item.file;
    }
    return item.metadata?.name || item.dbName || item.file;
  };

  const getStoryIcon = (item: any) => {
    if (item.kind === 'FeatureStory' || !!item.feature) {
      return item.metadata?.icon || '🧩';
    }
    return item.metadata?.icon || '📦';
  };

  const getStoryDesc = (item: any) => {
    if (item.kind === 'FeatureStory' || !!item.feature) {
      return item.feature?.description || 'Feature spec story';
    }
    return item.metadata?.description || 'Core system spec story';
  };

  // ─── JSX Renders ───

  return (
    <div className={cn(
      "relative",
      viewMode === 'board'
        ? "h-full flex flex-col overflow-hidden gap-3 pb-2"
        : "space-y-3 pb-6"
    )}>
      {/* Visual background atmospheric lights */}
      <div className="absolute -top-20 left-10 w-96 h-96 bg-primary/5 rounded-full filter blur-[120px] pointer-events-none -z-10" />
      <div className="absolute -top-30 right-20 w-80 h-80 bg-cyan-500/5 rounded-full filter blur-[100px] pointer-events-none -z-10" />

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 1. TOP HEADER CONSOLE                                                  */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <div className="space-y-2 md:space-y-4 pb-3 md:pb-4 select-none shrink-0 border-b border-border/40 px-1">
        {/* Main flex-row: Project Info on Left, Actions on Right */}
        <div className="flex items-center justify-between gap-2">
          
          {/* Left Column: Title + version */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-lg md:text-2xl shrink-0">🏭</span>
            <div className="min-w-0">
              <h1 className="text-sm md:text-xl font-extrabold tracking-tight text-foreground flex items-center gap-1.5 flex-wrap">
                <span className="truncate">{appRollup?.name || 'Loading Project...'}</span>
                <Badge variant="outline" className="text-[9px] font-bold px-1.5 py-0.5 border-border bg-muted/40 uppercase shrink-0">
                  v{appRollup?.version || '0.0.1'}
                </Badge>
                {queueRunning && (
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                )}
              </h1>
              {/* Stack badges — hidden on mobile to save space */}
              <div className="hidden md:flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground/80 mt-1">
                {appRollup?.stack && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground/80 py-0.5 px-1.5 bg-muted/20">
                      ⚡ {appRollup.stack.framework}
                    </Badge>
                    {appRollup.stack.language && (
                      <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground/80 py-0.5 px-1.5 bg-muted/20">
                        🏷️ {appRollup.stack.language}
                      </Badge>
                    )}
                    {appRollup.stack.database && (
                      <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground/80 py-0.5 px-1.5 bg-muted/20">
                        🗄️ {appRollup.stack.database}
                      </Badge>
                    )}
                  </div>
                )}
                {appRollup?.description && (
                  <span className="text-[10.5px] text-muted-foreground/60 border-l border-border/40 pl-3 max-w-xl truncate" title={appRollup.description}>
                    {appRollup.description}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Compact Action Toolbar */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Dev App Server Controls Pill */}
            <div className="flex items-center border border-border/60 rounded-md bg-background/40 backdrop-blur-xs p-0.5 h-6.5 text-[10px] select-none">
              <div className="flex items-center gap-1 px-1">
                <Activity className={cn("h-2.5 w-2.5", runStatus === 'running' ? "text-emerald-500" : "text-muted-foreground")} />
                <Badge className={cn(
                  "text-[8px] font-bold px-1 h-3.5 rounded-sm items-center justify-center hidden sm:flex",
                  runStatus === 'running' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                  runStatus === 'starting' ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse" :
                  "bg-muted text-muted-foreground border border-border"
                )}>
                  {runStatus === 'running' ? `:${runPort || 3000}` : runStatus}
                </Badge>
              </div>
              <Separator orientation="vertical" className="h-3.5 mx-0.5" />
              {runStatus === 'stopped' ? (
                <button
                  onClick={handleStartApp}
                  disabled={isActionLoading}
                  className="tap-shrink h-5 w-5 flex items-center justify-center text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-sm"
                >
                  <Play className="h-2.5 w-2.5" />
                </button>
              ) : (
                <button
                  onClick={handleStopApp}
                  disabled={isActionLoading}
                  className="tap-shrink h-5 w-5 flex items-center justify-center text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-sm"
                >
                  <Square className="h-2.5 w-2.5" />
                </button>
              )}
              {runStatus === 'running' && (
                <>
                  <Separator orientation="vertical" className="h-3.5 mx-0.5" />
                  <button
                    onClick={() => window.open(`http://localhost:${runPort || 3000}`, '_blank')}
                    className="tap-shrink h-5 w-5 flex items-center justify-center text-primary hover:bg-primary/10 rounded-sm"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                </>
              )}
            </div>

            {/* Refresh */}
            <button
              onClick={handleSyncRoadmap}
              disabled={syncing}
              className="tap-shrink h-6.5 w-6.5 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              title="Refresh project data"
            >
              <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Controls & Filter Bar — single row on mobile, two rows on desktop */}
        <div className="flex flex-col gap-1.5 select-none">
          <div className="flex items-center gap-1.5 justify-between">
            {/* Left: View tabs */}
            <div className="flex items-center gap-0.5 p-0.5 bg-muted/60 border rounded-md h-8 shrink-0">
              <button
                onClick={() => setViewMode('board')}
                className={cn(
                  'tap-shrink rounded-sm text-[10px] gap-1 h-7 px-2.5 flex items-center',
                  viewMode === 'board' ? 'bg-background shadow-xs text-foreground font-bold' : 'text-muted-foreground'
                )}
              >
                <Columns className="h-3.5 w-3.5" />
                <span>Board</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'tap-shrink rounded-sm text-[10px] gap-1 h-7 px-2.5 flex items-center',
                  viewMode === 'list' ? 'bg-background shadow-xs text-foreground font-bold' : 'text-muted-foreground'
                )}
              >
                <ListTodo className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Roadmap</span>
              </button>
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-1.5 ml-auto">
              {/* Search — full width input on desktop, icon-only on mobile */}
              <div className="relative hidden sm:flex w-36 md:w-44">
                <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground/75" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-7 h-8 text-[10px] rounded-md bg-muted/30 w-full border-border/80"
                />
              </div>

              {/* Mobile search button */}
              <button
                onClick={() => setShowMobileFilters(true)}
                className="sm:hidden tap-shrink h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                title="Search & Filter"
              >
                <Search className="h-3.5 w-3.5" />
              </button>

              {/* Filters */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (window.innerWidth < 640) {
                    setShowMobileFilters(true);
                  } else {
                    setShowDesktopFilters(!showDesktopFilters);
                  }
                }}
                className={cn(
                  "h-8 text-[10px] gap-1 rounded-md px-2 sm:px-2.5 border-border bg-background hover:bg-muted/80 shrink-0",
                  (showDesktopFilters || epicFilter !== 'all' || statusFilter !== 'all') && "border-primary text-primary bg-primary/5"
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Filters</span>
                {(epicFilter !== 'all' || statusFilter !== 'all') && (
                  <span className="flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                )}
              </Button>

              {/* New Story — hidden on mobile (FAB handles it), shown on desktop */}
              <button
                onClick={() => setShowStoryChat(true)}
                className="tap-shrink hidden sm:flex h-8 px-2.5 items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground font-bold hover:bg-primary/90 shadow-sm text-[10px] shrink-0"
                title="New Story"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span>New Story</span>
              </button>

              {/* Build Ready — icon only on mobile, full label on desktop */}
              <button
                onClick={handleBuildReadyStories}
                disabled={queueRunning || syncing}
                className={cn(
                  'tap-shrink h-8 px-2.5 flex items-center justify-center gap-1.5 rounded-md font-bold text-[10px] transition-all shrink-0',
                  queueRunning ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white'
                )}
                title="Build Ready Stories"
              >
                <Rocket className={cn('h-3.5 w-3.5 shrink-0', queueRunning && 'animate-bounce')} />
                <span className="hidden sm:inline">Build Ready</span>
              </button>

              {/* Loading indicator */}
              {loading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
              )}

            </div>
          </div>

          {/* Desktop Collapsible Inline Filters Sub-row */}
          {showDesktopFilters && (
            <div className="hidden md:flex items-center gap-4 px-3 py-1.5 bg-muted/15 border border-border/40 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200 select-none">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground font-mono font-semibold uppercase tracking-wider">Epic:</span>
                <select
                  value={epicFilter}
                  onChange={e => setEpicFilter(e.target.value)}
                  className="h-6.5 px-2 rounded-md border border-border/60 bg-background text-[10px] text-foreground focus:ring-1 focus:ring-primary w-40 cursor-pointer"
                >
                  <option value="all">All Epics</option>
                  {appRollup?.features?.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground font-mono font-semibold uppercase tracking-wider">Status:</span>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="h-6.5 px-2 rounded-md border border-border/60 bg-background text-[10px] text-foreground focus:ring-1 focus:ring-primary w-32 cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                  <option value="in-progress">In Progress</option>
                  <option value="failed">Failed</option>
                  <option value="done">Done</option>
                </select>
              </div>

              {(epicFilter !== 'all' || statusFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEpicFilter('all');
                    setStatusFilter('all');
                  }}
                  className="h-6.5 text-[10px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 gap-1 px-2 ml-auto rounded-md"
                >
                  <X className="h-3 w-3" />
                  <span>Reset Filters</span>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <StoryChat open={showStoryChat} onOpenChange={setShowStoryChat} onStorySaved={fetchStories} />

      {editingStory && (
        <StoryEditor
          storyFile={editingStory.file}
          storyName={editingStory.name}
          onClose={() => setEditingStory(null)}
          onSaved={() => { fetchStories(); fetchRollup(true); }}
        />
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* EMPTY STATE PROMPT BANNER                                              */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {!loading && mergedStories.length === 0 && !promptDismissed && (
        <div className="mx-1 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="relative rounded-xl border border-primary/20 bg-gradient-to-r from-primary/8 via-violet-500/5 to-transparent p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* Dismiss button */}
            <button
              onClick={handleDismissBanner}
              className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground transition-colors rounded-md p-0.5 hover:bg-muted"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            {/* Icon */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <span className="text-lg">✦</span>
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0 pr-6">
              <p className="text-xs font-semibold text-foreground">
                No stories yet — use an AI agent to scaffold your specs
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                Copy the prompt below and paste it into any AI agent. It will read the Factory skill file
                and walk you through creating your app spec, feature specs, and stories.
              </p>
            </div>

            {/* CTA */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPromptModal(true)}
              className="shrink-0 text-xs h-8 gap-1.5 border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50"
            >
              <span>Get Prompt</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Full prompt modal */}
      <NewProjectGuide
        open={showPromptModal}
        projectName={appRollup?.name || 'my-project'}
        onClose={() => setShowPromptModal(false)}
        onStartCreating={() => {
          setShowPromptModal(false);
          setShowStoryChat(true);
        }}
      />

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 3. VIEW 1: KANBAN BOARD                                               */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {viewMode === 'board' && (
        <MobileKanbanBoard
          backlogStories={backlogStories}
          readyStories={readyStories}
          buildingStories={buildingStories}
          doneStories={doneStories}
          mergedStories={mergedStories}
          epicColorMap={epicColorMap}
          handleOpenDrawer={handleOpenDrawer}
          handleValidateStory={handleValidateStory}
          handleSingleBuild={handleSingleBuild}
          activeAction={activeAction}
          handleDragOver={handleDragOver}
          handleDrop={handleDrop}
          handleDragStart={handleDragStart}
          showEpicLegend={showEpicLegend}
          appRollup={appRollup}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* 4. VIEW 2: ROADMAP HIERARCHICAL LIST VIEW                              */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <Card className="border border-border/80 bg-background/55 backdrop-blur-md shadow-lg overflow-hidden">
          <CardHeader className="border-b border-border/50 p-5">
            <CardTitle className="text-base font-bold text-foreground">Hierarchical Backlog Tree</CardTitle>
            <CardDescription className="text-xs text-muted-foreground leading-normal">
              Organized by Epic Features. Track task checklists and check them off to automatically sync with SQLite.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            {appRollup?.features && appRollup.features.length > 0 ? (
              <div className="divide-y divide-border/60">
                {appRollup.features
                  .filter(f => epicFilter === 'all' || f.id === epicFilter)
                  .map(feature => {
                    const isExpanded = !!expandedFeatures[feature.id];
                    const statusCfg = epicStatusMap[feature.status] || epicStatusMap.pending;

                    // Filter stories of this feature
                    const featureStoriesList = filteredStoriesList.filter(s => s.epicParent?.id === feature.id);

                    if (epicFilter === 'all' && featureStoriesList.length === 0 && searchQuery) return null;

                    return (
                      <div key={feature.id} className="group">
                        {/* FEATURE HEADER */}
                        <div
                          className={cn(
                            "flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 select-none transition-colors",
                            isExpanded && "bg-muted/10"
                          )}
                          onClick={() => setExpandedFeatures(p => ({ ...p, [feature.id]: !isExpanded }))}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {isExpanded ? (
                              <ChevronDown className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
                            )}
                            <Layers className="h-4.5 w-4.5 text-indigo-500 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-foreground truncate">{feature.name}</span>
                                <Badge className={cn("text-[9px] font-bold py-0.5 rounded-md border", statusCfg.bg)}>
                                  {statusCfg.label}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{feature.description}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-5 shrink-0 ml-4">
                            {/* Epic Progress */}
                            <div className="hidden sm:flex flex-col items-end gap-1 select-none">
                              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Progress</span>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-24 bg-muted border border-border/40 rounded-full overflow-hidden">
                                  <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${feature.progressPercent}%` }} />
                                </div>
                                <span className="text-[11px] font-bold text-foreground">{feature.progressPercent}%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* STORIES CONTAINER */}
                        {isExpanded && (
                          <div className="pl-4 sm:pl-8 pr-4 py-2 bg-muted/5 border-t border-border/20 space-y-2.5">
                            {featureStoriesList.length > 0 ? (
                              featureStoriesList.map(item => (
                                <ListStoryRow
                                  key={item.file}
                                  item={item}
                                  expanded={!!expandedStories[item.file]}
                                  onToggleExpand={() => setExpandedStories(p => ({ ...p, [item.file]: !expandedStories[item.file] }))}
                                  onSelect={handleOpenDrawer}
                                  onValidate={handleValidateStory}
                                  onBuild={handleSingleBuild}
                                  onToggleTask={handleUpdateTaskStatus}
                                  updatingTaskId={updatingTaskId}
                                  activeAction={activeAction}
                                  allStories={mergedStories}
                                />
                              ))
                            ) : (
                              <div className="text-xs text-muted-foreground italic py-3 pl-6">No stories mapped to this feature yet.</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No roadmap features populated. Start by syncing specs!
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 5. VIEW 3: PIPELINE EXECUTION / QUEUE VIEW                             */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {viewMode === 'queue' && (() => {
        const selectedQueueItem = queueItems.find(i => i.id === selectedQueueItemId) ?? null;
        const selectedSpecName = selectedQueueItem?.storyFile || selectedQueueItem?.specFile || '';
        const selectedMatchedStory = mergedStories.find(s => s.file === selectedSpecName || getSlug(s.file) === getSlug(selectedSpecName));
        // For running items: use live streamed log. For others: use stored output from the item.
        const panelLog = selectedQueueItem
          ? (selectedQueueItem.status === 'running' ? (buildOutput || selectedQueueItem.output || '') : (selectedQueueItem.output || selectedQueueItem.error || ''))
          : (buildOutput || '');
        const panelLabel = selectedQueueItem
          ? (selectedMatchedStory?.metadata?.name || selectedMatchedStory?.feature?.name || selectedMatchedStory?.dbName || (selectedQueueItem as any).displayName || selectedQueueItem.storyFile?.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '') || 'Select a build')
          : 'Live agent log console';
        const isSelectedRunning = selectedQueueItem?.status === 'running';

        return (
        <div className="max-w-3xl mx-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Queue Timeline — chronological list of items */}
          <Card className="border border-border/80 bg-background/55 backdrop-blur-md shadow-lg overflow-hidden w-full h-[500px] md:h-[calc(100vh-170px)] flex flex-col">
            <CardHeader className="border-b border-border/50 p-4 shrink-0 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold text-foreground">Build Timeline</CardTitle>
                <CardDescription className="text-[11px] text-muted-foreground mt-0.5">
                  {queueStats.total} total · {queueStats.pending} pending · {queueStats.running} running · {queueStats.completed} done · {queueStats.failed} failed
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={handleClearQueue} className="h-7 text-[10px] gap-1 px-2.5 border-border rounded-md hover:bg-muted/80">
                  <XCircle className="h-3 w-3" />
                  Clear
                </Button>
                {queueRunning && (
                  <Button variant="destructive" size="sm" onClick={handleStopQueue} className="h-7 text-[10px] gap-1 px-2.5 rounded-md">
                    <Square className="h-3 w-3" />
                    Stop
                  </Button>
                )}
              </div>
            </CardHeader>
            <ScrollArea className="flex-1">
              {queueItems.length > 0 ? (
                <div className="p-3 space-y-2.5">
                    {queueItems.map((item, idx) => {
                      const specName = item.storyFile || item.specFile || '';
                      const isRunning = item.status === 'running';
                      const isFailed = item.status === 'failed';
                      const isDone = item.status === 'completed';
                      const isBlocked = item.status === 'blocked';
                      const isSelected = item.id === selectedQueueItemId;
                      const matchedStory = mergedStories.find(s => s.file === specName || getSlug(s.file) === getSlug(specName));
                      const humanReadableName = matchedStory?.metadata?.name || matchedStory?.feature?.name || matchedStory?.dbName || (item as any).displayName || specName.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '') || `Queue item ${idx + 1}`;
                      const epicParent = matchedStory?.epicParent;
                      const epicColor = epicParent ? epicColorMap.get(epicParent.id) : undefined;
                      const desc = matchedStory?.metadata?.description || matchedStory?.feature?.description || '';
                      const totalTasks = matchedStory?.checklistTasks?.length || 0;
                      const doneTasks = matchedStory?.checklistTasks?.filter((t: any) => t.status === 'completed').length || 0;
                      const durationSec = item.durationMs ? Math.round(item.durationMs / 1000) : null;
                      const statusCfg = isRunning ? storyStatusMap.running : isFailed ? storyStatusMap.failed : isDone ? storyStatusMap.done : isBlocked ? { label: 'Blocked', bg: 'bg-rose-500/10 text-rose-400 border-rose-500/30', dot: 'bg-rose-500' } : storyStatusMap.draft;

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "rounded-xl border transition-all duration-150 cursor-pointer overflow-hidden",
                            isRunning && "border-primary/40 bg-primary/5 shadow-sm",
                            isFailed && "border-rose-500/30 bg-rose-500/5",
                            isDone && "border-emerald-500/20 bg-emerald-500/5",
                            isBlocked && "border-border/40 bg-muted/10 opacity-60",
                            !isRunning && !isFailed && !isDone && !isBlocked && "border-border/50 bg-background/40",
                            isSelected && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
                            epicColor && "border-l-2",
                            epicColor?.border
                          )}
                          onClick={() => { setSelectedQueueItemId(item.id); setBuildLogsOpen(true); }}
                        >
                          <div className="p-3">
                            {/* Top row: name + live dot + actions */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-xs text-foreground truncate" title={humanReadableName}>
                                    {humanReadableName}
                                  </span>
                                  {isRunning && (
                                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                                    </span>
                                  )}
                                </div>
                                {desc && (
                                  <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5 leading-normal">{desc}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                {isFailed && (
                                  <Button size="icon" variant="ghost" className="h-5 w-5 text-primary hover:bg-primary/10 rounded" onClick={() => handleRetryItem(item.id)}>
                                    <RefreshCw className="h-3 w-3" />
                                  </Button>
                                )}
                                <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded" onClick={() => handleRemoveQueueItem(item.id)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>

                            {/* Bottom meta row */}
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <Badge variant="outline" className={cn("text-[8px] font-bold h-4 px-1.5 rounded uppercase border", statusCfg.bg)}>
                                {statusCfg.label}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">{item.kind?.replace('Story', '') || 'Story'}</span>
                              {epicParent && epicColor && (
                                <Badge variant="outline" className={cn("text-[8px] font-bold h-4 px-1.5 rounded border", epicColor.badge)}>
                                  {epicParent.name}
                                </Badge>
                              )}
                              {totalTasks > 0 && (
                                <span className="text-[10px] text-muted-foreground ml-auto">
                                  {doneTasks}/{totalTasks} tasks
                                </span>
                              )}
                              {durationSec !== null && isDone && (
                                <span className="text-[10px] text-muted-foreground ml-auto">{durationSec}s</span>
                              )}
                              {item.addedAt && (
                                <span title={item.addedAt} className="text-[10px] text-muted-foreground ml-auto">
                                  {new Date(item.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                              {(item.output || item.error) && (
                                <span title="Has logs" className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-center text-muted-foreground px-4">
                  <Package className="h-10 w-10 text-muted-foreground/30 mb-2" />
                  <p className="text-xs font-semibold text-foreground">Queue is empty</p>
                  <p className="text-[11px] text-muted-foreground max-w-xs mt-1">
                    Click <strong>Build Ready Stories</strong> on the board or hit the rocket icon on any story card.
                  </p>
                </div>
              )}

            </ScrollArea>
          </Card>

          {/* Build Queue Logs Sliding Drawer */}
          <Sheet open={buildLogsOpen} onOpenChange={setBuildLogsOpen}>
            <SheetContent side="right" className="w-full sm:max-w-2xl bg-zinc-950 border-l border-border/40 shadow-2xl flex flex-col p-0 overflow-hidden text-zinc-300 font-mono focus:outline-none select-none">
              <div className="bg-zinc-900 border-b border-border/40 px-4 py-3 shrink-0 flex items-center justify-between">
                <span className="flex items-center gap-2 text-zinc-300 text-xs font-bold font-mono min-w-0">
                  <Terminal className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate" title={panelLabel}>{panelLabel}</span>
                  {isSelectedRunning && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                  )}
                  {selectedQueueItem && !isSelectedRunning && (
                    <Badge variant="outline" className={cn(
                      "text-[8px] font-bold h-4 px-1.5 rounded uppercase border ml-1 shrink-0",
                      selectedQueueItem.status === 'failed' ? "bg-rose-500/10 text-rose-400 border-rose-500/25" :
                      selectedQueueItem.status === 'completed' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" :
                      "bg-muted border-border text-muted-foreground"
                    )}>
                      {selectedQueueItem.status}
                    </Badge>
                  )}
                </span>
                <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider shrink-0 ml-2">
                  {isSelectedRunning ? 'live' : selectedQueueItem ? 'stored log' : 'idle'}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-zinc-300 space-y-1 select-text scrollbar-thin scrollbar-thumb-zinc-800">
                {panelLog ? (
                  panelLog.split('\n').map((l, i) => (
                    <div key={i} className="leading-5 whitespace-pre-wrap">{l || '\u00A0'}</div>
                  ))
                ) : (
                  <div className="text-zinc-500 italic py-6 text-center">
                    {selectedQueueItem
                      ? `No logs captured for this ${selectedQueueItem.kind.replace('Story', '')} build yet.`
                      : 'Select a build item from the timeline to view its logs.'}
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
        );
      })()}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 6. SLIDING DETAILS DRAWER                                             */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <Sheet open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) { setEditMode(false); setDeleteConfirm(false); } }}>
        <SheetContent className="w-full sm:max-w-2xl bg-background border-l border-border/60 shadow-2xl flex flex-col p-0 overflow-hidden focus:outline-none">
          {selectedItem && (
            <div className="flex flex-col h-full min-h-0">

              {/* ── Header ── */}
              <div className="shrink-0 border-b border-border/50 bg-muted/20 px-5 py-4 space-y-3">
                <div className="flex items-center gap-1.5">
                    {selectedItem.type === 'story' && (
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {selectedItem.data.kind === 'FeatureStory' ? 'feature' : 'app story'}
                      </span>
                    )}
                  </div>
                <SheetTitle className="text-lg font-bold text-white leading-snug pr-2 tracking-tight">
                  {selectedItem.type === 'task' ? selectedItem.data.title : getStoryTitle(selectedItem.data)}
                </SheetTitle>
                {selectedItem.type === 'task' ? (
                  <SheetDescription className="text-xs text-zinc-500 leading-relaxed line-clamp-2 pr-2">
                    {selectedItem.parentStory?.name || ''}
                  </SheetDescription>
                ) : getStoryDesc(selectedItem.data) ? (
                  <SheetDescription className="text-sm text-zinc-400 leading-relaxed line-clamp-3 pr-2 mt-1">
                    {getStoryDesc(selectedItem.data)}
                  </SheetDescription>
                ) : null}

              </div>

              {/* ── Action Bar ── */}
              {selectedItem.type === 'story' && (
                <div className="shrink-0 border-b border-border/40 bg-muted/10 px-4 py-2.5 flex items-center gap-1.5 flex-wrap">
                  {!editMode ? (
                    <>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" disabled={loadingYaml}
                        onClick={() => { setEditMode(true); setStoryTab('raw'); }}
                        className="h-7 px-3 gap-1.5 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800 font-sans">
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      {!deleteConfirm ? (
                        <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm(true)}
                          className="h-7 px-3 gap-1.5 text-[11px] text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 font-sans">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-rose-400 font-semibold font-sans">Delete?</span>
                          <Button size="sm" onClick={() => handleDeleteStory(selectedItem.data.file)}
                            className="h-7 px-2.5 text-[11px] bg-rose-600 hover:bg-rose-500 text-white font-semibold font-sans">Yes</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm(false)}
                            className="h-7 px-2.5 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800 font-sans">No</Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <Button size="sm" disabled={savingYaml} onClick={() => handleSaveYaml(selectedItem.data.file)}
                        className="h-7 px-3 gap-1.5 text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold font-sans">
                        {savingYaml ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save changes
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => { setEditMode(false); setEditedYaml(yamlContent || ''); setStoryTab('raw'); }}
                        className="h-7 px-3 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800 font-sans">
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              )}



              {/* ── Tabs ── */}
              {selectedItem.type === 'story' && (
                <div className="shrink-0 border-b border-border/40 bg-muted/10 px-4 flex items-end">
                  {([{ key: 'spec', label: 'Spec' }, { key: 'raw', label: 'YAML' }, { key: 'tasks', label: 'Tasks' }] as const).map(({ key, label }) => (
                    <button key={key} onClick={() => setStoryTab(key)}
                      className={cn('px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-all font-sans',
                        storyTab === key ? 'border-violet-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      )}>
                      {label}
                      {key === 'tasks' && (selectedItem.data.checklistTasks?.length ?? 0) > 0 && (
                        <span className="ml-1.5 text-[9px] bg-zinc-700 text-zinc-300 rounded-full px-1.5 font-mono">{selectedItem.data.checklistTasks.length}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Content Body ── */}
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800">

                {/* TASK DETAIL */}
                {selectedItem.type === 'task' && (
                  <div className="p-5 space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Status</label>
                      <select value={selectedItem.data.status}
                        onChange={e => handleUpdateTaskStatus(selectedItem.data.fullId, e.target.value as any)}
                        className="w-full h-9 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-100 px-3 focus:outline-none focus:ring-1 focus:ring-violet-500">
                        <option value="pending">Pending</option>
                        <option value="running">Running</option>
                        <option value="completed">Completed</option>
                        <option value="failed">Failed</option>
                      </select>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">Task ID</span>
                        <span className="font-mono text-zinc-200 font-bold">{selectedItem.data.fullId}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">Feature parent</span>
                        <span className="font-semibold text-zinc-200">{selectedItem.parentFeature?.name || 'General Core'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* STORY — SPEC TAB */}
                {selectedItem.type === 'story' && storyTab === 'spec' && (
                  <div className="p-6 space-y-6">

                    {/* Status row */}
                    <div>
                      <p className="text-xs font-semibold text-zinc-400 mb-1.5">Status</p>
                      <select
                        value={selectedItem.data.status ?? 'draft'}
                        onChange={e => handleUpdateStoryStatus(selectedItem.data.file, e.target.value)}
                        className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 text-sm text-zinc-100 px-3 focus:outline-none focus:ring-1 focus:ring-violet-500/60 font-sans cursor-pointer"
                      >
                        <option value="draft">Draft</option>
                        <option value="ready">Ready to build</option>
                        <option value="review">In review</option>
                        <option value="done">Done</option>
                      </select>
                    </div>

                    {/* Story metadata */}
                    <div className="space-y-1">
                      {[
                        { label: 'File', value: selectedItem.data.file, mono: true },
                        { label: 'Type', value: selectedItem.data.kind === 'FeatureStory' ? 'Feature' : 'App Story', mono: false },
                        ...(selectedItem.data.phase ? [{ label: 'Build phase', value: String(selectedItem.data.phase), mono: false }] : []),
                        ...(selectedItem.data.target?.app ? [{ label: 'Target app', value: selectedItem.data.target.app, mono: true }] : []),
                      ].map(({ label, value, mono }) => (
                        <div key={label} className="flex items-start justify-between py-2 border-b border-zinc-800/60 gap-4">
                          <span className="text-[12px] text-zinc-500">{label}</span>
                          <span className={cn('text-[12px] text-right', mono ? 'font-mono text-zinc-300 break-all' : 'font-medium text-zinc-200')}>
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Build dependencies */}
                    {selectedItem.data.dependsOn && selectedItem.data.dependsOn.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-zinc-400">Must build first</p>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedItem.data.dependsOn.map((dep: string) => {
                            const depStory = mergedStories.find((s: any) => getSlug(s.file) === dep || s.file === dep);
                            const depStatus = depStory ? getEffectiveStatus(depStory) : 'unknown';
                            const isDone = depStatus === 'done' || depStatus === 'completed';
                            return (
                              <span key={dep}
                                onClick={() => depStory && handleOpenDrawer(depStory, 'story', undefined, depStory.epicParent)}
                                className={cn(
                                  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-mono cursor-pointer transition-all',
                                  isDone
                                    ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-400 hover:border-emerald-600/60'
                                    : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                                )}>
                                {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5 text-zinc-500" />}
                                {dep}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Related stories */}
                    {(() => {
                      const { prerequisites, dependents, peers } = getRelatedStories(selectedItem.data, mergedStories);
                      const sections = [
                        { title: 'Depends on', items: prerequisites },
                        { title: 'Needed by', items: dependents },
                        { title: 'Same feature group', items: peers },
                      ].filter(s => s.items.length > 0);
                      if (!sections.length) return null;
                      return (
                        <div className="space-y-4">
                          {sections.map(({ title, items }) => (
                            <div key={title} className="space-y-2">
                              <p className="text-xs font-semibold text-zinc-400">{title}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {items.map((s: any) => {
                                  const st = getEffectiveStatus(s);
                                  const isDone = st === 'done' || st === 'completed';
                                  return (
                                    <span key={s.file}
                                      onClick={() => handleOpenDrawer(s, 'story', undefined, s.epicParent)}
                                      className={cn(
                                        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-mono cursor-pointer transition-all',
                                        isDone
                                          ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-400 hover:border-emerald-600/60'
                                          : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                                      )}>
                                      {isDone
                                        ? <CheckCircle2 className="h-3.5 w-3.5" />
                                        : <span className={cn('h-2 w-2 rounded-full', storyStatusMap[st]?.dot || 'bg-zinc-600')} />}
                                      {getSlug(s.file)}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Deployment config */}
                    {selectedItem.data.deployment && Object.keys(selectedItem.data.deployment).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-zinc-400">Deployment</p>
                        <div className="space-y-1">
                          {Object.entries(selectedItem.data.deployment)
                            .filter(([, v]) => v !== undefined && v !== null)
                            .map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between py-2 border-b border-zinc-800/60">
                                <span className="text-[12px] text-zinc-500 capitalize">{k}</span>
                                <span className="font-mono text-[12px] text-zinc-300">{String(v)}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STORY — RAW YAML TAB */}
                {selectedItem.type === 'story' && storyTab === 'raw' && (
                  <div className="flex flex-col" style={{ minHeight: '400px' }}>
                    <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800/60 bg-zinc-900/20">
                      <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider font-semibold">
                        {editMode ? '● editing' : selectedItem.data.file}
                      </span>
                      {!editMode && yamlContent && (
                        <button onClick={() => { navigator.clipboard.writeText(yamlContent); setCopiedYaml(true); setTimeout(() => setCopiedYaml(false), 1500); }}
                          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors">
                          <Copy className="h-3 w-3" />{copiedYaml ? 'Copied!' : 'Copy'}
                        </button>
                      )}
                    </div>
                    {loadingYaml ? (
                      <div className="flex-1 flex items-center justify-center py-16">
                        <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
                      </div>
                    ) : editMode ? (
                      <textarea value={editedYaml} onChange={e => setEditedYaml(e.target.value)} spellCheck={false}
                        className="w-full bg-zinc-950 text-zinc-200 font-mono text-[11px] leading-6 p-4 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                        style={{ minHeight: '400px' }}
                        placeholder="# YAML content..." />
                    ) : yamlContent ? (
                      <YamlViewer content={yamlContent} />
                    ) : (
                      <div className="flex-1 flex items-center justify-center py-16">
                        <p className="text-xs text-zinc-600 italic">Failed to load YAML</p>
                      </div>
                    )}
                  </div>
                )}

                {/* STORY — TASKS TAB */}
                {selectedItem.type === 'story' && storyTab === 'tasks' && (
                  <div className="p-5 space-y-2">
                    {selectedItem.data.checklistTasks && selectedItem.data.checklistTasks.length > 0 ? (
                      selectedItem.data.checklistTasks.map((task: Task) => {
                        const isDone = task.status === 'completed';
                        return (
                          <div key={task.fullId} className={cn('flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all',
                            isDone ? 'border-zinc-800/40 bg-zinc-900/20' : 'border-zinc-800 bg-zinc-900/50')}>
                            <button disabled={updatingTaskId !== null}
                              onClick={() => handleUpdateTaskStatus(task.fullId, isDone ? 'pending' : 'completed')}
                              className={cn('h-5 w-5 rounded-md border flex items-center justify-center transition-all shrink-0 mt-0.5',
                                isDone ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-600 hover:border-zinc-400')}>
                              {isDone && <Check className="h-3 w-3 stroke-[3]" />}
                            </button>
                            <span className={cn('text-[11px] leading-snug font-sans', isDone ? 'text-zinc-500 line-through' : 'text-zinc-200')}>
                              <span className="font-mono text-[9px] text-zinc-600 bg-zinc-800/60 px-1.5 py-0.5 rounded border border-zinc-700/50 mr-2">{task.id}</span>
                              {task.title}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex flex-col items-center justify-center h-40 text-center">
                        <ListTodo className="h-7 w-7 text-zinc-700 mb-2" />
                        <p className="text-xs text-zinc-500 font-sans">No checklist tasks defined.</p>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>



      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 6. MOBILE FILTERS SHEET                                                */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <Sheet open={showMobileFilters} onOpenChange={setShowMobileFilters}>
        <SheetContent side="bottom" className="h-[auto] max-h-[85vh] p-4 bg-background/95 backdrop-blur-md rounded-t-xl border-t border-border focus:outline-none select-none">
          <SheetHeader className="pb-3 border-b border-border/40 shrink-0">
            <SheetTitle className="text-sm font-bold text-foreground">Filter Stories</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Apply search queries or status filters to narrow down the stories.
            </SheetDescription>
          </SheetHeader>
          <div className="py-4 space-y-4">
            {/* Search box */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Search Query</label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground/75" />
                <Input
                  placeholder="Search stories..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9.5 h-10 text-xs rounded-md bg-muted/30 w-full"
                />
              </div>
            </div>

            {/* Epic Filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Epic / Feature</label>
              <select
                value={epicFilter}
                onChange={e => setEpicFilter(e.target.value)}
                className="h-10 w-full px-2.5 rounded-md border border-border bg-background text-xs text-foreground focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="all">All Epics</option>
                {appRollup?.features?.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Status</label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="h-10 w-full px-2.5 rounded-md border border-border bg-background text-xs text-foreground focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="ready">Ready</option>
                <option value="in-progress">In Progress</option>
                <option value="failed">Failed</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2.5 pt-4 border-t border-border/40">
            {(searchQuery || epicFilter !== 'all' || statusFilter !== 'all') && (
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setEpicFilter('all');
                  setStatusFilter('all');
                }}
                className="flex-1 h-9 text-xs rounded-md"
              >
                Reset
              </Button>
            )}
            <Button
              onClick={() => setShowMobileFilters(false)}
              className="flex-1 h-9 text-xs rounded-md bg-primary text-primary-foreground font-semibold"
            >
              Apply
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 7. LOCAL SERVER LOGS DRAWER (SIDEBAR)                                 */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <Sheet open={serverLogsOpen} onOpenChange={setServerLogsOpen}>
        <SheetContent className="w-[90%] sm:w-[480px] p-0 flex flex-col bg-zinc-950 border-l border-border/40 select-text focus:outline-none">
          <SheetHeader className="p-4 border-b border-border/40 shrink-0">
            <SheetTitle className="flex items-center gap-2 text-zinc-300 text-xs font-bold font-mono">
              <TerminalSquare className="h-4 w-4 text-emerald-500" />
              <span>LOCAL SERVER CONSOLE OUTPUT</span>
            </SheetTitle>
            <SheetDescription className="text-[10px] text-zinc-500 font-mono">
              Real-time terminal logs from modern Next.js development server.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-zinc-300 space-y-1 scrollbar-thin">
            {runLogs ? (
              runLogs.split('\n').map((l, i) => (
                <div key={i} className="leading-5 whitespace-pre-wrap">{l || '\u00A0'}</div>
              ))
            ) : (
              <div className="text-zinc-500 italic py-6 text-center">
                No server outputs yet. Click Play button in project header to start.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Sub-Components ───

interface EpicColor { border: string; badge: string; }

interface KanbanColumnProps {
  title: string;
  description: string;
  badgeColor: string;
  stories: any[];
  epicColorMap: Map<string, typeof EPIC_COLORS[0]>;
  onSelect: (item: any, type: 'task' | 'story', parentStory?: any, parentFeature?: any) => void;
  onValidate: (file: string, kind: string) => void;
  onBuild: (file: string, kind: string) => void;
  activeAction: { type: string; file: string } | null;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (e: React.DragEvent, file: string) => void;
  allStories?: any[];
}

// ─── MobileKanbanBoard ── unified board with reactive dots & proper height ──

function MobileKanbanBoard({
  backlogStories, readyStories, buildingStories, doneStories,
  mergedStories, epicColorMap,
  handleOpenDrawer, handleValidateStory, handleSingleBuild, activeAction,
  handleDragOver, handleDrop, handleDragStart,
  showEpicLegend, appRollup,
}: {
  backlogStories: any[]; readyStories: any[]; buildingStories: any[]; doneStories: any[];
  mergedStories: any[]; epicColorMap: Map<string, any>;
  handleOpenDrawer: any; handleValidateStory: any; handleSingleBuild: any; activeAction: any;
  handleDragOver: any; handleDrop: any; handleDragStart: any;
  showEpicLegend: boolean; appRollup: any;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeCol, setActiveCol] = useState(0);

  const COLS = [
    { title: 'Backlog', desc: 'Scaffold drafts or spec blueprints', badge: 'bg-amber-500/5 text-amber-300 border-amber-500/10', stories: backlogStories, status: 'draft', dot: 'bg-amber-400' },
    { title: 'Ready to Build', desc: 'Verified specifications awaiting launch', badge: 'bg-teal-500/5 text-teal-300 border-teal-500/10', stories: readyStories, status: 'ready', dot: 'bg-teal-400' },
    { title: 'In Progress', desc: 'Actively compiling or iterating', badge: 'bg-blue-500/5 text-blue-300 border-blue-500/10', stories: buildingStories, status: 'in-progress', dot: 'bg-blue-400' },
    { title: 'Completed', desc: 'Code written and tests passed', badge: 'bg-emerald-500/5 text-emerald-300 border-emerald-500/10', stories: doneStories, status: 'done', dot: 'bg-emerald-400' },
  ] as const;

  // Update active dot based on scroll position
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const colWidth = el.scrollWidth / COLS.length;
    const idx = Math.round(el.scrollLeft / colWidth);
    setActiveCol(Math.max(0, Math.min(COLS.length - 1, idx)));

  }, []);

  // Scroll to a column on dot click
  const scrollToCol = (i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const colWidth = el.scrollWidth / COLS.length;
    el.scrollTo({ left: i * colWidth, behavior: 'smooth' });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Epic Legend (desktop only, mobile would be too crowded) */}
      {showEpicLegend && appRollup?.features && appRollup.features.length > 0 && (
        <div className="shrink-0 hidden md:flex flex-wrap items-center gap-2 px-3 py-2 mb-3 bg-muted/15 border border-border/40 rounded-xl select-none">
          <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/70 shrink-0">Epic Colors:</span>
          {appRollup.features.map((f: any, idx: number) => {
            const swatchColors = ['#8b5cf6','#0ea5e9','#f59e0b','#f43f5e','#14b8a6','#d946ef','#84cc16','#f97316'];
            const color = EPIC_COLORS[idx % EPIC_COLORS.length];
            return (
              <span key={f.id} className="flex items-center gap-1.5 text-[10px] text-foreground">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: swatchColors[idx % swatchColors.length] }} />
                <span className="font-medium">{f.name}</span>
                <Badge variant="outline" className={cn('text-[7.5px] font-bold h-3.5 px-1 rounded border ml-0.5', color.badge)}>
                  {f.stories?.length ?? 0} stories
                </Badge>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Desktop: 4-column Kanban ── */}
      <div className="hidden md:grid md:grid-cols-2 xl:grid-cols-4 gap-4 flex-1 min-h-0 h-full">
        {COLS.map((col) => (
          <KanbanColumn
            key={col.title}
            title={col.title}
            description={col.desc}
            badgeColor={col.badge}
            stories={col.stories}
            epicColorMap={epicColorMap}
            onSelect={handleOpenDrawer}
            onValidate={handleValidateStory}
            onBuild={handleSingleBuild}
            activeAction={activeAction}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.status)}
            onDragStart={handleDragStart}
            allStories={mergedStories}
          />
        ))}
      </div>

      {/* ── Mobile: full-height horizontal snap carousel ── */}
      <div
        className="flex md:hidden flex-col"
        style={{
          height: 'calc(100dvh - 176px - 80px - env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Column dot indicator */}
        <div className="flex items-center justify-center gap-2 pb-2 shrink-0">
          {COLS.map((col, i) => (
            <button
              key={col.title}
              onClick={() => scrollToCol(i)}
              className="flex flex-col items-center gap-1 tap-shrink"
            >
              <div className={cn(
                'rounded-full transition-all duration-300',
                activeCol === i
                  ? `h-2 w-6 ${col.dot}`
                  : 'h-1.5 w-1.5 bg-muted-foreground/30'
              )} />
            </button>
          ))}
          <span className="text-[9px] text-muted-foreground/40 ml-1 font-medium">
            {COLS[activeCol].title}
          </span>
        </div>

        {/* Scrollable columns — each takes full screen width */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex flex-1 min-h-0 overflow-x-auto snap-x-mandatory gap-0"
          style={{ scrollbarWidth: 'none' } as React.CSSProperties}
        >
          {COLS.map((col, i) => (
            <div
              key={col.title}
              className="kanban-slide snap-center px-1"
            >
              <KanbanColumn
                title={col.title}
                description={col.desc}
                badgeColor={col.badge}
                stories={col.stories}
                epicColorMap={epicColorMap}
                onSelect={handleOpenDrawer}
                onValidate={handleValidateStory}
                onBuild={handleSingleBuild}
                activeAction={activeAction}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.status)}
                onDragStart={handleDragStart}
                allStories={mergedStories}
              />
            </div>
          ))}
        </div>
      </div>


    </div>
  );
}

function KanbanColumn({
  title,
  description,
  badgeColor,
  stories,
  epicColorMap,
  onSelect,
  onValidate,
  onBuild,
  activeAction,
  onDragOver,
  onDrop,
  onDragStart,
  allStories
}: KanbanColumnProps) {
  // Group stories into clusters of related items using their prerequisite, dependent, and peer links
  const clusters = useMemo(() => {
    if (!stories || stories.length === 0) return [];
    
    // Only group stories in "Ready to Build" column to keep the interface simple and clean.
    if (title !== 'Ready to Build') {
      return stories.map(s => [s]);
    }
    
    const pool = allStories || stories;
    
    const visited = new Set<string>();
    const result: any[][] = [];

    const getStoryBySlug = (slug: string) => {
      return stories.find(s => getSlug(s.file) === slug);
    };

    stories.forEach(story => {
      const slug = getSlug(story.file);
      if (visited.has(slug)) return;

      const cluster: any[] = [];
      const queue: any[] = [story];
      visited.add(slug);

      while (queue.length > 0) {
        const current = queue.shift();
        cluster.push(current);

        const { prerequisites, dependents, peers } = getRelatedStories(current, pool);
        const related = [...prerequisites, ...dependents, ...peers];

        related.forEach(rel => {
          const relSlug = getSlug(rel.file);
          const storyInCol = getStoryBySlug(relSlug);
          if (storyInCol && !visited.has(relSlug)) {
            visited.add(relSlug);
            queue.push(storyInCol);
          }
        });
      }
      result.push(cluster);
    });

    // Sort stories within each cluster in execution order by their index in the input stories array
    const sortedResult = result.map(cluster => {
      return [...cluster].sort((a, b) => {
        const idxA = stories.findIndex(s => getSlug(s.file) === getSlug(a.file));
        const idxB = stories.findIndex(s => getSlug(s.file) === getSlug(b.file));
        return idxA - idxB;
      });
    });

    // Sort the clusters themselves based on the original index of their first story
    return sortedResult.sort((a, b) => {
      const idxA = stories.findIndex(s => getSlug(s.file) === getSlug(a[0].file));
      const idxB = stories.findIndex(s => getSlug(s.file) === getSlug(b[0].file));
      return idxA - idxB;
    });
  }, [stories, allStories, title]);

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="flex flex-col h-full bg-muted/30 border border-border/40 rounded-xl overflow-hidden transition-all duration-300 hover:bg-muted/40"
    >
      {/* Header info */}
      <div className="p-4 bg-muted/20 border-b border-border/30 space-y-1 shrink-0 select-none">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-foreground/90 tracking-tight">{title}</h2>
          <Badge variant="outline" className={cn("text-[9px] font-bold px-2.5 h-4.5 rounded-full border backdrop-blur-md select-none", badgeColor)}>
            {stories.length}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground/60 leading-normal line-clamp-1">{description}</p>
      </div>

      {/* Story list */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/20 scrollbar-thin scrollbar-thumb-muted-foreground/10 scrollbar-track-transparent">
        {clusters.length > 0 ? (
          clusters.map((cluster, clusterIdx) => {
            if (cluster.length === 1) {
              const item = cluster[0];
              return (
                <StoryKanbanCard
                  key={item.file}
                  item={item}
                  epicColor={item.epicParent ? epicColorMap.get(item.epicParent.id) : undefined}
                  onSelect={onSelect}
                  onValidate={onValidate}
                  onBuild={onBuild}
                  activeAction={activeAction}
                  onDragStart={onDragStart}
                  allStories={allStories}
                />
              );
            }

            // Cluster group
            return (
              <div key={`cluster-${clusterIdx}-${cluster[0].file}`}>
                {/* Group label */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/30">
                  <span className="text-[9px] text-muted-foreground/50 font-semibold uppercase tracking-wider">Build Sequence</span>
                  <span className="text-[9px] text-muted-foreground/40">{cluster.length} items</span>
                </div>
                <div>
                  {cluster.map((item) => (
                    <StoryKanbanCard
                      key={item.file}
                      item={item}
                      epicColor={item.epicParent ? epicColorMap.get(item.epicParent.id) : undefined}
                      onSelect={onSelect}
                      onValidate={onValidate}
                      onBuild={onBuild}
                      activeAction={activeAction}
                      onDragStart={onDragStart}
                      allStories={allStories}
                    />
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="h-32 border border-dashed border-border/60 rounded-xl flex items-center justify-center text-center p-4 select-none">
            <span className="text-[10px] text-muted-foreground/50 italic font-semibold">Column empty</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StoryKanbanCard({
  item,
  epicColor,
  onSelect,
  onValidate,
  onBuild,
  activeAction,
  onDragStart,
  allStories
}: {
  item: any;
  epicColor?: EpicColor;
  onSelect: (item: any, type: 'task' | 'story', parentStory?: any, parentFeature?: any) => void;
  onValidate: (file: string, kind: string) => void;
  onBuild: (file: string, kind: string) => void;
  activeAction: { type: string; file: string } | null;
  onDragStart: (e: React.DragEvent, file: string) => void;
  allStories?: any[];
}) {
  const name = item.metadata?.name || item.feature?.name || item.dbName || item.file;
  const effectiveStatus = getEffectiveStatus(item);
  const statusCfg = storyStatusMap[effectiveStatus] || storyStatusMap.unknown;
  const totalTasks = item.checklistTasks ? item.checklistTasks.length : 0;
  const doneTasks = item.checklistTasks ? item.checklistTasks.filter((t: any) => t.status === 'completed').length : 0;
  const desc = item.metadata?.description || item.feature?.description || '';
  const isDraggable = effectiveStatus === 'draft' || effectiveStatus === 'ready';
  const isActive = effectiveStatus === 'running' || effectiveStatus === 'validation';

  // Architect-level Gating Visualizer: Check if base app scaffold exists and if there are pending prerequisites
  const targetApp = item.target?.app || item.targetApp;
  const isFeature = item.kind === 'FeatureStory' || !!item.feature;
  let isScaffoldGated = false;
  if (isFeature && targetApp) {
    const parentApp = allStories?.find(s => 
      s.kind === 'AppStory' && (getSlug(s.file) === getSlug(targetApp) || s.metadata?.slug === targetApp)
    );
    const parentStatus = parentApp ? getEffectiveStatus(parentApp) : 'unknown';
    isScaffoldGated = parentStatus !== 'done' && parentStatus !== 'completed';
  }

  const { prerequisites } = getRelatedStories(item, allStories || []);
  const pendingPrereqs = prerequisites.filter(p => {
    const s = getEffectiveStatus(p);
    return s !== 'done' && s !== 'completed';
  });
  const isPrereqGated = pendingPrereqs.length > 0;

  return (
    <div
      draggable={isDraggable}
      onDragStart={(e) => isDraggable && onDragStart(e, item.file)}
      onClick={() => onSelect(item, 'story')}
      className={cn(
        "group flex flex-col gap-1.5 px-3 py-2.5 cursor-pointer select-none transition-colors border-b border-border/30 last:border-b-0 border-l-2 hover:bg-muted/40",
        isDraggable ? "cursor-grab active:cursor-grabbing" : "",
        item.placeholder && "opacity-50",
        isActive && "bg-primary/5 border-l-primary",
        !isActive && (epicColor?.border?.replace('border-l-', 'border-l-') || "border-l-border/40")
      )}
    >
      {/* Name + status dot */}
      <div className="flex items-start justify-between gap-1.5">
        <span className="font-medium text-xs text-foreground group-hover:text-primary transition-colors leading-snug line-clamp-2 flex-1" title={name}>
          {name.replace('features/', '')}
        </span>
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 mt-1", statusCfg.dot)} title={statusCfg.label} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {item.epicParent && epicColor && (
          <Badge variant="outline" className={cn("text-[7.5px] font-semibold h-3.5 px-1.5 rounded border leading-none shrink-0", epicColor.badge)}>
            {item.epicParent.name}
          </Badge>
        )}
        {(isScaffoldGated || isPrereqGated) && (effectiveStatus !== 'done' && effectiveStatus !== 'completed') && (
          <>
            {isScaffoldGated && (
              <Badge variant="outline" className="text-[7.5px] font-medium bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/25 px-1.5 h-3.5 rounded-full flex items-center gap-0.5">
                <Lock className="h-2 w-2" /> Gated
              </Badge>
            )}
            {isPrereqGated && (
              <Badge variant="outline" className="text-[7.5px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25 px-1.5 h-3.5 rounded-full flex items-center gap-0.5">
                <Clock className="h-2 w-2" /> {pendingPrereqs.length} pending
              </Badge>
            )}
          </>
        )}
        {totalTasks > 0 && (
          <span className="text-[9px] text-muted-foreground/50 ml-auto font-mono tabular-nums">{doneTasks}/{totalTasks}</span>
        )}
      </div>

      {/* Dependencies */}
      {item.dependsOn && item.dependsOn.length > 0 && (
        <div className="flex items-center gap-1 overflow-hidden">
          <Link2 className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
          <div className="flex flex-wrap gap-1 min-w-0">
            {item.dependsOn.map((depSlug: string) => {
              const depStory = allStories?.find(s => getStorySlugs(s).includes(depSlug));
              const status = depStory ? getEffectiveStatus(depStory) : 'unknown';
              const depColor = (status === 'done' || status === 'completed')
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                : (status === 'running' || status === 'in-progress')
                ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25'
                : 'bg-muted/50 text-muted-foreground border-border';
              return (
                <Badge
                  key={depSlug}
                  variant="outline"
                  className={cn("text-[8px] font-medium h-3.5 px-1 rounded-xs cursor-pointer select-none transition-colors hover:bg-muted/60 max-w-[100px] truncate", depColor)}
                  onClick={(e) => { e.stopPropagation(); if (depStory) onSelect(depStory, 'story'); }}
                  title={`${depSlug} (${status})`}
                >
                  {depSlug}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface ListStoryRowProps {
  item: any;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelect: (item: any, type: 'task' | 'story', parentStory?: any, parentFeature?: any) => void;
  onValidate: (file: string, kind: string) => void;
  onBuild: (file: string, kind: string) => void;
  onToggleTask: (taskId: string, nextStatus: Task['status']) => void;
  updatingTaskId: string | null;
  activeAction: { type: string; file: string } | null;
  allStories?: any[];
}

function ListStoryRow({
  item,
  expanded,
  onToggleExpand,
  onSelect,
  onValidate,
  onBuild,
  onToggleTask,
  updatingTaskId,
  activeAction,
  allStories
}: ListStoryRowProps) {
  const name = item.metadata?.name || item.feature?.name || item.dbName || item.file;
  const isFeature = item.kind === 'FeatureStory' || !!item.feature;
  const icon = item.metadata?.icon || (isFeature ? '🧩' : '📦');
  const effectiveStatus = getEffectiveStatus(item);
  const statusCfg = storyStatusMap[effectiveStatus] || storyStatusMap.unknown;
  const progress = item.dbProgress !== undefined ? item.dbProgress : 0;
  const hasTasks = item.checklistTasks && item.checklistTasks.length > 0;
  const isActionLoading = !!(activeAction && activeAction.file === item.file);

  // Architect-level Gating Visualizer: Check if base app scaffold exists and if there are pending prerequisites
  const targetApp = item.target?.app || item.targetApp;
  let isScaffoldGated = false;
  if (isFeature && targetApp) {
    const parentApp = allStories?.find(s => 
      s.kind === 'AppStory' && (getSlug(s.file) === getSlug(targetApp) || s.metadata?.slug === targetApp)
    );
    const parentStatus = parentApp ? getEffectiveStatus(parentApp) : 'unknown';
    isScaffoldGated = parentStatus !== 'done' && parentStatus !== 'completed';
  }

  const { prerequisites } = getRelatedStories(item, allStories || []);
  const pendingPrereqs = prerequisites.filter(p => {
    const s = getEffectiveStatus(p);
    return s !== 'done' && s !== 'completed';
  });
  const isPrereqGated = pendingPrereqs.length > 0;

  return (
    <div
      className="border border-border/50 bg-background/55 rounded-lg overflow-hidden transition-all duration-300"
    >
      {/* Row Header */}
      <div className="flex items-center justify-between p-3 gap-3 flex-wrap sm:flex-nowrap">
        {/* Story Title & File */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {hasTasks ? (
            <button
              onClick={onToggleExpand}
              className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <div className="w-6" />
          )}

          <span className="text-base shrink-0 select-none">{icon}</span>
          <div className="min-w-0 flex-1">
            <span
              onClick={() => onSelect(item, 'story')}
              className="font-bold text-xs text-foreground hover:text-primary hover:underline cursor-pointer truncate max-w-[240px] block"
              title={name}
            >
              {name.replace('features/', '')}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono block truncate max-w-[180px]" title={item.file}>
              {item.file}
            </span>

            {/* Architect Gating Warnings */}
            {(isScaffoldGated || isPrereqGated) && (effectiveStatus !== 'done' && effectiveStatus !== 'completed') && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {isScaffoldGated && (
                  <Badge variant="outline" className="text-[8px] font-medium tracking-wide bg-rose-500/5 text-rose-400/90 border-rose-500/10 px-2 h-5 rounded-full backdrop-blur-sm select-none flex items-center gap-1">
                    <Lock className="h-2.5 w-2.5 text-rose-400/70" /> Scaffold Baseline Missing
                  </Badge>
                )}
                {isPrereqGated && (
                  <Badge variant="outline" className="text-[8px] font-medium tracking-wide bg-amber-500/5 text-amber-400/90 border-amber-500/10 px-2 h-5 rounded-full backdrop-blur-sm select-none flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5 text-amber-400/70" /> Prerequisite Dependencies Pending ({pendingPrereqs.length})
                  </Badge>
                )}
              </div>
            )}

            {/* Dependencies in List View */}
            {item.dependsOn && item.dependsOn.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <Link2 className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                {item.dependsOn.map((depSlug: string) => {
                  const depStory = allStories?.find(s => getStorySlugs(s).includes(depSlug));
                  const status = depStory ? getEffectiveStatus(depStory) : 'unknown';
                  let statusBadgeColor = 'bg-muted/30 text-muted-foreground/60 border-border/10';
                  if (status === 'done' || status === 'completed') {
                    statusBadgeColor = 'bg-emerald-500/5 text-emerald-300 border-emerald-500/10';
                  } else if (status === 'running' || status === 'validation' || status === 'in-progress' || status === 'review') {
                    statusBadgeColor = 'bg-blue-500/5 text-blue-300 border-blue-500/10 animate-pulse';
                  }

                  return (
                    <Badge
                      key={depSlug}
                      variant="outline"
                      className={cn(
                        "text-[8px] font-medium h-4 px-1.5 rounded-xs cursor-pointer select-none transition-colors hover:bg-muted/40 truncate max-w-[120px]",
                        statusBadgeColor
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (depStory) {
                          onSelect(depStory, 'story');
                        }
                      }}
                      title={depStory ? `Dependency: ${depSlug} (${status})` : `Dependency: ${depSlug} (not found)`}
                    >
                      {depSlug}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Task progress percentage — only show if not done */}
        {hasTasks && effectiveStatus !== 'done' && effectiveStatus !== 'completed' && (
          <div className="hidden md:flex items-center gap-2 select-none shrink-0 w-36">
            <div className="h-1 bg-muted rounded-full overflow-hidden w-20 shrink-0 border border-border/30">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] font-bold text-muted-foreground">{progress}% checklist</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0 select-none">
          {/* Status indicator */}
          <Badge className={cn("text-[8px] font-extrabold h-4.5 px-1.5 py-0.5 rounded-sm border shrink-0 select-none", statusCfg.bg)}>
            {statusCfg.label}
          </Badge>
        </div>

        {/* Row Actions */}
        <div className="flex items-center gap-1 shrink-0 ml-2 select-none">
          <Button
            size="icon"
            variant="ghost"
            disabled={isActionLoading}
            onClick={() => onValidate(item.file, item.kind)}
            className="h-7.5 w-7.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/80"
          >
            {isActionLoading && activeAction?.type === 'validate' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            disabled={isActionLoading}
            onClick={() => onBuild(item.file, item.kind || 'AppStory')}
            className="h-7.5 w-7.5 text-primary hover:bg-primary/10 rounded-md"
          >
            {isActionLoading && activeAction?.type === 'build' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelect(item, 'story')}
            className="h-7.5 text-[10px] px-2 rounded-md font-medium border-border"
          >
            Open Specs
          </Button>
        </div>
      </div>

      {/* Checklist expanded panel */}
      {expanded && hasTasks && (
        <div className="px-4 pb-3 pt-1 bg-muted/10 border-t border-border/30 space-y-2 select-none">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ListTodo className="h-3.5 w-3.5" />
            Subtask Checklists ({item.checklistTasks.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {item.checklistTasks.map((task: Task) => {
              const isComp = task.status === 'completed';
              const statusCfg = taskStatusMap[task.status] || taskStatusMap.pending;

              return (
                <div
                  key={task.fullId}
                  className="flex items-start gap-2.5 p-2 rounded-md border bg-background/55 hover:bg-background/90 group"
                >
                  <button
                    disabled={updatingTaskId !== null}
                    onClick={() => onToggleTask(task.fullId, isComp ? 'pending' : 'completed')}
                    className={cn(
                      "h-4 w-4 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all",
                      isComp ? "bg-emerald-500 border-emerald-500 text-white" : "border-border hover:border-muted-foreground"
                    )}
                  >
                    {isComp && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                  </button>

                  <div className="min-w-0 flex-1 leading-normal">
                    <span
                      onClick={() => onSelect(task, 'task', item, item.epicParent)}
                      className={cn(
                        "text-[11px] font-medium text-foreground hover:underline cursor-pointer block truncate",
                        isComp && "text-muted-foreground line-through"
                      )}
                    >
                      <span className="font-mono text-[9px] font-bold text-muted-foreground bg-muted/40 px-1 border border-border/40 rounded-xs mr-1">{task.id}</span>
                      {task.title}
                    </span>
                  </div>

                  <Badge className={cn("text-[7px] font-extrabold px-1 rounded-sm py-0 shrink-0", statusCfg.bg)}>
                    {statusCfg.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
