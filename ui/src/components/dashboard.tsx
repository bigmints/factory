'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Sidebar, MobileNav } from '@/components/sidebar';
import { AddProject } from '@/components/add-project';
import { BuildLog } from '@/components/build-log';
import { ReportViewer } from '@/components/report-viewer';
import { KnowledgeView } from '@/components/knowledge-view';
import { TestPlaceholder } from '@/components/test-placeholder';
import { DeployPlaceholder } from '@/components/deploy-placeholder';
import { SettingsView } from '@/components/settings-view';
import { SkillsView } from '@/components/skills-view';
import { NotionBoard } from '@/components/notion-board';
import { BuildPage } from '@/components/build-page';
import { TpmChat } from '@/components/tpm-chat';
import { IntegrationsView } from '@/components/integrations-view';
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
import { FileText, Package, CheckCircle2, AlertCircle, Activity, Puzzle, Globe, ListOrdered, X, Terminal, Plug, Plus, Loader2 as Spinner, Sparkles, Rocket, Compass, LayoutDashboard } from 'lucide-react';


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

const VALID_TABS = ['plan', 'tpm', 'build', 'test', 'deploy', 'roadmap', 'queue', 'dashboard', 'skills', 'reports', 'knowledge', 'projects', 'integrations', 'settings'];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('plan');
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
  const [isBuildingAll, setIsBuildingAll] = useState(false);
  const [queueStatusMap, setQueueStatusMap] = useState<Record<string, { status: string; id: string }>>({});
  const [queueRunning, setQueueRunning] = useState(false);

  const logOffsetRef = useRef(0);

  const fetchQueueStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      const map: Record<string, { status: string; id: string }> = {};
      for (const item of (data.items || [])) {
        // API returns camelCase: storyFile / specFile
        const file = item.storyFile || item.specFile || item.story_file || item.spec_file;
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
      if (hash === 'roadmap' || hash === 'stories' || hash === 'dashboard') {
        setActiveTab('plan');
      } else if (hash === 'queue') {
        setActiveTab('build');
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
        body: JSON.stringify({ storyFile: file, specFile: file, kind: 'AppStory', engine: 'factory' }),
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
          body: JSON.stringify({ storyFile: file, specFile: file, kind: 'FeatureStory', engine: 'factory' }),
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
        body: JSON.stringify({ storyFile, specFile: storyFile, kind, phase: opts?.phase, dependsOn: opts?.dependsOn, engine: 'factory' }),
      });
      const data = await res.json();
      if (res.ok) {
        setBuildOutput(`✓ Added "${storyFile}" to build queue`);
        toast.success('Added to queue', { description: storyFile });
        fetchQueueStatus();
        setActiveTab('build');
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
            body: JSON.stringify({ storyFile: story.file, specFile: story.file, kind: 'AppStory', phase: 0, dependsOn: [], buildAll: true, engine: 'factory' }),
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
              engine: 'factory',
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
          description: parts.length > 0 ? parts.join(', ') : 'Switch to Build tab to start processing',
        });
        setActiveTab('build');
        fetchQueueStatus();
      } else if (errors > 0 || skipped > 0) {
        toast.error(`No stories queued`, { description: parts.join(', ') });
      } else {
        toast.info('All stories are already in the queue');
        setActiveTab('build');
      }
    } catch { toast.error('Build All failed'); }
    finally { setIsBuildingAll(false); }
  };

  // Removed old render functions - fully replaced by NotionBoard

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

  // ─── Render: Output Content (shared between desktop panel and mobile sheet) ──
  const OutputContent = ({
    validationResult: vr,
    buildOutput: bo,
    activeAction: aa,
    queueRunning: qr,
  }: {
    validationResult: typeof validationResult;
    buildOutput: string;
    activeAction: typeof activeAction;
    queueRunning: boolean;
  }) => (
    <>
      {vr && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4">
            <div className="flex items-center gap-2">
              {vr.passed ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-500 dark:text-rose-400" />
              )}
              <CardTitle className="text-sm font-bold text-foreground">
                Validation {vr.passed ? 'Passed' : 'Failed'}
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
                  {vr.checks.map((check, i) => (
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
      {bo && (
        <BuildLog
          output={bo}
          isRunning={!!aa || qr}
        />
      )}
    </>
  );

  const handleNavChange = (tab: string) => {
    setShowAddProject(false);
    setActiveTab(tab);
  };

  // ─── Derived state ───────────────────────────────────────
  const hasOutput = !!(buildOutput || validationResult);
  const showOutputButton = hasOutput || queueRunning;

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

      <main className="flex-1 min-h-0 pt-12 md:pt-0 overflow-auto">
        {showAddProject ? (
          <div className="p-4 md:p-8 w-full h-full">
            <AddProject
              onProjectAdded={() => {
                setShowAddProject(false);
                setHasProjects(true);
                setProjectRefreshKey((k) => k + 1);
                fetchProjects();
                fetchStories();
                fetchReports();
              }}
              onNavigateToPlan={() => {
                setShowAddProject(false);
                setActiveTab('plan');
              }}
            />
          </div>
        ) : (
          <div className="w-full max-w-[1400px] mx-auto p-2 md:px-6 md:py-4">
            {/* Page header */}
            {['skills', 'reports', 'integrations', 'settings'].includes(activeTab) && (
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

            {activeTab === 'plan' && <NotionBoard initialView="list" onNavigateToBuild={() => setActiveTab('build')} projectRefreshKey={projectRefreshKey} onOpenStoryChat={() => setActiveTab('tpm')} className="flex-1 min-h-0" />}
            {activeTab === 'tpm' && <TpmChat />}
            {activeTab === 'build' && <BuildPage />}
            {activeTab === 'test' && <TestPlaceholder />}
            {activeTab === 'deploy' && <DeployPlaceholder />}
            {/* legacy hash compat */}
            {activeTab === 'dashboard' && <NotionBoard initialView="board" onNavigateToBuild={() => setActiveTab('build')} projectRefreshKey={projectRefreshKey} onOpenStoryChat={() => setActiveTab('tpm')} className="flex-1 min-h-0" />}
            {activeTab === 'skills' && <SkillsView />}
            {activeTab === 'reports' && renderReports()}
            {activeTab === 'knowledge' && <KnowledgeView />}
            {activeTab === 'integrations' && <IntegrationsView />}
            {activeTab === 'settings' && <SettingsView />}
          </div>
        )}
      </main>

      {/* Output panel — desktop: slide-over overlay, mobile: bottom sheet */}
      {/* Desktop panel */}
      <aside
        className={cn(
          "fixed right-0 top-0 h-screen z-50 border-l border-border bg-background/85 backdrop-blur-md shadow-2xl transition-all duration-300 ease-in-out hidden md:block",
          outputPanelOpen && hasOutput ? "w-[450px]" : "w-0 border-l-0 opacity-0 pointer-events-none"
        )}
      >
        <div className="w-[450px] h-screen flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Output</span>
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
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <OutputContent validationResult={validationResult} buildOutput={buildOutput} activeAction={activeAction} queueRunning={queueRunning} />
          </div>
        </div>
      </aside>

      {/* Mobile bottom sheet output */}
      {outputPanelOpen && hasOutput && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setOutputPanelOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-background border-t border-border rounded-t-2xl max-h-[75vh] flex flex-col"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Output</span>
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
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              <OutputContent validationResult={validationResult} buildOutput={buildOutput} activeAction={activeAction} queueRunning={queueRunning} />
            </div>
          </div>
        </div>
      )}

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
        onNewStory={() => {
          setActiveTab('tpm');
        }}
      />
    </div>
  );
}
