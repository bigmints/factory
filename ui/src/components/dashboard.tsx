'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Sidebar, MobileNav } from '@/components/sidebar';
import { AddProject } from '@/components/add-project';
import { SpecCard } from '@/components/spec-card';
import { SpecEditor } from '@/components/spec-editor';
import { SpecChat } from '@/components/spec-chat';
import { BuildLog } from '@/components/build-log';
import { ReportViewer } from '@/components/report-viewer';
import { QueueView } from '@/components/queue-view';
import { KnowledgeView } from '@/components/knowledge-view';
import { SettingsView } from '@/components/settings-view';
import { SkillsView } from '@/components/skills-view';
import { Skeleton } from '@/components/ui/skeleton';
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
import { FileText, Package, CheckCircle2, AlertCircle, Activity, Puzzle, Globe, ListOrdered, X, Terminal, FolderOpen, Plug, Plus, Loader2 as Spinner, Sparkles, Rocket } from 'lucide-react';


interface Spec {
  file: string;
  valid: boolean;
  status: string;
  metadata: Record<string, any>;
  deployment?: Record<string, any>;
  database?: Record<string, any>;
  api?: Record<string, any>;
  features?: Record<string, any>;
}

interface FeatureSpecItem {
  file: string;
  kind: 'FeatureSpec';
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

const VALID_TABS = ['dashboard', 'queue', 'specs', 'skills', 'reports', 'knowledge', 'projects', 'integrations', 'settings'];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showAddProject, setShowAddProject] = useState(false);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [featureSpecs, setFeatureSpecs] = useState<FeatureSpecItem[]>([]);
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
  const [editingSpec, setEditingSpec] = useState<{ file: string; name: string } | null>(null);
  const [showSpecChat, setShowSpecChat] = useState(false);
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
        map[item.spec_file] = { status: item.status, id: item.id };
      }
      setQueueStatusMap(map);
      const running = (data.items || []).some((i: any) => i.status === 'running');
      setQueueRunning(running || data.isRunning || false);
    } catch {}
  }, []);

  const fetchSpecs = useCallback(async () => {
    try {
      const res = await fetch('/api/specs');
      const data = await res.json();
      setSpecs(data.specs || []);
      setFeatureSpecs(data.featureSpecs || []);
    } catch {
      console.error('Failed to fetch specs');
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
    Promise.all([fetchProjects(), fetchSpecs(), fetchReports(), fetchQueueStatus()]).finally(() => setLoading(false));
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '');
      if (VALID_TABS.includes(hash)) {
        if (hash === 'projects') {
          setShowAddProject(true);
        } else {
          setActiveTab(hash);
        }
      }
    }

  }, [fetchProjects, fetchSpecs, fetchReports, fetchQueueStatus]);

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
        body: JSON.stringify({ specFile: file }),
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
    setBuildOutput('Enqueuing spec...\n');
    setOutputPanelOpen(true);
    try {
      const enqueueRes = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specFile: file, kind: 'AppSpec', engine: buildEngine }),
      });
      const enqueueData = await enqueueRes.json();
      if (!enqueueRes.ok) {
        setBuildOutput(`Enqueue failed: ${enqueueData.error || 'Unknown error'}`);
        toast.error('Failed to enqueue', { description: enqueueData.error });
        return;
      }
      setBuildOutput('Spec queued. Starting build queue...\n');
      toast.success('Spec queued', { description: file });
      const startRes = await fetch('/api/queue/start', { method: 'POST' });
      const startData = await startRes.json();
      if (!startRes.ok) {
        setBuildOutput(`Queue start failed: ${startData.error || 'Unknown error'}`);
        toast.error('Queue start failed', { description: startData.error });
        return;
      }
      const output = startData.results
        ?.map((r: any) => `[${r.status.toUpperCase()}] ${r.specFile}\n${r.output || r.error || ''}`)
        .join('\n\n') || 'Queue processed';
      setBuildOutput(output);
      await fetchSpecs();
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
          body: JSON.stringify({ specFile: file, kind: 'FeatureSpec', engine: buildEngine }),
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
          ?.map((r: any) => `[${r.status.toUpperCase()}] ${r.specFile}\n${r.output || r.error || ''}`)
          .join('\n\n') || 'Queue processed';
        setBuildOutput(output);
        await fetchSpecs();
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
          body: JSON.stringify({ specFile: file, action: 'validate' }),
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

  const handleEnqueue = async (specFile: string, kind: string, opts?: { phase?: number; dependsOn?: string[] }) => {
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specFile, kind, phase: opts?.phase, dependsOn: opts?.dependsOn, engine: buildEngine }),
      });
      const data = await res.json();
      if (res.ok) {
        setBuildOutput(`✓ Added "${specFile}" to build queue`);
        toast.success('Added to queue', { description: specFile });
        fetchQueueStatus();
        setActiveTab('queue');
      } else {
        setBuildOutput(`✗ ${data.error}`);
        toast.error('Failed to enqueue', { description: data.error });
      }
    } catch {
      setBuildOutput('Failed to enqueue spec');
      toast.error('Failed to enqueue spec');
    }
  };

  const handleBuildAll = async () => {
    setIsBuildingAll(true);
    let enqueued = 0;
    let skipped = 0;
    let errors = 0;
    try {
      for (const spec of specs) {
        try {
          const valRes = await fetch('/api/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ specFile: spec.file, quick: true }),
          });
          const valData = await valRes.json();
          if (!valRes.ok || !valData.passed) {
            skipped++;
            toast.warning(`Skipped: ${spec.metadata?.name || spec.file}`, {
              description: `YAML issue: ${valData.errors?.[0] || valData.checks?.find((c: any) => !c.passed)?.message || 'Validation failed'}`,
            });
            continue;
          }
          const res = await fetch('/api/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ specFile: spec.file, kind: 'AppSpec', phase: 0, dependsOn: [], buildAll: true, engine: buildEngine }),
          });
          if (res.ok) enqueued++;
          else {
            const data = await res.json();
            if (res.status !== 409) { errors++; toast.error(`Failed: ${spec.file}`, { description: data.error }); }
          }
        } catch { errors++; }
      }
      const sortedFeatures = [...featureSpecs].sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0));
      for (const fs of sortedFeatures) {
        try {
          const valRes = await fetch('/api/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ specFile: fs.file, quick: true }),
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
              specFile: fs.file,
              kind: 'FeatureSpec',
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
        toast.success(`Queued ${enqueued} spec${enqueued !== 1 ? 's' : ''}`, {
          description: parts.length > 0 ? parts.join(', ') : 'Switch to Queue tab to start processing',
        });
        setActiveTab('queue');
        fetchQueueStatus();
      } else if (errors > 0 || skipped > 0) {
        toast.error(`No specs queued`, { description: parts.join(', ') });
      } else {
        toast.info('All specs are already in the queue');
        setActiveTab('queue');
      }
    } catch { toast.error('Build All failed'); }
    finally { setIsBuildingAll(false); }
  };

  // ─── Render: Dashboard ──────────────────────────────────
  const renderDashboard = () => (
    <div className="space-y-6 md:space-y-8">
      {activeProject && (
        <div className="glass-panel rounded-2xl glow-blue p-5 md:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="relative flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20">
              <FolderOpen className="h-5 w-5 md:h-6 md:w-6 text-blue-400" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm md:text-base font-bold truncate flex items-center gap-1.5">
                {activeProject.name}
              </p>
              <p className="text-[10px] md:text-xs text-muted-foreground font-mono truncate">{activeProject.path}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 sm:mt-0 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleBuildAll()}
              disabled={isBuildingAll}
              className="tap-shrink text-xs font-semibold h-8 rounded-xl px-3 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 gap-1.5"
            >
              {isBuildingAll ? <Spinner className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
              Build All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSpecChat(true)}
              className="tap-shrink text-xs font-semibold h-8 rounded-xl px-3 gap-1.5"
            >
              <Sparkles className="h-3 w-3 text-purple-400" />
              New Spec
            </Button>
          </div>
        </div>
      )}

      {/* Stats row — 2 cols mobile, 4 cols desktop with premium spacing & larger cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {[
          { icon: FileText, glowClass: 'glow-blue hover:border-blue-500/20', value: specs.length, label: 'App Specs', iconColor: 'text-blue-400', bgColor: 'bg-blue-500/10' },
          { icon: Activity, glowClass: 'glow-purple hover:border-purple-500/20', value: featureSpecs.length, label: 'Features', iconColor: 'text-purple-400', bgColor: 'bg-purple-500/10' },
          { icon: CheckCircle2, glowClass: 'glow-emerald hover:border-emerald-500/20', value: specs.filter((s) => s.status === 'ready' || s.status === 'done').length, label: 'Ready Specs', iconColor: 'text-emerald-400', bgColor: 'bg-emerald-500/10' },
          { icon: Package, glowClass: 'glass-panel border-muted-foreground/10 hover:border-muted-foreground/20', value: reportStats?.totalBuilds || 0, label: 'Total Builds', iconColor: 'text-muted-foreground', bgColor: 'bg-muted/40' },
        ].map((stat, i) => (
          <div key={i} className={cn("glass-panel rounded-2xl p-5 md:p-6 transition-all duration-300 hover:shadow-md tap-shrink", stat.glowClass)}>
            <div className="flex items-center gap-4">
              <div className={cn("flex h-11 w-11 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-2xl", stat.bgColor)}>
                <stat.icon className={cn("h-5 md:h-6 w-5 md:w-6", stat.iconColor)} />
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-xl md:text-2xl font-black tracking-tight leading-none">{stat.value}</p>
                <p className="text-[10px] md:text-xs text-muted-foreground font-bold truncate uppercase tracking-wider">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Spec Queue Header Block & Cards Grid (No double nesting!) */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="space-y-1">
            <h2 className="text-base md:text-lg font-bold tracking-tight flex items-center gap-2">
              <ListOrdered className="h-4.5 w-4.5 text-blue-400" />
              Spec Queue
            </h2>
            <p className="text-xs text-muted-foreground">
              Connected application specs queued for direct compilation and validation.
            </p>
          </div>
          {specs.length > 0 && (
            <Badge variant="outline" className="text-[10px] md:text-xs font-semibold bg-blue-500/5 border-blue-500/20 text-blue-400 w-fit shrink-0">
              {specs.length} Apps Active
            </Badge>
          )}
        </div>

        {specs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 glass-panel py-8 md:py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No specs found. Add YAML files to the specs/ directory.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {specs.map((spec) => (
              <SpecCard
                key={spec.file}
                spec={spec}
                onValidate={handleValidate}
                onBuild={handleBuild}
                onEnqueue={handleEnqueue}
                onView={(file, name) => setEditingSpec({ file, name })}
                isValidating={activeAction?.type === 'validate' && activeAction?.file === spec.file}
                isBuilding={activeAction?.type === 'build' && activeAction?.file === spec.file}
              />
            ))}
          </div>
        )}
      </div>

      {/* Validation & Build output */}
      {(validationResult || buildOutput) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {validationResult && (
            <div className="glass-panel rounded-2xl border border-border/40 p-5 md:p-6 space-y-4 glow-blue">
              <div className="flex items-center gap-2">
                {validationResult.passed ? (
                  <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-4.5 w-4.5 text-rose-400" />
                )}
                <h4 className="text-sm font-bold text-foreground">
                  Validation {validationResult.passed ? 'Passed' : 'Failed'}
                </h4>
                <Badge variant={validationResult.passed ? 'default' : 'destructive'} className="ml-auto text-[10px] font-bold">
                  {validationResult.checks.filter((c) => c.passed).length}/{validationResult.checks.length}
                </Badge>
              </div>
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
                            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{check.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{check.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          {buildOutput && (
            <BuildLog
              output={buildOutput}
              isRunning={activeAction?.type === 'build'}
            />
          )}
        </div>
      )}
    </div>
  );

  // ─── Render: Specs ──────────────────────────────────────
  const renderSpecs = () => {
    if (editingSpec) {
      return (
        <SpecEditor
          specFile={editingSpec.file}
          specName={editingSpec.name}
          onClose={() => setEditingSpec(null)}
          onSaved={() => fetchSpecs()}
        />
      );
    }

    return (
      <div className="space-y-8">
        {/* Header row & control bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-muted/20 border border-border/40 p-5 md:p-6 rounded-2xl">
          <div className="flex flex-wrap items-center gap-4 text-xs md:text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
              <span className="font-bold text-foreground">{specs.length}</span> App Specs
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
              <span className="font-bold text-foreground">{featureSpecs.length}</span> Feature Specs
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center border rounded-xl h-9 overflow-x-auto text-xs bg-background/50 p-1 shrink-0">
              <span className="text-[10px] text-muted-foreground font-bold px-2 uppercase tracking-wider">Engine:</span>
              <button
                className={`px-3 py-1 rounded-lg transition-all text-[11px] font-semibold shrink-0 ${buildEngine === 'factory' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
                onClick={() => setBuildEngine('factory')}
              >
                Factory
              </button>
            </div>
            
            <Button
              size="sm"
              variant="outline"
              onClick={handleBuildAll}
              disabled={isBuildingAll || (specs.length === 0 && featureSpecs.length === 0)}
              className="h-9 text-xs gap-1.5 rounded-xl border-border/50 hover:bg-muted/80 font-semibold"
            >
              {isBuildingAll ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              <span>Build All</span>
            </Button>
            
            <Button
              size="sm"
              onClick={() => setShowSpecChat(true)}
              className="h-9 text-xs gap-1.5 rounded-xl font-bold bg-primary hover:bg-primary/95 text-primary-foreground shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Spec</span>
            </Button>
          </div>
        </div>

        <SpecChat open={showSpecChat} onOpenChange={setShowSpecChat} onSpecSaved={() => fetchSpecs()} />

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[180px] rounded-2xl" />
            ))}
          </div>
        ) : specs.length === 0 && featureSpecs.length === 0 ? (
          <div className="glass-panel rounded-2xl border border-dashed border-border/60 p-6 sm:p-10 text-center glow-purple">
            <FileText className="h-10 w-10 md:h-12 md:w-12 mx-auto mb-3 md:mb-4 text-muted-foreground/30" />
            <p className="text-sm font-semibold text-foreground">No specs found</p>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">
              Add YAML files to specs/apps/ or specs/features/ to get started
            </p>
          </div>
        ) : (
          <div className="space-y-8 md:space-y-10">
            {/* App Specs Section */}
            {specs.length > 0 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h3 className="text-base md:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                    <Globe className="h-4.5 w-4.5 text-blue-400" />
                    App Specifications
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Core backend structure, schemas, and cloud resources.
                  </p>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                  {specs.map((spec) => (
                    <SpecCard
                      key={spec.file}
                      spec={spec}
                      onValidate={handleValidate}
                      onBuild={handleBuild}
                      onEnqueue={handleEnqueue}
                      onView={(file, name) => setEditingSpec({ file, name })}
                      isValidating={activeAction?.type === 'validate' && activeAction?.file === spec.file}
                      isBuilding={activeAction?.type === 'build' && activeAction?.file === spec.file}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Feature Specs Section */}
            {featureSpecs.length > 0 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h3 className="text-base md:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                    <Puzzle className="h-4.5 w-4.5 text-purple-400" />
                    Feature Specifications
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Sequenced features, UI pages, logic flows, and user experiences.
                  </p>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                  {featureSpecs.map((fs) => (
                    <SpecCard
                      key={fs.file}
                      spec={{ ...fs, kind: 'FeatureSpec' }}
                      onValidate={(file) => handleFeatureAction(file, 'validate')}
                      onBuild={(file) => handleFeatureAction(file, 'build')}
                      onEnqueue={handleEnqueue}
                      onView={(file, name) => setEditingSpec({ file, name })}
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
  const showOutputButton = ((activeTab === 'specs' || activeTab === 'queue') && hasOutput && !outputPanelOpen);

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
      />

      <main className="flex-1 overflow-auto pb-16 md:pb-0">
        {showAddProject ? (
          <div className="p-4 md:p-8 h-full">
            <AddProject onProjectAdded={() => {
              setShowAddProject(false);
              setHasProjects(true);
              setProjectRefreshKey((k) => k + 1);
              fetchProjects();
              fetchSpecs();
              fetchReports();
            }} />
          </div>
        ) : (
          <div className="p-4 md:p-8">
            {/* Page header */}
            {['dashboard', 'specs', 'skills', 'reports', 'integrations', 'settings'].includes(activeTab) && (
              <div className="mb-4 md:mb-8 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <div>
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                    {activeTab === 'dashboard' && 'Dashboard'}
                    {activeTab === 'specs' && 'Specs'}
                    {activeTab === 'skills' && 'Skills'}
                    {activeTab === 'reports' && 'Reports'}
                    {activeTab === 'integrations' && 'Integrations'}
                    {activeTab === 'settings' && 'Settings'}
                  </h1>
                  <p className="text-xs md:text-sm text-muted-foreground mt-1">
                    {activeTab === 'dashboard' && 'Overview for the active project'}
                    {activeTab === 'specs' && 'Manage your app specifications'}
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
            {activeTab === 'specs' && renderSpecs()}
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

      {/* Output panel — desktop: sidebar, mobile: bottom sheet */}
      <aside
        className={`border-l border-border bg-background/95 backdrop-blur-sm transition-all duration-300 ease-in-out overflow-hidden ${
          outputPanelOpen && hasOutput ? 'w-[320px] md:w-[420px]' : 'w-0'
        } md:block hidden`}
      >
        <div className="w-[320px] md:w-[420px] h-screen flex flex-col">
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
              <div className="glass-panel rounded-2xl border border-border/40 p-4 md:p-5 space-y-3 glow-blue">
                <div className="flex items-center gap-2">
                  {validationResult.passed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-rose-400" />
                  )}
                  <h4 className="text-xs md:text-sm font-bold text-foreground">
                    Validation {validationResult.passed ? 'Passed' : 'Failed'}
                  </h4>
                </div>
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
                              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-medium">{check.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{check.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
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

      {/* Mobile bottom navigation */}
      <MobileNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onAddProject={() => setShowAddProject(true)}
        projectRefreshKey={projectRefreshKey}
      />
    </div>
  );
}
