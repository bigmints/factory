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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { NewProjectGuide } from '@/components/new-project-guide';
import {
  Rocket, Play, Square, ExternalLink, Terminal, Settings, Activity,
  CheckCircle2, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronRight, Plus,
  Search, Filter, Tag, Columns, Layers, FileCode2, Brain, FlaskConical, Wrench,
  ShieldCheck, FolderOpen, RefreshCw, Sliders, X, Check, Package, ListTodo, Info,
  BookOpen, Code, TerminalSquare, Link2, Users, Network, Lock, Clock,
  Pencil, Trash2, Eye, FileText, Save, Copy, Factory, Zap, Database, AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StoryEditor } from '@/components/story-editor';

// ─── Board sub-modules ───
import type {
  Task, PhysicalStory, QueueItem, QueueStats, FeatureEpic, AppRollupData, ActivityStep, NotionBoardProps,
} from './board/types';
import { storyStatusMap, epicStatusMap, EPIC_COLORS, taskStatusMap } from './board/constants';
import {
  getStepIcon, parseActivities, getBasename, getSlug, getStorySlugs,
  getRelatedStories, getEffectiveStatus, topoSort, resolveDependencyChain,
} from './board/utils';
import { YamlViewer } from './board/yaml-viewer';
import { MobileKanbanBoard } from './board/mobile-kanban-board';
import { FlatTaskList } from './board/flat-task-list';
import { ListStoryRow } from './board/list-story-row';


export function NotionBoard({ initialView = 'list', onNavigateToBuild, projectRefreshKey = 0, onOpenStoryChat, className }: NotionBoardProps) {
  // ─── State ───
  const [viewMode, setViewMode] = useState<'board' | 'list' | 'queue'>(initialView);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Drag-and-drop removed — Board is view-only
  const handleDragStart = (_e: React.DragEvent, _file: string) => {};
  const handleDragOver = (_e: React.DragEvent) => {};

  const handleDrop = async (_e: React.DragEvent, _targetStatus: string) => {};

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

  // Bootstrap / scaffold gate
  const [bootstrapped, setBootstrapped] = useState<boolean>(true); // default true = don’t block
  const [scaffoldStoryFile, setScaffoldStoryFile] = useState<string | null>(null);

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
  const [activeAction, setActiveAction] = useState<{ type: string; file: string } | null>(null);

  // Empty-state prompt banner dismiss (persisted in localStorage)
  const [promptDismissed, setPromptDismissed] = useState(true);
  const [showPromptModal, setShowPromptModal] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (activeProjectId) {
        setPromptDismissed(localStorage.getItem(`factory_empty_board_dismissed_${activeProjectId}`) === 'true');
      } else {
        setPromptDismissed(false);
      }
    }
  }, [activeProjectId]);

  const handleDismissBanner = () => {
    setPromptDismissed(true);
    if (activeProjectId) {
      localStorage.setItem(`factory_empty_board_dismissed_${activeProjectId}`, 'true');
    }
  };

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

  // Fetch bootstrap status (does scaffold need to be built first?)
  const fetchBootstrapStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/bootstrap-status');
      if (res.ok) {
        const data = await res.json();
        setBootstrapped(data.bootstrapped ?? true);
        setScaffoldStoryFile(data.scaffoldStory ?? null);
      }
    } catch {
      // Non-fatal — default remains true (don’t block)
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
    Promise.all([fetchRollup(true), fetchStories(), fetchQueue(), fetchRunStatus(), fetchBootstrapStatus()]).finally(() => setLoading(false));

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
  }, [fetchRollup, fetchStories, fetchQueue, fetchRunStatus, fetchBootstrapStatus, projectRefreshKey]);

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
            const comp = nextTasks.filter(t => t.status === 'done').length;
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

  const handleDeleteTask = async (taskFullId: string) => {
    setUpdatingTaskId(taskFullId);
    try {
      const res = await fetch('/api/app-rollup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteTask', taskId: taskFullId }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Delete failed');
      }

      // Fast optimistic UI update
      if (appRollup) {
        const updatedFeatures = appRollup.features.map(f => ({
          ...f,
          stories: f.stories.map(s => {
            const hasTask = s.tasks.some(t => t.fullId === taskFullId);
            if (!hasTask) return s;

            const nextTasks = s.tasks.filter(t => t.fullId !== taskFullId);
            const comp = nextTasks.filter(t => t.status === 'done').length;
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
      toast.success('Task deleted successfully');

      // Refresh drawer if viewing active item
      if (selectedItem && selectedItem.type === 'story') {
        setSelectedItem(prev => prev ? {
          ...prev,
          data: {
            ...prev.data,
            checklistTasks: (prev.data.checklistTasks || []).filter((t: any) => t.fullId !== taskFullId)
          }
        } : null);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete task');
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

    // Bootstrap gate: block FeatureStory builds until scaffold is built
    if (kind === 'FeatureStory' && !bootstrapped) {
      const scaffoldStory = scaffoldStoryFile
        ? mergedStories.find(s => s.file === scaffoldStoryFile || getSlug(s.file) === getSlug(scaffoldStoryFile))
        : null;
      const scaffoldStatus = scaffoldStory ? getEffectiveStatus(scaffoldStory) : 'unknown';

      if (scaffoldStatus === 'draft') {
        const confirmMove = window.confirm(
          "The 'Scaffold & Foundation' story must be built first, but it is currently in Draft status. Would you like to add it to 'Ready to Build' now?"
        );
        if (confirmMove) {
          try {
            const res = await fetch('/api/stories/update-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ file: scaffoldStoryFile, status: 'ready-to-build' }),
            });
            const data = await res.json();
            if (data.success) {
              toast.success("Scaffold story moved to 'Ready to Build'");
              fetchStories();
              if (scaffoldStoryFile) {
                setTimeout(() => {
                  handleSingleBuild(scaffoldStoryFile!, 'AppStory');
                }, 300);
              }
              return;
            } else {
              toast.error(data.error || 'Could not update status');
            }
          } catch (iEx) {
            toast.error('Failed to update status');
          }
        }
      } else {
        toast.error('Scaffold not built yet', {
          description: 'Build the "Scaffold & Foundation" epic first. Feature stories cannot compile without a base app scaffold.',
          duration: 6000,
          action: scaffoldStoryFile
            ? {
                label: 'Build Scaffold',
                onClick: () => handleSingleBuild(scaffoldStoryFile, 'AppStory'),
              }
            : undefined,
        });
      }
      return;
    }

    // If building scaffold and it is in 'draft' status, ask to move it to 'ready-to-build'
    if (file === scaffoldStoryFile) {
      const scaffoldStory = mergedStories.find(s => s.file === file || getSlug(s.file) === getSlug(file));
      const scaffoldStatus = scaffoldStory ? getEffectiveStatus(scaffoldStory) : 'unknown';
      if (scaffoldStatus === 'draft') {
        const confirmMove = window.confirm(
          "The Scaffold story is currently in Draft status. Would you like to move it to 'Ready to Build' first?"
        );
        if (confirmMove) {
          try {
            const res = await fetch('/api/stories/update-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ file, status: 'ready-to-build' }),
            });
            const data = await res.json();
            if (data.success) {
              toast.success("Scaffold story moved to 'Ready to Build'");
              fetchStories();
            } else {
              toast.error(data.error || 'Could not update status');
              return; // Abort build since move failed
            }
          } catch (iEx) {
            toast.error('Failed to update status');
            return; // Abort build since error occurred
          }
        }
      }
    }

    // ─── Dependency resolution ──────────────────────────────────────────────────────
    // Find the story object so we can resolve its dependency chain.
    const storyObj = mergedStories.find(s => s.file === file || getSlug(s.file) === getSlug(file));
    const chain = storyObj ? resolveDependencyChain(storyObj, mergedStories) : [];

    // If chain > 1, there are unbuilt prerequisites — queue the whole chain.
    if (chain.length > 1) {
      const prereqs = chain.slice(0, -1); // everything before the target story
      const prereqNames = prereqs.map(s => s.name || getBasename(s.file)).join(', ');
      const toastId = toast.loading(`Resolving ${prereqs.length} prerequisite${prereqs.length > 1 ? 's' : ''}...`);

      try {
        let allEnqueued = 0;
        for (const s of chain) {
          const res = await fetch('/api/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storyFile: s.file, specFile: s.file,
              kind: s.kind || kind,
              phase: s.phase,
              dependsOn: s.dependsOn,
              engine: 'factory',
            }),
          });
          if (res.ok) allEnqueued++;
        }
        if (allEnqueued === 0) { toast.error('Failed to enqueue', { id: toastId }); return; }

        toast.success(`Queued ${baseName} + auto-added ${prereqs.length} prerequisite${prereqs.length > 1 ? 's' : ''}`, {
          id: toastId,
          description: `→ ${prereqNames}`,
          duration: 7000,
        });
        fetchQueue();
        const startRes = await fetch('/api/queue/start', { method: 'POST' });
        if (startRes.ok) {
          fetchBootstrapStatus();
          if (onNavigateToBuild) { onNavigateToBuild(); }
          else { setViewMode('queue'); setBuildLogsOpen(true); }
        } else {
          toast.error('Failed to launch pipeline');
        }
      } catch {
        toast.error('Network error building story');
      }
      return;
    }

    // No unbuilt prerequisites — simple single-story build path.
    toast.info(`Preparing build for ${baseName}...`);
    try {
      const enqueued = await handleEnqueue(file, kind);
      if (!enqueued) return;
      const res = await fetch('/api/queue/start', { method: 'POST' });
      if (res.ok) {
        toast.success('Build pipeline running...');
        fetchQueue();
        fetchBootstrapStatus();
        if (onNavigateToBuild) { onNavigateToBuild(); }
        else { setViewMode('queue'); setBuildLogsOpen(true); }
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
    // Collect all non-done stories that are ready, failed, or review
    const readyStories = mergedStories.filter(item => {
      const status = getEffectiveStatus(item);
      return status === 'ready-to-build' || status === 'failed' || status === 'review';
    });

    if (readyStories.length === 0) {
      toast.info('All stories are fully built or clean! No pending items found.');
      return;
    }

    // Topological sort: dependencies always appear before dependents.
    // Also pulls in any unbuilt prerequisites of the ready stories.
    const ordered = topoSort(readyStories, mergedStories);

    const toastId = toast.loading(`Enqueuing ${ordered.length} stories into pipeline...`);
    let enqueued = 0;
    try {
      for (const story of ordered) {
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyFile: story.file,
            specFile: story.file,
            kind: story.kind || 'FeatureStory',
            phase: story.phase,
            dependsOn: story.dependsOn,
            engine: 'factory',
          }),
        });
        if (res.ok) enqueued++;
      }

      if (enqueued > 0) {
        toast.loading(`Starting execution loop for ${enqueued} items...`, { id: toastId });
        const startRes = await fetch('/api/queue/start', { method: 'POST' });
        if (startRes.ok) {
          toast.success(`Launched ${enqueued} stories in dependency order.`, { id: toastId });
          fetchQueue();
          if (onNavigateToBuild) { onNavigateToBuild(); }
          else { setViewMode('queue'); setBuildLogsOpen(true); }
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

  // Build Epic Action — queues ALL non-done stories in one epic in topo order
  const handleBuildEpic = async (feature: any) => {
    if (!feature) return;

    // Collect all non-done stories that belong to this epic
    const epicStories = mergedStories.filter(s => s.epicParent?.id === feature.id);
    const unbuilt = epicStories.filter(s => {
      const st = getEffectiveStatus(s);
      return st !== 'done' && st !== 'completed';
    });

    if (unbuilt.length === 0) {
      toast.success(`All stories in “${feature.name}” are already done!`);
      return;
    }

    // Topo-sort the epic stories — also pulls in cross-epic prerequisites
    const ordered = topoSort(unbuilt, mergedStories);

    const toastId = toast.loading(`Queuing ${ordered.length} stories in “${feature.name}”...`);
    let enqueued = 0;
    try {
      for (const story of ordered) {
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyFile: story.file,
            specFile: story.file,
            kind: story.kind || 'FeatureStory',
            phase: story.phase,
            dependsOn: story.dependsOn,
            engine: 'factory',
          }),
        });
        if (res.ok) enqueued++;
      }

      if (enqueued > 0) {
        toast.loading(`Starting pipeline for ${enqueued} stories...`, { id: toastId });
        const startRes = await fetch('/api/queue/start', { method: 'POST' });
        if (startRes.ok) {
          toast.success(`Building “${feature.name}” — ${enqueued} stories in order.`, { id: toastId, duration: 6000 });
          fetchQueue();
          if (onNavigateToBuild) { onNavigateToBuild(); }
          else { setViewMode('queue'); setBuildLogsOpen(true); }
        } else {
          toast.error('Failed to start pipeline', { id: toastId });
        }
      } else {
        toast.error('Nothing was queued', { id: toastId });
      }
    } catch {
      toast.error('Network error starting epic build');
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
        const name = item.name || item.metadata?.name || item.feature?.name || item.dbName || item.file;
        return name.toLowerCase().includes(q) || item.file.toLowerCase().includes(q);
      });
    }

    if (epicFilter !== 'all') {
      list = list.filter(item => item.epicParent?.id === epicFilter);
    }

    if (statusFilter !== 'all') {
      list = list.filter(item => {
        const status = getEffectiveStatus(item);
        if (statusFilter === 'in-progress') {
          return status === 'in-progress' || status === 'validation' || status === 'running' || status === 'building';
        }
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
      return status === 'ready-to-build' || status === 'failed' || status === 'review';
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
      return status === 'in-progress' || status === 'validation' || status === 'running' || status === 'building';
    });
  }, [filteredStoriesList]);

  // Done specs
  const doneStories = useMemo(() => {
    return filteredStoriesList.filter(item => {
      const status = getEffectiveStatus(item);
      return status === 'done' || status === 'done';
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
    const stats: QueueStats = { draft: 0, 'ready-to-build': 0, building: 0, paused: 0, failed: 0, done: 0, total: 0 };
    queueItems.forEach(item => {
      stats.total++;
      if (item.status === 'building') stats.building++;
      else if (item.status === 'done') stats.done++;
      else if (item.status === 'failed') stats.failed++;
      else if (item.status === 'ready-to-build') stats['ready-to-build']++;
      else if (item.status === 'paused') stats.paused++;
      else if (item.status === 'draft') stats.draft++;
    });
    return stats;
  }, [queueItems]);

  const activeQueueLogs = useMemo(() => {
    const runningItem = queueItems.find(i => i.status === 'running');
    return runningItem?.output || '';
  }, [queueItems]);

  // Trigger Drawer View
  const handleOpenDrawer = (item: any, type?: 'task' | 'story', parentStory?: any, parentFeature?: any) => {
    const resolvedType = type || (item.fullId ? 'task' : 'story');
    setSelectedItem({ type: resolvedType, data: item, parentStory, parentFeature });
    setDrawerOpen(true);
    setEditMode(false);
    setDeleteConfirm(false);
    setStoryTab('spec');
    setYamlContent(null);
    if (resolvedType === 'story' && item.file) {
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

  const handleDeleteStory = async (file: string, name?: string) => {
    try {
      const encodedFile = encodeURIComponent(file || 'none');
      const nameParam = name ? `?name=${encodeURIComponent(name)}` : '';
      const res = await fetch(`/api/stories/${encodedFile}${nameParam}`, { method: 'DELETE' });
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
      return item.name || item.feature?.name || item.dbName || item.file;
    }
    return item.metadata?.name || item.dbName || item.file;
  };

  const getStoryIcon = (item: any) => {
    if (item.kind === 'FeatureStory' || !!item.feature) {
      return 'Feature';
    }
    return 'App';
  };

  const getStoryDesc = (item: any) => {
    if (item.kind === 'FeatureStory' || !!item.feature) {
      return item.feature?.description || 'Feature spec story';
    }
    return item.metadata?.description || 'Core system spec story';
  };

  // ─── JSX Renders ───

  return (
    <div className={cn("relative", className)}>
      {/* Visual background atmospheric lights */}
      <div className="absolute -top-20 left-10 w-96 h-96 bg-primary/5 rounded-full filter blur-[120px] pointer-events-none -z-10" />
      <div className="absolute -top-30 right-20 w-80 h-80 bg-cyan-500/5 rounded-full filter blur-[100px] pointer-events-none -z-10" />

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 1. TOP HEADER CONSOLE                                                  */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <div className="pt-3 md:pt-4 pb-3 select-none shrink-0 border-b border-border/40 px-1">


        {/* Controls & Filter Bar — single row on mobile, two rows on desktop */}
        <div className="flex flex-col gap-1.5 select-none">
            {/* Left: Tasks label + View Mode Switcher */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <ListTodo className="h-3.5 w-3.5" />
                <span>All Tasks</span>
                <span className="tabular-nums text-[10px] bg-muted border rounded px-1.5 py-0.5 text-foreground/70">{filteredStoriesList.length}</span>
              </div>

              {/* View Switcher segment group */}
              <div className="rounded-lg bg-muted p-0.5 flex items-center border border-border/80 select-none ml-1 sm:ml-2">
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] sm:text-xs font-bold transition-all tap-shrink min-h-[26px] cursor-pointer",
                    viewMode === 'list' ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-label="List View"
                >
                  <ListTodo className="h-3 w-3 shrink-0" />
                  <span className="hidden sm:inline">List</span>
                </button>
                <button
                  onClick={() => setViewMode('board')}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] sm:text-xs font-bold transition-all tap-shrink min-h-[26px] cursor-pointer",
                    viewMode === 'board' ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-label="Board View"
                >
                  <Columns className="h-3 w-3 shrink-0" />
                  <span className="hidden sm:inline">Board</span>
                </button>
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-1.5 w-full sm:w-auto sm:ml-auto">
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
                className="sm:hidden tap-shrink h-8 flex-1 sm:w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
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
                  "h-8 text-[10px] gap-1 rounded-md px-2 sm:px-2.5 border-border bg-background hover:bg-muted/80 shrink-0 flex-1 sm:flex-none",
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
                onClick={() => onOpenStoryChat?.()}
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
                  'tap-shrink h-8 px-2.5 flex items-center justify-center gap-1.5 rounded-md font-bold text-[10px] transition-all shrink-0 flex-1 sm:flex-none',
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
                  <option value="ready-to-build">Ready</option>
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
          onOpenStoryChat?.();
        }}
      />

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 3. FLAT TASK LIST — single unified list, no hierarchy                  */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <FlatTaskList
          stories={filteredStoriesList}
          mergedStories={mergedStories}
          epicColorMap={epicColorMap}
          handleOpenDrawer={handleOpenDrawer}
          handleValidateStory={handleValidateStory}
          handleSingleBuild={handleSingleBuild}
          activeAction={activeAction}
          bootstrapped={bootstrapped}
          scaffoldStoryFile={scaffoldStoryFile}
        />
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 4. KANBAN BOARD — 4 columns desktop layout / snap carousel mobile      */}
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
          showEpicLegend={showEpicLegend}
          appRollup={appRollup}
          bootstrapped={bootstrapped}
          scaffoldStoryFile={scaffoldStoryFile}
        />
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
          ? (selectedMatchedStory?.name || selectedMatchedStory?.metadata?.name || selectedMatchedStory?.feature?.name || selectedMatchedStory?.dbName || (selectedQueueItem as any).displayName || selectedQueueItem.storyFile?.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '') || 'Select a build')
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
                  {queueStats.total} total · {queueStats['ready-to-build']} pending · {queueStats.building} running · {queueStats.done} done · {queueStats.failed} failed
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
                      const isRunning = item.status === 'building' || item.status === 'running';
                      const isFailed = item.status === 'failed';
                      const isDone = item.status === 'done';
                      const isSelected = item.id === selectedQueueItemId;
                      const matchedStory = mergedStories.find(s => s.file === specName || getSlug(s.file) === getSlug(specName));
                      const humanReadableName = matchedStory?.name || matchedStory?.metadata?.name || matchedStory?.feature?.name || matchedStory?.dbName || (item as any).displayName || specName.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '') || `Queue item ${idx + 1}`;
                      const epicParent = matchedStory?.epicParent;
                      const epicColor = epicParent ? epicColorMap.get(epicParent.id) : undefined;
                      const desc = matchedStory?.metadata?.description || matchedStory?.feature?.description || '';
                      const totalTasks = matchedStory?.checklistTasks?.length || 0;
                      const doneTasks = matchedStory?.checklistTasks?.filter((t: any) => t.status === 'done').length || 0;
                      const durationSec = item.durationMs ? Math.round(item.durationMs / 1000) : null;
                      const statusCfg = isRunning ? storyStatusMap.running : isFailed ? storyStatusMap.failed : isDone ? storyStatusMap.done : storyStatusMap.draft;

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "rounded-xl border transition-all duration-150 cursor-pointer overflow-hidden",
                            isRunning && "border-primary/40 bg-primary/5 shadow-sm",
                            isFailed && "border-rose-500/30 bg-rose-500/5",
                            isDone && "border-emerald-500/20 bg-emerald-500/5",
                            !isRunning && !isFailed && !isDone && "border-border/50 bg-background/40",
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
                                {(isFailed || isDone || item.status === 'paused' || item.status === 'blocked') && (
                                  <Button size="icon" variant="ghost" title="Rebuild" className="h-5 w-5 text-primary hover:bg-primary/10 rounded" onClick={() => handleRetryItem(item.id)}>
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
                      selectedQueueItem.status === 'done' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" :
                      "bg-muted border-border text-muted-foreground"
                    )}>
                      {selectedQueueItem.status}
                    </Badge>
                  )}
                </span>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                    {isSelectedRunning ? 'live' : selectedQueueItem ? 'stored log' : 'idle'}
                  </span>
                  {selectedQueueItem && !isSelectedRunning && (selectedQueueItem.status === 'done' || selectedQueueItem.status === 'failed') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] text-primary hover:bg-primary/10 rounded gap-1"
                      onClick={() => { handleRetryItem(selectedQueueItem.id); setBuildLogsOpen(false); }}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Rebuild
                    </Button>
                  )}
                  {selectedQueueItem && !isSelectedRunning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded gap-1"
                      onClick={() => { handleRemoveQueueItem(selectedQueueItem.id); setBuildLogsOpen(false); }}
                    >
                      <X className="h-3 w-3" />
                      Remove
                    </Button>
                  )}
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
      <Sheet open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) { setEditMode(false); setDeleteConfirm(false); } }}>
        <SheetContent 
          side="right" 
          className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl bg-zinc-950/95 backdrop-blur-md border-l border-border/40 shadow-2xl flex flex-col p-0 h-full overflow-hidden focus:outline-none"
        >
          {selectedItem && (
            <div className="flex flex-col h-full min-h-0 divide-y divide-border/20 text-zinc-300">
              
              {/* ── UNIFIED COMPACT HEADER ── */}
              <div className="shrink-0 px-5 pt-3.5 pb-0 bg-zinc-900/40 border-b border-border/20 relative flex flex-col gap-2 select-none">
                {/* Row 1: Category, Status, & Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 pr-8">
                  {/* Category Label */}
                  <div className="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5 font-mono">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    {selectedItem.type === 'story'
                      ? (selectedItem.data.kind === 'FeatureStory' ? 'Feature spec story' : 'App bootstrap story')
                      : 'Story sub-task'}
                  </div>

                  {/* Controls / Actions (Title-adjacent or aligned to right) */}
                  <div className="flex items-center gap-2">
                    {/* Status Dropdown */}
                    {selectedItem.type === 'story' ? (
                      <select
                        value={selectedItem.data.status ?? 'draft'}
                        onChange={e => {
                          handleUpdateStoryStatus(selectedItem.data.file, e.target.value);
                          setSelectedItem(prev => prev ? { ...prev, data: { ...prev.data, status: e.target.value } } : null);
                        }}
                        className="h-7 rounded border border-zinc-800 bg-zinc-950 text-[10px] font-medium text-zinc-300 px-2 focus:outline-none focus:ring-1 focus:ring-primary/60 font-sans cursor-pointer hover:bg-zinc-900 hover:text-white transition-all shrink-0"
                      >
                        <option value="draft">Draft</option>
                        <option value="ready-to-build">Ready to Build</option>
                        <option value="review">In Review</option>
                        <option value="done">Done</option>
                      </select>
                    ) : (
                      <select
                        value={selectedItem.data.status ?? 'draft'}
                        onChange={e => {
                          handleUpdateTaskStatus(selectedItem.data.fullId, e.target.value as any);
                          setSelectedItem(prev => prev ? { ...prev, data: { ...prev.data, status: e.target.value } } : null);
                        }}
                        className="h-7 rounded border border-zinc-800 bg-zinc-950 text-[10px] font-medium text-zinc-300 px-2 focus:outline-none focus:ring-1 focus:ring-primary/60 font-sans cursor-pointer hover:bg-zinc-900 hover:text-white transition-all shrink-0"
                      >
                        <option value="pending">Pending</option>
                        <option value="running">Running</option>
                        <option value="completed">Completed</option>
                        <option value="failed">Failed</option>
                      </select>
                    )}

                    {/* Build / Edit / Delete Actions */}
                    {selectedItem.type === 'story' ? (
                      <>
                        <Button
                          size="sm"
                          className="h-7 px-2.5 gap-1 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-all flex items-center shrink-0"
                          onClick={() => {
                            handleEnqueue(selectedItem.data.file, selectedItem.data.kind);
                            setDrawerOpen(false);
                          }}
                        >
                          <Play className="h-2.5 w-2.5 fill-current" />
                          <span>Build</span>
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 gap-1 text-[10px] border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-white rounded transition-all shrink-0"
                          onClick={() => {
                            setEditingStory({ file: selectedItem.data.file, name: selectedItem.data.name });
                            setDrawerOpen(false);
                          }}
                        >
                          <Pencil className="h-2.5 w-2.5" />
                          <span>Edit Form</span>
                        </Button>

                        {!deleteConfirm ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-zinc-500 hover:text-rose-450 hover:bg-rose-950/20 rounded transition-all shrink-0"
                            onClick={() => setDeleteConfirm(true)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        ) : (
                          <div className="flex items-center gap-1 bg-rose-950/30 border border-rose-800/40 rounded p-0.5 shrink-0">
                            <span className="text-[9px] text-rose-400 font-bold px-1.5">Delete?</span>
                            <Button
                              size="sm"
                              className="h-5.5 px-1.5 text-[9px] bg-rose-600 hover:bg-rose-505 text-white font-bold"
                              onClick={() => {
                                handleDeleteStory(selectedItem.data.file, selectedItem.data.name);
                                setDrawerOpen(false);
                              }}
                            >
                              Yes
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5.5 px-1.5 text-[9px] text-zinc-400 hover:text-white"
                              onClick={() => setDeleteConfirm(false)}
                            >
                              No
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {!deleteConfirm ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2.5 gap-1 text-[10px] text-zinc-500 hover:text-rose-450 hover:bg-rose-950/20 rounded transition-all shrink-0"
                            onClick={() => setDeleteConfirm(true)}
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Delete</span>
                          </Button>
                        ) : (
                          <div className="flex items-center gap-1 bg-rose-950/30 border border-rose-800/40 rounded p-0.5 shrink-0">
                            <span className="text-[9px] text-rose-400 font-bold px-1.5">Delete?</span>
                            <Button
                              size="sm"
                              className="h-5.5 px-1.5 text-[9px] bg-rose-600 hover:bg-rose-505 text-white font-bold"
                              onClick={() => {
                                handleDeleteTask(selectedItem.data.fullId);
                                setDrawerOpen(false);
                              }}
                            >
                              Yes
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5.5 px-1.5 text-[9px] text-zinc-400 hover:text-white"
                              onClick={() => setDeleteConfirm(false)}
                            >
                              No
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Row 2: Title and Subtitle */}
                <div className="space-y-1">
                  <SheetTitle className="text-sm font-bold text-white tracking-tight pr-6 select-all flex items-center gap-2 leading-tight">
                    {selectedItem.type === 'task' ? selectedItem.data.title : getStoryTitle(selectedItem.data)}
                  </SheetTitle>
                  
                  {selectedItem.type === 'story' && getStoryDesc(selectedItem.data) && (
                    <p className="text-[11px] text-zinc-400 font-sans leading-relaxed select-all line-clamp-2">
                      {getStoryDesc(selectedItem.data)}
                    </p>
                  )}

                  {selectedItem.type === 'task' && selectedItem.parentStory && (
                    <p className="text-[10px] text-zinc-500 font-sans select-all">
                      Parent Story: <span className="text-zinc-400 font-semibold">{selectedItem.parentStory.name}</span>
                    </p>
                  )}
                </div>

                {/* Row 3: Tabs System (Only for Story) */}
                {selectedItem.type === 'story' && (
                  <div className="flex items-end gap-1.5 mt-1 border-t border-border/10 pt-1">
                    {([
                      { key: 'spec', label: 'Specification' },
                      { key: 'raw', label: 'YAML Source' },
                      { key: 'tasks', label: 'Sub-tasks' }
                    ] as const).map(({ key, label }) => {
                      const isTasks = key === 'tasks';
                      const taskCount = selectedItem.data.checklistTasks?.length ?? 0;
                      return (
                        <button
                          key={key}
                          onClick={() => setStoryTab(key)}
                          className={cn(
                            'px-3 py-1.5 text-[11px] font-semibold border-b-2 transition-all font-sans relative flex items-center gap-1.5 focus:outline-none cursor-pointer',
                            storyTab === key
                              ? 'border-primary text-white font-bold'
                              : 'border-transparent text-zinc-500 hover:text-zinc-300'
                          )}
                        >
                          {label}
                          {isTasks && taskCount > 0 && (
                            <span className="inline-flex items-center justify-center bg-zinc-800 text-zinc-300 rounded-full px-1 py-0.5 text-[8px] font-mono border border-zinc-700/50">
                              {taskCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── 4. CONTENT BODY ── */}
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800/80 bg-zinc-950/50">
                
                {/* ─── STORY: SPECIFICATION TAB ─── */}
                {selectedItem.type === 'story' && storyTab === 'spec' && (
                  <div className="p-6 space-y-6">
                    
                    {/* Visual details grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      
                      {/* Column 1: Core Details Card */}
                      <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-4 space-y-3.5 shadow-sm">
                        <div className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest font-mono">
                          Story Metadata
                        </div>
                        <div className="space-y-2 text-xs">
                          <div className="flex items-start justify-between py-1.5 border-b border-zinc-900 overflow-hidden gap-4">
                            <span className="text-zinc-500 whitespace-nowrap">File Path</span>
                            <span 
                              className="font-mono text-zinc-300 text-right select-all max-w-[240px] break-words whitespace-pre-wrap"
                            >
                              {selectedItem.data.file}
                            </span>
                          </div>
                          <div className="flex items-center justify-between py-1.5 border-b border-zinc-900">
                            <span className="text-zinc-500">Story Kind</span>
                            <span className="font-semibold text-zinc-200">
                              {selectedItem.data.kind === 'FeatureStory' ? 'Feature Specification' : 'App Bootstrap'}
                            </span>
                          </div>
                          {selectedItem.data.phase !== undefined && (
                            <div className="flex items-center justify-between py-1.5 border-b border-zinc-900">
                              <span className="text-zinc-500">Build Phase</span>
                              <span className="font-semibold text-primary">
                                Phase {selectedItem.data.phase}
                              </span>
                            </div>
                          )}
                          {selectedItem.data.target?.app && (
                            <div className="flex items-center justify-between py-1.5">
                              <span className="text-zinc-500">Target Application</span>
                              <span className="font-mono text-cyan-400">
                                {selectedItem.data.target.app}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Column 2: Dependencies and Related Stories */}
                      <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-4 space-y-3 shadow-sm flex flex-col justify-between">
                        <div>
                          <div className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest font-mono mb-2.5">
                            Dependency Chain
                          </div>
                          
                          {/* Must build first / dependsOn */}
                          {selectedItem.data.dependsOn && selectedItem.data.dependsOn.length > 0 ? (
                            <div className="space-y-2">
                              <span className="text-[11px] text-zinc-400 font-semibold block">Must build first:</span>
                              <div className="flex flex-wrap gap-1.5">
                                {selectedItem.data.dependsOn.map((dep: string) => {
                                  // Find the dependency story in mergedStories
                                  const depStory = mergedStories.find((s: any) => {
                                    const slug = s.file.split('/').pop()?.replace(/\.ya?ml$/i, '') || '';
                                    return slug === dep || s.file === dep;
                                  });
                                  const depStatus = depStory ? (depStory.status || 'draft') : 'unknown';
                                  const isDone = depStatus === 'done' || depStatus === 'completed';
                                  
                                  return (
                                    <span
                                      key={dep}
                                      onClick={() => depStory && handleOpenDrawer(depStory, 'story', undefined, depStory.epicParent)}
                                      className={cn(
                                        'inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-mono cursor-pointer transition-all hover:scale-[1.02]',
                                        isDone
                                          ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-450'
                                          : 'bg-zinc-900 border-zinc-800 text-zinc-450'
                                      )}
                                    >
                                      {isDone ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5 text-zinc-500" />}
                                      {dep.replace('.yaml', '')}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="text-zinc-500 text-xs italic py-2">
                              No prerequisites. This story can build immediately.
                            </div>
                          )}
                        </div>

                        {/* NPM dependencies */}
                        {selectedItem.data.dependencies && selectedItem.data.dependencies.length > 0 && (
                          <div className="mt-2.5 pt-2.5 border-t border-zinc-900 space-y-1.5">
                            <span className="text-[11px] text-zinc-400 font-semibold block">Required NPM packages:</span>
                            <div className="flex flex-wrap gap-1">
                              {selectedItem.data.dependencies.map((pkg: string) => (
                                <Badge key={pkg} variant="outline" className="bg-zinc-900 border-zinc-800 text-zinc-300 font-mono text-[9px] px-1.5 py-0">
                                  {pkg}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                    </div>

                    {/* Model Details Block (Database Schema) */}
                    {selectedItem.data.model && selectedItem.data.model.collection && (
                      <div className="bg-zinc-900/20 border border-zinc-800/40 rounded-xl p-5 space-y-3.5 shadow-sm">
                        <div className="flex items-center gap-2 text-zinc-150">
                          <Database className="h-4 w-4 text-sky-400" />
                          <span className="text-sm font-bold text-white">Database Spec</span>
                          <span className="text-[10px] bg-sky-950/40 text-sky-400 font-mono border border-sky-900/50 px-2 py-0.5 rounded-full">
                            Collection: {selectedItem.data.model.collection}
                          </span>
                        </div>
                        {Array.isArray(selectedItem.data.model.fields) && selectedItem.data.model.fields.length > 0 ? (
                          <div className="border border-zinc-900 rounded-lg overflow-hidden">
                            <Table className="text-xs">
                              <TableHeader className="bg-zinc-900/40">
                                <TableRow className="border-b border-zinc-900/80 hover:bg-transparent">
                                  <TableHead className="font-mono text-[10px] text-zinc-400 h-8">Field Name</TableHead>
                                  <TableHead className="font-mono text-[10px] text-zinc-400 h-8">Type</TableHead>
                                  <TableHead className="font-mono text-[10px] text-zinc-400 h-8">Required</TableHead>
                                  <TableHead className="font-mono text-[10px] text-zinc-400 h-8">Default</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {selectedItem.data.model.fields.map((field: any, idx: number) => (
                                  <TableRow key={idx} className="border-b border-zinc-900 hover:bg-zinc-900/10">
                                    <TableCell className="font-mono font-semibold text-zinc-200 py-2">{field.name}</TableCell>
                                    <TableCell className="font-mono text-sky-300 py-2">{field.type}</TableCell>
                                    <TableCell className="py-2">
                                      {field.required ? (
                                        <Badge variant="outline" className="bg-rose-950/20 border-rose-900/30 text-rose-400 text-[9px] px-1 py-0 rounded">true</Badge>
                                      ) : (
                                        <span className="text-zinc-650">-</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="font-mono text-zinc-400 py-2">
                                      {field.default !== undefined ? String(field.default) : <span className="text-zinc-700 italic">-</span>}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <div className="text-xs text-zinc-550 italic">No fields defined for this collection.</div>
                        )}
                      </div>
                    )}

                    {/* Pages Details Block */}
                    {Array.isArray(selectedItem.data.pages) && selectedItem.data.pages.length > 0 && (
                      <div className="bg-zinc-900/20 border border-zinc-800/40 rounded-xl p-5 space-y-3 shadow-sm">
                        <div className="flex items-center gap-2 text-zinc-150">
                          <FileText className="h-4 w-4 text-purple-400" />
                          <span className="text-sm font-bold text-white">Pages & Layouts ({selectedItem.data.pages.length})</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {selectedItem.data.pages.map((page: any, idx: number) => (
                            <div key={idx} className="bg-zinc-900/40 border border-zinc-900 p-3 rounded-lg flex flex-col justify-between hover:border-zinc-850 hover:bg-zinc-900/60 transition-all">
                              <div>
                                <span className="text-xs font-bold text-zinc-100 block truncate">{page.title}</span>
                                <span className="font-mono text-[10px] text-zinc-500 select-all block truncate mt-0.5">/{page.slug}</span>
                              </div>
                              <div className="mt-2.5 flex items-center justify-between">
                                <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-mono text-zinc-400 bg-zinc-950 border-zinc-800/80 px-1.5 py-0">
                                  {page.type || 'page'}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Related Epics / Feature stories */}
                    {(() => {
                      const { prerequisites, dependents, peers } = getRelatedStories(selectedItem.data, mergedStories);
                      const sections = [
                        { title: 'Requires Build of', items: prerequisites },
                        { title: 'Prerequisite for', items: dependents },
                        { title: 'Same Epic Group', items: peers },
                      ].filter(s => s.items.length > 0);
                      if (!sections.length) return null;
                      return (
                        <div className="bg-zinc-900/10 border border-zinc-800/30 rounded-xl p-5 space-y-4 shadow-sm">
                          <div className="text-sm font-bold text-white flex items-center gap-2">
                            <Layers className="h-4 w-4 text-teal-400" />
                            <span>Planning Relationships</span>
                          </div>
                          <div className="space-y-3">
                            {sections.map(({ title, items }) => (
                              <div key={title} className="space-y-1.5">
                                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest font-mono block">{title}</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {items.map((s: any) => {
                                    const st = s.status || 'draft';
                                    const isDone = st === 'done' || st === 'completed';
                                    const slug = s.file.split('/').pop()?.replace(/\.ya?ml$/i, '') || '';
                                    return (
                                      <span
                                        key={s.file}
                                        onClick={() => handleOpenDrawer(s, 'story', undefined, s.epicParent)}
                                        className={cn(
                                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-mono cursor-pointer transition-all hover:scale-[1.02]',
                                          isDone
                                            ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-450'
                                            : 'bg-zinc-900 border-zinc-800 text-zinc-450'
                                        )}
                                      >
                                        {isDone ? (
                                          <CheckCircle2 className="h-2.5 w-2.5" />
                                        ) : (
                                          <span className={cn('h-1.5 w-1.5 rounded-full', storyStatusMap[st]?.dot || 'bg-zinc-600')} />
                                        )}
                                        {slug}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                  </div>
                )}

                {/* ─── STORY: YAML SOURCE TAB ─── */}
                {selectedItem.type === 'story' && storyTab === 'raw' && (
                  <div className="flex flex-col h-full min-h-[350px]">
                    
                    {/* Code Bar Header */}
                    <div className="shrink-0 flex items-center justify-between px-6 py-2.5 border-b border-border/20 bg-zinc-900/40">
                      <div className="flex items-center gap-2">
                        <FileCode2 className="h-3.5 w-3.5 text-zinc-500" />
                        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest font-bold">
                          {editMode ? 'Editing YAML' : selectedItem.data.file}
                        </span>
                      </div>
                      
                      {/* Copy & Edit controls */}
                      <div className="flex items-center gap-2.5">
                        {!editMode ? (
                          <>
                            {yamlContent && (
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(yamlContent);
                                  setCopiedYaml(true);
                                  setTimeout(() => setCopiedYaml(false), 1500);
                                }}
                                className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors cursor-pointer bg-zinc-900 border border-zinc-800 px-2 py-1 rounded"
                              >
                                <Copy className="h-3 w-3" />
                                <span>{copiedYaml ? 'Copied!' : 'Copy'}</span>
                              </button>
                            )}
                            <button
                              disabled={loadingYaml}
                              onClick={() => {
                                setEditMode(true);
                                setEditedYaml(yamlContent || '');
                              }}
                              className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 font-bold transition-colors cursor-pointer bg-primary/10 border border-primary/20 px-2.5 py-1 rounded"
                            >
                              <Pencil className="h-3 w-3" />
                              <span>Edit YAML</span>
                            </button>
                          </>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              disabled={savingYaml}
                              onClick={() => handleSaveYaml(selectedItem.data.file)}
                              className="h-7 px-2.5 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                            >
                              {savingYaml ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                              <span>Save</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditMode(false);
                                setEditedYaml(yamlContent || '');
                              }}
                              className="h-7 px-2 text-[10px] text-zinc-400 hover:text-white"
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Loader or Content */}
                    <div className="flex-1 bg-zinc-950 font-mono select-text flex flex-col min-h-[300px]">
                      {loadingYaml ? (
                        <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
                          <Loader2 className="h-6 w-6 text-primary animate-spin" />
                          <span className="text-xs text-zinc-550 italic">Retrieving file specifications...</span>
                        </div>
                      ) : editMode ? (
                        <textarea
                          value={editedYaml}
                          onChange={e => setEditedYaml(e.target.value)}
                          spellCheck={false}
                          className="w-full flex-1 bg-zinc-950 text-zinc-200 font-mono text-[11px] leading-6 p-6 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 border-0 outline-none h-full min-h-[300px] select-text"
                          placeholder="# Write YAML specifications here..."
                        />
                      ) : yamlContent ? (
                        <YamlViewer content={yamlContent} />
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center py-20 gap-2">
                          <AlertTriangle className="h-6 w-6 text-zinc-700" />
                          <p className="text-xs text-zinc-655 italic">Failed to load spec file content</p>
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* ─── STORY: SUB-TASKS TAB ─── */}
                {selectedItem.type === 'story' && storyTab === 'tasks' && (
                  <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white uppercase tracking-wider font-sans">
                        Checklist Sub-tasks
                      </span>
                      <span className="text-[10px] text-zinc-550 font-mono">
                        {(selectedItem.data.checklistTasks || []).filter((t: any) => t.status === 'done').length}/{(selectedItem.data.checklistTasks || []).length} completed
                      </span>
                    </div>

                    {selectedItem.data.checklistTasks && selectedItem.data.checklistTasks.length > 0 ? (
                      <div className="space-y-2.5">
                        {selectedItem.data.checklistTasks.map((task: any) => {
                          const isDone = task.status === 'done';
                          return (
                            <div
                              key={task.fullId}
                              className={cn(
                                'flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all group shadow-sm',
                                isDone
                                  ? 'border-zinc-900 bg-zinc-900/10'
                                  : 'border-zinc-800 bg-zinc-900/35 hover:border-zinc-700'
                              )}
                            >
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <button
                                  onClick={() => {
                                    const nextStatus = isDone ? 'ready-to-build' : 'done';
                                    handleUpdateTaskStatus(task.fullId, nextStatus);
                                    // Update locally immediately for responsiveness
                                    setSelectedItem(prev => {
                                      if (!prev || prev.type !== 'story') return prev;
                                      const updatedTasks = prev.data.checklistTasks.map((t: any) =>
                                        t.fullId === task.fullId ? { ...t, status: nextStatus } : t
                                      );
                                      return { ...prev, data: { ...prev.data, checklistTasks: updatedTasks } };
                                    });
                                  }}
                                  className={cn(
                                    'h-4.5 w-4.5 rounded border flex items-center justify-center transition-all shrink-0 mt-0.5 cursor-pointer',
                                    isDone
                                      ? 'bg-emerald-500 border-emerald-500 text-white'
                                      : 'border-zinc-700 hover:border-zinc-500 bg-zinc-950'
                                  )}
                                >
                                  {isDone && <Check className="h-3 w-3 stroke-[3]" />}
                                </button>
                                <span className={cn('text-xs leading-snug font-sans', isDone ? 'text-zinc-550 line-through' : 'text-zinc-200')}>
                                  <span className="font-mono text-[9px] text-zinc-550 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-850 mr-2">
                                    {task.id}
                                  </span>
                                  {task.title}
                                </span>
                              </div>
                              
                              <button
                                onClick={() => {
                                  handleDeleteTask(task.fullId);
                                  // Update locally immediately
                                  setSelectedItem(prev => {
                                    if (!prev || prev.type !== 'story') return prev;
                                    const filtered = prev.data.checklistTasks.filter((t: any) => t.fullId !== task.fullId);
                                    return { ...prev, data: { ...prev.data, checklistTasks: filtered } };
                                  });
                                }}
                                className="opacity-0 group-hover:opacity-100 hover:text-rose-500 text-zinc-650 p-1 rounded transition-all shrink-0 cursor-pointer"
                                title="Delete task"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 border border-dashed border-border/20 rounded-xl bg-zinc-900/5 text-center">
                        <ListTodo className="h-7 w-7 text-zinc-700 mb-2" />
                        <p className="text-xs text-zinc-555 font-sans italic">No checklist sub-tasks defined.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ─── STORY: TASK/SUB-TASK DETAIL VIEW ─── */}
                {selectedItem.type === 'task' && (
                  <div className="p-6 space-y-5">
                    
                    {/* Status card */}
                    <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">
                          Task Details
                        </span>
                        
                        {(() => {
                          const status = selectedItem.data.status || 'draft';
                          const dotColorMap: Record<string, string> = {
                            draft: 'bg-zinc-500',
                            'ready-to-build': 'bg-amber-500',
                            building: 'bg-blue-500 animate-pulse',
                            paused: 'bg-orange-500',
                            done: 'bg-emerald-500',
                            failed: 'bg-rose-500',
                          };
                          return (
                            <Badge variant="outline" className="px-2 py-0.5 text-[9px] uppercase tracking-wider rounded font-mono border-zinc-850">
                              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 mr-1.5", dotColorMap[status])} />
                              {status}
                            </Badge>
                          );
                        })()}
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex items-start justify-between py-1 border-b border-zinc-900">
                          <span className="text-zinc-500">Task Unique ID</span>
                          <span className="font-mono text-zinc-300 break-all select-all">{selectedItem.data.id}</span>
                        </div>
                        <div className="flex items-start justify-between py-1 border-b border-zinc-900">
                          <span className="text-zinc-500">Full Queue ID</span>
                          <span className="font-mono text-zinc-300 break-all select-all text-right max-w-[200px]">
                            {selectedItem.data.fullId}
                          </span>
                        </div>
                        {selectedItem.parentStory && (
                          <div className="flex items-start justify-between py-1">
                            <span className="text-zinc-500">Target Spec File</span>
                            <span className="font-mono text-cyan-400 text-right select-all max-w-[200px]">
                              {selectedItem.parentStory.file}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Task Actions */}
                    <div className="text-center py-6 text-zinc-555 border border-dashed border-zinc-900 rounded-xl bg-zinc-900/5">
                      <Info className="h-5 w-5 mx-auto text-zinc-700 mb-2" />
                      <p className="text-xs max-w-sm mx-auto font-sans leading-relaxed">
                        This task is part of the build pipeline checklist. Switch status above or trigger the full build pipeline via the main board controls to execute this task.
                      </p>
                    </div>

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
                <option value="ready-to-build">Ready</option>
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


    </div>
  );
}
