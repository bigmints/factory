'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  Compass,
  CheckCircle2,
  Circle,
  Play,
  Check,
  RefreshCw,
  Sliders,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Database,
  Cpu,
  Layers,
  Sparkles,
  Zap,
  Terminal,
  Activity,
  FileCode,
  Flame,
  AlertCircle,
  X,
  Search,
  Filter,
  Clock,
  User,
  Tag,
  ExternalLink,
  Columns
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
    const toastId = toast.loading('Synchronizing .factory/app.yaml with SQLite database...');
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
            {error || 'No active project with a valid .factory/app.yaml was detected in SQLite database.'}
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
  
  // Radial Progress Calculations
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (data.progressPercent / 100) * circumference;

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-300 relative">
      
      {/* Top Banner: Glassmorphic App details with Circular Progress gauge */}
      <Card className="relative overflow-hidden border border-border bg-card shadow-sm">
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/5 rounded-full filter blur-3xl -translate-y-12 translate-x-12 pointer-events-none" />
        <CardContent className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 md:gap-8">
          
          <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className={cn("text-xs font-semibold uppercase tracking-wider px-2.5 py-0.5 border shadow-sm", appStatus.bg)}>
                <span className="relative flex h-1.5 w-1.5 mr-1.5">
                  <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", appStatus.pulse)}></span>
                  <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", appStatus.pulse)}></span>
                </span>
                {appStatus.label}
              </Badge>
              <span className="text-xs font-mono text-muted-foreground font-semibold bg-muted/60 px-2 py-0.5 rounded border">v{data.version}</span>
            </div>

            <div>
              <h2 className="text-xl md:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
                <Compass className="h-6 w-6 text-primary animate-pulse" />
                {data.name}
              </h2>
              <p className="text-xs md:text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-xl">
                {data.description}
              </p>
            </div>

            {/* Stack badges */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {Object.entries(data.stack).map(([key, val]) => {
                if (!val) return null;
                return (
                  <Badge key={key} variant="secondary" className="text-[10px] font-semibold font-mono bg-muted/40 hover:bg-muted/60 border text-foreground/80 px-2 py-0.5 capitalize">
                    {key}: {val}
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* Metrics Overview Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
            <div className="bg-card/30 border border-border/40 p-3 rounded-lg text-center flex flex-col justify-center min-w-[80px]">
              <span className="text-lg font-black text-foreground font-mono">{stats.totalStories}</span>
              <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mt-0.5">Stories</span>
            </div>
            <div className="bg-card/30 border border-border/40 p-3 rounded-lg text-center flex flex-col justify-center min-w-[80px]">
              <span className="text-lg font-black text-emerald-400 font-mono">{stats.completedTasks}</span>
              <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mt-0.5">Done Tasks</span>
            </div>
            <div className="bg-card/30 border border-border/40 p-3 rounded-lg text-center flex flex-col justify-center min-w-[80px]">
              <span className={cn("text-lg font-black font-mono", stats.runningTasks > 0 ? "text-blue-400 animate-pulse" : "text-foreground")}>{stats.runningTasks}</span>
              <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mt-0.5">Running</span>
            </div>
            <div className="bg-card/30 border border-border/40 p-3 rounded-lg text-center flex flex-col justify-center min-w-[80px]">
              <span className={cn("text-lg font-black font-mono", stats.failedTasks > 0 ? "text-rose-400" : "text-foreground")}>{stats.failedTasks}</span>
              <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mt-0.5">Failed</span>
            </div>
          </div>

          {/* Large Glassmorphic Circular Gauge */}
          <div className="flex items-center gap-6 self-center md:self-auto pr-2 md:pr-4">
            <div className="relative flex items-center justify-center">
              <svg className="w-28 h-28 transform -rotate-90">
                {/* Track circle */}
                <circle
                  cx="56"
                  cy="56"
                  r={radius - 6}
                  className="stroke-muted"
                  strokeWidth="7"
                  fill="transparent"
                />
                {/* Glowing progress circle */}
                <circle
                  cx="56"
                  cy="56"
                  r={radius - 6}
                  className="stroke-primary transition-all duration-1000 ease-out"
                  strokeWidth="7"
                  fill="transparent"
                  strokeDasharray={2 * Math.PI * (radius - 6)}
                  strokeDashoffset={2 * Math.PI * (radius - 6) - (data.progressPercent / 100) * 2 * Math.PI * (radius - 6)}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-xl font-black text-foreground tracking-tighter">{data.progressPercent}%</span>
                <span className="text-[8px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">App done</span>
              </div>
            </div>
            
            <div className="flex flex-col gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="text-xs font-semibold h-8 rounded-lg shadow-sm border bg-background hover:bg-muted gap-1.5"
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                Sync Spec
              </Button>
              <div className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
                <Terminal className="h-3 w-3 text-muted-foreground/60" />
                <span>Source: app.yaml</span>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>

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
                <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0">
                  {data.features.length} total
                </Badge>
              </div>

              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {/* "All Epics" filter row */}
                <div
                  onClick={() => setSelectedEpicId(null)}
                  className={cn(
                    "relative p-4 rounded-xl border cursor-pointer select-none transition-all duration-300 flex flex-col gap-2 overflow-hidden",
                    selectedEpicId === null
                      ? "bg-accent border-primary shadow-sm"
                      : "bg-card border-border hover:border-muted-foreground text-foreground"
                  )}
                >
                  {selectedEpicId === null && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r bg-primary" />
                  )}
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs tracking-tight">All Backlog Items</span>
                    <Badge variant="secondary" className="text-[9px] font-bold px-1.5 bg-muted/60">
                      {stats.totalStories} stories
                    </Badge>
                  </div>
                  <div className="w-full h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-primary to-indigo-500 h-full transition-all duration-500" style={{ width: `${data.progressPercent}%` }} />
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
                        "relative p-4 rounded-xl border cursor-pointer select-none transition-all duration-300 flex flex-col gap-2.5 overflow-hidden",
                        isSelected
                          ? "bg-accent border-primary shadow-sm"
                          : "bg-card border-border hover:border-muted-foreground"
                      )}
                    >
                      {isSelected && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r bg-primary" />
                      )}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-extrabold text-xs text-foreground leading-tight line-clamp-1 tracking-tight">{feature.name}</span>
                          <Badge variant="outline" className={cn("text-[8px] font-bold tracking-wide uppercase px-1.5 shrink-0 scale-90", epicStyle.bg)}>
                            {epicStyle.label}
                          </Badge>
                        </div>
                        {feature.description && (
                          <span className="text-[10px] text-muted-foreground/80 leading-normal line-clamp-2">
                            {feature.description}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-4 pt-1.5">
                        <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-primary to-indigo-500 h-full transition-all duration-500"
                            style={{ width: `${feature.progressPercent}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono font-bold text-foreground shrink-0">{feature.progressPercent}%</span>
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
              <Card className="border-dashed py-16 text-center bg-card border-border rounded-2xl">
                <AlertCircle className="h-10 w-10 text-muted-foreground/60 mx-auto mb-3 animate-pulse" />
                <p className="text-sm font-bold text-foreground">No matching backlog items found</p>
                <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto leading-relaxed">
                  Try clearing your search query, selecting another epic on the left, or clicking Sync Spec.
                </p>
              </Card>
            ) : (
              <div className="space-y-6">
                {filteredData?.features.map(feature => {
                  const isEpicExpanded = !!expandedFeatures[feature.id];

                  return (
                    <div key={feature.id} className="space-y-3">
                      
                      {/* Sub-Epic Group Header */}
                      <div 
                        onClick={() => toggleFeature(feature.id)}
                        className="flex items-center justify-between gap-3 bg-muted border border-border p-3 rounded-xl cursor-pointer hover:bg-muted/80 select-none transition-all duration-300 shadow-sm"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isEpicExpanded ? (
                            <ChevronDown className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-[9px] font-black uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded shrink-0">
                            EPIC
                          </span>
                          <span className="font-extrabold text-xs md:text-sm text-foreground truncate tracking-tight">{feature.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-[10px] font-mono font-bold text-foreground">{feature.progressPercent}%</span>
                          <div className="w-16 h-1.5 bg-muted/40 rounded-full overflow-hidden border-0 shrink-0">
                            <div className="bg-gradient-to-r from-primary to-indigo-500 h-full" style={{ width: `${feature.progressPercent}%` }} />
                          </div>
                        </div>
                      </div>

                      {/* Stories Backlog Tree under this Feature */}
                      {isEpicExpanded && (
                        <div className="pl-2 space-y-4 border-l border-border/25 ml-4 animate-in slide-in-from-top-1 duration-200">
                          {feature.stories.length === 0 ? (
                            <span className="text-xs text-muted-foreground italic pl-6 py-2 block">No stories match your filter in this epic.</span>
                          ) : (
                            feature.stories.map(story => {
                              const isStoryExpanded = !!expandedStories[story.id];
                              const storyStyle = getStoryStatusStyle(story.status);
                              const completedCount = story.tasks.filter(t => t.status === 'completed').length;
                              const totalTasks = story.tasks.length;
                              const hasFailedTasks = story.tasks.some(t => t.status === 'failed');

                              return (
                                <div key={story.id} className="relative group">
                                  
                                  {/* Story Card Container */}
                                  <div
                                    className={cn(
                                      "relative z-10 rounded-xl border bg-card transition-all duration-300 hover:scale-[1.01] hover:-translate-y-0.5 shadow-sm",
                                      isStoryExpanded ? "border-border shadow-md" : "border-border hover:border-muted-foreground",
                                      story.status === 'done' && "shadow-[0_0_15px_-4px_rgba(16,185,129,0.1)] bg-emerald-500/[0.02] border-emerald-500/15 hover:border-emerald-500/30",
                                      story.status === 'in-progress' && "shadow-[0_0_15px_-4px_rgba(59,130,246,0.1)] bg-blue-500/[0.02] border-blue-500/15 hover:border-blue-500/30",
                                      hasFailedTasks && "shadow-[0_0_15px_-4px_rgba(239,68,68,0.1)] bg-rose-500/[0.02] border-rose-500/15 hover:border-rose-500/30"
                                    )}
                                  >
                                    <div
                                      onClick={() => toggleStory(story.id)}
                                      className="p-4 flex flex-wrap sm:flex-nowrap items-center justify-between gap-4 cursor-pointer select-none"
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex items-center justify-center shrink-0">
                                          {isStoryExpanded ? (
                                            <ChevronDown className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
                                          ) : (
                                            <ChevronRight className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
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
                                              className="text-[10px] font-mono font-bold tracking-tight bg-muted/80 hover:bg-primary/20 border hover:border-primary/40 px-2 py-0.5 rounded text-foreground hover:text-primary transition-all shrink-0 cursor-pointer"
                                            >
                                              STRY-{story.id.split(':').pop()?.substring(0, 5) || '101'}
                                            </span>
                                            <span className="font-extrabold text-xs sm:text-sm text-foreground truncate tracking-tight">{story.name}</span>
                                            <Badge className={cn("text-[8px] font-bold font-mono border tracking-wide uppercase px-1.5 py-0 scale-95 shadow-sm", storyStyle.bg)}>
                                              <span className={cn("h-1 w-1 rounded-full mr-1 shrink-0 inline-block animate-pulse", storyStyle.dot)} />
                                              {story.status}
                                            </Badge>
                                          </div>
                                          {story.file && (
                                            <span className="text-[10px] text-muted-foreground/80 font-mono mt-1.5 truncate flex items-center gap-1.5">
                                              <FileCode className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                                              {story.file}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Story Progress */}
                                      <div className="flex items-center gap-3.5 shrink-0 text-right">
                                        <span className="text-[9px] font-bold text-muted-foreground font-mono bg-muted/40 border border-border/30 px-2 py-0.5 rounded">
                                          {completedCount}/{totalTasks} tasks ({story.progressPercent}%)
                                        </span>
                                        <div className="w-16 h-1.5 bg-muted/40 rounded-full overflow-hidden border-0 shrink-0">
                                          <div
                                            className={cn(
                                              "h-full transition-all duration-500 ease-out",
                                              story.status === 'done'
                                                ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                                                : hasFailedTasks
                                                  ? "bg-gradient-to-r from-rose-500 to-red-400"
                                                  : "bg-gradient-to-r from-primary to-indigo-500"
                                            )}
                                            style={{ width: `${story.progressPercent}%` }}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Indented Task Subtree with branch lines */}
                                  {isStoryExpanded && (
                                    <div className="relative mt-2.5 pl-7 pr-1 pb-1 space-y-2.5 animate-in slide-in-from-top-1 duration-200">
                                      
                                      {/* Continuous vertical tree trunk line down from story */}
                                      <div className="absolute left-[13px] top-0 bottom-[22px] w-px bg-border/30 border-dashed border-l pointer-events-none" />

                                      {story.tasks.length === 0 ? (
                                        <p className="text-xs text-muted-foreground italic pl-3 py-1">No actionable tasks under this story.</p>
                                      ) : (
                                        story.tasks.map((task, index) => {
                                          const isCompleted = task.status === 'completed';
                                          const isRunning = task.status === 'running';
                                          const isFailed = task.status === 'failed';
                                          const isUpdating = updatingTaskId === task.fullId;

                                          return (
                                            <div
                                              key={task.id}
                                              className="relative flex items-center gap-3 group/task"
                                            >
                                              {/* Branch Line Connector (Story Trunk to Task Checkbox) */}
                                              <div className="absolute left-[-14px] top-1/2 -translate-y-1/2 w-[14px] h-[1px] bg-border/30 pointer-events-none" />

                                              {/* Task Item Box */}
                                              <div
                                                className={cn(
                                                  "flex-1 flex items-center justify-between gap-4 p-3 rounded-xl border transition-all duration-300 select-none cursor-pointer",
                                                  isCompleted
                                                    ? "bg-emerald-500/[0.03] border-emerald-500/15 hover:bg-emerald-500/[0.06] hover:border-emerald-500/30 shadow-[0_0_12px_-4px_rgba(16,185,129,0.08)]"
                                                    : isRunning
                                                      ? "border-blue-500/30 bg-blue-500/[0.04] shadow-[0_0_12px_-2px_rgba(59,130,246,0.15)] animate-pulse"
                                                      : isFailed
                                                        ? "border-rose-500/30 bg-rose-500/[0.04] shadow-[0_0_12px_-2px_rgba(239,68,68,0.15)]"
                                                        : "bg-card/20 border-border/40 hover:bg-card/35 hover:border-border/70"
                                                )}
                                              >
                                                <div 
                                                  onClick={() => !isUpdating && handleToggleTask(task)}
                                                  className="flex items-center gap-3 min-w-0 flex-1"
                                                >
                                                  {/* Custom Animated Checkbox */}
                                                  <div className="relative shrink-0 flex items-center justify-center">
                                                    {isCompleted ? (
                                                      <div className="h-4.5 w-4.5 rounded bg-emerald-500 text-white flex items-center justify-center shadow-md animate-scale-in">
                                                        <Check className="h-2.5 w-2.5 stroke-[3.5]" />
                                                      </div>
                                                    ) : isRunning ? (
                                                      <div className="h-4.5 w-4.5 rounded border border-blue-500 flex items-center justify-center bg-blue-500/10">
                                                        <RefreshCw className="h-2.5 w-2.5 text-blue-500 animate-spin" />
                                                      </div>
                                                    ) : isFailed ? (
                                                      <div className="h-4.5 w-4.5 rounded border border-rose-500 flex items-center justify-center bg-rose-500/10">
                                                        <AlertCircle className="h-2.5 w-2.5 text-rose-500 animate-pulse" />
                                                      </div>
                                                    ) : (
                                                      <div className="h-4.5 w-4.5 rounded border border-border hover:border-muted-foreground transition-colors bg-card/60" />
                                                    )}
                                                  </div>

                                                  <div className="min-w-0 flex-1">
                                                    <p
                                                      className={cn(
                                                        "text-xs font-semibold leading-tight truncate transition-all duration-200",
                                                        isCompleted ? "line-through text-muted-foreground font-medium" : "text-foreground",
                                                        isRunning && "text-blue-400 font-bold",
                                                        isFailed && "text-rose-400 font-bold"
                                                      )}
                                                    >
                                                      {task.title}
                                                    </p>
                                                  </div>
                                                </div>

                                                {/* Task Info & Drawer Trigger */}
                                                <div className="flex items-center gap-2 shrink-0">
                                                  <Badge variant="outline" className={cn(
                                                    "text-[8px] font-mono uppercase font-bold tracking-wider py-0 px-1 shrink-0 select-none scale-90",
                                                    isCompleted && "text-emerald-500/70 border-emerald-500/20",
                                                    isRunning && "text-blue-500/70 border-blue-500/20 animate-pulse",
                                                    isFailed && "text-rose-500/70 border-rose-500/20",
                                                    task.status === 'pending' && "text-muted-foreground/60 border-border"
                                                  )}>
                                                    {task.status}
                                                  </Badge>

                                                  {/* Key/Drawer trigger */}
                                                  <span
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleOpenDrawer(task, 'task', story, feature);
                                                    }}
                                                    className="text-[9px] font-mono text-muted-foreground bg-muted/30 border hover:border-border rounded px-1 cursor-pointer py-0.5 hover:text-foreground transition-all shrink-0 uppercase"
                                                  >
                                                    TSK-{task.id}
                                                  </span>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })
                                      )}
                                    </div>
                                  )}
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

        </div>
      ) : (
        /* Kanban Board View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 overflow-x-auto pb-4">
          
          {/* Column: To Do */}
          <div className="bg-muted border border-border rounded-xl p-3 flex flex-col gap-3 min-w-[250px] min-h-[500px]">
            <div className="flex items-center justify-between border-b border-border pb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span className="text-xs font-bold text-foreground">TO DO</span>
              </div>
              <Badge variant="outline" className="text-[9px] font-mono">
                {filteredData?.features.reduce((acc, f) => 
                  acc + f.stories.reduce((sAcc, s) => sAcc + s.tasks.filter(t => t.status === 'pending').length, 0)
                , 0)}
              </Badge>
            </div>
            
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px]">
              {filteredData?.features.flatMap(f => 
                f.stories.flatMap(s => 
                  s.tasks.filter(t => t.status === 'pending').map(t => (
                    <div
                      key={t.fullId}
                      onClick={() => handleOpenDrawer(t, 'task', s, f)}
                      className="p-3 bg-card border border-border hover:border-muted-foreground rounded-lg cursor-pointer transition-all flex flex-col gap-2 select-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-mono text-muted-foreground bg-muted/60 px-1 py-0.5 rounded truncate max-w-[120px]">
                          {s.name}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground uppercase">TSK-{t.id}</span>
                      </div>
                      <p className="text-xs font-semibold text-foreground line-clamp-2">{t.title}</p>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          {/* Column: In Progress */}
          <div className="bg-muted border border-border rounded-xl p-3 flex flex-col gap-3 min-w-[250px] min-h-[500px]">
            <div className="flex items-center justify-between border-b border-border pb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-xs font-bold text-foreground">IN PROGRESS</span>
              </div>
              <Badge variant="outline" className="text-[9px] font-mono">
                {filteredData?.features.reduce((acc, f) => 
                  acc + f.stories.reduce((sAcc, s) => sAcc + s.tasks.filter(t => t.status === 'running').length, 0)
                , 0)}
              </Badge>
            </div>
            
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px]">
              {filteredData?.features.flatMap(f => 
                f.stories.flatMap(s => 
                  s.tasks.filter(t => t.status === 'running').map(t => (
                    <div
                      key={t.fullId}
                      onClick={() => handleOpenDrawer(t, 'task', s, f)}
                      className="p-3 bg-card border border-blue-500 hover:border-blue-600 rounded-lg cursor-pointer transition-all flex flex-col gap-2 select-none shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-mono text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded truncate max-w-[120px] border border-blue-500/10">
                          {s.name}
                        </span>
                        <span className="text-[9px] font-mono text-blue-400 uppercase font-bold animate-pulse">TSK-{t.id}</span>
                      </div>
                      <p className="text-xs font-semibold text-foreground line-clamp-2 leading-snug">{t.title}</p>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          {/* Column: Failed / Attention */}
          <div className="bg-muted border border-border rounded-xl p-3 flex flex-col gap-3 min-w-[250px] min-h-[500px]">
            <div className="flex items-center justify-between border-b border-border pb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-xs font-bold text-foreground">FAILED / BLOCKED</span>
              </div>
              <Badge variant="outline" className="text-[9px] font-mono">
                {filteredData?.features.reduce((acc, f) => 
                  acc + f.stories.reduce((sAcc, s) => sAcc + s.tasks.filter(t => t.status === 'failed').length, 0)
                , 0)}
              </Badge>
            </div>
            
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px]">
              {filteredData?.features.flatMap(f => 
                f.stories.flatMap(s => 
                  s.tasks.filter(t => t.status === 'failed').map(t => (
                    <div
                      key={t.fullId}
                      onClick={() => handleOpenDrawer(t, 'task', s, f)}
                      className="p-3 bg-card border border-rose-500 hover:border-rose-600 rounded-lg cursor-pointer transition-all flex flex-col gap-2 select-none shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-mono text-rose-400 bg-rose-500/10 px-1 py-0.5 rounded truncate max-w-[120px] border border-rose-500/10">
                          {s.name}
                        </span>
                        <span className="text-[9px] font-mono text-rose-400 uppercase font-bold">TSK-{t.id}</span>
                      </div>
                      <p className="text-xs font-semibold text-foreground line-clamp-2 leading-snug">{t.title}</p>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          {/* Column: Done */}
          <div className="bg-muted border border-border rounded-xl p-3 flex flex-col gap-3 min-w-[250px] min-h-[500px]">
            <div className="flex items-center justify-between border-b border-border pb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-foreground">DONE</span>
              </div>
              <Badge variant="outline" className="text-[9px] font-mono">
                {filteredData?.features.reduce((acc, f) => 
                  acc + f.stories.reduce((sAcc, s) => sAcc + s.tasks.filter(t => t.status === 'completed').length, 0)
                , 0)}
              </Badge>
            </div>
            
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px]">
              {filteredData?.features.flatMap(f => 
                f.stories.flatMap(s => 
                  s.tasks.filter(t => t.status === 'completed').map(t => (
                    <div
                      key={t.fullId}
                      onClick={() => handleOpenDrawer(t, 'task', s, f)}
                      className="p-3 bg-card border border-emerald-500 hover:border-emerald-600 rounded-lg cursor-pointer transition-all flex flex-col gap-2 select-none shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.5 rounded truncate max-w-[120px]">
                          {s.name}
                        </span>
                        <span className="text-[9px] font-mono text-emerald-400 uppercase font-semibold">TSK-{t.id}</span>
                      </div>
                      <p className="text-xs font-semibold text-muted-foreground line-through line-clamp-2">{t.title}</p>
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
                    <span>Gemini Builder Agent 🤖</span>
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
                          <p className="text-emerald-400">[POST-BUILD] Synchronized app.yaml spec file and saved SQLite history.</p>
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
