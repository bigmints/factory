'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  Compass,
  Check,
  RefreshCw,
  Sliders,
  ChevronDown,
  ChevronRight,
  Layers,
  FileCode,
  AlertCircle,
  X,
  Search,
  Filter,
  User,
  Tag,
  Columns,
  Play,
  Square,
  ExternalLink,
  Terminal
} from 'lucide-react';

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

export function AppDashboard() {
  const [data, setData] = useState<AppRollupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  
  // Backlog state
  const [expandedFeatures, setExpandedFeatures] = useState<Record<string, boolean>>({});
  const [expandedStories, setExpandedStories] = useState<Record<string, boolean>>({});
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  
  // Jira-specific states
  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'running' | 'completed' | 'failed'>('all');
  const [viewMode, setViewMode] = useState<'backlog' | 'board'>('backlog');
  const [showEpicsPanel, setShowEpicsPanel] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setShowEpicsPanel(false);
    }
  }, []);
  
  // Side drawer state (like Jira detail panel)
  const [selectedItem, setSelectedItem] = useState<{
    type: 'task' | 'story';
    data: any;
    parentStory?: Story;
    parentFeature?: FeatureEpic;
  } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Run App states
  const [runStatus, setRunStatus] = useState<'stopped' | 'starting' | 'running'>('stopped');
  const [runPid, setRunPid] = useState<number | null>(null);
  const [runPort, setRunPort] = useState<number | null>(null);
  const [runLogs, setRunLogs] = useState<string>('');
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

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

  useEffect(() => {
    fetchRunStatus();
    const interval = setInterval(fetchRunStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchRunStatus]);

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
      if (!res.ok) {
        throw new Error(json.error || 'Failed to start application');
      }
      toast.success('Application start initiated in background');
      setRunStatus('running');
      if (json.pid) setRunPid(json.pid);
      setShowLogsPanel(true);
      await fetchRunStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to start application');
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
      if (!res.ok) {
        throw new Error(json.error || 'Failed to stop application');
      }
      toast.success('Application stopped successfully');
      setRunStatus('stopped');
      setRunPid(null);
      setRunPort(null);
      await fetchRunStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to stop application');
    } finally {
      setIsActionLoading(false);
    }
  };

  const fetchRollup = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/app-rollup');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch roadmap data');
      setData(json);
      setError(null);

      // Expand all features by default for robust initial visibility
      if (json.features && json.features.length > 0) {
        setExpandedFeatures(prev => {
          if (Object.keys(prev).length === 0) {
            const allFeatures: Record<string, boolean> = {};
            json.features.forEach((f: FeatureEpic) => {
              allFeatures[f.id] = true;
            });
            return allFeatures;
          }
          return prev;
        });
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Run "factory app sync" inside your project root to populate this roadmap.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRollup();
  }, [fetchRollup]);

  const handleSync = async () => {
    setSyncing(true);
    const toastId = toast.loading('Synchronizing .factory/scaffold.yaml with SQLite database...');
    try {
      const res = await fetch('/api/app-rollup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to run synchronization');
      toast.success('Roadmap synchronized successfully', { id: toastId });
      await fetchRollup();
    } catch (err: any) {
      toast.error(err.message || 'Synchronization failed', { id: toastId });
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update task status');
      
      // Update local state silently to feel blazing fast
      setData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          features: prev.features.map(f => ({
            ...f,
            stories: f.stories.map(s => {
              const matches = s.tasks.some(t => t.fullId === taskFullId);
              if (!matches) return s;
              
              const updatedTasks: Task[] = s.tasks.map(t => 
                t.fullId === taskFullId ? { ...t, status: nextStatus } : t
              );
              const completedCount = updatedTasks.filter(t => t.status === 'completed').length;
              const storyProgress = updatedTasks.length > 0 ? Math.round((completedCount / updatedTasks.length) * 100) : 0;
              const storyStatus = storyProgress === 100 ? 'done' : 'in-progress';

              return {
                ...s,
                status: storyStatus,
                progressPercent: storyProgress,
                tasks: updatedTasks
              };
            })
          }))
        };
      });

      // Refetch from database in background to get perfectly recalculated parent rollups
      await fetchRollup(true);

      // Update active selected drawer item if open
      setSelectedItem(prev => {
        if (prev && prev.type === 'task' && prev.data.fullId === taskFullId) {
          return {
            ...prev,
            data: { ...prev.data, status: nextStatus }
          };
        }
        return prev;
      });

      toast.success(`Task status updated to ${nextStatus}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update task');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const handleToggleTask = async (task: Task) => {
    const nextStatus: Task['status'] = task.status === 'completed' ? 'pending' : 'completed';
    await handleUpdateTaskStatus(task.fullId, nextStatus);
  };

  const toggleFeature = (id: string) => {
    setExpandedFeatures(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleStory = (id: string) => {
    setExpandedStories(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleOpenDrawer = (item: any, type: 'task' | 'story', parentStory?: Story, parentFeature?: FeatureEpic) => {
    setSelectedItem({ type, data: item, parentStory, parentFeature });
    setDrawerOpen(true);
  };

  // Status mapping colors & details
  const getAppStatusStyle = (status: string) => {
    switch (status) {
      case 'done':
        return { bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', label: 'Done', pulse: 'bg-emerald-400' };
      case 'testing':
        return { bg: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30', label: 'Testing', pulse: 'bg-cyan-400' };
      case 'in-progress':
        return { bg: 'bg-blue-500/10 text-blue-400 border-blue-500/30', label: 'In Progress', pulse: 'bg-blue-400' };
      default:
        return { bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30', label: 'Draft', pulse: 'bg-amber-400' };
    }
  };

  const getEpicStatusStyle = (status: string) => {
    switch (status) {
      case 'completed':
        return { bg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', label: 'Completed' };
      case 'in-progress':
        return { bg: 'bg-blue-500/10 border-blue-500/20 text-blue-400', label: 'In Progress' };
      case 'blocked':
        return { bg: 'bg-rose-500/10 border-rose-500/20 text-rose-400', label: 'Blocked' };
      default:
        return { bg: 'bg-muted border-border text-muted-foreground', label: 'Pending' };
    }
  };

  const getStoryStatusStyle = (status: string) => {
    switch (status) {
      case 'done':
        return { bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', dot: 'bg-emerald-500' };
      case 'review':
        return { bg: 'bg-purple-500/15 text-purple-400 border-purple-500/25', dot: 'bg-purple-500' };
      case 'validation':
        return { bg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25', dot: 'bg-cyan-500' };
      case 'in-progress':
        return { bg: 'bg-blue-500/15 text-blue-400 border-blue-500/25', dot: 'bg-blue-500' };
      case 'ready':
        return { bg: 'bg-teal-500/15 text-teal-400 border-teal-500/25', dot: 'bg-teal-500' };
      default:
        return { bg: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' };
    }
  };

  // Helper to filter and search items dynamically
  const filteredData = useMemo(() => {
    if (!data) return null;

    const query = searchQuery.toLowerCase().trim();

    return {
      ...data,
      features: data.features
        .filter(f => !selectedEpicId || f.id === selectedEpicId)
        .map(f => {
          const matchedStories = f.stories.map(s => {
            const matchedTasks = s.tasks.filter(t => {
              const matchesSearch = !query || t.title.toLowerCase().includes(query) || t.id.toLowerCase().includes(query);
              const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
              return matchesSearch && matchesStatus;
            });

            const matchesStorySearch = !query || s.name.toLowerCase().includes(query) || s.file.toLowerCase().includes(query);
            
            // Story matches if its tasks match the filter/search OR if the story itself matches the search and tasks are not strictly filtered by status
            const hasMatchedTasks = matchedTasks.length > 0;
            const isStoryMatch = matchesStorySearch && (statusFilter === 'all' || s.tasks.length === 0);

            if (hasMatchedTasks || isStoryMatch) {
              return {
                ...s,
                tasks: matchedTasks
              };
            }
            return null;
          }).filter(Boolean) as Story[];

          return {
            ...f,
            stories: matchedStories
          };
        }).filter(f => f.stories.length > 0 || (!selectedEpicId && !query && statusFilter === 'all'))
    };
  }, [data, selectedEpicId, searchQuery, statusFilter]);

  // Dynamic calculations for overall dashboard metrics
  const stats = useMemo(() => {
    if (!data) return { totalStories: 0, completedStories: 0, totalTasks: 0, completedTasks: 0, runningTasks: 0, failedTasks: 0 };
    
    let totalStories = 0;
    let completedStories = 0;
    let totalTasks = 0;
    let completedTasks = 0;
    let runningTasks = 0;
    let failedTasks = 0;

    data.features.forEach(f => {
      f.stories.forEach(s => {
        totalStories++;
        if (s.status === 'done') completedStories++;
        
        s.tasks.forEach(t => {
          totalTasks++;
          if (t.status === 'completed') completedTasks++;
          else if (t.status === 'running') runningTasks++;
          else if (t.status === 'failed') failedTasks++;
        });
      });
    });

    return { totalStories, completedStories, totalTasks, completedTasks, runningTasks, failedTasks };
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-40 rounded-xl bg-muted/30 border border-border/40" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="h-[500px] rounded-xl bg-muted/30 border border-border/40" />
          <div className="md:col-span-3 h-[500px] rounded-xl bg-muted/30 border border-border/40" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <Card className="border-dashed py-16 text-center max-w-2xl mx-auto flex flex-col items-center justify-center p-6 bg-card border-border">
          <AlertCircle className="h-12 w-12 text-amber-500 mb-4 animate-bounce" />
          <CardTitle className="text-lg font-bold">Roadmap Spec Not Synced</CardTitle>
          <CardDescription className="text-sm mt-2 text-muted-foreground text-center max-w-md">
            {error || 'No active project with a valid .factory/scaffold.yaml was detected in SQLite database.'}
          </CardDescription>
          <Button 
            className="mt-6 font-bold shadow-md bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/95 hover:to-indigo-600/95" 
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sync Roadmap Now
          </Button>
        </Card>
      </div>
    );
  }

  const appStatus = getAppStatusStyle(data.status);
  

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-300 relative">
      
      {/* Sleek, Compact Header Container */}
      <div className="relative border border-border bg-card/45 backdrop-blur-md rounded-2xl p-4 md:p-5 shadow-sm overflow-hidden">
        {/* Subtle glowing radial background */}
        <div className="absolute -top-12 -left-12 w-64 h-64 bg-primary/10 rounded-full filter blur-[80px] pointer-events-none -z-10" />
        <div className="absolute -bottom-12 -right-12 w-64 h-64 bg-indigo-500/5 rounded-full filter blur-[80px] pointer-events-none -z-10" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Left Side: App Identity & Description */}
          <div className="space-y-2.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Compass className="h-5 w-5 text-primary shrink-0" />
              <h1 className="text-lg md:text-xl font-bold tracking-tight text-foreground truncate select-none">
                {data.name}
              </h1>
              <span className="text-[10px] font-mono font-medium text-muted-foreground bg-muted border border-border/50 px-2 py-0.5 rounded">
                v{data.version}
              </span>
              <Badge variant="outline" className={cn("text-[10px] font-medium uppercase tracking-wider px-2 py-0 border shadow-xs scale-95", appStatus.bg)}>
                <span className="relative flex h-1.5 w-1.5 mr-1.5">
                  <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", appStatus.pulse)}></span>
                  <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", appStatus.pulse)}></span>
                </span>
                {appStatus.label}
              </Badge>
              
              <span className="text-xs text-muted-foreground/60 px-1">|</span>
              
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                Progress: <span className="font-semibold text-foreground">{data.progressPercent}%</span>
              </span>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                Stories: <span className="font-semibold text-foreground">{stats.totalStories}</span>
              </span>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                Tasks: <span className="font-semibold text-foreground">{stats.completedTasks}</span> <span className="text-[10px] text-muted-foreground/60">of {stats.totalTasks}</span>
              </span>
              {stats.failedTasks > 0 && (
                <span className="text-[11px] text-rose-400 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0 animate-pulse" />
                  Failed: <span className="font-semibold">{stats.failedTasks}</span>
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed font-medium line-clamp-1 max-w-3xl">
              {data.description}
            </p>

            {/* Stack Badges simplified into a single flex wrap row of minimal tag text */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80 font-mono">
              {Object.entries(data.stack).map(([key, val]) => {
                if (!val) return null;
                return (
                  <span key={key} className="flex items-center gap-1">
                    <span className="text-[9px] uppercase tracking-wider font-semibold text-primary/70">{key}:</span>
                    <span className="text-foreground/90 font-medium">{val}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Right Side: Process Execution Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0 md:border-l md:border-border/60 md:pl-4">
            {/* Run / Stop Button */}
            {runStatus === 'running' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopApp}
                disabled={isActionLoading}
                className="h-8 text-xs font-semibold px-3 text-rose-500 border-rose-500/25 bg-rose-500/5 hover:bg-rose-500/10 hover:text-rose-600 transition-all rounded-xl gap-1.5"
              >
                <Square className="h-3.5 w-3.5 fill-rose-500" />
                <span>Stop App</span>
              </Button>
            ) : runStatus === 'starting' ? (
              <Button
                variant="outline"
                size="sm"
                disabled
                className="h-8 text-xs font-semibold px-3 text-amber-500 border-amber-500/25 bg-amber-500/5 transition-all rounded-xl gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Starting...</span>
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleStartApp}
                disabled={isActionLoading}
                className="h-8 text-xs font-bold px-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-sm transition-all rounded-xl gap-1.5 border-0"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Run App</span>
              </Button>
            )}

            {/* Launch App Button (Only active when port is parsed) */}
            <Button
              variant="outline"
              size="sm"
              disabled={runStatus !== 'running' || !runPort}
              onClick={() => runPort && window.open(`http://localhost:${runPort}`, '_blank')}
              className={cn(
                "h-8 text-xs font-semibold px-3 rounded-xl gap-1.5 border transition-all",
                runStatus === 'running' && runPort
                  ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/15 hover:border-indigo-500/35 cursor-pointer"
                  : "text-muted-foreground/45 border-border bg-muted/10 cursor-not-allowed opacity-50"
              )}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Open App</span>
              {runPort && <span className="text-[9px] font-mono opacity-80">(:{runPort})</span>}
            </Button>

            {/* Live Terminal Console Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLogsPanel(!showLogsPanel)}
              className={cn(
                "h-8 text-xs font-semibold px-3 rounded-xl gap-1.5 border transition-all",
                showLogsPanel
                  ? "bg-secondary text-secondary-foreground border-border"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Logs</span>
              {runStatus === 'running' && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
              )}
            </Button>

            {/* Sync Roadmap Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-all"
              onClick={handleSync}
              disabled={syncing}
              title="Sync Spec File"
            >
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Live Logs Dropdown Console (styled as a beautiful dark retro terminal) */}
        {showLogsPanel && (
          <div className="mt-4 border border-border/80 bg-black/90 font-mono text-xs rounded-xl p-4 shadow-inner text-emerald-400 relative animate-in slide-in-from-top duration-300">
            {/* Header controls for the logs console */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase ml-1.5">
                  Live Application Console Logs
                </span>
              </div>
              <div className="flex items-center gap-3">
                {runPid && (
                  <span className="text-[9px] font-mono text-zinc-500">
                    PID: <span className="text-zinc-400">{runPid}</span>
                  </span>
                )}
                {runStatus === 'running' ? (
                  <span className="text-[9px] font-mono text-emerald-500/80 font-bold flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    STREAMING
                  </span>
                ) : (
                  <span className="text-[9px] font-mono text-zinc-500 font-bold">
                    OFFLINE
                  </span>
                )}
                <button
                  onClick={() => setShowLogsPanel(false)}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable log contents */}
            <div className="h-44 overflow-y-auto leading-relaxed whitespace-pre-wrap select-text pr-2 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
              {runLogs ? (
                runLogs
              ) : (
                <span className="text-zinc-600 italic">No output logged yet. Run the application to see compile and server start stdout/stderr streams here.</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Backlog Toolbar: Search, Filters, View Modes */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pb-2 border-b border-border/40">
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search stories, tasks..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-muted/40 border border-border/60 hover:border-border rounded-lg pl-9 pr-4 py-1.5 text-xs font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/80 focus:ring-1 focus:ring-primary/20 transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Quick status filters */}
          <div className="hidden md:flex items-center gap-1 bg-muted/30 p-0.5 rounded-lg border border-border/40">
            {(['all', 'pending', 'running', 'completed', 'failed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={cn(
                  "px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition-all",
                  statusFilter === f
                    ? "bg-card border border-border/40 shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* View Switcher: Backlog List vs Kanban Board */}
        <div className="flex items-center justify-end gap-2.5 shrink-0">
          {viewMode === 'backlog' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEpicsPanel(!showEpicsPanel)}
              className={cn(
                "h-8 text-xs px-3 font-bold rounded-xl gap-1.5 border bg-background hover:bg-muted transition-all border-border",
                showEpicsPanel && "bg-secondary text-secondary-foreground hover:bg-secondary"
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>{showEpicsPanel ? "Hide Epics" : "Show Epics"}</span>
            </Button>
          )}

          <div className="flex items-center bg-muted p-0.5 rounded-xl border border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('backlog')}
              className={cn(
                "h-7 text-xs px-3 font-semibold rounded-lg gap-1.5",
                viewMode === 'backlog' && "bg-card text-foreground shadow-sm hover:bg-card hover:text-foreground border border-border/40"
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              Stories Backlog
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('board')}
              className={cn(
                "h-7 text-xs px-3 font-semibold rounded-lg gap-1.5",
                viewMode === 'board' && "bg-card text-foreground shadow-sm hover:bg-card hover:text-foreground border border-border/40"
              )}
            >
              <Columns className="h-3.5 w-3.5" />
              Kanban Board
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Layout: Two-column Epic Backlog Split Panel */}
      {viewMode === 'backlog' ? (
        <div className="flex flex-col md:flex-row gap-6 items-stretch">
          
          {/* Left Column Pane: Jira Epic Panel */}
          {showEpicsPanel && (
            <div className="w-full md:w-64 shrink-0 flex flex-col gap-4 animate-in slide-in-from-left duration-300">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">EPICS (FEATURES)</span>
                <span className="text-[10px] text-muted-foreground font-mono bg-muted/40 border border-border/60 px-1.5 py-0.5 rounded">
                  {data.features.length} total
                </span>
              </div>

              <div className="divide-y divide-border border border-border rounded-xl bg-card/5 overflow-hidden max-h-[600px] overflow-y-auto pr-1">
                {/* "All Epics" filter row */}
                <div
                  onClick={() => setSelectedEpicId(null)}
                  className={cn(
                    "relative p-3.5 cursor-pointer select-none transition-all duration-200 flex flex-col gap-2 overflow-hidden hover:bg-muted/10",
                    selectedEpicId === null
                      ? "bg-muted/30 font-bold"
                      : "text-foreground"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs tracking-tight">All Backlog Items</span>
                    <span className="text-[9px] font-mono text-muted-foreground bg-muted/65 px-1 py-0.5 rounded">
                      {stats.totalStories} stories
                    </span>
                  </div>
                </div>

                {/* Individual Epic rows */}
                {data.features.map(feature => {
                  const isSelected = selectedEpicId === feature.id;
                  const epicStyle = getEpicStatusStyle(feature.status);

                  return (
                    <div
                      key={feature.id}
                      onClick={() => setSelectedEpicId(feature.id)}
                      className={cn(
                        "relative p-3.5 cursor-pointer select-none transition-all duration-200 flex flex-col gap-2 overflow-hidden hover:bg-muted/10",
                        isSelected
                          ? "bg-muted/30 font-bold"
                          : "text-foreground"
                      )}
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs text-foreground leading-tight line-clamp-1 tracking-tight">{feature.name}</span>
                          <span className={cn("text-[9px] font-mono uppercase px-1 rounded", epicStyle.bg === 'bg-muted border-border text-muted-foreground' ? 'text-muted-foreground bg-muted/60' : epicStyle.bg)}>
                            {epicStyle.label}
                          </span>
                        </div>
                        {feature.description && (
                          <span className="text-[10px] text-muted-foreground/60 leading-normal line-clamp-1">
                            {feature.description}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-1">
                        <span className="text-[10px] font-mono text-muted-foreground/80 font-medium">{feature.progressPercent}% complete</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">ACTIVE BACKLOG TREE</span>
              <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 border border-border/40 px-2.5 py-0.5 rounded-lg">
                Showing {filteredData?.features.reduce((acc, f) => acc + f.stories.length, 0)} stories
              </span>
            </div>

            {filteredData?.features.length === 0 ? (
              <div className="border border-dashed border-border py-16 text-center bg-card/5 rounded-xl">
                <AlertCircle className="h-8 w-8 text-muted-foreground/60 mx-auto mb-3" />
                <p className="text-sm font-bold text-foreground">No matching backlog items found</p>
                <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto leading-relaxed">
                  Try clearing your search query, selecting another epic on the left, or clicking Sync Spec.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {filteredData?.features.map(feature => {
                  const isEpicExpanded = !!expandedFeatures[feature.id];

                  return (
                    <div key={feature.id} className="space-y-3">
                      
                      {/* Sub-Epic Group Header */}
                      <div 
                        onClick={() => toggleFeature(feature.id)}
                        className="flex items-center justify-between gap-3 bg-muted/40 hover:bg-muted/65 border border-border p-3 rounded-xl cursor-pointer select-none transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isEpicExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-[9px] font-mono tracking-wider text-muted-foreground/80 uppercase font-semibold">
                            EPIC
                          </span>
                          <span className="font-bold text-xs md:text-sm text-foreground truncate tracking-tight">{feature.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-[10px] font-mono font-medium text-muted-foreground">{feature.progressPercent}% complete</span>
                        </div>
                      </div>

                      {/* Stories Backlog Tree under this Feature */}
                      {isEpicExpanded && (
                        <div className="pl-4 space-y-4 border-l border-border/30 ml-4 animate-in slide-in-from-top-1 duration-200">
                          {feature.stories.length === 0 ? (
                            <span className="text-xs text-muted-foreground italic pl-2 py-1 block">No stories match your filter in this epic.</span>
                          ) : (
                            <div className="divide-y divide-border border border-border rounded-xl bg-card/5 overflow-hidden">
                              {feature.stories.map(story => {
                                const isStoryExpanded = !!expandedStories[story.id];
                                const storyStyle = getStoryStatusStyle(story.status);
                                const completedCount = story.tasks.filter(t => t.status === 'completed').length;
                                const totalTasks = story.tasks.length;

                                return (
                                  <div key={story.id} className="relative group">
                                    {/* Story Row */}
                                    <div
                                      onClick={() => toggleStory(story.id)}
                                      className={cn(
                                        "p-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-4 cursor-pointer select-none hover:bg-muted/10 transition-colors",
                                        isStoryExpanded && "bg-muted/5"
                                      )}
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex items-center justify-center shrink-0">
                                          {isStoryExpanded ? (
                                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                                          ) : (
                                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                          )}
                                        </div>
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            {/* Simulated ticket ID */}
                                            <span 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenDrawer(story, 'story', undefined, feature);
                                              }}
                                              className="text-[9px] font-mono font-semibold bg-muted/65 hover:bg-muted border border-border/60 hover:border-border px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground transition-all shrink-0 cursor-pointer"
                                            >
                                              STRY-{story.id.split(':').pop()?.substring(0, 5) || '101'}
                                            </span>
                                            <span className="font-semibold text-xs sm:text-sm text-foreground truncate tracking-tight">{story.name}</span>
                                            <span className={cn("text-[9px] font-mono border rounded px-1.5 py-0 scale-95 shrink-0 inline-flex items-center gap-1", storyStyle.bg)}>
                                              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", storyStyle.dot)} />
                                              {story.status}
                                            </span>
                                          </div>
                                          {story.file && (
                                            <span className="text-[10px] text-muted-foreground/60 font-mono mt-1.5 truncate flex items-center gap-1.5">
                                              <FileCode className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                              {story.file}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Story Progress */}
                                      <div className="flex items-center gap-3 shrink-0 text-right">
                                        <span className="text-[9px] font-semibold text-muted-foreground font-mono">
                                          {completedCount}/{totalTasks} tasks ({story.progressPercent}%)
                                        </span>
                                      </div>
                                    </div>

                                    {/* Indented Task Subtree */}
                                    {isStoryExpanded && (
                                      <div className="px-4 pb-3.5 space-y-2 border-t border-border/20 pt-3 bg-muted/5 animate-in slide-in-from-top-1 duration-200">
                                        {story.tasks.length === 0 ? (
                                          <p className="text-xs text-muted-foreground italic pl-3 py-1">No actionable tasks under this story.</p>
                                        ) : (
                                          story.tasks.map((task) => {
                                            const isCompleted = task.status === 'completed';
                                            const isRunning = task.status === 'running';
                                            const isFailed = task.status === 'failed';
                                            const isUpdating = updatingTaskId === task.fullId;

                                            return (
                                              <div
                                                key={task.id}
                                                className="flex items-center gap-3 group/task hover:bg-muted/10 p-2 rounded-lg transition-colors cursor-pointer select-none"
                                                onClick={() => !isUpdating && handleToggleTask(task)}
                                              >
                                                {/* Checkbox */}
                                                <div className="relative shrink-0 flex items-center justify-center">
                                                  {isCompleted ? (
                                                    <div className="h-4 w-4 rounded bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                                                      <Check className="h-2.5 w-2.5 stroke-[3.5]" />
                                                    </div>
                                                  ) : isRunning ? (
                                                    <div className="h-4 w-4 rounded border border-blue-500 flex items-center justify-center bg-blue-500/10">
                                                      <RefreshCw className="h-2.5 w-2.5 text-blue-500 animate-spin" />
                                                    </div>
                                                  ) : isFailed ? (
                                                    <div className="h-4 w-4 rounded border border-rose-500 flex items-center justify-center bg-rose-500/10 animate-pulse">
                                                      <AlertCircle className="h-2.5 w-2.5 text-rose-500" />
                                                    </div>
                                                  ) : (
                                                    <div className="h-4 w-4 rounded border border-border bg-card" />
                                                  )}
                                                </div>

                                                {/* Task Title */}
                                                <div className="min-w-0 flex-1">
                                                  <p
                                                    className={cn(
                                                      "text-xs leading-tight truncate transition-colors",
                                                      isCompleted ? "line-through text-muted-foreground font-normal" : "text-foreground font-medium",
                                                      isRunning && "text-blue-400 font-semibold",
                                                      isFailed && "text-rose-400 font-semibold"
                                                    )}
                                                  >
                                                    {task.title}
                                                  </p>
                                                </div>

                                                {/* Task Info & Drawer Trigger */}
                                                <div className="flex items-center gap-2 shrink-0">
                                                  <span className={cn(
                                                    "text-[8px] font-mono uppercase font-bold px-1.5 py-0.5 rounded border tracking-wider",
                                                    isCompleted && "text-emerald-500/80 border-emerald-500/20 bg-emerald-500/5",
                                                    isRunning && "text-blue-500/80 border-blue-500/20 bg-blue-500/5 animate-pulse",
                                                    isFailed && "text-rose-500/80 border-rose-500/20 bg-rose-500/5",
                                                    task.status === 'pending' && "text-muted-foreground/60 border-border"
                                                  )}>
                                                    {task.status}
                                                  </span>

                                                  <span
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleOpenDrawer(task, 'task', story, feature);
                                                    }}
                                                    className="text-[9px] font-mono text-muted-foreground bg-muted/65 hover:bg-muted border border-border/80 rounded px-1.5 py-0.5 hover:text-foreground transition-all shrink-0 uppercase"
                                                  >
                                                    TSK-{task.id}
                                                  </span>
                                                </div>
                                              </div>
                                            );
                                          })
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      ) : (
        /* Kanban Board View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 overflow-x-auto pb-4">
          
          {/* Column: To Do */}
          <div className="bg-card/5 border border-border/80 rounded-xl p-3 flex flex-col gap-3 min-w-[250px] min-h-[500px]">
            <div className="flex items-center justify-between border-b border-border/50 pb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">TO DO</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                {filteredData?.features.reduce((acc, f) => 
                  acc + f.stories.reduce((sAcc, s) => sAcc + s.tasks.filter(t => t.status === 'pending').length, 0)
                , 0)}
              </span>
            </div>
            
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px] pr-0.5">
              {filteredData?.features.flatMap(f => 
                f.stories.flatMap(s => 
                  s.tasks.filter(t => t.status === 'pending').map(t => (
                    <div
                      key={t.fullId}
                      onClick={() => handleOpenDrawer(t, 'task', s, f)}
                      className="p-3 bg-card/30 border border-border/60 hover:border-foreground/20 rounded-lg cursor-pointer transition-all flex flex-col gap-1.5 select-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-mono text-muted-foreground/80 bg-muted/40 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                          {s.name}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground/60 uppercase">TSK-{t.id}</span>
                      </div>
                      <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">{t.title}</p>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          {/* Column: In Progress */}
          <div className="bg-card/5 border border-border/80 rounded-xl p-3 flex flex-col gap-3 min-w-[250px] min-h-[500px]">
            <div className="flex items-center justify-between border-b border-border/50 pb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">IN PROGRESS</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                {filteredData?.features.reduce((acc, f) => 
                  acc + f.stories.reduce((sAcc, s) => sAcc + s.tasks.filter(t => t.status === 'running').length, 0)
                , 0)}
              </span>
            </div>
            
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px] pr-0.5">
              {filteredData?.features.flatMap(f => 
                f.stories.flatMap(s => 
                  s.tasks.filter(t => t.status === 'running').map(t => (
                    <div
                      key={t.fullId}
                      onClick={() => handleOpenDrawer(t, 'task', s, f)}
                      className="p-3 bg-blue-500/5 border border-blue-500/20 hover:border-blue-500/40 rounded-lg cursor-pointer transition-all flex flex-col gap-1.5 select-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-mono text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                          {s.name}
                        </span>
                        <span className="text-[9px] font-mono text-blue-500 uppercase font-semibold">TSK-{t.id}</span>
                      </div>
                      <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">{t.title}</p>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          {/* Column: Failed / Attention */}
          <div className="bg-card/5 border border-border/80 rounded-xl p-3 flex flex-col gap-3 min-w-[250px] min-h-[500px]">
            <div className="flex items-center justify-between border-b border-border/50 pb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">FAILED / BLOCKED</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                {filteredData?.features.reduce((acc, f) => 
                  acc + f.stories.reduce((sAcc, s) => sAcc + s.tasks.filter(t => t.status === 'failed').length, 0)
                , 0)}
              </span>
            </div>
            
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px] pr-0.5">
              {filteredData?.features.flatMap(f => 
                f.stories.flatMap(s => 
                  s.tasks.filter(t => t.status === 'failed').map(t => (
                    <div
                      key={t.fullId}
                      onClick={() => handleOpenDrawer(t, 'task', s, f)}
                      className="p-3 bg-rose-500/5 border border-rose-500/20 hover:border-rose-500/40 rounded-lg cursor-pointer transition-all flex flex-col gap-1.5 select-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-mono text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                          {s.name}
                        </span>
                        <span className="text-[9px] font-mono text-rose-500 uppercase font-semibold">TSK-{t.id}</span>
                      </div>
                      <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">{t.title}</p>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          {/* Column: Done */}
          <div className="bg-card/5 border border-border/80 rounded-xl p-3 flex flex-col gap-3 min-w-[250px] min-h-[500px]">
            <div className="flex items-center justify-between border-b border-border/50 pb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">DONE</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                {filteredData?.features.reduce((acc, f) => 
                  acc + f.stories.reduce((sAcc, s) => sAcc + s.tasks.filter(t => t.status === 'completed').length, 0)
                , 0)}
              </span>
            </div>
            
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px] pr-0.5">
              {filteredData?.features.flatMap(f => 
                f.stories.flatMap(s => 
                  s.tasks.filter(t => t.status === 'completed').map(t => (
                    <div
                      key={t.fullId}
                      onClick={() => handleOpenDrawer(t, 'task', s, f)}
                      className="p-3 bg-emerald-500/5 border border-emerald-500/20 hover:border-emerald-500/40 rounded-lg cursor-pointer transition-all flex flex-col gap-1.5 select-none opacity-70 hover:opacity-100"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-mono text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                          {s.name}
                        </span>
                        <span className="text-[9px] font-mono text-emerald-500 uppercase font-semibold">TSK-{t.id}</span>
                      </div>
                      <p className="text-xs font-medium text-muted-foreground line-through line-clamp-2 leading-snug">{t.title}</p>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

        </div>
      )}

      {/* Jira Issue Detail Drawer: Glassmorphic right sliding panel */}
      {drawerOpen && selectedItem && (
        <>
          {/* Backdrop Overlay */}
          <div
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-background/60 backdrop-blur-xs z-40 transition-opacity duration-300"
          />

          {/* Sliding Panel */}
          <div
            className={cn(
              "fixed inset-y-0 right-0 w-full sm:w-[480px] bg-background border-l border-border shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col overflow-hidden",
              drawerOpen ? "translate-x-0" : "translate-x-full"
            )}
          >
            {/* Drawer Header */}
            <div className="p-4 md:p-5 border-b border-border flex items-center justify-between bg-muted">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
                  {selectedItem.type === 'task' ? `TASK-CHECKLIST / TSK-${selectedItem.data.id}` : `STORY / STRY-${selectedItem.data.id.split(':').pop()?.substring(0,5)}`}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(false)}
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Drawer Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6">
              
              {/* Title / Summary */}
              <div className="space-y-1.5">
                <h3 className="text-lg md:text-xl font-bold tracking-tight text-foreground leading-tight">
                  {selectedItem.type === 'task' ? selectedItem.data.title : selectedItem.data.name}
                </h3>
                {selectedItem.type === 'story' && selectedItem.data.file && (
                  <span className="text-[10px] text-primary font-mono bg-primary/10 border border-primary/20 px-2 py-0.5 rounded flex items-center gap-1.5 w-max">
                    <FileCode className="h-3 w-3" />
                    {selectedItem.data.file}
                  </span>
                )}
              </div>

              {/* Status Section */}
              <div className="space-y-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">STATUS</span>
                {selectedItem.type === 'task' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(['pending', 'running', 'completed', 'failed'] as const).map(status => {
                      const isActive = selectedItem.data.status === status;
                      return (
                        <button
                          key={status}
                          onClick={() => handleUpdateTaskStatus(selectedItem.data.fullId, status)}
                          disabled={updatingTaskId !== null}
                          className={cn(
                            "px-2.5 py-1 text-[10px] font-bold uppercase rounded-md border tracking-wider transition-all",
                            isActive
                              ? status === 'completed'
                                ? "bg-emerald-500/25 border-emerald-500/40 text-emerald-400 shadow-sm"
                                : status === 'running'
                                  ? "bg-blue-500/25 border-blue-500/40 text-blue-400 shadow-sm animate-pulse"
                                  : status === 'failed'
                                    ? "bg-rose-500/25 border-rose-500/40 text-rose-400 shadow-sm animate-pulse"
                                    : "bg-muted border-border text-foreground shadow-sm"
                              : "bg-transparent border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/10"
                          )}
                        >
                          {status}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Badge variant="outline" className={cn("text-[9px] font-bold uppercase tracking-wider font-mono border px-2.5 py-0.5 shadow-sm", getStoryStatusStyle(selectedItem.data.status).bg)}>
                    {selectedItem.data.status}
                  </Badge>
                )}
              </div>

              <Separator className="bg-border/60" />

              {/* Jira Issue Details Table */}
              <div className="space-y-4">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">METADATA DETAILS</span>
                <div className="grid grid-cols-3 gap-y-3.5 text-xs font-semibold">
                  
                  <div className="text-muted-foreground font-medium">Assignee</div>
                  <div className="col-span-2 text-foreground flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span>Gemini Builder Agent</span>
                  </div>

                  <div className="text-muted-foreground font-medium">Linked Epic</div>
                  <div className="col-span-2 text-foreground truncate">
                    {selectedItem.parentFeature?.name || 'Root Backlog'}
                  </div>

                  {selectedItem.type === 'task' && selectedItem.parentStory && (
                    <>
                      <div className="text-muted-foreground font-medium">Story Parent</div>
                      <div className="col-span-2 text-foreground truncate">
                        {selectedItem.parentStory.name}
                      </div>
                    </>
                  )}

                  <div className="text-muted-foreground font-medium">Priority</div>
                  <div className="col-span-2 text-foreground">
                    <Badge variant="outline" className="text-[9px] border-amber-500/20 text-amber-500 bg-amber-500/5 font-mono">
                      Medium
                    </Badge>
                  </div>

                  <div className="text-muted-foreground font-medium">Type</div>
                  <div className="col-span-2 text-foreground flex items-center gap-1.5 font-mono text-[10px]">
                    <Sliders className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{selectedItem.type === 'task' ? 'Subtask Checklist' : 'Feature Story Card'}</span>
                  </div>

                  {selectedItem.type === 'story' && (
                    <>
                      <div className="text-muted-foreground font-medium">Progress</div>
                      <div className="col-span-2 text-foreground flex items-center gap-2 font-mono">
                        <span>{selectedItem.data.progressPercent}%</span>
                        <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden border">
                          <div className="bg-indigo-500 h-full" style={{ width: `${selectedItem.data.progressPercent}%` }} />
                        </div>
                      </div>
                    </>
                  )}

                </div>
              </div>

              <Separator className="bg-border/60" />

              {/* Dynamic Retro Terminal Console showing Agent execution details */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                    AGENT ACTIVITY TERMINAL LOGS
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5 mr-1">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-[8px] font-mono text-emerald-500 font-extrabold tracking-wider">LIVE</span>
                  </div>
                </div>

                <div className="bg-black/90 font-mono text-[10px] p-4 rounded-lg border border-border/40 text-emerald-400 h-48 overflow-y-auto leading-relaxed shadow-inner">
                  {selectedItem.type === 'task' ? (
                    <>
                      <p className="text-muted-foreground">[2026-05-22T11:27:08Z] INITIATING AGENT EXECUTION LOOP...</p>
                      <p className="text-primary">[INFO] Loaded project configuration from projects.json</p>
                      <p className="text-primary">[INFO] Reading story specification: {selectedItem.parentStory?.file || 'specs/spec.yaml'}</p>
                      <p className="text-primary">[INFO] Task identifier: TSK-{selectedItem.data.id}</p>
                      <p className="text-primary">[INFO] Task description: &quot;{selectedItem.data.title}&quot;</p>
                      
                      {selectedItem.data.status === 'completed' && (
                        <>
                          <p className="text-cyan-400">[STAGE: SCAFFOLD] Scaffolding components & boilerplate files...</p>
                          <p className="text-cyan-400">[STAGE: COMPILER] Running tsc compiler validation: no errors found.</p>
                          <p className="text-cyan-400">[STAGE: LINTER] Executing Biome linter check: passed.</p>
                          <p className="text-cyan-400">[STAGE: TESTS] Running unit & smoke tests... 4/4 assertions passed.</p>
                          <p className="text-emerald-400 font-bold">[SUCCESS] Task completed and all validation gates passed!</p>
                          <p className="text-emerald-400">[POST-BUILD] Synchronized scaffold.yaml spec file and saved SQLite history.</p>
                        </>
                      )}
                      
                      {selectedItem.data.status === 'running' && (
                        <>
                          <p className="text-blue-400 animate-pulse">[STAGE: COMPILER] Active: checking TypeScript strict compilation...</p>
                          <p className="text-muted-foreground animate-pulse">Running: npx tsc --noEmit (checking references...)</p>
                          <p className="text-cyan-400/70">[STAGE: SCAFFOLD] Complete. Scaffolding finished successfully in 430ms.</p>
                        </>
                      )}

                      {selectedItem.data.status === 'failed' && (
                        <>
                          <p className="text-cyan-400">[STAGE: SCAFFOLD] Scaffolding completed.</p>
                          <p className="text-rose-400 font-bold">[FAILURE] Compilation error detected during &quot;tsc --noEmit&quot;:</p>
                          <p className="text-rose-500/90 font-bold">  Error: Property &apos;status&apos; does not exist on type &apos;TaskItemSpec&apos; in src/app-dashboard.tsx line 137</p>
                          <p className="text-rose-400">[ITERATION] Auto-launching targeted iteration fixing loops...</p>
                          <p className="text-muted-foreground">[WARNING] Task needs immediate engineer attention.</p>
                        </>
                      )}

                      {selectedItem.data.status === 'pending' && (
                        <>
                          <p className="text-muted-foreground">[PENDING] Task is in queue. Waiting for build dependency resolution.</p>
                          <p className="text-muted-foreground">[PENDING] Dependencies: none blocked. Ready to run.</p>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-muted-foreground">[2026-05-22T11:27:08Z] PARSING STORY ROADMAP...</p>
                      <p className="text-primary">[STORY] &quot;{selectedItem.data.name}&quot;</p>
                      <p className="text-primary">[FILE] {selectedItem.data.file}</p>
                      <p className="text-primary">[TASKS] Found {selectedItem.data.tasks.length} subtask checklists under this card.</p>
                      <p className="text-primary">[STATUS] Rollup progress is currently {selectedItem.data.progressPercent}% complete.</p>
                      <p className="text-cyan-400">[SYNC] Database synchronizer is monitoring task triggers.</p>
                      <p className="text-emerald-400">[SYNC] Complete. Story rolling up parent stats to Epic &quot;{selectedItem.parentFeature?.name}&quot;.</p>
                    </>
                  )}
                </div>
              </div>

            </div>
          </div>
        </>
      )}

    </div>
  );
}
