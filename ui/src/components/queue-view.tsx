'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Play, Square, Trash2, RotateCcw, CheckCircle2, XCircle, Clock, Loader2,
  AlertTriangle, ChevronDown, ChevronRight, Zap, FileCode2, Brain, FlaskConical,
  Wrench, ShieldCheck, FolderOpen, Terminal, Sparkles, RefreshCw,
} from 'lucide-react';

interface QueueItem {
  id: string;
  spec_file?: string;
  story_file?: string;
  specFile?: string;
  storyFile?: string;
  kind: string;
  status: string;
  priority: number;
  engine?: string;
  added_at?: string;
  addedAt?: string;
  started_at?: string | null;
  startedAt?: string | null;
  completed_at?: string | null;
  completedAt?: string | null;
  output: string;
  error: string | null;
  duration_ms?: number | null;
  durationMs?: number | null;
}

interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  'needs-attention': number;
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

const statusConfig: Record<string, { label: string; color: string; glowClass: string; icon: any; bg: string }> = {
  pending: { label: 'Pending', color: 'text-muted-foreground', glowClass: 'border-border shadow-sm', icon: Clock, bg: 'bg-muted' },
  running: { label: 'Running', color: 'text-primary', glowClass: 'border-border shadow-sm', icon: Loader2, bg: 'bg-muted' },
  completed: { label: 'Completed', color: 'text-emerald-500', glowClass: 'border-border shadow-sm', icon: CheckCircle2, bg: 'bg-muted' },
  failed: { label: 'Failed', color: 'text-rose-500 dark:text-rose-400', glowClass: 'border-rose-200 dark:border-rose-950 shadow-sm', icon: XCircle, bg: 'bg-rose-500/5 dark:bg-rose-950/15' },
  'needs-attention': { label: 'Attention', color: 'text-amber-500 dark:text-amber-400', glowClass: 'border-amber-200 dark:border-amber-950 shadow-sm', icon: AlertTriangle, bg: 'bg-amber-500/5 dark:bg-amber-950/15' },
};

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

    if (line.startsWith('🏭') || /^[═─]{5,}/.test(line)) continue;

    const tokenMatch = line.match(/^\s*Tokens\s+generated:\s*(\d+)/i);
    if (tokenMatch && current) { current.substeps.push({ text: `${tokenMatch[1]} tokens generated`, status: 'info' }); }

    if (line.length > 0 && current) { current.details.push(line); }
  }
  pushCurrent();
  return steps;
}

function getStepIcon(label: string): any {
  const l = label.toLowerCase();
  if (l.includes('validat')) return ShieldCheck;
  if (l.includes('gather') || l.includes('context')) return FolderOpen;
  if (l.includes('plan')) return Brain;
  if (l.includes('generat') || l.includes('code')) return FileCode2;
  if (l.includes('test') || l.includes('running')) return FlaskConical;
  if (l.includes('writ') || l.includes('file')) return FileCode2;
  if (l.includes('commit') || l.includes('push') || l.includes('git')) return Sparkles;
  if (l.includes('feed') || l.includes('iterat') || l.includes('fix')) return RefreshCw;
  if (l.includes('install') || l.includes('npm') || l.includes('pnpm')) return Terminal;
  if (l.includes('lint') || l.includes('eslint')) return Wrench;
  if (l.includes('tsc') || l.includes('typescript')) return Wrench;
  return Zap;
}

function CircularProgress({ completed, total }: { completed: number; total: number }) {
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const strokeDashoffset = 100 - progress;
  return (
    <svg className="-rotate-90 scale-y-[-1]" height="16" width="16" viewBox="0 0 14 14">
      <circle className="stroke-muted" cx="7" cy="7" fill="none" r="6" strokeWidth="2" pathLength="100" />
      <circle className="stroke-primary" cx="7" cy="7" fill="none" r="6" strokeWidth="2" pathLength="100" strokeDasharray="100" strokeLinecap="round" style={{ strokeDashoffset }} />
    </svg>
  );
}

function StepIndicator({ status, isActive }: { status: 'success' | 'error' | 'running' | 'info' | 'warning'; isActive: boolean }) {
  if (status === 'success') return <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald-500" />;
  if (status === 'error') return <XCircle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-rose-500 dark:text-rose-400" />;
  if (status === 'warning') return <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-500 dark:text-amber-400 animate-pulse" />;
  if (status === 'running' && isActive) return <Loader2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary animate-spin" />;
  return <div className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted-foreground/30 bg-muted" />;
}

function ActivityTimeline({ output, error, itemStatus }: { output: string; error: string | null; itemStatus: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const [openStepId, setOpenStepId] = useState<string | null>(null);

  const activities = useMemo(() => {
    const steps = parseActivities(output);
    if (itemStatus === 'failed' && steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      if (lastStep.status === 'running') lastStep.status = 'error';
    }
    if (itemStatus === 'completed') { for (const s of steps) { if (s.status === 'running') s.status = 'success'; } }
    return steps;
  }, [output, itemStatus]);

  useEffect(() => {
    const errorStep = activities.find(s => s.status === 'error');
    const runningStep = activities.find(s => s.status === 'running');
    if (errorStep) setOpenStepId(errorStep.id);
    else if (runningStep) setOpenStepId(runningStep.id);
  }, [activities]);

  const completedCount = activities.filter(s => s.status === 'success').length;

  if (activities.length === 0 && !error) {
    return output ? (
      <div className="rounded-xl border bg-card text-card-foreground p-3 max-h-64 overflow-y-auto">
        <pre className="text-[10px] sm:text-xs font-mono text-foreground/80 whitespace-pre-wrap">{output}</pre>
      </div>
    ) : null;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card text-card-foreground p-5 md:p-6 shadow-sm relative overflow-hidden">
        <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-xs sm:text-sm font-semibold tracking-wide text-foreground">Build Pipeline Activities</h4>
          </div>
          <div className="flex items-center gap-2 bg-muted px-2.5 py-1 rounded-full border border-border">
            <CircularProgress completed={completedCount} total={activities.length} />
            <span className="text-[10px] sm:text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{completedCount}</span>
              {' / '}<span className="font-semibold text-foreground">{activities.length}</span> steps
            </span>
          </div>
        </div>

        <ScrollArea className="max-h-[450px] pr-1">
          <div className="space-y-2.5 relative before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
            {activities.map((step, index) => {
              const isOpen = openStepId === step.id;
              const StepIcon = step.icon;

              return (
                <div key={step.id} className="relative transition-all duration-300">
                  <div className={`relative overflow-hidden rounded-lg transition-all duration-200 ${
                    isOpen ? 'border border-border bg-muted shadow-sm' : 'hover:bg-muted'
                  }`}>
                    <div className="flex items-start gap-3 py-3.5 px-4">
                      <div className="shrink-0 relative z-10 bg-background rounded-full p-0.5">
                        <StepIndicator status={step.status} isActive={itemStatus === 'running'} />
                      </div>
                      <div className="grow min-w-0">
                        <button
                          onClick={() => setOpenStepId(isOpen ? null : step.id)}
                          className="flex items-center justify-between w-full text-left gap-2 cursor-pointer outline-none"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {StepIcon && <StepIcon className={`h-4 w-4 shrink-0 ${
                              step.status === 'success' ? 'text-emerald-500' :
                              step.status === 'error' ? 'text-rose-500 dark:text-rose-400' :
                              step.status === 'warning' ? 'text-amber-500 dark:text-amber-400' :
                              step.status === 'running' && itemStatus === 'running' ? 'text-primary animate-pulse' :
                              'text-muted-foreground'
                            }`} />}
                            <h4 className={`text-xs sm:text-sm font-medium truncate ${
                              step.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' :
                              step.status === 'error' ? 'text-rose-600 dark:text-rose-400' :
                              step.status === 'warning' ? 'text-amber-600 dark:text-amber-400' :
                              step.status === 'running' && itemStatus === 'running' ? 'text-primary' :
                              'text-foreground/90'
                            }`}>{step.label}</h4>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                             {step.status === 'success' && <Badge variant="outline" className="text-[9px] border-emerald-500 text-emerald-500 bg-emerald-500/5 dark:bg-emerald-950/10 px-1.5 py-0 rounded-md font-medium">Done</Badge>}
                             {step.status === 'error' && <Badge variant="outline" className="text-[9px] border-rose-500 text-rose-500 dark:border-rose-400/30 dark:text-rose-400 bg-rose-500/5 dark:bg-rose-950/10 px-1.5 py-0 rounded-md font-medium">Failed</Badge>}
                             {step.status === 'warning' && <Badge variant="outline" className="text-[9px] border-amber-500 text-amber-500 dark:border-amber-400/30 dark:text-amber-400 bg-amber-500/5 dark:bg-amber-950/10 px-1.5 py-0 rounded-md font-medium">Warning</Badge>}
                             {step.status === 'running' && itemStatus === 'running' && <Badge variant="outline" className="text-[9px] border-primary text-primary bg-primary/5 px-1.5 py-0 rounded-md font-medium animate-pulse">Active</Badge>}
                             <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200 ${isOpen ? 'rotate-90 text-foreground' : ''}`} />
                           </div>
                        </button>

                        {isOpen && (
                          <div className="mt-3 space-y-2 border-t border-border/20 pt-2.5 text-left animate-in fade-in slide-in-from-top-1 duration-200">
                            {step.substeps.length > 0 && (
                              <div className="space-y-1.5 pl-1">
                                {step.substeps.map((sub, si) => (
                                  <div key={si} className="flex items-start gap-2 text-[10px] sm:text-xs">
                                    {sub.status === 'success' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />}
                                    {sub.status === 'error' && <XCircle className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" />}
                                    {sub.status === 'warning' && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 mt-0.5 shrink-0" />}
                                    {sub.status === 'info' && <ChevronRight className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />}
                                    <span className={
                                      sub.status === 'error' ? 'text-rose-600 dark:text-rose-400 font-medium' :
                                      sub.status === 'warning' ? 'text-amber-600 dark:text-amber-400 font-medium' :
                                      'text-muted-foreground'
                                    }>{sub.text}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {step.details.length > 0 && (step.status === 'error' || step.status === 'warning') && (
                              <div className={`rounded-lg border p-3 max-h-60 overflow-y-auto mt-2 font-mono text-[10px] sm:text-[11px] leading-relaxed shadow-inner ${
                                step.status === 'error'
                                  ? 'bg-rose-500/5 dark:bg-rose-950/20 border-rose-200/50 dark:border-rose-900/40 text-rose-600 dark:text-rose-300'
                                  : 'bg-amber-500/5 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-900/40 text-amber-600 dark:text-amber-300'
                              }`}>
                                <pre className="whitespace-pre-wrap font-mono">{step.details.join('\n')}</pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-500/5 dark:bg-rose-950/15 p-4 md:p-5 relative overflow-hidden shadow-sm">
          <div className="absolute left-0 top-0 h-full w-1 bg-rose-500" />
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-rose-500 dark:text-rose-400" />
            <p className="text-xs sm:text-sm text-rose-600 dark:text-rose-400 font-semibold">Error Log Details</p>
          </div>
          <pre className="text-[10px] sm:text-xs font-mono whitespace-pre-wrap bg-background/50 dark:bg-black/40 p-3 rounded-lg border border-rose-200/40 dark:border-rose-900/30 text-rose-600 dark:text-rose-300 max-h-64 overflow-y-auto leading-relaxed">{error}</pre>
        </div>
      )}

      {output && (
        <div className="flex flex-col items-start">
          <Button variant="ghost" size="sm" onClick={() => setShowRaw(!showRaw)} className="text-[10px] text-muted-foreground hover:text-foreground h-7 px-2.5 rounded-full bg-muted hover:bg-secondary border border-border">
            <Terminal className="h-3.5 w-3.5 mr-1 text-sky-400" />
            {showRaw ? 'Hide Raw Build Log' : 'Show Raw Build Log'}
          </Button>
          {showRaw && (
            <div className="rounded-xl bg-card border p-3 sm:p-4 max-h-80 w-full overflow-y-auto mt-2 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
              <pre className="text-[10px] sm:text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface QueueViewProps {
  onToggleOutput?: () => void;
  outputPanelOpen?: boolean;
  queueRunning?: boolean;
}

export function QueueView({ onToggleOutput, outputPanelOpen, queueRunning }: QueueViewProps = {}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<QueueStats>({ pending: 0, running: 0, completed: 0, failed: 0, 'needs-attention': 0, total: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // ── Story name resolution ──────────────────────────────────────────────
  // Build a slug → human-readable name map from both /api/stories and /api/app-rollup
  const [storyNameMap, setStoryNameMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const getSlugLocal = (path: string) => (path.split('/').pop() || '').replace(/\.ya?ml$/i, '');
    async function loadNames() {
      const map = new Map<string, string>();
      try {
        // 1. Physical story files — metadata.name / feature.name
        const res = await fetch('/api/stories');
        if (res.ok) {
          const data = await res.json();
          const allStories = [...(data.stories || []), ...(data.featureStories || [])];
          for (const s of allStories) {
            const slug = getSlugLocal(s.file || '');
            const name = s.metadata?.name || s.feature?.name || s.feature?.title || '';
            if (slug && name) map.set(slug, name);
          }
        }
      } catch { /* ignore */ }
      try {
        // 2. App rollup DB — dbName for stories that have it
        const res = await fetch('/api/app-rollup');
        if (res.ok) {
          const data = await res.json();
          for (const feature of (data.features || [])) {
            for (const s of (feature.stories || [])) {
              const slug = getSlugLocal(s.file || '');
              if (slug && s.name && !map.has(slug)) map.set(slug, s.name);
            }
          }
        }
      } catch { /* ignore */ }
      setStoryNameMap(map);
    }
    loadNames();
    const interval = setInterval(loadNames, 15_000);
    return () => clearInterval(interval);
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      setItems(data.items || []);
      setStats(data.stats || { pending: 0, running: 0, completed: 0, failed: 0, 'needs-attention': 0, total: 0 });
      setIsRunning(data.isRunning || false);
    } catch { console.error('Failed to fetch queue'); }
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const handleStart = async () => {
    try { await fetch('/api/queue/start', { method: 'POST' }); await fetchQueue(); } catch { console.error('Failed to start queue'); }
  };

  const handleStopAll = async () => {
    try { await fetch('/api/queue/stop', { method: 'POST' }); await fetchQueue(); } catch { console.error('Failed to stop queue'); }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch('/api/queue', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      await fetchQueue();
    } catch { console.error('Failed to remove item'); }
  };

  const handleRetry = async (id: string) => {
    try {
      await fetch(`/api/queue/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry' }) });
      await fetchQueue();
    } catch { console.error('Failed to retry item'); }
  };

  const handleClearAll = async () => {
    try { await fetch('/api/queue/clear', { method: 'POST' }); await fetchQueue(); } catch { console.error('Failed to clear queue'); }
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  const formatTime = (iso: string | undefined | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  /** Strip directory and .yaml extension to get a bare slug for matching. */
  const getSlug = (path: string) => (path.split('/').pop() || '').replace(/\.ya?ml$/i, '');

  /** Build a slug → display name map from story metadata. */
  const resolveStoryName = useCallback((rawPath: string): string => {
    const slug = getSlug(rawPath);
    if (storyNameMap.has(slug)) return storyNameMap.get(slug)!;
    return slug || rawPath;
  }, [storyNameMap]);

  return (
    <div className="space-y-6 pb-20 sm:pb-8">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border border-border bg-card/10 rounded-xl p-5">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">Build Queue</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Manage, prioritize, and execute your build specs autonomously</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onToggleOutput && (isRunning || queueRunning) && (
            <Button variant={outputPanelOpen ? 'default' : 'outline'} size="sm" onClick={onToggleOutput} className="text-xs gap-1.5 rounded-lg h-9">
              <Terminal className="h-4 w-4" />
              Output
              {(isRunning || queueRunning) && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              )}
            </Button>
          )}
          {stats.total > 0 && !isRunning && (
            <Button variant="outline" size="sm" onClick={handleClearAll} className="text-xs gap-1.5 rounded-lg h-9 border text-muted-foreground hover:text-foreground">
              <Trash2 className="h-4 w-4" />
              <span>Clear All ({stats.total})</span>
            </Button>
          )}
          {isRunning && (
            <Button variant="outline" size="sm" onClick={handleStopAll} className="text-xs gap-1.5 rounded-lg h-9 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground">
              <Square className="h-4 w-4" />
              <span>Stop Execution</span>
            </Button>
          )}
          <Button onClick={handleStart} disabled={isRunning || stats.pending === 0} size="sm" className="text-xs gap-1.5 h-9 font-semibold">
            {isRunning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /><span>Running Queue...</span></>
            ) : (
              <><Play className="h-4 w-4 fill-current" /><span>Start Build Queue ({stats.pending})</span></>
            )}
          </Button>
        </div>
      </div>

      {/* Collapse Stats into a clean inline horizontal summary */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground bg-muted/40 px-4 py-2.5 rounded-lg border border-border">
        <span className="font-semibold text-foreground">Summary:</span>
        <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> <span className="font-semibold text-foreground">{stats.pending}</span> pending</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin text-primary" /> <span className="font-semibold text-foreground">{stats.running}</span> running</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> <span className="font-semibold text-emerald-500">{stats.completed}</span> completed</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="flex items-center gap-1.5"><XCircle className="h-3 w-3 text-rose-500 dark:text-rose-400" /> <span className="font-semibold text-rose-500 dark:text-rose-400">{stats.failed}</span> failed</span>
      </div>

      {/* Queue items */}
      {items.length === 0 ? (
        <div className="bg-card/10 rounded-xl border border-dashed border-border p-6 sm:p-10 text-center">
          <div className="h-10 w-10 rounded-lg bg-muted border border-border flex items-center justify-center mx-auto mb-3">
            <Clock className="h-5 w-5 text-muted-foreground/60" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Build queue is empty</h3>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5 leading-relaxed">Go to the Stories panel and configure your build stories to load items here.</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl divide-y divide-border/60 bg-card/10 overflow-hidden">
          {items.map((item) => {
            const cfg = statusConfig[item.status] || statusConfig.pending;
            const Icon = cfg.icon;
            const isExpanded = expandedItem === item.id;

            return (
              <div key={item.id} className="hover:bg-muted/10 transition-colors duration-150">
                <div className="p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      className="flex items-center gap-2.5 text-left flex-1 min-w-0 cursor-pointer outline-none select-none"
                      onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                    >
                      <div className="shrink-0 p-1 rounded bg-muted border border-border">
                        <Icon className={`h-3.5 w-3.5 ${cfg.color} ${item.status === 'running' ? 'animate-spin' : ''}`} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-sm text-foreground truncate">{(item as any).displayName || resolveStoryName(item.storyFile || item.story_file || item.specFile || item.spec_file || '')}</span>
                          <Badge variant="outline" className="text-[9px] shrink-0 font-medium px-1.5 rounded-md border-border bg-muted/40">
                            {item.kind === 'FeatureSpec' || item.kind === 'FeatureStory' ? 'Feature' : 'App'}
                          </Badge>
                          {item.engine === 'gemini-cli' && (
                            <Badge variant="outline" className="text-[9px] border-primary/20 text-primary font-medium px-1.5 rounded-md gap-1 shrink-0 bg-primary/5">
                              <Terminal className="h-3 w-3" />Gemini CLI
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-0.5 sm:hidden">
                          {formatTime(item.addedAt || item.added_at)}{(item.durationMs || item.duration_ms) ? ` · ${formatDuration(item.durationMs || item.duration_ms || 0)}` : ''}
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-muted-foreground hidden sm:inline mr-1 bg-muted/50 px-2 py-0.5 rounded-full border border-border/60">
                        Added at {formatTime(item.addedAt || item.added_at)}
                        {(item.durationMs || item.duration_ms) ? ` · Duration: ${formatDuration(item.durationMs || item.duration_ms || 0)}` : ''}
                      </span>
                      
                      <Badge variant="outline" className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded font-semibold ${
                        item.status === 'completed' ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/5 dark:bg-emerald-950/10' :
                        item.status === 'failed' ? 'border-rose-500/30 text-rose-500 bg-rose-500/5 dark:bg-rose-950/10' :
                        item.status === 'running' ? 'border-primary/30 text-primary bg-primary/5 animate-pulse' :
                        'border-border text-muted-foreground bg-muted/40'
                      }`}>
                        {item.status}
                      </Badge>
                      
                      {item.status === 'failed' && (
                        <Button variant="ghost" size="icon" onClick={() => handleRetry(item.id)} className="h-8 w-8 rounded hover:bg-muted border border-border/80">
                          <RotateCcw className="h-3.5 w-3.5 text-foreground" />
                        </Button>
                      )}
                      {item.status === 'pending' && !isRunning && (
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(item.id)} className="h-8 w-8 rounded hover:bg-muted hover:text-destructive border border-border/80">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded"
                        onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4 rotate-180" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 border-t border-border/45 pt-4 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-muted/30 border border-border/65 rounded-lg p-4 text-[10px] sm:text-[11px] text-muted-foreground mb-4">
                        <div>
                          <span className="block text-muted-foreground/50 font-medium">Story File</span>
                          <span className="text-foreground truncate block mt-0.5 font-mono">{(item.story_file || item.spec_file || '').split('/').pop()}</span>
                        </div>
                        {item.engine && (
                          <div>
                            <span className="block text-muted-foreground/50 font-medium">Engine Driver</span>
                            <span className="text-primary font-semibold block mt-0.5">{item.engine}</span>
                          </div>
                        )}
                        {item.started_at && (
                          <div>
                            <span className="block text-muted-foreground/50 font-medium">Start Time</span>
                            <span className="text-foreground block mt-0.5">{new Date(item.started_at).toLocaleTimeString()}</span>
                          </div>
                        )}
                        {item.duration_ms && (
                          <div>
                            <span className="block text-muted-foreground/50 font-medium">Duration</span>
                            <span className="text-foreground block mt-0.5">{formatDuration(item.duration_ms)}</span>
                          </div>
                        )}
                      </div>
                      <ActivityTimeline output={item.output} error={item.error} itemStatus={item.status} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
