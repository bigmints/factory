'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import {
  Rocket, Play, Square, ExternalLink, Terminal, Settings, Activity,
  CheckCircle2, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronRight, Plus,
  Search, Filter, Tag, Columns, Layers, FileCode2, Brain, FlaskConical, Wrench,
  ShieldCheck, FolderOpen, RefreshCw, Sliders, X, Check, Package, ListTodo, Info,
  BookOpen, Code, TerminalSquare, Link2, Users, Network, Lock, Clock
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
}

// ─── Constants & Configurations ───

const storyStatusMap: Record<string, { label: string; bg: string; dot: string }> = {
  done: { label: 'Done', bg: 'bg-emerald-500/5 text-emerald-300 border-emerald-500/10 backdrop-blur-xs font-semibold', dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' },
  completed: { label: 'Done', bg: 'bg-emerald-500/5 text-emerald-300 border-emerald-500/10 backdrop-blur-xs font-semibold', dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' },
  review: { label: 'In Review', bg: 'bg-purple-500/5 text-purple-300 border-purple-500/10 backdrop-blur-xs font-semibold', dot: 'bg-purple-400 shadow-[0_0_6px_rgba(192,132,252,0.5)]' },
  validation: { label: 'Validation', bg: 'bg-cyan-500/5 text-cyan-300 border-cyan-500/10 backdrop-blur-xs font-semibold', dot: 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)]' },
  'in-progress': { label: 'In Progress', bg: 'bg-blue-500/5 text-blue-300 border-blue-500/10 backdrop-blur-xs font-semibold', dot: 'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.5)]' },
  running: { label: 'Building', bg: 'bg-blue-500/5 text-blue-300 border-blue-500/10 backdrop-blur-xs font-semibold', dot: 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)] animate-pulse' },
  ready: { label: 'Ready to Build', bg: 'bg-teal-500/5 text-teal-300 border-teal-500/10 backdrop-blur-xs font-semibold', dot: 'bg-teal-400 shadow-[0_0_6px_rgba(45,212,191,0.5)]' },
  failed: { label: 'Failed', bg: 'bg-rose-500/5 text-rose-300 border-rose-500/10 backdrop-blur-xs font-semibold', dot: 'bg-rose-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]' },
  draft: { label: 'Draft', bg: 'bg-amber-500/5 text-amber-300 border-amber-500/10 backdrop-blur-xs font-semibold', dot: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]' },
  unknown: { label: 'Draft', bg: 'bg-muted/30 border-border/20 text-muted-foreground', dot: 'bg-muted-foreground/60' }
};

const epicStatusMap: Record<string, { label: string; bg: string }> = {
  completed: { label: 'Completed', bg: 'bg-emerald-500/15 border-emerald-500/10 text-emerald-300 backdrop-blur-xs' },
  'in-progress': { label: 'In Progress', bg: 'bg-blue-500/15 border-blue-500/10 text-blue-300 backdrop-blur-xs' },
  blocked: { label: 'Blocked', bg: 'bg-rose-500/15 border-rose-500/10 text-rose-300 backdrop-blur-xs' },
  pending: { label: 'Pending', bg: 'bg-muted/30 border-border/20 text-muted-foreground' }
};

// Rotating palette of epic accent colors (border-left + badge tints)
const EPIC_COLORS = [
  { border: 'border-l-violet-500',  badge: 'bg-violet-500/5 text-violet-300 border-violet-500/10 backdrop-blur-md font-medium' },
  { border: 'border-l-sky-500',     badge: 'bg-sky-500/5 text-sky-300 border-sky-500/10 backdrop-blur-md font-medium' },
  { border: 'border-l-emerald-500', badge: 'bg-emerald-500/5 text-emerald-300 border-emerald-500/10 backdrop-blur-md font-medium' },
  { border: 'border-l-rose-500',    badge: 'bg-rose-500/5 text-rose-300 border-rose-500/10 backdrop-blur-md font-medium' },
  { border: 'border-l-teal-500',    badge: 'bg-teal-500/5 text-teal-300 border-teal-500/10 backdrop-blur-md font-medium' },
  { border: 'border-l-fuchsia-500', badge: 'bg-fuchsia-500/5 text-fuchsia-300 border-fuchsia-500/10 backdrop-blur-md font-medium' },
  { border: 'border-l-amber-500',   badge: 'bg-amber-500/5 text-amber-300 border-amber-500/10 backdrop-blur-md font-medium' },
  { border: 'border-l-pink-500',    badge: 'bg-pink-500/5 text-pink-300 border-pink-500/10 backdrop-blur-md font-medium' },
];

const taskStatusMap: Record<string, { label: string; bg: string; dot: string }> = {
  completed: { label: 'Completed', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-500' },
  running: { label: 'Running', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20', dot: 'bg-blue-500 animate-pulse' },
  failed: { label: 'Failed', bg: 'bg-rose-500/10 text-rose-400 border-rose-500/20', dot: 'bg-rose-500' },
  pending: { label: 'Pending', bg: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' }
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
  // Queue status is the live source of truth — drives the Kanban column
  if (item.queueStatus === 'running') return 'running';
  if (item.queueStatus === 'completed') return 'done';
  if (item.queueStatus === 'failed' || item.queueStatus === 'needs-attention') return 'failed';

  // Fall back to the physical YAML status
  const activeStates = ['in-progress', 'validation', 'running', 'review'];
  if (item.status && activeStates.includes(item.status)) return item.status;

  if (item.dbStatus && item.dbStatus !== 'unknown') return item.dbStatus;
  if (item.status && item.status !== 'unknown') return item.status;
  return 'unknown';
};

export function NotionBoard({ initialView = 'board' }: NotionBoardProps) {
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

  // Story Creation & Editing overlays
  const [editingStory, setEditingStory] = useState<{ file: string; name: string } | null>(null);
  const [showStoryChat, setShowStoryChat] = useState(false);
  const [activeAction, setActiveAction] = useState<{ type: string; file: string } | null>(null);

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

  // Combined Polling Orchestrator
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
  }, [fetchRollup, fetchStories, fetchQueue, fetchRunStatus]);

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
        setViewMode('queue');
        setBuildLogsOpen(true);
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
          setViewMode('queue');
          setBuildLogsOpen(true);
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
          setViewMode('queue');
          setBuildLogsOpen(true);
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

  const handleValidateStory = async (file: string, kind: string) => {
    setActiveAction({ type: 'validate', file });
    const toastId = toast.loading(`Validating spec model for ${file}...`);
    try {
      const isFeature = kind === 'FeatureStory';
      const endpoint = isFeature ? '/api/feature-build' : '/api/validate';
      const body = isFeature
        ? { storyFile: file, specFile: file, action: 'validate' }
        : { storyFile: file, specFile: file };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const passed = isFeature ? data.success : data.passed;

      if (passed) {
        toast.success('Spec model validation PASSED!', { id: toastId });
        fetchStories();
      } else {
        const errMessage = data.error || data.errors?.[0] || 'Validation constraints unmet';
        toast.error(`Validation FAILED: ${errMessage}`, { id: toastId });
      }
    } catch {
      toast.error('Network error validating story', { id: toastId });
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
          setViewMode('queue');
          setBuildLogsOpen(true);
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

  // Unsynced/Standalone stories (not declared in app.yaml)
  const unsyncedStories = useMemo(() => {
    return filteredStoriesList.filter(item => !item.epicParent);
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
      "space-y-4 relative",
      viewMode === 'board' ? "md:h-full md:flex md:flex-col md:overflow-hidden pb-2" : "pb-6"
    )}>
      {/* Visual background atmospheric lights */}
      <div className="absolute -top-20 left-10 w-96 h-96 bg-primary/5 rounded-full filter blur-[120px] pointer-events-none -z-10" />
      <div className="absolute -top-30 right-20 w-80 h-80 bg-cyan-500/5 rounded-full filter blur-[100px] pointer-events-none -z-10" />

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 1. TOP HEADER CONSOLE                                                  */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <div className="space-y-4 pb-4 select-none shrink-0 border-b border-border/40 px-1">
        {/* Main flex-row: Project Info on Left, Actions on Right */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          
          {/* Left Column: Title, version, stack badges & description */}
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-xl md:text-2xl shrink-0">🏭</span>
              <h1 className="text-base md:text-2xl font-extrabold tracking-tight text-foreground flex items-center gap-2 flex-wrap">
                {appRollup?.name || 'Loading Project...'}
                <Badge variant="outline" className="text-[9px] md:text-[10px] font-bold px-1.5 py-0.5 border-border bg-muted/40 uppercase shrink-0">
                  v{appRollup?.version || '0.0.1'}
                </Badge>
                {queueRunning && (
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0 ml-0.5" />
                )}
              </h1>
            </div>

            {/* Stack badges & Description Row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground/80">
              {appRollup?.stack && (
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground/80 py-0.5 px-1.5 bg-muted/20 shrink-0">
                    ⚡ {appRollup.stack.framework}
                  </Badge>
                  {appRollup.stack.language && (
                    <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground/80 py-0.5 px-1.5 bg-muted/20 shrink-0">
                      🏷️ {appRollup.stack.language}
                    </Badge>
                  )}
                  {appRollup.stack.database && (
                    <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground/80 py-0.5 px-1.5 bg-muted/20 shrink-0">
                      🗄️ {appRollup.stack.database}
                    </Badge>
                  )}
                </div>
              )}
              {appRollup?.description && (
                <span className="text-[10.5px] text-muted-foreground/60 md:border-l border-border/40 md:pl-3 max-w-xl truncate" title={appRollup.description}>
                  {appRollup.description}
                </span>
              )}
            </div>
          </div>

          {/* Right Column: Unified Actions Toolbar */}
          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
            {/* Dev App Server Controls Pill */}
            <div className="flex items-center border border-border/60 rounded-md bg-background/40 backdrop-blur-xs p-0.5 h-6.5 text-[10px] select-none shrink-0">
              <div className="flex items-center gap-1 px-1">
                <Activity className={cn("h-2.5 w-2.5", runStatus === 'running' ? "text-emerald-500" : "text-muted-foreground")} />
                <span className="font-bold text-[8.5px] uppercase tracking-wider text-muted-foreground hidden lg:inline">Server:</span>
                <Badge className={cn(
                  "text-[8px] font-bold px-1 h-3.5 rounded-sm flex items-center justify-center",
                  runStatus === 'running' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                  runStatus === 'starting' ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse" :
                  "bg-muted text-muted-foreground border border-border"
                )}>
                  {runStatus === 'running' ? `Active (:${runPort || 3000})` : runStatus}
                </Badge>
              </div>
              <Separator orientation="vertical" className="h-3.5 mx-0.5" />
              {runStatus === 'stopped' ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleStartApp}
                  disabled={isActionLoading}
                  className="h-5 w-5 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-sm"
                >
                  <Play className="h-2.5 w-2.5 fill-emerald-500/20" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleStopApp}
                  disabled={isActionLoading}
                  className="h-5 w-5 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-sm"
                >
                  <Square className="h-2.5 w-2.5 fill-rose-500/20" />
                </Button>
              )}

              {/* View server URL if active */}
              {runStatus === 'running' && (
                <>
                  <Separator orientation="vertical" className="h-3.5 mx-0.5" />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => window.open(`http://localhost:${runPort || 3000}`, '_blank')}
                    className="h-5 w-5 text-primary hover:bg-primary/10 rounded-sm"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                  </Button>
                </>
              )}

              {/* Terminal sidebar button */}
              <Separator orientation="vertical" className="h-3.5 mx-0.5" />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setServerLogsOpen(!serverLogsOpen)}
                className={cn("h-5 w-5 rounded-sm", serverLogsOpen ? "bg-muted text-foreground" : "text-muted-foreground")}
              >
                <Terminal className="h-3 w-3" />
              </Button>
            </div>

            {/* Refresh data button */}
            <Button
              variant="outline"
              size="icon"
              onClick={handleSyncRoadmap}
              disabled={syncing}
              className="h-6.5 w-6.5 rounded-md text-muted-foreground hover:text-foreground shrink-0"
              title="Refresh project data"
            >
              <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Controls & Filter Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 select-none">
          {/* Left side: View tabs, New Story, and Build Ready buttons */}
          <div className="flex items-center gap-1.5 shrink-0 self-start md:self-auto w-full md:w-auto">
            <div className="flex items-center gap-1 p-0.5 bg-muted/60 border rounded-md h-7 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setViewMode('board')}
                className={cn(
                  "rounded-sm text-[10px] gap-1 h-6 px-2.5",
                  viewMode === 'board' ? "bg-background shadow-xs text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Columns className="h-3 w-3" />
                <span>Board</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setViewMode('list')}
                className={cn(
                  "rounded-sm text-[10px] gap-1 h-6 px-2.5",
                  viewMode === 'list' ? "bg-background shadow-xs text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ListTodo className="h-3 w-3" />
                <span>Roadmap</span>
              </Button>
            </div>

            {/* New Story button next to tabs (Responsive) */}
            <Button
              size="sm"
              onClick={() => setShowStoryChat(true)}
              className="h-7 w-7 sm:w-auto p-0 sm:px-2.5 text-[10px] gap-1 rounded-md bg-primary text-primary-foreground font-bold hover:bg-primary/90 shadow-sm shrink-0 flex items-center justify-center ml-0.5"
              title="New Story"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New Story</span>
            </Button>

            {/* Build Ready Stories button grouped side-by-side (Responsive) */}
            <Button
              onClick={handleBuildReadyStories}
              disabled={queueRunning || syncing}
              className={cn(
                "h-7 w-7 sm:w-auto p-0 sm:px-2.5 text-[10px] gap-1 rounded-md font-bold transition-all duration-200 shrink-0 flex items-center justify-center",
                queueRunning ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white hover:shadow-sm active:scale-95"
              )}
              title="Build Ready Stories"
            >
              <Rocket className={cn("h-3 w-3", queueRunning && "animate-bounce")} />
              <span className="hidden sm:inline">Build Ready</span>
            </Button>
          </div>

          {/* Right side: Search, Filters toggle */}
          <div className="flex items-center gap-1.5 w-full md:w-auto justify-end">
            {/* Search box */}
            <div className="relative flex-1 md:flex-initial w-full md:w-44 shrink-0">
              <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground/75" />
              <Input
                placeholder="Search stories..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-7 h-7 text-[10px] rounded-md bg-muted/30 w-full border-border/80"
              />
            </div>

            {/* Universal Filters Toggle Button (Desktop collapsible toggle / Mobile bottom sheet) */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (window.innerWidth < 768) {
                  setShowMobileFilters(true);
                } else {
                  setShowDesktopFilters(!showDesktopFilters);
                }
              }}
              className={cn(
                "h-7 text-[10px] gap-1 rounded-md px-2.5 border-border bg-background hover:bg-muted/80 shrink-0 select-none",
                (showDesktopFilters || epicFilter !== 'all' || statusFilter !== 'all') && "border-primary text-primary bg-primary/5"
              )}
            >
              <Filter className="h-3 w-3" />
              <span>Filters</span>
              {(epicFilter !== 'all' || statusFilter !== 'all') && (
                <span className="flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              )}
            </Button>

            {/* Epic Color Legend Toggle — only shown in board view */}
            {viewMode === 'board' && appRollup?.features && appRollup.features.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEpicLegend(v => !v)}
                className={cn(
                  "h-7 text-[10px] gap-1 rounded-md px-2.5 border-border bg-background hover:bg-muted/80 shrink-0 select-none",
                  showEpicLegend && "border-primary text-primary bg-primary/5"
                )}
                title="Toggle epic color legend"
              >
                <Tag className="h-3 w-3" />
                <span className="hidden sm:inline">Epic Colors</span>
              </Button>
            )}

            {/* Loading indicator */}
            {loading && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0 ml-1" />
            )}
          </div>
        </div>

        {/* Desktop Collapsible Inline Filters Sub-row */}
        {showDesktopFilters && (
          <div className="hidden md:flex items-center gap-4 px-3 py-1.5 bg-muted/15 border border-border/40 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200 mt-1 select-none">
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
      {/* 3. VIEW 1: KANBAN BOARD                                               */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {viewMode === 'board' && (
        <div className="flex-1 min-h-0 flex flex-col md:overflow-hidden overflow-y-auto space-y-6 pr-1 pb-4 scrollbar-thin scrollbar-thumb-muted-foreground/10 scrollbar-track-transparent">

          {/* ── Epic Color Legend Strip ── */}
          {showEpicLegend && appRollup?.features && appRollup.features.length > 0 && (
            <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/15 border border-border/40 rounded-xl animate-in fade-in slide-in-from-top-1 duration-200 select-none">
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/70 shrink-0">Epic Colors:</span>
              {appRollup.features.map((f: any, idx: number) => {
                const color = EPIC_COLORS[idx % EPIC_COLORS.length];
                // Extract a CSS color from the Tailwind badge class for the swatch dot
                const swatchColors = [
                  '#8b5cf6', // violet-500
                  '#0ea5e9', // sky-500
                  '#f59e0b', // amber-500
                  '#f43f5e', // rose-500
                  '#14b8a6', // teal-500
                  '#d946ef', // fuchsia-500
                  '#84cc16', // lime-500
                  '#f97316', // orange-500
                ];
                return (
                  <span key={f.id} className="flex items-center gap-1.5 text-[10px] text-foreground">
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: swatchColors[idx % swatchColors.length] }}
                    />
                    <span className="font-medium">{f.name}</span>
                    <Badge variant="outline" className={cn("text-[7.5px] font-bold h-3.5 px-1 rounded border ml-0.5", color.badge)}>
                      {f.stories?.length ?? 0} stories
                    </Badge>
                  </span>
                );
              })}
            </div>
          )}

          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch md:h-full">
            {/* Column 1: BACKLOG / DRAFT */}
            <KanbanColumn
              title="Backlog"
              description="Scaffold drafts or spec blueprints"
              badgeColor="bg-amber-500/5 text-amber-300 border-amber-500/10"
              stories={backlogStories}
              epicColorMap={epicColorMap}
              onSelect={handleOpenDrawer}
              onValidate={handleValidateStory}
              onBuild={handleSingleBuild}
              activeAction={activeAction}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'draft')}
              onDragStart={handleDragStart}
              allStories={mergedStories}
            />

            {/* Column 2: READY TO BUILD */}
            <KanbanColumn
              title="Ready to Build"
              description="Verified specifications awaiting launch"
              badgeColor="bg-teal-500/5 text-teal-300 border-teal-500/10"
              stories={readyStories}
              epicColorMap={epicColorMap}
              onSelect={handleOpenDrawer}
              onValidate={handleValidateStory}
              onBuild={handleSingleBuild}
              activeAction={activeAction}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'ready')}
              onDragStart={handleDragStart}
              allStories={mergedStories}
            />

            {/* Column 3: BUILDING / RUNNING */}
            <KanbanColumn
              title="In Progress"
              description="Actively compiling or iterating"
              badgeColor="bg-blue-500/5 text-blue-300 border-blue-500/10"
              stories={buildingStories}
              epicColorMap={epicColorMap}
              onSelect={handleOpenDrawer}
              onValidate={handleValidateStory}
              onBuild={handleSingleBuild}
              activeAction={activeAction}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'in-progress')}
              onDragStart={handleDragStart}
              allStories={mergedStories}
            />

            {/* Column 4: COMPLETED / DONE */}
            <KanbanColumn
              title="Completed"
              description="Code written and tests passed"
              badgeColor="bg-emerald-500/5 text-emerald-300 border-emerald-500/10"
              stories={doneStories}
              epicColorMap={epicColorMap}
              onSelect={handleOpenDrawer}
              onValidate={handleValidateStory}
              onBuild={handleSingleBuild}
              activeAction={activeAction}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'done')}
              onDragStart={handleDragStart}
              allStories={mergedStories}
            />
          </div>

          {unsyncedStories.length > 0 && (
            <div className="space-y-3 mt-6 border border-border/60 bg-muted/20 p-5 rounded-xl shrink-0">
              <div className="flex items-center gap-2">
                <Info className="h-4.5 w-4.5 text-muted-foreground" />
                <h3 className="font-bold text-sm text-foreground">Uncategorized</h3>
                <Badge variant="outline" className="text-[10px] text-muted-foreground">{unsyncedStories.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                These story files are not mapped to any feature in your app roadmap. Click cards to edit or compile them.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-2">
                {unsyncedStories.map(item => (
                  <StoryKanbanCard
                    key={item.file}
                    item={item}
                    onSelect={handleOpenDrawer}
                    onValidate={handleValidateStory}
                    onBuild={handleSingleBuild}
                    activeAction={activeAction}
                    onDragStart={handleDragStart}
                    allStories={mergedStories}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 4. VIEW 2: ROADMAP HIERARCHICAL LIST VIEW                              */}
      {/* ────────────────────────────────────────────────────────────────────── */}
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
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                    {isSelectedRunning ? 'live' : selectedQueueItem ? 'stored log' : 'idle'}
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md shrink-0 focus:outline-none" onClick={() => setBuildLogsOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
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
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-md bg-background/95 backdrop-blur-md border-l border-border/60 shadow-2xl flex flex-col p-0 overflow-hidden">
          {selectedItem && (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="border-b border-border/50 p-4 shrink-0 bg-muted/10 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={cn(
                    "text-[10px] font-bold uppercase py-0.5 rounded-md",
                    selectedItem.type === 'task' ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/25" : "bg-primary/10 text-primary border-primary/25"
                  )}>
                    {selectedItem.type === 'task' ? `Task: ${selectedItem.data.id}` : 'Spec Story'}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setDrawerOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <SheetTitle className="text-base font-bold text-foreground">
                  {selectedItem.type === 'task' ? selectedItem.data.title : getStoryTitle(selectedItem.data)}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {selectedItem.type === 'task'
                    ? `Part of story: ${selectedItem.parentStory?.name || 'App Spec'}`
                    : getStoryDesc(selectedItem.data)
                  }
                </SheetDescription>
              </div>

              {/* Body */}
              <ScrollArea className="flex-1 p-4 space-y-5">
                {/* ── TASK DETAIL CARD ── */}
                {selectedItem.type === 'task' && (
                  <div className="space-y-4">
                    {/* Status Dropdown Picker */}
                    <div className="space-y-1.5 text-xs">
                      <span className="text-muted-foreground font-semibold">Status:</span>
                      <select
                        value={selectedItem.data.status}
                        onChange={e => handleUpdateTaskStatus(selectedItem.data.fullId, e.target.value as any)}
                        className="w-full h-9 rounded-md border bg-background text-xs text-foreground px-2"
                      >
                        <option value="pending">Pending</option>
                        <option value="running">Running</option>
                        <option value="completed">Completed</option>
                        <option value="failed">Failed</option>
                      </select>
                    </div>

                    {/* Metadata Card */}
                    <div className="border border-border/60 bg-muted/15 rounded-lg p-3 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Task Full ID:</span>
                        <span className="font-mono text-foreground font-bold">{selectedItem.data.fullId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Feature parent:</span>
                        <span className="font-semibold text-foreground">{selectedItem.parentFeature?.name || 'General Core'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── STORY DETAIL CARD ── */}
                {selectedItem.type === 'story' && (
                  <div className="space-y-5">
                    {/* Core Actions Panel */}
                    <div className="grid grid-cols-2 gap-2 select-none">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!activeAction}
                        onClick={() => handleValidateStory(selectedItem.data.file, selectedItem.data.kind)}
                        className="h-8.5 text-xs font-semibold gap-1.5 border-border rounded-lg hover:bg-muted/80"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Validate SPEC
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setDrawerOpen(false);
                          handleSingleBuild(selectedItem.data.file, selectedItem.data.kind || 'AppStory');
                        }}
                        className="h-8.5 text-xs font-bold gap-1.5 rounded-lg bg-primary hover:bg-primary/95 text-primary-foreground shadow-xs"
                      >
                        <Rocket className="h-3.5 w-3.5" />
                        Compile Story
                      </Button>
                    </div>

                    {(() => {
                      const { prerequisites, dependents, peers } = getRelatedStories(selectedItem.data, mergedStories);
                      const family = [selectedItem.data, ...prerequisites, ...dependents, ...peers];
                      const incompleteFamilyCount = family.filter(s => {
                        const status = getEffectiveStatus(s);
                        return status !== 'done' && status !== 'completed';
                      }).length;
                      
                      return incompleteFamilyCount > 0 ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleQueueRelatedStories(selectedItem.data)}
                          className="w-full h-8.5 text-xs font-bold gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white shadow-xs select-none"
                        >
                          <Layers className="h-3.5 w-3.5" />
                          Queue Related Family ({incompleteFamilyCount})
                        </Button>
                      ) : null;
                    })()}

                    {/* Quick Specs View */}
                    <div className="border border-border/60 bg-muted/15 rounded-lg p-3 space-y-2 text-xs select-none">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">YAML Spec File:</span>
                        <span className="font-mono text-foreground truncate max-w-[200px]" title={selectedItem.data.file}>{selectedItem.data.file}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Type:</span>
                        <span className="font-bold text-foreground">{selectedItem.data.kind === 'FeatureStory' ? 'Feature' : 'App Story'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">State:</span>
                        <Badge className={cn("text-[9px] font-bold", (storyStatusMap[getEffectiveStatus(selectedItem.data)] || storyStatusMap.unknown).bg)}>
                          {getEffectiveStatus(selectedItem.data)}
                        </Badge>
                      </div>
                      {selectedItem.data.dbProgress !== undefined && (
                        <div className="space-y-1 pt-1.5">
                          <div className="flex justify-between text-[10px] text-muted-foreground font-semibold">
                            <span>Checklist Progress</span>
                            <span>{selectedItem.data.dbProgress}%</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${selectedItem.data.dbProgress}%` }} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* LLM Pipeline & Gating Panel */}
                    <div className="space-y-3 pt-2 border-t border-border/40 select-none">
                      <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
                        <Brain className="h-4 w-4 text-violet-500" />
                        LLM Pipeline & Gating
                      </h4>
                      <div className="border border-border/60 bg-muted/15 rounded-lg p-3.5 space-y-4 text-xs">
                        {/* Auto-Priority Phase */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                            <span>Auto-Priority Level</span>
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                              selectedItem.data.kind === 'AppStory' 
                                ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/25"
                                : (selectedItem.data.phase === 1 
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
                                  : (selectedItem.data.phase === 2 
                                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/25"
                                    : "bg-amber-500/10 text-amber-400 border border-amber-500/25"))
                            )}>
                              {selectedItem.data.kind === 'AppStory' 
                                ? 'Phase 0: Scaffold (Priority 100)' 
                                : `Phase ${selectedItem.data.phase ?? 1}: ${
                                    selectedItem.data.phase === 1 
                                      ? 'Foundation (Priority 80)' 
                                      : (selectedItem.data.phase === 2 
                                        ? 'Core (Priority 60)' 
                                        : 'Polish (Priority 40)')
                                  }`}
                            </span>
                          </div>
                          
                          {/* Horizontal mini timeline of phases */}
                          <div className="flex items-center gap-1 pt-1">
                            {[0, 1, 2, 3].map((p) => {
                              const currentPhase = selectedItem.data.kind === 'AppStory' ? 0 : (selectedItem.data.phase ?? 1);
                              const isActive = currentPhase === p;
                              const isCompleted = currentPhase > p;
                              
                              let color = "bg-muted";
                              if (isActive) {
                                color = p === 0 ? "bg-indigo-500" : (p === 1 ? "bg-emerald-500" : (p === 2 ? "bg-blue-500" : "bg-amber-500"));
                              } else if (isCompleted) {
                                color = "bg-foreground/45";
                              }
                              
                              return (
                                <div key={p} className="flex-1 space-y-1">
                                  <div className={cn("h-1 rounded-full transition-all duration-300", color)} />
                                  <div className="flex items-center justify-between text-[8px] text-muted-foreground px-0.5">
                                    <span className={cn("font-medium", isActive && "text-foreground font-bold")}>
                                      {p === 0 ? 'Scaffold' : p === 1 ? 'Found.' : p === 2 ? 'Core' : 'Polish'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Scaffold & Prerequisite Gates */}
                        <div className="space-y-2.5">
                          {/* Scaffold Baseline Gate */}
                          {(() => {
                            const targetApp = selectedItem.data.target?.app;
                            const isAppStory = selectedItem.data.kind === 'AppStory';
                            
                            if (isAppStory) {
                              return (
                                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                  <div className="space-y-0.5">
                                    <span className="text-[11px] font-bold text-emerald-400">Scaffold Baseline: Ready</span>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                      App spec story. Acts as the baseline scaffold. No scaffolding prerequisites required.
                                    </p>
                                  </div>
                                </div>
                              );
                            }
                            
                            if (!targetApp) {
                              return (
                                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                  <div className="space-y-0.5">
                                    <span className="text-[11px] font-bold text-emerald-400">Scaffold Baseline: Ready (Unbound)</span>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                      No parent app specified. Features will be integrated in-place.
                                    </p>
                                  </div>
                                </div>
                              );
                            }
                            
                            // Look up parent app status
                            const parentApp = mergedStories.find(s => 
                              s.kind === 'AppStory' && (getSlug(s.file) === getSlug(targetApp) || s.metadata?.slug === targetApp)
                            );
                            const parentStatus = parentApp ? getEffectiveStatus(parentApp) : 'unknown';
                            const isAppBuilt = parentStatus === 'done' || parentStatus === 'completed';
                            
                            if (isAppBuilt) {
                              return (
                                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                  <div className="space-y-0.5">
                                    <span className="text-[11px] font-bold text-emerald-400">Scaffold Baseline: Ready</span>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                      Base app scaffold <span className="font-semibold text-foreground">&quot;{targetApp}&quot;</span> is implemented. Ready to compile feature onto it.
                                    </p>
                                  </div>
                                </div>
                              );
                            } else {
                              return (
                                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-rose-500/5 border border-rose-500/20">
                                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                                  <div className="space-y-0.5">
                                    <span className="text-[11px] font-bold text-rose-400">Scaffold Baseline: Gated / Blocked</span>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                      Requires base app scaffold <span className="font-semibold text-rose-300">&quot;{targetApp}&quot;</span> to be built first. LLM cannot write features to a non-existent app!
                                    </p>
                                  </div>
                                </div>
                              );
                            }
                          })()}

                          {/* Prerequisite Dependencies Gate */}
                          {(() => {
                            const { prerequisites } = getRelatedStories(selectedItem.data, mergedStories);
                            const pendingPrereqs = prerequisites.filter(p => {
                              const s = getEffectiveStatus(p);
                              return s !== 'done' && s !== 'completed';
                            });
                            const isGated = pendingPrereqs.length > 0;
                            
                            if (prerequisites.length === 0) {
                              return (
                                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                  <div className="space-y-0.5">
                                    <span className="text-[11px] font-bold text-emerald-400">Prerequisites Gate: Ready</span>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                      No feature dependencies declared in YAML spec. Ready to queue.
                                    </p>
                                  </div>
                                </div>
                              );
                            }
                            
                            if (!isGated) {
                              return (
                                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                  <div className="space-y-0.5">
                                    <span className="text-[11px] font-bold text-emerald-400">Prerequisites Gate: Ready</span>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                      All {prerequisites.length} prerequisite features are already built and integrated.
                                    </p>
                                  </div>
                                </div>
                              );
                            } else {
                              return (
                                <div className="flex items-start gap-2.5 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                                  <div className="space-y-0.5">
                                    <span className="text-[11px] font-bold text-amber-400">Prerequisites Gate: Blocked</span>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                      Blocked by {pendingPrereqs.length} prerequisite(s): <span className="font-mono text-amber-300">{pendingPrereqs.map(p => getSlug(p.file)).join(', ')}</span>.
                                    </p>
                                  </div>
                                </div>
                              );
                            }
                          })()}
                        </div>

                        {/* LLM Context Payload Visualizer */}
                        <div className="space-y-2 pt-1 border-t border-border/40">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Active LLM Context Payload</span>
                            <Badge variant="outline" className="text-[9px] font-mono bg-violet-500/5 text-violet-400 border-violet-500/20 px-1 rounded select-none">
                              Injected on build
                            </Badge>
                          </div>
                          
                          <div className="font-mono text-[10px] rounded-lg bg-black/60 border border-border/50 text-muted-foreground overflow-hidden p-3.5 space-y-3.5 leading-relaxed">
                            {/* 1. Target Stack */}
                            <div className="space-y-1">
                              <span className="text-foreground font-bold flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
                                1. Stack Config Context
                              </span>
                              {(() => {
                                const getAppStack = () => {
                                  const story = selectedItem.data;
                                  if (story.kind === 'AppStory' && story.stack) {
                                    return story.stack;
                                  }
                                  const targetApp = story.target?.app;
                                  const parentApp = mergedStories.find(s => 
                                    s.kind === 'AppStory' && (getSlug(s.file) === getSlug(targetApp) || s.metadata?.slug === targetApp)
                                  );
                                  if (parentApp?.stack) return parentApp.stack;
                                  if (appRollup?.stack) return appRollup.stack;
                                  return null;
                                };
                                const stack = getAppStack();
                                if (!stack) return <span className="text-[9px] text-muted-foreground italic pl-3.5">No stack config detected.</span>;
                                
                                return (
                                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 pl-3.5 text-[9px]">
                                    <div><span className="text-muted-foreground/75">Framework:</span> <span className="text-violet-300 font-bold">{stack.framework || 'Next.js 15'}</span></div>
                                    <div><span className="text-muted-foreground/75">Language:</span> <span className="text-sky-300 font-bold">{stack.language || 'TypeScript'}</span></div>
                                    <div><span className="text-muted-foreground/75">Database:</span> <span className="text-amber-300 font-bold">{stack.database || 'SQLite'}</span></div>
                                    <div><span className="text-muted-foreground/75">Styling:</span> <span className="text-emerald-300 font-bold">Tailwind CSS</span></div>
                                  </div>
                                );
                              })()}
                            </div>

                            {/* 2. Conventions & Rules */}
                            <div className="space-y-1">
                              <span className="text-foreground font-bold flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
                                2. TOON & Conventions Rules
                              </span>
                              <div className="pl-3.5 text-[9px] text-muted-foreground/85 space-y-0.5">
                                <div>✓ <span className="text-foreground/90 font-semibold">AGENTS.md</span> specifications guidelines injected.</div>
                                <div>✓ <span className="text-foreground/90 font-semibold">@toon-format/toon</span> semantic file structure.</div>
                                <div>✓ <span className="text-foreground/90 font-semibold">factory/scripts</span> heartbeat & auto-context scripts.</div>
                              </div>
                            </div>

                            {/* 3. Knowledge Base Memory */}
                            <div className="space-y-1">
                              <span className="text-foreground font-bold flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                                3. Knowledge Graph Memory
                              </span>
                              {(() => {
                                const completedStories = mergedStories.filter(s => {
                                  const st = getEffectiveStatus(s);
                                  return st === 'done' || st === 'completed';
                                });
                                
                                if (completedStories.length === 0) {
                                  return (
                                    <div className="pl-3.5 text-[9px] text-muted-foreground italic leading-normal">
                                      No past builds. First compile (cold start).
                                    </div>
                                  );
                                }
                                
                                return (
                                  <div className="pl-3.5 space-y-1">
                                    <div className="text-[9px] text-muted-foreground leading-normal">
                                      Auto-injects details of {completedStories.length} past builds from <span className="text-emerald-300 font-mono">.factory/knowledge/</span>:
                                    </div>
                                    <div className="flex flex-wrap gap-1 pt-0.5 max-h-[60px] overflow-y-auto">
                                      {completedStories.map(cs => (
                                        <span key={cs.file} className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-900/40 font-mono">
                                          {getSlug(cs.file)}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Checklist Subtasks */}
                    <div className="space-y-2.5">
                      <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
                        <ListTodo className="h-4 w-4 text-indigo-500" />
                        Task Checklist
                      </h4>
                      {selectedItem.data.checklistTasks && selectedItem.data.checklistTasks.length > 0 ? (
                        <div className="space-y-1.5 border rounded-lg p-2.5 bg-background">
                          {selectedItem.data.checklistTasks.map((task: Task) => {
                            const isDone = task.status === 'completed';
                            return (
                              <div key={task.fullId} className="flex items-start gap-2 py-1">
                                <button
                                  disabled={updatingTaskId !== null}
                                  onClick={() => handleUpdateTaskStatus(task.fullId, isDone ? 'pending' : 'completed')}
                                  className={cn(
                                    "h-4.5 w-4.5 rounded-md border flex items-center justify-center transition-all shrink-0 mt-0.5",
                                    isDone ? "bg-emerald-500 border-emerald-500 text-white" : "border-border hover:border-muted-foreground"
                                  )}
                                >
                                  {isDone && <Check className="h-3 w-3 stroke-[3]" />}
                                </button>
                                <span className={cn("text-xs text-foreground", isDone && "text-muted-foreground line-through")}>
                                  <span className="font-mono font-bold text-[10px] text-muted-foreground bg-muted/40 px-1 border border-border/40 rounded-sm mr-1.5 select-none">{task.id}</span>
                                  {task.title}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground italic py-3 text-center border rounded-lg bg-muted/5 select-none">
                          No checklists declared. Mapped tasks will populate once synchronized.
                        </div>
                      )}
                    </div>

                    {/* Meta integration table */}
                    {selectedItem.data.deployment && (
                      <div className="space-y-2">
                        <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
                          <Settings className="h-4 w-4 text-muted-foreground" />
                          Deployment Specification
                        </h4>
                        <div className="border rounded-lg bg-background p-2.5 space-y-1 text-xs select-text">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Port target:</span>
                            <span className="font-semibold text-foreground">{selectedItem.data.deployment.port || '3000'}</span>
                          </div>
                          {selectedItem.data.deployment.region && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Cloud region:</span>
                              <span className="font-semibold text-foreground">{selectedItem.data.deployment.region}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Related Family Group (Prerequisites, Dependents, Peers) */}
                    <div className="space-y-4 pt-2 border-t border-border/40 select-none">
                      <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
                        <Network className="h-4 w-4 text-violet-500" />
                        Related Family Group
                      </h4>
                      
                      {(() => {
                        const { prerequisites, dependents, peers } = getRelatedStories(selectedItem.data, mergedStories);
                        const hasRelations = prerequisites.length > 0 || dependents.length > 0 || peers.length > 0;
                        
                        if (!hasRelations) {
                          return (
                            <div className="text-xs text-muted-foreground italic py-3 text-center border rounded-lg bg-muted/5 select-none">
                              No related stories (prerequisites, dependents, or peers) found.
                            </div>
                          );
                        }

                        const renderBadgeList = (storiesList: any[], title: string, badgeIcon: React.ReactNode, activeGlow: string) => {
                          if (storiesList.length === 0) return null;
                          return (
                            <div className="space-y-1.5">
                              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                                {title} ({storiesList.length})
                              </span>
                              <div className="flex flex-wrap gap-2 p-2 rounded-lg border bg-background/50">
                                {storiesList.map((story) => {
                                  const slug = getSlug(story.file);
                                  const status = getEffectiveStatus(story);
                                  let statusBadgeColor = 'bg-muted text-muted-foreground border-border/40';
                                  if (status === 'done' || status === 'completed') {
                                    statusBadgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/35';
                                  } else if (status === 'running' || status === 'validation' || status === 'in-progress' || status === 'review') {
                                    statusBadgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/35 animate-pulse';
                                  }
                                  
                                  return (
                                    <Badge
                                      key={slug}
                                      variant="outline"
                                      className={cn(
                                        "text-[10px] font-medium py-1 px-2.5 rounded-md cursor-pointer select-none transition-all hover:bg-muted flex items-center gap-1.5",
                                        statusBadgeColor,
                                        activeGlow
                                      )}
                                      onClick={() => {
                                        handleOpenDrawer(story, 'story', undefined, story.epicParent);
                                      }}
                                      title={`${title}: ${slug} (${status})`}
                                    >
                                      {badgeIcon}
                                      <span>{slug}</span>
                                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 ml-1", storyStatusMap[status]?.dot || 'bg-muted-foreground')} />
                                    </Badge>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        };

                        return (
                          <div className="space-y-4">
                            {renderBadgeList(
                              prerequisites,
                              "Prerequisites (Depends On)",
                              <Link2 className="h-3 w-3 text-sky-400 shrink-0" />,
                              "hover:border-sky-500/50 hover:shadow-[0_0_10px_rgba(14,165,233,0.15)]"
                            )}
                            {renderBadgeList(
                              dependents,
                              "Dependents (Required By)",
                              <Layers className="h-3 w-3 text-purple-400 shrink-0" />,
                              "hover:border-purple-500/50 hover:shadow-[0_0_10px_rgba(168,85,247,0.15)]"
                            )}
                            {renderBadgeList(
                              peers,
                              "Peers (Shared Context / Target App)",
                              <Users className="h-3 w-3 text-amber-400 shrink-0" />,
                              "hover:border-amber-500/50 hover:shadow-[0_0_10px_rgba(245,158,11,0.15)]"
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </ScrollArea>
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
      className="flex flex-col h-[450px] md:h-full bg-zinc-950/20 dark:bg-zinc-950/30 backdrop-blur-md border border-border/20 rounded-xl overflow-hidden shadow-[inset_0_1px_1px_rgba(255,255,255,0.01),0_8px_30px_rgb(0,0,0,0.12)] flex-1 transition-all duration-300 hover:bg-zinc-950/25 dark:hover:bg-zinc-950/40"
    >
      {/* Header info */}
      <div className="p-4 bg-background/20 border-b border-border/20 space-y-1 shrink-0 select-none backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-foreground/90 tracking-tight">{title}</h2>
          <Badge variant="outline" className={cn("text-[9px] font-bold px-2.5 h-4.5 rounded-full border backdrop-blur-md select-none", badgeColor)}>
            {stories.length}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground/60 leading-normal line-clamp-1">{description}</p>
      </div>

      {/* Cards list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5 pb-6 scrollbar-thin scrollbar-thumb-muted-foreground/10 scrollbar-track-transparent">
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

            // Render a premium, clean, simplified group container for clusters of size > 1 (No unnecessary elements)
            return (
              <div
                key={`cluster-${clusterIdx}-${cluster[0].file}`}
                className="border border-border/15 bg-muted/5 dark:bg-muted/10 rounded-xl p-2.5 space-y-2 relative overflow-hidden transition-all duration-300"
              >
                {/* Clean, Minimalist Group Header */}
                <div className="flex items-center justify-between px-1 pb-0.5 select-none text-[9px] text-muted-foreground/40 font-semibold uppercase tracking-wider">
                  <span>Build Sequence</span>
                  <span>{cluster.length} items</span>
                </div>
                
                {/* The cards in the cluster */}
                <div className="space-y-2">
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
    <Card
      draggable={isDraggable}
      onDragStart={(e) => isDraggable && onDragStart(e, item.file)}
      onClick={() => onSelect(item, 'story')}
      className={cn(
        "border bg-zinc-950/20 hover:bg-zinc-950/40 hover:shadow-lg hover:-translate-y-[1.5px] active:translate-y-0 transition-all duration-300 group relative overflow-hidden rounded-lg cursor-pointer border-l-[3px]",
        isDraggable ? "cursor-grab active:cursor-grabbing" : "",
        item.placeholder && "border-dashed border-border opacity-70",
        isActive && "border-indigo-500/30 bg-indigo-950/15 shadow-[0_0_12px_rgba(99,102,241,0.08)]",
        !isActive && "border-border/25 hover:border-indigo-500/20",
        epicColor?.border || "border-l-border/30"
      )}
    >
      <CardContent className="p-3 space-y-1.5 select-none">
        {/* Name row */}
        <div className="flex items-start justify-between gap-1.5">
          <span className="font-medium text-xs text-foreground group-hover:text-primary transition-colors leading-tight line-clamp-2 flex-1" title={name}>
            {name.replace('features/', '')}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 mt-1", statusCfg.dot)} title={statusCfg.label} />
          </div>
        </div>

        {/* Description */}
        {desc && (
          <p className="text-[9.5px] text-muted-foreground/60 line-clamp-1 leading-normal font-light">{desc}</p>
        )}

        {/* Bottom meta */}
        <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
          {item.epicParent && epicColor && (
            <Badge variant="outline" className={cn("text-[7.5px] font-semibold h-3.5 px-1.5 rounded border leading-none shrink-0", epicColor.badge)}>
              {item.epicParent.name}
            </Badge>
          )}

          {/* Minimalist Gating Badges */}
          {(isScaffoldGated || isPrereqGated) && (effectiveStatus !== 'done' && effectiveStatus !== 'completed') && (
            <div className="flex items-center gap-1 shrink-0">
              {isScaffoldGated && (
                <Badge variant="outline" className="text-[7.5px] font-medium tracking-wide bg-rose-500/5 text-rose-400/90 border-rose-500/10 px-1.5 h-4 rounded-full backdrop-blur-md select-none flex items-center gap-0.5">
                  <Lock className="h-2 w-2 text-rose-400/70" /> Scaffold Gated
                </Badge>
              )}
              {isPrereqGated && (
                <Badge variant="outline" className="text-[7.5px] font-medium tracking-wide bg-amber-500/5 text-amber-400/90 border-amber-500/10 px-1.5 h-4 rounded-full backdrop-blur-md select-none flex items-center gap-0.5">
                  <Clock className="h-2 w-2 text-amber-400/70" /> Pending ({pendingPrereqs.length})
                </Badge>
              )}
            </div>
          )}

          <span className="text-[9px] text-muted-foreground/50 ml-auto font-mono">
            {totalTasks > 0 ? `${doneTasks}/${totalTasks} tasks` : 'No tasks'}
          </span>
        </div>

        {/* Dependencies */}
        {item.dependsOn && item.dependsOn.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-border/10 overflow-hidden">
            <Link2 className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
            <div className="flex flex-wrap gap-1 min-w-0">
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
                      "text-[8px] font-medium h-4 px-1 rounded-xs cursor-pointer select-none transition-colors hover:bg-muted/40 max-w-[100px] truncate",
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
          </div>
        )}
      </CardContent>
    </Card>
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
