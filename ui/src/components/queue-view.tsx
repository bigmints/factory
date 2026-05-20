'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
// Card imports removed
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Play, Square, Trash2, RotateCcw, CheckCircle2, XCircle, Clock, Loader2,
  AlertTriangle, ChevronDown, ChevronRight, Zap, FileCode2, Brain, FlaskConical,
  Wrench, ShieldCheck, FolderOpen, Terminal, Sparkles, RefreshCw,
} from 'lucide-react';

interface QueueItem {
  id: string;
  spec_file: string;
  kind: string;
  status: string;
  priority: number;
  engine?: string;
  added_at: string;
  started_at: string | null;
  completed_at: string | null;
  output: string;
  error: string | null;
  duration_ms: number | null;
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
  substeps: { text: string; status: 'success' | 'error' | 'info' }[];
}

const statusConfig: Record<string, { label: string; color: string; glowClass: string; icon: any; bg: string }> = {
  pending: { label: 'Pending', color: 'text-zinc-400', glowClass: '', icon: Clock, bg: 'bg-zinc-500/10' },
  running: { label: 'Running', color: 'text-sky-400', glowClass: 'glow-blue border-sky-500/30 shadow-sky-500/10', icon: Loader2, bg: 'bg-sky-500/10' },
  completed: { label: 'Completed', color: 'text-emerald-400', glowClass: 'glow-emerald border-emerald-500/30 shadow-emerald-500/10', icon: CheckCircle2, bg: 'bg-emerald-500/10' },
  failed: { label: 'Failed', color: 'text-rose-400', glowClass: 'border-rose-500/30 shadow-rose-500/10', icon: XCircle, bg: 'bg-rose-500/10' },
  'needs-attention': { label: 'Attention', color: 'text-amber-400', glowClass: 'glow-purple border-amber-500/30 shadow-amber-500/10', icon: AlertTriangle, bg: 'bg-amber-500/10' },
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
    if (warningMatch && current) { current.status = 'error'; current.substeps.push({ text: warningMatch[1], status: 'error' }); }

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
  if (status === 'success') return <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald-400" />;
  if (status === 'error') return <XCircle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-rose-400" />;
  if (status === 'running' && isActive) return <Loader2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-sky-400 animate-spin" />;
  return <div className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted-foreground/30 bg-muted/50" />;
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
      <div className="rounded-xl border glass-panel p-3 max-h-64 overflow-y-auto">
        <pre className="text-[10px] sm:text-xs font-mono text-foreground/80 whitespace-pre-wrap">{output}</pre>
      </div>
    ) : null;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border glass-panel p-5 md:p-6 shadow-lg relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center justify-between mb-4 border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-sky-400" />
            <h4 className="text-xs sm:text-sm font-semibold tracking-wide text-foreground">Build Pipeline Activities</h4>
          </div>
          <div className="flex items-center gap-2 bg-muted/40 px-2.5 py-1 rounded-full border border-border/30">
            <CircularProgress completed={completedCount} total={activities.length} />
            <span className="text-[10px] sm:text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{completedCount}</span>
              {' / '}<span className="font-semibold text-foreground">{activities.length}</span> steps
            </span>
          </div>
        </div>

        <ScrollArea className="max-h-[450px] pr-1">
          <div className="space-y-2.5 relative before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-0.5 before:bg-border/30">
            {activities.map((step, index) => {
              const isOpen = openStepId === step.id;
              const StepIcon = step.icon;

              return (
                <div key={step.id} className="relative transition-all duration-300">
                  <div className={`relative overflow-hidden rounded-xl transition-all duration-200 ${
                    isOpen ? 'border border-border/80 bg-muted/30 shadow-inner' : 'hover:bg-muted/10'
                  }`}>
                    <div className="flex items-start gap-3 py-3.5 px-4">
                      <div className="shrink-0 relative z-10 bg-background/80 rounded-full p-0.5">
                        <StepIndicator status={step.status} isActive={itemStatus === 'running'} />
                      </div>
                      <div className="grow min-w-0">
                        <button
                          onClick={() => setOpenStepId(isOpen ? null : step.id)}
                          className="flex items-center justify-between w-full text-left gap-2 cursor-pointer outline-none"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {StepIcon && <StepIcon className={`h-4 w-4 shrink-0 ${
                              step.status === 'success' ? 'text-emerald-400' :
                              step.status === 'error' ? 'text-rose-400' :
                              step.status === 'running' && itemStatus === 'running' ? 'text-sky-400 animate-pulse' :
                              'text-muted-foreground'
                            }`} />}
                            <h4 className={`text-xs sm:text-sm font-medium truncate ${
                              step.status === 'success' ? 'text-emerald-400/90' :
                              step.status === 'error' ? 'text-rose-400/90' :
                              step.status === 'running' && itemStatus === 'running' ? 'text-sky-400' :
                              'text-foreground/90'
                            }`}>{step.label}</h4>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {step.status === 'success' && <Badge variant="outline" className="text-[9px] border-emerald-500/20 bg-emerald-500/5 text-emerald-400 h-4 px-1.5 rounded-full font-medium">Done</Badge>}
                            {step.status === 'error' && <Badge variant="outline" className="text-[9px] border-rose-500/20 bg-rose-500/5 text-rose-400 h-4 px-1.5 rounded-full font-medium">Failed</Badge>}
                            {step.status === 'running' && itemStatus === 'running' && <Badge variant="outline" className="text-[9px] border-sky-500/20 bg-sky-500/5 text-sky-400 h-4 px-1.5 rounded-full font-medium animate-pulse">Active</Badge>}
                            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200 ${isOpen ? 'rotate-90 text-foreground' : ''}`} />
                          </div>
                        </button>

                        {isOpen && (
                          <div className="mt-3 space-y-2 border-t border-border/20 pt-2.5 text-left animate-in fade-in slide-in-from-top-1 duration-200">
                            {step.substeps.length > 0 && (
                              <div className="space-y-1.5 pl-1">
                                {step.substeps.map((sub, si) => (
                                  <div key={si} className="flex items-start gap-2 text-[10px] sm:text-xs">
                                    {sub.status === 'success' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />}
                                    {sub.status === 'error' && <XCircle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />}
                                    {sub.status === 'info' && <ChevronRight className="h-3.5 w-3.5 text-sky-400/70 mt-0.5 shrink-0" />}
                                    <span className={sub.status === 'error' ? 'text-rose-300/90 font-medium' : 'text-muted-foreground'}>{sub.text}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {step.details.length > 0 && step.status === 'error' && (
                              <div className="rounded-lg bg-rose-500/5 border border-rose-500/10 p-3 max-h-40 overflow-y-auto mt-2 shadow-inner">
                                <pre className="text-[10px] sm:text-[11px] font-mono text-rose-300/80 whitespace-pre-wrap">{step.details.join('\n')}</pre>
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
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 md:p-5 shadow-md relative overflow-hidden">
          <div className="absolute left-0 top-0 h-full w-1 bg-rose-500" />
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle className="h-4 w-4 text-rose-400" />
            <p className="text-xs sm:text-sm text-rose-400 font-semibold">Error Log Details</p>
          </div>
          <pre className="text-[10px] sm:text-xs font-mono whitespace-pre-wrap bg-background/40 p-2.5 rounded-lg border border-border/20 max-h-48 overflow-y-auto">{error}</pre>
        </div>
      )}

      {output && (
        <div className="flex flex-col items-start">
          <Button variant="ghost" size="sm" onClick={() => setShowRaw(!showRaw)} className="text-[10px] text-muted-foreground hover:text-foreground h-7 px-2.5 rounded-full tap-shrink bg-muted/20 hover:bg-muted/40 border border-border/30">
            <Terminal className="h-3.5 w-3.5 mr-1 text-sky-400" />
            {showRaw ? 'Hide Raw Build Log' : 'Show Raw Build Log'}
          </Button>
          {showRaw && (
            <div className="rounded-xl bg-card/60 glass-panel border p-3 sm:p-4 max-h-80 w-full overflow-y-auto mt-2 shadow-xl animate-in fade-in slide-in-from-top-2 duration-300">
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

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const specName = (path: string) => path.split('/').pop()?.replace('.yaml', '') || path;

  return (
    <div className="space-y-5 pb-20 sm:pb-8">
      {/* Header Panel */}
      <div className="relative overflow-hidden rounded-2xl glass-panel p-5 md:p-6 shadow-xl border-border/40">
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-sky-400 animate-pulse" />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text">Build Queue</h1>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1.5">Manage, prioritize, and execute your build specs autonomously</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onToggleOutput && (isRunning || queueRunning) && (
              <Button variant={outputPanelOpen ? 'default' : 'outline'} size="sm" onClick={onToggleOutput} className="text-xs gap-1.5 rounded-full tap-shrink h-9 px-3.5">
                <Terminal className="h-4 w-4" />
                Output
                {(isRunning || queueRunning) && (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                )}
              </Button>
            )}
            {stats.total > 0 && !isRunning && (
              <Button variant="outline" size="sm" onClick={handleClearAll} className="text-xs gap-1.5 rounded-full tap-shrink h-9 px-3.5 border-border/60 hover:bg-muted/40 text-muted-foreground hover:text-foreground">
                <Trash2 className="h-4 w-4" />
                <span>Clear All ({stats.total})</span>
              </Button>
            )}
            {isRunning && (
              <Button variant="outline" size="sm" onClick={handleStopAll} className="text-xs gap-1.5 rounded-full tap-shrink h-9 px-3.5 border-rose-500/30 text-rose-400 hover:bg-rose-500/10">
                <Square className="h-4 w-4 fill-rose-400/20" />
                <span>Stop Execution</span>
              </Button>
            )}
            <Button onClick={handleStart} disabled={isRunning || stats.pending === 0} size="sm" className="bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white text-xs gap-1.5 rounded-full shadow-lg shadow-sky-500/10 h-9 px-4 tap-shrink">
              {isRunning ? (
                <><Loader2 className="h-4 w-4 animate-spin" /><span>Running Queue...</span></>
              ) : (
                <><Play className="h-4 w-4 fill-white" /><span>Start Build Queue ({stats.pending})</span></>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Swipeable Status Cards Grid */}
      <div className="relative">
        {/* Shadow Overlay Faders for horizontal overflow */}
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent pointer-events-none sm:hidden z-10" />
        <div className="flex sm:grid sm:grid-cols-5 gap-2.5 overflow-x-auto sm:overflow-visible pb-2.5 sm:pb-0 scrollbar-none snap-x snap-mandatory px-0.5">
          {(['pending', 'running', 'completed', 'failed', 'needs-attention'] as const).map((status) => {
            const cfg = statusConfig[status];
            const Icon = cfg.icon;
            const hasCount = stats[status] > 0;
            return (
              <div key={status} className="snap-center shrink-0 w-[140px] sm:w-auto">
                <div className={`relative overflow-hidden transition-all duration-300 rounded-2xl border glass-panel tap-shrink min-h-[72px] flex items-center justify-between p-4 md:p-5 ${
                  hasCount ? cfg.glowClass : 'opacity-40 border-border/30'
                }`}>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{cfg.label}</span>
                    <span className="text-xl font-bold tracking-tight mt-0.5">{stats[status]}</span>
                  </div>
                  <div className={`p-2 rounded-xl ${cfg.bg} shrink-0`}>
                    <Icon className={`h-4.5 w-4.5 ${cfg.color} ${status === 'running' && hasCount ? 'animate-spin' : ''}`} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Separator className="bg-border/40" />

      {/* Queue items */}
      {items.length === 0 ? (
        <div className="glass-panel rounded-2xl border border-dashed border-border/60 p-6 sm:p-10 text-center glow-purple">
          <div className="h-12 w-12 rounded-2xl bg-muted/40 border border-border/30 flex items-center justify-center mx-auto mb-4">
            <Clock className="h-6 w-6 text-muted-foreground/60" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Build queue is empty</h3>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto mt-1.5 leading-relaxed">Go to the Specs panel and configure your build specifications to load items here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const cfg = statusConfig[item.status] || statusConfig.pending;
            const Icon = cfg.icon;
            const isExpanded = expandedItem === item.id;

            return (
              <div key={item.id} className={`relative overflow-hidden rounded-2xl border glass-panel transition-all duration-300 ${
                isExpanded ? 'shadow-lg shadow-sky-500/5 border-sky-500/20' : 'hover:bg-muted/10'
              }`}>
                {/* Thin side glowing accent strip */}
                <div className={`absolute left-0 top-0 h-full w-[3px] transition-all ${
                  item.status === 'completed' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' :
                  item.status === 'failed' ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' :
                  item.status === 'running' ? 'bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.5)] animate-pulse' :
                  item.status === 'needs-attention' ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' :
                  'bg-muted-foreground/30'
                }`} />

                <div className="p-5 md:p-6 pl-6 md:pl-8">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      className="flex items-center gap-2.5 text-left flex-1 min-w-0 cursor-pointer outline-none select-none"
                      onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                    >
                      <div className="shrink-0 p-1.5 rounded-lg bg-muted/60 border border-border/20">
                        <Icon className={`h-4 w-4 ${cfg.color} ${item.status === 'running' ? 'animate-spin' : ''}`} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-xs sm:text-sm text-foreground/90 truncate">{specName(item.spec_file)}</span>
                          <Badge variant="outline" className={`text-[9px] shrink-0 font-medium px-1.5 h-4.5 rounded-full ${
                            item.kind === 'FeatureSpec' ? 'border-purple-500/20 bg-purple-500/5 text-purple-400' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
                          }`}>{item.kind === 'FeatureSpec' ? 'Feature' : 'App'}</Badge>
                          {item.engine === 'gemini-cli' && (
                            <Badge variant="outline" className="text-[9px] border-sky-500/20 bg-sky-500/5 text-sky-400 font-medium px-1.5 h-4.5 rounded-full gap-1 shrink-0">
                              <Terminal className="h-3 w-3" />Gemini CLI
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-0.5 sm:hidden">
                          {formatTime(item.added_at)}{item.duration_ms ? ` · ${formatDuration(item.duration_ms)}` : ''}
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] sm:text-xs text-muted-foreground hidden sm:inline mr-1 bg-muted/40 px-2 py-0.5 rounded-full border border-border/20">
                        Added at {formatTime(item.added_at)}
                        {item.duration_ms ? ` · Total: ${formatDuration(item.duration_ms)}` : ''}
                      </span>
                      {item.status === 'failed' && (
                        <Button variant="ghost" size="icon" onClick={() => handleRetry(item.id)} className="h-8 w-8 rounded-full bg-muted/40 hover:bg-muted/80 tap-shrink border border-border/20">
                          <RotateCcw className="h-3.5 w-3.5 text-sky-400" />
                        </Button>
                      )}
                      {item.status === 'pending' && !isRunning && (
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(item.id)} className="h-8 w-8 rounded-full bg-muted/40 hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 tap-shrink border border-border/20">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <ChevronRight className={`h-4 w-4 text-muted-foreground/60 transition-transform duration-200 hidden sm:inline-block ${isExpanded ? 'rotate-90 text-foreground' : ''}`} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 ml-0 sm:ml-9 border-t border-border/20 pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-muted/20 border border-border/20 rounded-xl p-4 text-[10px] sm:text-[11px] text-muted-foreground mb-4">
                        <div>
                          <span className="block text-muted-foreground/50 font-medium">Spec File</span>
                          <span className="text-foreground/95 truncate block mt-0.5">{item.spec_file.split('/').pop()}</span>
                        </div>
                        {item.engine && (
                          <div>
                            <span className="block text-muted-foreground/50 font-medium">Engine Driver</span>
                            <span className="text-sky-400 font-semibold block mt-0.5">{item.engine}</span>
                          </div>
                        )}
                        {item.started_at && (
                          <div>
                            <span className="block text-muted-foreground/50 font-medium">Start Time</span>
                            <span className="text-foreground/90 block mt-0.5">{new Date(item.started_at).toLocaleTimeString()}</span>
                          </div>
                        )}
                        {item.duration_ms && (
                          <div>
                            <span className="block text-muted-foreground/50 font-medium">Duration</span>
                            <span className="text-foreground/90 block mt-0.5">{formatDuration(item.duration_ms)}</span>
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
