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
  BookOpen, Code, TerminalSquare
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
  done: { label: 'Done', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-500' },
  completed: { label: 'Done', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-500' },
  review: { label: 'In Review', bg: 'bg-purple-500/10 text-purple-400 border-purple-500/30', dot: 'bg-purple-500' },
  validation: { label: 'Validation', bg: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30', dot: 'bg-cyan-500' },
  'in-progress': { label: 'In Progress', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/30', dot: 'bg-blue-500' },
  running: { label: 'Building', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/30', dot: 'bg-blue-500 animate-pulse' },
  ready: { label: 'Ready to Build', bg: 'bg-teal-500/10 text-teal-400 border-teal-500/30', dot: 'bg-teal-500' },
  failed: { label: 'Failed', bg: 'bg-rose-500/10 text-rose-400 border-rose-500/30', dot: 'bg-rose-500' },
  draft: { label: 'Draft', bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30', dot: 'bg-amber-500' },
  unknown: { label: 'Draft', bg: 'bg-muted border-border text-muted-foreground', dot: 'bg-muted-foreground' }
};

const epicStatusMap: Record<string, { label: string; bg: string }> = {
  completed: { label: 'Completed', bg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' },
  'in-progress': { label: 'In Progress', bg: 'bg-blue-500/10 border-blue-500/20 text-blue-400' },
  blocked: { label: 'Blocked', bg: 'bg-rose-500/10 border-rose-500/20 text-rose-400' },
  pending: { label: 'Pending', bg: 'bg-muted border-border text-muted-foreground' }
};

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

const getEffectiveStatus = (item: any) => {
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

    const toastId = toast.loading(`Updating story status to ${targetStatus}...`);
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

      const json = await res.json();
      toast.success(json.message || `Successfully updated status to "${targetStatus}"`, { id: toastId });
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
  const [buildEngine, setBuildEngine] = useState<'factory' | 'gemini-cli' | 'pi-cli'>('factory');

  // Dev Server Controls
  const [runStatus, setRunStatus] = useState<'stopped' | 'starting' | 'running'>('stopped');
  const [runPid, setRunPid] = useState<number | null>(null);
  const [runPort, setRunPort] = useState<number | null>(null);
  const [runLogs, setRunLogs] = useState<string>('');
  const [serverLogsOpen, setServerLogsOpen] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Build Pipeline Logs
  const [buildOutput, setBuildOutput] = useState('');
  const logOffsetRef = useRef(0);

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [epicFilter, setEpicFilter] = useState<string>('all');
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
      setRunStatus('running');
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
          engine: buildEngine
        }),
      });
      if (res.ok) {
        toast.success(`Enqueued build for ${file}`);
        fetchQueue();
      } else {
        const data = await res.json();
        toast.error('Failed to enqueue', { description: data.error });
      }
    } catch {
      toast.error('Network error enqueuing story');
    }
  };

  const handleSingleBuild = async (file: string, kind: string) => {
    toast.info(`Preparing build for ${file}...`);
    try {
      await handleEnqueue(file, kind);
      const res = await fetch('/api/queue/start', { method: 'POST' });
      if (res.ok) {
        toast.success('Build pipeline running...');
        fetchQueue();
        setViewMode('queue');
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
    const readySpecs: Array<{ file: string; kind: string; phase?: number; dependsOn?: string[] }> = [];

    // Check App Stories
    stories.forEach(s => {
      if (s.status === 'ready' || s.status === 'failed') {
        readySpecs.push({ file: s.file, kind: 'AppStory' });
      }
    });

    // Check Feature Stories
    featureStories.forEach(fs => {
      if (fs.status === 'ready' || fs.status === 'failed') {
        readySpecs.push({
          file: fs.file,
          kind: 'FeatureStory',
          phase: fs.phase,
          dependsOn: fs.dependsOn
        });
      }
    });

    if (readySpecs.length === 0) {
      toast.info('All stories are fully built or clean! No pending items found.');
      return;
    }

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
            engine: buildEngine
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
        if (startRes.ok) setViewMode('queue');
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

    return Array.from(map.values());
  }, [stories, featureStories, appRollup]);

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
    return filteredStoriesList.filter(item => {
      const status = getEffectiveStatus(item);
      return status === 'draft' || status === 'unknown';
    });
  }, [filteredStoriesList]);

  // Ready specs (Ready/Failed/Review)
  const readyStories = useMemo(() => {
    return filteredStoriesList.filter(item => {
      const status = getEffectiveStatus(item);
      return status === 'ready' || status === 'failed' || status === 'review';
    });
  }, [filteredStoriesList]);

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
    <div className="space-y-4 relative pb-6">
      {/* Visual background atmospheric lights */}
      <div className="absolute -top-20 left-10 w-96 h-96 bg-primary/5 rounded-full filter blur-[120px] pointer-events-none -z-10" />
      <div className="absolute -top-30 right-20 w-80 h-80 bg-cyan-500/5 rounded-full filter blur-[100px] pointer-events-none -z-10" />

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 1. TOP HEADER CONSOLE                                                  */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <Card className="border border-border/80 bg-background/55 backdrop-blur-md shadow-sm overflow-hidden select-none shrink-0">
        <CardContent className="p-2 md:px-3 md:py-2 space-y-2">
          {/* Main flex-row: Project Info on Left, Actions on Right */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-2.5">
            
            {/* Left Column: Title, version, stack badges & description */}
            <div className="space-y-0.5 min-w-0 flex-1 w-full lg:w-auto">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm">🏭</span>
                <h1 className="text-xs md:text-sm font-bold tracking-tight text-foreground flex items-center gap-1.5 flex-wrap">
                  {appRollup?.name || 'Loading Project...'}
                  <Badge variant="outline" className="text-[8.5px] font-bold px-1 py-0 border-border bg-muted/40 uppercase shrink-0">
                    v{appRollup?.version || '0.0.1'}
                  </Badge>
                  {queueRunning && (
                    <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  )}
                  {/* Stack Badges inline next to the version */}
                  {appRollup?.stack && (
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="text-[8px] font-semibold text-muted-foreground/80 py-0 px-1 bg-muted/20 shrink-0">
                        ⚡ {appRollup.stack.framework}
                      </Badge>
                      {appRollup.stack.language && (
                        <Badge variant="outline" className="text-[8px] font-semibold text-muted-foreground/80 py-0 px-1 bg-muted/20 shrink-0">
                          🏷️ {appRollup.stack.language}
                        </Badge>
                      )}
                      {appRollup.stack.database && (
                        <Badge variant="outline" className="text-[8px] font-semibold text-muted-foreground/80 py-0 px-1 bg-muted/20 shrink-0">
                          🗄️ {appRollup.stack.database}
                        </Badge>
                      )}
                    </div>
                  )}
                </h1>
              </div>
              <p className="text-[10px] text-muted-foreground line-clamp-1 max-w-2xl leading-relaxed">
                {appRollup?.description || 'Scaffolding and developing your application automatically.'}
              </p>
            </div>

            {/* Right Column: Unified Actions Toolbar */}
            <div className="flex flex-wrap items-center gap-1 shrink-0 w-full lg:w-auto">
              {/* Build Ready Stories button */}
              <Button
                onClick={handleBuildReadyStories}
                disabled={queueRunning || syncing}
                className={cn(
                  "h-7 text-[10px] gap-1 rounded-md font-bold transition-all duration-200 flex-1 sm:flex-none justify-center px-2.5",
                  queueRunning ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white hover:shadow-sm active:scale-95"
                )}
              >
                <Rocket className={cn("h-3 w-3", queueRunning && "animate-bounce")} />
                <span>Build Ready</span>
              </Button>

              {/* Dev App Server Controls Pill */}
              <div className="flex items-center border rounded-md bg-background p-0.5 h-7 text-[10px] select-none shrink-0">
                <div className="flex items-center gap-1 px-1">
                  <Activity className={cn("h-2.5 w-2.5", runStatus === 'running' ? "text-emerald-500" : "text-muted-foreground")} />
                  <span className="font-bold text-[8.5px] uppercase tracking-wider text-muted-foreground hidden xl:inline">Server:</span>
                  <Badge className={cn(
                    "text-[8px] font-bold px-1 h-4 rounded-sm flex items-center justify-center",
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
                    className="h-5.5 w-5.5 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-sm"
                  >
                    <Play className="h-2.5 w-2.5 fill-emerald-500/20" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleStopApp}
                    disabled={isActionLoading}
                    className="h-5.5 w-5.5 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-sm"
                  >
                    <Square className="h-2.5 w-2.5 fill-rose-500/20" />
                  </Button>
                )}

                {/* View server URL if active */}
                {runStatus === 'running' && runPort && (
                  <>
                    <Separator orientation="vertical" className="h-3.5 mx-0.5" />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => window.open(`http://localhost:${runPort}`, '_blank')}
                      className="h-5.5 w-5.5 text-primary hover:bg-primary/10 rounded-sm"
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
                  className={cn("h-5.5 w-5.5 rounded-sm", serverLogsOpen ? "bg-muted text-foreground" : "text-muted-foreground")}
                >
                  <Terminal className="h-3 w-3" />
                </Button>
              </div>

              {/* New Story button */}
              <Button
                size="sm"
                onClick={() => setShowStoryChat(true)}
                className="h-7 text-[10px] gap-1 rounded-md bg-primary text-primary-foreground font-bold hover:bg-primary/90 shadow-sm shrink-0 px-2.5 flex-1 sm:flex-none"
              >
                <Plus className="h-3 w-3" />
                <span>New Story</span>
              </Button>

              {/* Refresh data button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncRoadmap}
                disabled={syncing}
                className="h-7 text-[10px] rounded-md gap-1 px-2 text-muted-foreground hover:text-foreground shrink-0 flex-1 sm:flex-none"
              >
                <RefreshCw className={cn("h-2.5 w-2.5", syncing && "animate-spin")} />
                <span>Refresh</span>
              </Button>
            </div>
          </div>

          <Separator className="opacity-40" />

          {/* Controls & Filter Bar inside the Card */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 select-none">
            {/* Left side: View tabs & Mobile Filters Toggle Button */}
            <div className="flex items-center gap-1 shrink-0 self-start md:self-auto w-full md:w-auto">
              <div className="flex items-center gap-1 p-0.5 bg-muted/60 border rounded-md h-7.5 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setViewMode('board')}
                  className={cn(
                    "rounded-sm text-[10px] gap-1 h-6.5 px-2.5",
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
                    "rounded-sm text-[10px] gap-1 h-6.5 px-2.5",
                    viewMode === 'list' ? "bg-background shadow-xs text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <ListTodo className="h-3 w-3" />
                  <span>Roadmap</span>
                </Button>
              </div>

              {/* Optional mobile filters button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMobileFilters(true)}
                className={cn(
                  "h-7.5 text-[10px] gap-1 rounded-md px-2.5 md:hidden border-border bg-background hover:bg-muted/80 ml-auto",
                  (searchQuery || epicFilter !== 'all' || statusFilter !== 'all') && "border-primary text-primary"
                )}
              >
                <Filter className="h-3 w-3" />
                <span>Filters</span>
                {(searchQuery || epicFilter !== 'all' || statusFilter !== 'all') && (
                  <span className="flex h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </Button>
            </div>

            {/* Right side: Search, Dropdowns (Desktop only) */}
            <div className="hidden md:flex items-center gap-1.5 w-auto">
              {/* Search box */}
              <div className="relative w-40 md:w-44 shrink-0">
                <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground/75" />
                <Input
                  placeholder="Search stories..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-6.5 h-7 text-[10px] rounded-md bg-muted/30 w-full"
                />
              </div>

              {/* Epic Filter */}
              <select
                value={epicFilter}
                onChange={e => setEpicFilter(e.target.value)}
                className="h-7 px-1.5 rounded-md border border-border bg-background text-[10px] text-foreground focus:ring-1 focus:ring-primary w-32 cursor-pointer"
              >
                <option value="all">All Epics</option>
                {appRollup?.features?.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="h-7 px-1.5 rounded-md border border-border bg-background text-[10px] text-foreground focus:ring-1 focus:ring-primary w-28 cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="ready">Ready</option>
                <option value="in-progress">In Progress</option>
                <option value="failed">Failed</option>
                <option value="done">Done</option>
              </select>

              {/* Loading indicator */}
              {loading && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0 ml-1" />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-start">
          {/* Column 1: BACKLOG / DRAFT */}
          <KanbanColumn
            title="Backlog"
            description="Scaffold drafts or spec blueprints"
            badgeColor="bg-amber-500/10 text-amber-500 border-amber-500/25"
            stories={backlogStories}
            onSelect={handleOpenDrawer}
            onValidate={handleValidateStory}
            onBuild={handleSingleBuild}
            activeAction={activeAction}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'draft')}
            onDragStart={handleDragStart}
          />

          {/* Column 2: READY TO BUILD */}
          <KanbanColumn
            title="Ready to Build"
            description="Verified specifications awaiting launch"
            badgeColor="bg-teal-500/10 text-teal-400 border-teal-500/25"
            stories={readyStories}
            onSelect={handleOpenDrawer}
            onValidate={handleValidateStory}
            onBuild={handleSingleBuild}
            activeAction={activeAction}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'ready')}
            onDragStart={handleDragStart}
          />

          {/* Column 3: BUILDING / RUNNING */}
          <KanbanColumn
            title="In Progress"
            description="Actively compiling or iterating"
            badgeColor="bg-blue-500/10 text-blue-400 border-blue-500/25"
            stories={buildingStories}
            onSelect={handleOpenDrawer}
            onValidate={handleValidateStory}
            onBuild={handleSingleBuild}
            activeAction={activeAction}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'in-progress')}
            onDragStart={handleDragStart}
          />

          {/* Column 4: COMPLETED / DONE */}
          <KanbanColumn
            title="Completed"
            description="Code written and tests passed"
            badgeColor="bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
            stories={doneStories}
            onSelect={handleOpenDrawer}
            onValidate={handleValidateStory}
            onBuild={handleSingleBuild}
            activeAction={activeAction}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'done')}
            onDragStart={handleDragStart}
          />
        </div>
      )}

      {/* Standalone Lane if Board view */}
      {viewMode === 'board' && unsyncedStories.length > 0 && (
        <div className="space-y-3 mt-6 border border-border/60 bg-muted/20 p-5 rounded-xl">
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
              />
            ))}
          </div>
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
        // For running items: use live streamed log. For others: use stored output from the item.
        const panelLog = selectedQueueItem
          ? (selectedQueueItem.status === 'running' ? (buildOutput || selectedQueueItem.output || '') : (selectedQueueItem.output || selectedQueueItem.error || ''))
          : (buildOutput || '');
        const panelLabel = selectedQueueItem
          ? (() => {
              const specName = selectedQueueItem.storyFile || selectedQueueItem.specFile || '';
              const matched = mergedStories.find(s => s.file === specName || getBasename(s.file) === getBasename(specName));
              return matched
                ? (matched.metadata?.name || matched.feature?.name || matched.dbName || getBasename(specName))
                : (specName ? specName.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '') : 'Select a build');
            })()
          : 'Live agent log console';
        const isSelectedRunning = selectedQueueItem?.status === 'running';

        return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Queue Timeline — chronological list of items */}
          <Card className="border border-border/80 bg-background/55 backdrop-blur-md shadow-lg overflow-hidden lg:col-span-4 h-[500px] md:h-[calc(100vh-170px)] flex flex-col">
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
                <div className="relative py-3 px-4">
                  {/* Vertical timeline line */}
                  <div className="absolute left-[27px] top-0 bottom-0 w-px bg-border/60" />
                  <div className="space-y-3">
                    {queueItems.map((item, idx) => {
                      const specName = item.storyFile || item.specFile || '';
                      const isRunning = item.status === 'running';
                      const isFailed = item.status === 'failed';
                      const isDone = item.status === 'completed';
                      const isPending = !isRunning && !isFailed && !isDone;
                      const isSelected = item.id === selectedQueueItemId;
                      const matchedStory = mergedStories.find(s => s.file === specName || getBasename(s.file) === getBasename(specName));
                      const humanReadableName = matchedStory
                        ? (matchedStory.metadata?.name || matchedStory.feature?.name || matchedStory.dbName || getBasename(specName))
                        : (specName ? specName.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '') : `Queue item ${idx + 1}`);

                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 cursor-pointer group"
                          onClick={() => setSelectedQueueItemId(item.id)}
                        >
                          {/* Timeline dot */}
                          <div className={cn(
                            "relative z-10 h-7 w-7 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all",
                            isRunning && "border-primary bg-primary/20 animate-pulse",
                            isFailed && "border-rose-500 bg-rose-500/20",
                            isDone && "border-emerald-500 bg-emerald-500/20",
                            isPending && "border-border bg-muted"
                          )}>
                            {isRunning && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />}
                            {isFailed && <XCircle className="h-3.5 w-3.5 text-rose-500" />}
                            {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                            {isPending && <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />}
                          </div>

                          {/* Content card */}
                          <div className={cn(
                            "flex-1 min-w-0 p-2.5 rounded-lg border text-xs transition-all",
                            isRunning && "border-primary/40 bg-primary/5",
                            isFailed && "border-rose-500/30 bg-rose-500/5",
                            isDone && "border-emerald-500/20 bg-emerald-500/5",
                            isPending && "border-border/60 bg-background/40",
                            // Selection ring
                            isSelected && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
                            !isSelected && "group-hover:border-border"
                          )}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-foreground truncate" title={humanReadableName}>{humanReadableName}</span>
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
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                              <Badge variant="outline" className={cn(
                                "text-[8px] font-bold h-4 px-1.5 rounded uppercase border",
                                isRunning ? "bg-blue-500/10 text-blue-400 border-blue-500/25 animate-pulse" :
                                isFailed ? "bg-rose-500/10 text-rose-400 border-rose-500/25" :
                                isDone ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" :
                                "bg-muted border-border text-muted-foreground"
                              )}>
                                {item.status}
                              </Badge>
                              <span>{item.kind.replace('Story', '')}</span>
                              {item.addedAt && <span title={item.addedAt} className="ml-auto">{new Date(item.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                              {/* Log indicator: show dot if item has output */}
                              {(item.output || item.error) && !isSelected && (
                                <span title="Has logs — click to view" className="ml-auto h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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

          {/* Per-item Log Console */}
          <Card className="border border-border/80 bg-zinc-950 shadow-2xl lg:col-span-8 h-[500px] md:h-[calc(100vh-170px)] flex flex-col overflow-hidden">
            <div className="bg-zinc-900 border-b border-border/40 px-4 py-3 shrink-0 flex items-center justify-between select-none">
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
          </Card>
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

interface KanbanColumnProps {
  title: string;
  description: string;
  badgeColor: string;
  stories: any[];
  onSelect: (item: any, type: 'task' | 'story', parentStory?: any, parentFeature?: any) => void;
  onValidate: (file: string, kind: string) => void;
  onBuild: (file: string, kind: string) => void;
  activeAction: { type: string; file: string } | null;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (e: React.DragEvent, file: string) => void;
}

function KanbanColumn({
  title,
  description,
  badgeColor,
  stories,
  onSelect,
  onValidate,
  onBuild,
  activeAction,
  onDragOver,
  onDrop,
  onDragStart
}: KanbanColumnProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="flex flex-col h-[600px] md:h-[calc(100vh-170px)] bg-muted/15 border border-border/60 rounded-xl overflow-hidden shadow-xs flex-1 transition-all duration-200 hover:bg-muted/20"
    >
      {/* Header info */}
      <div className="p-3.5 bg-muted/20 border-b border-border/40 space-y-1 shrink-0 select-none">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm text-foreground tracking-tight">{title}</h2>
          <Badge className={cn("text-[9px] font-extrabold px-2 h-4.5 rounded-full border", badgeColor)}>
            {stories.length}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground leading-normal line-clamp-1">{description}</p>
      </div>

      {/* Cards list */}
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3 pb-4">
          {stories.length > 0 ? (
            stories.map(item => (
              <StoryKanbanCard
                key={item.file}
                item={item}
                onSelect={onSelect}
                onValidate={onValidate}
                onBuild={onBuild}
                activeAction={activeAction}
                onDragStart={onDragStart}
              />
            ))
          ) : (
            <div className="h-32 border border-dashed rounded-xl flex items-center justify-center text-center p-4 select-none">
              <span className="text-[10px] text-muted-foreground/60 italic font-semibold">Column empty</span>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StoryKanbanCard({
  item,
  onSelect,
  onValidate,
  onBuild,
  activeAction,
  onDragStart
}: {
  item: any;
  onSelect: (item: any, type: 'task' | 'story', parentStory?: any, parentFeature?: any) => void;
  onValidate: (file: string, kind: string) => void;
  onBuild: (file: string, kind: string) => void;
  activeAction: { type: string; file: string } | null;
  onDragStart: (e: React.DragEvent, file: string) => void;
}) {
  const name = item.metadata?.name || item.feature?.name || item.dbName || item.file;
  const isFeature = item.kind === 'FeatureStory' || !!item.feature;
  const icon = item.metadata?.icon || (isFeature ? '🧩' : '📦');
  const desc = item.metadata?.description || item.feature?.description;
  const progress = item.dbProgress !== undefined ? item.dbProgress : 0;
  const effectiveStatus = getEffectiveStatus(item);
  const statusCfg = storyStatusMap[effectiveStatus] || storyStatusMap.unknown;
  const isActionLoading = !!(activeAction && activeAction.file === item.file);

  return (
    <Card
      draggable={true}
      onDragStart={(e) => onDragStart(e, item.file)}
      onClick={() => onSelect(item, 'story')}
      className={cn(
        "border border-border/80 bg-background/55 hover:bg-background/90 hover:border-primary/40 hover:shadow-md cursor-grab active:cursor-grabbing transition-all duration-200 group relative",
        item.placeholder && "border-dashed border-border opacity-70",
        (effectiveStatus === 'running' || effectiveStatus === 'validation') && "border-primary bg-primary/5 animate-pulse"
      )}
    >
      <CardContent className="p-3.5 space-y-3 select-none">
        {/* Title row */}
        <div className="flex items-start gap-2.5 justify-between">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <span className="text-base shrink-0 mt-0.5">{icon}</span>
            <div className="min-w-0 flex-1">
              <span className="font-bold text-xs text-foreground group-hover:text-primary transition-colors leading-tight line-clamp-1 truncate" title={name}>
                {name.replace('features/', '')}
              </span>
              <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[130px] mt-0.5" title={item.file}>
                {item.file}
              </p>
            </div>
          </div>
          <Badge variant={isFeature ? "secondary" : "outline"} className="text-[8px] font-bold h-4 px-1 rounded-sm shrink-0 border-border uppercase">
            {isFeature ? 'Feature' : 'App'}
          </Badge>
        </div>

        {/* Description */}
        {desc && (
          <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
            {desc}
          </p>
        )}

        {/* Progress Bar */}
        {item.checklistTasks && item.checklistTasks.length > 0 && effectiveStatus !== 'done' && effectiveStatus !== 'completed' && (
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] text-muted-foreground font-semibold">
              <span>Backlog Checklist</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Footer row */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30">
          <Badge className={cn("text-[8px] font-extrabold h-4.5 px-1.5 py-0.5 rounded-sm border", statusCfg.bg)}>
            {statusCfg.label}
          </Badge>

          {/* Quick Actions buttons overlay */}
          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="ghost"
              disabled={isActionLoading}
              onClick={(e) => {
                e.stopPropagation();
                onValidate(item.file, item.kind);
              }}
              className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
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
              onClick={(e) => {
                e.stopPropagation();
                onBuild(item.file, item.kind || 'AppStory');
              }}
              className="h-6 w-6 text-primary hover:bg-primary/10 rounded-md"
            >
              {isActionLoading && activeAction?.type === 'build' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
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
  activeAction
}: ListStoryRowProps) {
  const name = item.metadata?.name || item.feature?.name || item.dbName || item.file;
  const isFeature = item.kind === 'FeatureStory' || !!item.feature;
  const icon = item.metadata?.icon || (isFeature ? '🧩' : '📦');
  const effectiveStatus = getEffectiveStatus(item);
  const statusCfg = storyStatusMap[effectiveStatus] || storyStatusMap.unknown;
  const progress = item.dbProgress !== undefined ? item.dbProgress : 0;
  const hasTasks = item.checklistTasks && item.checklistTasks.length > 0;
  const isActionLoading = !!(activeAction && activeAction.file === item.file);

  return (
    <div className="border border-border/50 bg-background/55 rounded-lg overflow-hidden transition-all duration-150">
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

        {/* Status indicator */}
        <Badge className={cn("text-[8px] font-extrabold h-4.5 px-1.5 py-0.5 rounded-sm border shrink-0 select-none", statusCfg.bg)}>
          {statusCfg.label}
        </Badge>

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
