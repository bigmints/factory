'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Sidebar, MobileNav } from '@/components/sidebar';
import { AddProject } from '@/components/add-project';
import { StoryCard } from '@/components/story-card';
import { StoryEditor } from '@/components/story-editor';
import { StoryChat } from '@/components/story-chat';
import { BuildLog } from '@/components/build-log';
import { ReportViewer } from '@/components/report-viewer';
import { QueueView } from '@/components/queue-view';
import { KnowledgeView } from '@/components/knowledge-view';
import { SettingsView } from '@/components/settings-view';
import { SkillsView } from '@/components/skills-view';
import { AppDashboard } from '@/components/app-dashboard';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FileText, Package, CheckCircle2, AlertCircle, Activity, Puzzle, Globe, ListOrdered, X, Terminal, FolderOpen, Plug, Plus, Loader2 as Spinner, Sparkles, Rocket, Compass, LayoutDashboard } from 'lucide-react';


interface Story {
  file: string;
  valid: boolean;
  status: string;
  metadata: Record<string, any>;
  deployment?: Record<string, any>;
  database?: Record<string, any>;
  api?: Record<string, any>;
  features?: Record<string, any>;
}

interface FeatureStoryItem {
  file: string;
  kind: 'FeatureStory';
  valid: boolean;
  status: string;
  feature: Record<string, any>;
  target: Record<string, any>;
  pages: any[];
  model: Record<string, any>;
  phase?: number;
  dependsOn?: string[];
}

interface ValidationCheck {
  passed: boolean;
  name: string;
  message: string;
}

const VALID_TABS = ['dashboard', 'roadmap', 'queue', 'stories', 'skills', 'reports', 'knowledge', 'projects', 'integrations', 'settings'];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showAddProject, setShowAddProject] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('factory_sidebar_collapsed');
      if (stored !== null) {
        setSidebarCollapsed(stored === 'true');
      }
    }
  }, []);

  const toggleSidebarCollapse = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('factory_sidebar_collapsed', String(next));
    }
  };

  const [stories, setStories] = useState<Story[]>([]);
  const [featureStories, setFeatureStories] = useState<FeatureStoryItem[]>([]);
  const [reportEntries, setReportEntries] = useState<any[]>([]);
  const [reportStats, setReportStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [buildOutput, setBuildOutput] = useState('');
  const [validationResult, setValidationResult] = useState<{
    passed: boolean;
    checks: ValidationCheck[];
  } | null>(null);
  const [activeAction, setActiveAction] = useState<{
    type: 'validate' | 'build' | 'feature-validate' | 'feature-build';
    file: string;
  } | null>(null);
  const [outputPanelOpen, setOutputPanelOpen] = useState(false);
  const [hasProjects, setHasProjects] = useState(true);
  const [activeProject, setActiveProject] = useState<{ id: string; name: string; path: string } | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [projectRefreshKey, setProjectRefreshKey] = useState(0);
  const [editingStory, setEditingStory] = useState<{ file: string; name: string } | null>(null);
  const [showStoryChat, setShowStoryChat] = useState(false);
  const [isBuildingAll, setIsBuildingAll] = useState(false);
  const [queueStatusMap, setQueueStatusMap] = useState<Record<string, { status: string; id: string }>>({});
  const [queueRunning, setQueueRunning] = useState(false);
  const [buildEngine, setBuildEngine] = useState<'factory' | 'gemini-cli' | 'pi-cli'>('factory');

  const logOffsetRef = useRef(0);

  const fetchQueueStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      const map: Record<string, { status: string; id: string }> = {};
      for (const item of (data.items || [])) {
        const file = item.story_file || item.spec_file;
        if (file) {
          map[file] = { status: item.status, id: item.id };
        }
      }
      setQueueStatusMap(map);
      const running = (data.items || []).some((i: any) => i.status === 'running');
      setQueueRunning(running || data.isRunning || false);
    } catch {}
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

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge?limit=100');
      const data = await res.json();
      setReportEntries(data.entries || []);
      setReportStats(data.stats || null);
    } catch {
      console.error('Failed to fetch reports');
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      const projects = data.projects || [];
      setProjectCount(projects.length);
      setHasProjects(projects.length > 0);
      if (!projects.length) setShowAddProject(true);
      const active = projects.find((p: any) => p.id === data.activeId);
      setActiveProject(active || null);
    } catch {}
  }, []);

  useEffect(() => {
    Promise.all([fetchProjects(), fetchStories(), fetchReports(), fetchQueueStatus()]).finally(() => setLoading(false));
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'roadmap') {
        setActiveTab('dashboard');
      } else if (VALID_TABS.includes(hash)) {
        if (hash === 'projects') {
          setShowAddProject(true);
        } else {
          setActiveTab(hash);
        }
      }
    }
  }, [fetchProjects, fetchStories, fetchReports, fetchQueueStatus]);

  useEffect(() => {
    const tab = showAddProject ? 'projects' : activeTab;
    window.location.hash = tab;
  }, [activeTab, showAddProject]);

  useEffect(() => {
    if (!queueRunning) {
      logOffsetRef.current = 0;
      return;
    }
    setBuildOutput('Waiting for build output...\n');
    logOffsetRef.current = 0;
    setOutputPanelOpen(true);
    const pollLog = async () => {
      try {
        const res = await fetch(`/api/queue/log?offset=${logOffsetRef.current}`);
        const data = await res.json();
        if (data.log) {
          setBuildOutput(prev => prev + data.log);
          logOffsetRef.current = data.offset;
        }
      } catch { /* ignore */ }
    };
    pollLog();
    const interval = setInterval(pollLog, 1500);
    return () => clearInterval(interval);
  }, [queueRunning]);

  const handleValidate = async (file: string) => {
    setActiveAction({ type: 'validate', file });
    setValidationResult(null);
    setBuildOutput('');
    setOutputPanelOpen(true);
    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyFile: file, specFile: file }),
      });
      const data = await res.json();
      setValidationResult({ passed: data.passed, checks: data.checks || [] });
      if (data.raw) setBuildOutput(data.raw);
      if (data.passed) {
        toast.success('Validation passed', { description: file });
      } else {
        toast.error('Validation failed', { description: file });
      }
    } catch {
      setValidationResult({ passed: false, checks: [{ passed: false, name: 'Error', message: 'Validation request failed' }] });
      toast.error('Validation request failed');
    } finally {
      setActiveAction(null);
    }
  };

  const handleBuild = async (file: string) => {
    setActiveAction({ type: 'build', file });
    setValidationResult(null);
    setBuildOutput('Enqueuing story...\n');
    setOutputPanelOpen(true);
    try {
      const enqueueRes = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyFile: file, specFile: file, kind: 'AppStory', engine: buildEngine }),
      });
      const enqueueData = await enqueueRes.json();
      if (!enqueueRes.ok) {
        setBuildOutput(`Enqueue failed: ${enqueueData.error || 'Unknown error'}`);
        toast.error('Failed to enqueue', { description: enqueueData.error });
        return;
      }
      setBuildOutput('Story queued. Starting build queue...\n');
      toast.success('Story queued', { description: file });
      const startRes = await fetch('/api/queue/start', { method: 'POST' });
      const startData = await startRes.json();
      if (!startRes.ok) {
        setBuildOutput(`Queue start failed: ${startData.error || 'Unknown error'}`);
        toast.error('Queue start failed', { description: startData.error });
        return;
      }
      const output = startData.results
        ?.map((r: any) => `[${r.status.toUpperCase()}] ${r.storyFile || r.specFile}\n${r.output || r.error || ''}`)
        .join('\n\n') || 'Queue processed';
      setBuildOutput(output);
      await fetchStories();
      if (startData.completed > 0) {
        await fetchReports();
        toast.success(`Build completed (${startData.completed} succeeded, ${startData.failed} failed)`);
      } else if (startData.failed > 0) {
        toast.error(`Build failed (${startData.failed} failed)`);
      }
    } catch {
      setBuildOutput('Build request failed');
      toast.error('Build request failed');
    } finally {
      setActiveAction(null);
    }
  };

  const handleFeatureAction = async (file: string, action: 'validate' | 'build') => {
    const actionType = action === 'validate' ? 'feature-validate' : 'feature-build';
    setActiveAction({ type: actionType as any, file });
    setValidationResult(null);
    setBuildOutput(action === 'build' ? 'Enqueuing feature...\n' : '');
    setOutputPanelOpen(true);
    try {
      if (action === 'build') {
        const enqueueRes = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyFile: file, specFile: file, kind: 'FeatureStory', engine: buildEngine }),
        });
        const enqueueData = await enqueueRes.json();
        if (!enqueueRes.ok) {
          setBuildOutput(`Enqueue failed: ${enqueueData.error || 'Unknown error'}`);
          toast.error('Failed to enqueue', { description: enqueueData.error });
          return;
        }
        setBuildOutput('Feature queued. Starting build queue...\n');
        toast.success('Feature queued', { description: file });
        const startRes = await fetch('/api/queue/start', { method: 'POST' });
        const startData = await startRes.json();
        if (!startRes.ok) {
          setBuildOutput(`Queue start failed: ${startData.error || 'Unknown error'}`);
          toast.error('Queue start failed', { description: startData.error });
          return;
        }
        const output = startData.results
          ?.map((r: any) => `[${r.status.toUpperCase()}] ${r.storyFile || r.specFile}\n${r.output || r.error || ''}`)
          .join('\n\n') || 'Queue processed';
        setBuildOutput(output);
        await fetchStories();
        if (startData.completed > 0) {
          await fetchReports();
          toast.success('Feature build completed');
        } else if (startData.failed > 0) {
          toast.error('Feature build failed');
        }
      } else {
        const res = await fetch('/api/feature-build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyFile: file, specFile: file, action: 'validate' }),
        });
        const data = await res.json();
        setBuildOutput(data.output || data.error || 'Unknown result');
        if (data.success) {
          toast.success('Feature validation passed', { description: file });
        } else {
          toast.error('Feature validation failed', { description: file });
        }
      }
    } catch {
      setBuildOutput(`Feature ${action} request failed`);
      toast.error(`Feature ${action} failed`);
    } finally {
      setActiveAction(null);
    }
  };

  const handleEnqueue = async (storyFile: string, kind: string, opts?: { phase?: number; dependsOn?: string[] }) => {
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyFile, specFile: storyFile, kind, phase: opts?.phase, dependsOn: opts?.dependsOn, engine: buildEngine }),
      });
      const data = await res.json();
      if (res.ok) {
        setBuildOutput(`✓ Added "${storyFile}" to build queue`);
        toast.success('Added to queue', { description: storyFile });
        fetchQueueStatus();
        setActiveTab('queue');
      } else {
        setBuildOutput(`✗ ${data.error}`);
        toast.error('Failed to enqueue', { description: data.error });
      }
    } catch {
      setBuildOutput('Failed to enqueue story');
      toast.error('Failed to enqueue story');
    }
  };

  const handleBuildAll = async () => {
    setIsBuildingAll(true);
    let enqueued = 0;
    let skipped = 0;
    let errors = 0;
    try {
      for (const story of stories) {
        try {
          const valRes = await fetch('/api/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyFile: story.file, specFile: story.file, quick: true }),
          });
          const valData = await valRes.json();
          if (!valRes.ok || !valData.passed) {
            skipped++;
            toast.warning(`Skipped: ${story.metadata?.name || story.file}`, {
              description: `YAML issue: ${valData.errors?.[0] || valData.checks?.find((c: any) => !c.passed)?.message || 'Validation failed'}`,
            });
            continue;
          }
          const res = await fetch('/api/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyFile: story.file, specFile: story.file, kind: 'AppStory', phase: 0, dependsOn: [], buildAll: true, engine: buildEngine }),
          });
          if (res.ok) enqueued++;
          else {
            const data = await res.json();
            if (res.status !== 409) { errors++; toast.error(`Failed: ${story.file}`, { description: data.error }); }
          }
        } catch { errors++; }
      }
      const sortedFeatures = [...featureStories].sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0));
      for (const fs of sortedFeatures) {
        try {
          const valRes = await fetch('/api/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyFile: fs.file, specFile: fs.file, quick: true }),
          });
          const valData = await valRes.json();
          if (!valRes.ok || !valData.passed) {
            skipped++;
            toast.warning(`Skipped: ${String(fs.feature?.name || fs.file)}`, {
              description: `YAML issue: ${valData.errors?.[0] || valData.checks?.find((c: any) => !c.passed)?.message || 'Validation failed'}`,
            });
            continue;
          }
          const res = await fetch('/api/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storyFile: fs.file,
              specFile: fs.file,
              kind: 'FeatureStory',
              phase: fs.phase ?? 0,
              dependsOn: fs.dependsOn ?? [],
              buildAll: true,
              engine: buildEngine,
            }),
          });
          if (res.ok) enqueued++;
          else {
            const data = await res.json();
            if (res.status !== 409) { errors++; toast.error(`Failed: ${String(fs.feature?.name || fs.file)}`, { description: data.error }); }
          }
        } catch { errors++; }
      }
      const parts: string[] = [];
      if (errors > 0) parts.push(`${errors} errors`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (enqueued > 0) {
        toast.success(`Queued ${enqueued} story${enqueued !== 1 ? 'ies' : ''}`, {
          description: parts.length > 0 ? parts.join(', ') : 'Switch to Queue tab to start processing',
        });
        setActiveTab('queue');
        fetchQueueStatus();
      } else if (errors > 0 || skipped > 0) {
        toast.error(`No stories queued`, { description: parts.join(', ') });
      } else {
        toast.info('All stories are already in the queue');
        setActiveTab('queue');
      }
    } catch { toast.error('Build All failed'); }
    finally { setIsBuildingAll(false); }
  };

  // ─── Render: Dashboard ──────────────────────────────────
  const renderDashboard = () => (
    <div className="space-y-6 md:space-y-10 relative">
      {/* Decorative subtle background glows */}
      <div className="absolute -top-10 left-10 w-96 h-96 bg-primary/5 rounded-full filter blur-[120px] pointer-events-none -z-10" />
      <div className="absolute -top-20 right-20 w-80 h-80 bg-indigo-500/5 rounded-full filter blur-[100px] pointer-events-none -z-10" />

      {activeProject && (
        <Card className="bg-card border-border hover:shadow-sm transition-all duration-300 overflow-hidden relative group">
          <CardContent className="p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
            <div className="flex items-center gap-4 md:gap-5 min-w-0">
              <div className="relative flex h-12 w-12 md:h-14 md:w-14 shrink-0 items-center justify-center rounded-xl bg-secondary border border-border shadow-sm group-hover:scale-105 transition-transform duration-300">
                <FolderOpen className="h-6 w-6 md:h-7 md:w-7 text-foreground" />
                <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-base md:text-lg font-black tracking-tight text-foreground truncate flex items-center gap-2 select-none">
                  {activeProject.name}
                  <Badge variant="outline" className="text-[10px] font-bold text-emerald-500 bg-emerald-500/5 border-emerald-500/20 uppercase px-2 tracking-wide scale-90">
                    Active
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground font-mono truncate">{activeProject.path}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBuildAll()}
                disabled={isBuildingAll}
                className="text-xs font-semibold h-8 px-3 gap-1.5 shadow-sm border bg-background hover:bg-muted transition-all"
              >
                {isBuildingAll ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                <span>Build All</span>
              </Button>
              <Button
                size="sm"
                onClick={() => setShowStoryChat(true)}
                className="text-xs font-semibold h-8 px-3 gap-1.5 shadow-sm transition-all"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>New Story</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats row — 2 cols mobile, 4 cols desktop with premium spacing & larger cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { icon: FileText, value: stories.length, label: 'App Stories', iconColor: 'text-muted-foreground', bgColor: 'bg-muted border-border' },
          { icon: Activity, value: featureStories.length, label: 'Features', iconColor: 'text-muted-foreground', bgColor: 'bg-muted border-border' },
          { icon: CheckCircle2, value: stories.filter((s) => s.status === 'ready' || s.status === 'done').length, label: 'Ready Stories', iconColor: 'text-muted-foreground', bgColor: 'bg-muted border-border' },
          { icon: Package, value: reportStats?.totalBuilds || 0, label: 'Total Builds', iconColor: 'text-muted-foreground', bgColor: 'bg-muted border-border' },
        ].map((stat, i) => (
          <Card key={i} className="group bg-card border-border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border group-hover:scale-105 transition-transform duration-300", stat.bgColor)}>
                  <stat.icon className={cn("h-6 w-6", stat.iconColor)} />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-2xl md:text-3xl font-black tracking-tight leading-none text-foreground font-mono">{stat.value}</p>
                  <p className="text-[10px] md:text-xs text-muted-foreground font-extrabold truncate uppercase tracking-widest">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="animate-in fade-in duration-300">
        <AppDashboard />
      </div>
    </div>
  );

  // ─── Render: Stories ────────────────────────────────────
  const renderStories = () => {
    if (editingStory) {
      return (
        <StoryEditor
          storyFile={editingStory.file}
          storyName={editingStory.name}
          onClose={() => setEditingStory(null)}
          onSaved={() => fetchStories()}
        />
      );
    }

    return (
      <div className="space-y-8">
        {/* Header row & control bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-muted border border-border p-4 rounded-lg">
          <div className="flex flex-wrap items-center gap-4 text-xs md:text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
              <span className="font-bold text-foreground">{stories.length}</span> App Stories
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
              <span className="font-bold text-foreground">{featureStories.length}</span> Feature Stories
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center border rounded-lg h-9 overflow-x-auto text-xs bg-background p-1 shrink-0">
              <span className="text-[10px] text-muted-foreground font-bold px-2 uppercase tracking-wider">Engine:</span>
              <button
                className={`px-3 py-1 rounded-md transition-all text-[11px] font-semibold shrink-0 ${buildEngine === 'factory' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
                onClick={() => setBuildEngine('factory')}
              >
                Factory
              </button>
            </div>
            
            <Button
              size="sm"
              variant="outline"
              onClick={handleBuildAll}
              disabled={isBuildingAll || (stories.length === 0 && featureStories.length === 0)}
              className="h-9 text-xs gap-1.5 rounded-lg border hover:bg-muted font-semibold"
            >
              {isBuildingAll ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              <span>Build All</span>
            </Button>
            
            <Button
              size="sm"
              onClick={() => setShowStoryChat(true)}
              className="h-9 text-xs gap-1.5 rounded-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Story</span>
            </Button>
          </div>
        </div>

        <StoryChat open={showStoryChat} onOpenChange={setShowStoryChat} onStorySaved={() => fetchStories()} />

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[64px] rounded-lg" />
            ))}
          </div>
        ) : stories.length === 0 && featureStories.length === 0 ? (
          <Card className="border-dashed p-6 sm:p-10 text-center flex flex-col items-center justify-center">
            <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-semibold text-foreground">No stories found</p>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">
              Add YAML files to stories/apps/ or stories/features/ to get started
            </p>
          </Card>
        ) : (
          <div className="space-y-8 md:space-y-10">
            {/* App Stories Section */}
            {stories.length > 0 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h3 className="text-base md:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    App Stories
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Core backend structure, schemas, and cloud resources.
                  </p>
                </div>
                
                <div className="border border-border rounded-xl divide-y divide-border/60 bg-card/10 overflow-hidden">
                  {stories.map((story) => (
                    <StoryCard
                      key={story.file}
                      story={story}
                      onValidate={handleValidate}
                      onBuild={handleBuild}
                      onEnqueue={handleEnqueue}
                      onView={(file, name) => setEditingStory({ file, name })}
                      isValidating={activeAction?.type === 'validate' && activeAction?.file === story.file}
                      isBuilding={activeAction?.type === 'build' && activeAction?.file === story.file}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Feature Stories Section */}
            {featureStories.length > 0 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h3 className="text-base md:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                    <Puzzle className="h-4 w-4 text-muted-foreground" />
                    Feature Stories
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Sequenced features, UI pages, logic flows, and user experiences.
                  </p>
                </div>
                
                <div className="border border-border rounded-xl divide-y divide-border/60 bg-card/10 overflow-hidden">
                  {featureStories.map((fs) => (
                    <StoryCard
                      key={fs.file}
                      story={{ ...fs, kind: 'FeatureStory' }}
                      onValidate={(file) => handleFeatureAction(file, 'validate')}
                      onBuild={(file) => handleFeatureAction(file, 'build')}
                      onEnqueue={handleEnqueue}
                      onView={(file, name) => setEditingStory({ file, name })}
                      isValidating={activeAction?.type === 'feature-validate' && activeAction?.file === fs.file}
                      isBuilding={activeAction?.type === 'feature-build' && activeAction?.file === fs.file}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─── Render: Reports ────────────────────────────────────
  const renderReports = () => (
    <div className="space-y-4 md:space-y-6">
      {loading ? (
        <Skeleton className="h-[400px] md:h-[600px] rounded-lg" />
      ) : (
        <ReportViewer
          entries={reportEntries}
          stats={reportStats || { totalBuilds: 0, successfulBuilds: 0, failedBuilds: 0, uniqueSpecs: 0, totalTokensIn: 0, totalTokensOut: 0, avgDurationMs: 0, modelUsage: [], errorBreakdown: [] }}
        />
      )}
    </div>
  );

  const hasOutput = !!(validationResult || buildOutput || queueRunning);
  const showOutputButton = ((activeTab === 'stories' || activeTab === 'queue') && hasOutput && !outputPanelOpen);

  // ─── Main Layout ─────────────────────────────────────────
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar — handles both desktop (always visible) and mobile (Sheet drawer) */}
      <Sidebar
        activeTab={showAddProject ? 'projects' : activeTab}
        onTabChange={(tab) => {
          if (tab === 'projects') {
            setShowAddProject(true);
          } else {
            setShowAddProject(false);
            setActiveTab(tab);
          }
        }}
        onAddProject={() => setShowAddProject(true)}
        projectRefreshKey={projectRefreshKey}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />

      <main className="flex-1 overflow-auto pt-16 md:pt-0 pb-6 md:pb-0">
        {showAddProject ? (
          <div className="p-4 md:p-8 w-full h-full">
            <AddProject onProjectAdded={() => {
              setShowAddProject(false);
              setHasProjects(true);
              setProjectRefreshKey((k) => k + 1);
              fetchProjects();
              fetchStories();
              fetchReports();
            }} />
          </div>
        ) : (
          <div className="p-4 md:p-8 w-full max-w-[1400px] mx-auto">
            {/* Page header */}
            {['dashboard', 'stories', 'skills', 'reports', 'integrations', 'settings'].includes(activeTab) && (
              <div className="mb-4 md:mb-8 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <div>
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                    {activeTab === 'dashboard' && 'Dashboard'}
                    {activeTab === 'stories' && 'Stories'}
                    {activeTab === 'skills' && 'Skills'}
                    {activeTab === 'reports' && 'Reports'}
                    {activeTab === 'integrations' && 'Integrations'}
                    {activeTab === 'settings' && 'Settings'}
                  </h1>
                  <p className="text-xs md:text-sm text-muted-foreground mt-1">
                    {activeTab === 'dashboard' && 'Overview for the active project'}
                    {activeTab === 'stories' && 'Manage your app stories'}
                    {activeTab === 'skills' && 'Reusable recipes the engine auto-matches to builds'}
                    {activeTab === 'reports' && 'View generated build reports'}
                    {activeTab === 'integrations' && 'Connect external services and tools'}
                    {activeTab === 'settings' && 'Configure factory preferences'}
                  </p>
                </div>
                {showOutputButton && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setOutputPanelOpen(true)}
                  >
                    <Terminal className="h-4 w-4" />
                    Output
                    {queueRunning && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                      </span>
                    )}
                  </Button>
                )}
              </div>
            )}

            {activeTab === 'dashboard' && renderDashboard()}
            {activeTab === 'queue' && (
              <QueueView
                onToggleOutput={() => setOutputPanelOpen(!outputPanelOpen)}
                outputPanelOpen={outputPanelOpen}
                queueRunning={queueRunning}
              />
            )}
            {activeTab === 'stories' && renderStories()}
            {activeTab === 'skills' && <SkillsView />}
            {activeTab === 'reports' && renderReports()}
            {activeTab === 'knowledge' && <KnowledgeView />}
            {activeTab === 'integrations' && (
              <div className="flex flex-col items-center justify-center py-16 md:py-24 text-center">
                <Plug className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground/30 mb-3 md:mb-4" />
                <h2 className="text-base md:text-lg font-semibold">Integrations</h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-1 max-w-md">
                  Connect external services like GitHub, CI/CD pipelines, and notification channels. Coming soon.
                </p>
              </div>
            )}
            {activeTab === 'settings' && <SettingsView />}
          </div>
        )}
      </main>

      {/* Output panel — desktop: slide-over overlay, mobile: bottom sheet */}
      <aside
        className={cn(
          "fixed right-0 top-0 h-screen z-50 border-l border-border bg-background/85 backdrop-blur-md shadow-2xl transition-all duration-300 ease-in-out md:block hidden",
          outputPanelOpen && hasOutput ? "w-[320px] md:w-[450px]" : "w-0 border-l-0 opacity-0 pointer-events-none"
        )}
      >
        <div className="w-[320px] md:w-[450px] h-screen flex flex-col">
          <div className="flex items-center justify-between px-3 md:px-4 py-2.5 md:py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
              <span className="text-xs md:text-sm font-medium">Output</span>
              {(activeAction || queueRunning) && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOutputPanelOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4">
            {validationResult && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4">
                  <div className="flex items-center gap-2">
                    {validationResult.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-rose-500 dark:text-rose-400" />
                    )}
                    <CardTitle className="text-xs md:text-sm font-bold text-foreground">
                      Validation {validationResult.passed ? 'Passed' : 'Failed'}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead className="text-xs">Check</TableHead>
                          <TableHead className="text-xs">Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {validationResult.checks.map((check, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              {check.passed ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <AlertCircle className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400" />
                              )}
                            </TableCell>
                            <TableCell className="text-xs font-medium">{check.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{check.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
            {buildOutput && (
              <BuildLog
                output={buildOutput}
                isRunning={!!activeAction || queueRunning}
              />
            )}
          </div>
        </div>
      </aside>

      {/* Mobile top header & left side drawer navigation */}
      <MobileNav
        activeTab={showAddProject ? 'projects' : activeTab}
        onTabChange={(tab) => {
          if (tab === 'projects') {
            setShowAddProject(true);
          } else {
            setShowAddProject(false);
            setActiveTab(tab);
          }
        }}
        onAddProject={() => setShowAddProject(true)}
        projectRefreshKey={projectRefreshKey}
      />
    </div>
  );
}
