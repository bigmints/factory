'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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

const statusConfig: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  pending: { label: 'Pending', color: 'text-muted-foreground', icon: Clock, bg: 'bg-muted' },
  running: { label: 'Running', color: 'text-blue-400', icon: Loader2, bg: 'bg-blue-500/10' },
  completed: { label: 'Completed', color: 'text-emerald-400', icon: CheckCircle2, bg: 'bg-emerald-500/10' },
  failed: { label: 'Failed', color: 'text-red-400', icon: XCircle, bg: 'bg-red-500/10' },
  'needs-attention': { label: 'Attention', color: 'text-amber-400', icon: AlertTriangle, bg: 'bg-amber-500/10' },
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
    <svg className="-rotate-90 scale-y-[-1]" height="14" width="14" viewBox="0 0 14 14">
      <circle className="stroke-muted" cx="7" cy="7" fill="none" r="6" strokeWidth="2" pathLength="100" />
      <circle className="stroke-primary" cx="7" cy="7" fill="none" r="6" strokeWidth="2" pathLength="100" strokeDasharray="100" strokeLinecap="round" style={{ strokeDashoffset }} />
    </svg>
  );
}

function StepIndicator({ status, isActive }: { status: 'success' | 'error' | 'running' | 'info' | 'warning'; isActive: boolean }) {
  if (status === 'success') return <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald-400" />;
  if (status === 'error') return <XCircle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-red-400" />;
  if (status === 'running' && isActive) return <Loader2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-blue-400 animate-spin" />;
  return <div className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border-2 border-muted-foreground/30" />;
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

  useMemo(() => {
    const errorStep = activities.find(s => s.status === 'error');
    const runningStep = activities.find(s => s.status === 'running');
    if (errorStep) setOpenStepId(errorStep.id);
    else if (runningStep) setOpenStepId(runningStep.id);
  }, [activities]);

  const completedCount = activities.filter(s => s.status === 'success').length;

  if (activities.length === 0 && !error) {
    return output ? (
      <div className="rounded-lg border bg-card p-3 max-h-64 overflow-y-auto">
        <pre className="text-[10px] sm:text-xs font-mono text-foreground/80 whitespace-pre-wrap">{output}</pre>
      </div>
    ) : null;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3 sm:p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs sm:text-sm font-semibold text-foreground">Build Activity</h4>
          <div className="flex items-center gap-2">
            <CircularProgress completed={completedCount} total={activities.length} />
            <span className="text-[10px] sm:text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{completedCount}</span>
              {' / '}<span className="font-medium text-foreground">{activities.length}</span> steps
            </span>
          </div>
        </div>

        <ScrollArea className="max-h-[400px]">
          <div className="space-y-0">
            {activities.map((step, index) => {
              const isOpen = openStepId === step.id;
              const isFirst = index === 0;
              const prevStep = activities[index - 1];
              const isPrevOpen = prevStep && openStepId === prevStep.id;
              const showBorderTop = !isFirst && !isOpen && !isPrevOpen;
              const StepIcon = step.icon;

              return (
                <div key={step.id} className={`group ${isOpen ? 'rounded-lg' : ''} ${showBorderTop ? 'border-t border-border' : ''}`}>
                  <button
                    onClick={() => setOpenStepId(isOpen ? null : step.id)}
                    className="block w-full cursor-pointer text-left"
                  >
                    <div className={`relative overflow-hidden rounded-lg transition-colors ${isOpen ? 'border border-border bg-muted' : ''}`}>
                      <div className="relative flex items-center justify-between gap-2 sm:gap-3 py-2 pl-2.5 pr-2">
                        <div className="flex w-full gap-2 sm:gap-3">
                          <div className="shrink-0">
                            <StepIndicator status={step.status} isActive={itemStatus === 'running'} />
                          </div>
                          <div className="mt-0.5 grow min-w-0">
                            <h4 className={`text-xs sm:text-sm font-medium truncate ${
                              step.status === 'success' ? 'text-emerald-400' :
                              step.status === 'error' ? 'text-red-400' :
                              step.status === 'running' && itemStatus === 'running' ? 'text-blue-400' :
                              'text-foreground'
                            }`}>{step.label}</h4>
                            {isOpen && (
                              <div className="mt-2 space-y-1">
                                {step.substeps.length > 0 && (
                                  <div className="space-y-1">
                                    {step.substeps.map((sub, si) => (
                                      <div key={si} className="flex items-start gap-2 text-[10px] sm:text-xs">
                                        {sub.status === 'success' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />}
                                        {sub.status === 'error' && <XCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />}
                                        {sub.status === 'info' && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />}
                                        <span className={sub.status === 'error' ? 'text-red-300' : 'text-muted-foreground'}>{sub.text}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {step.details.length > 0 && step.status === 'error' && (
                                  <div className="rounded bg-red-500/5 border border-red-500/10 p-2 max-h-32 overflow-y-auto">
                                    <pre className="text-[10px] font-mono text-red-300/80 whitespace-pre-wrap">{step.details.join('\n')}</pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                          {step.status === 'success' && <Badge variant="outline" className="text-[9px] sm:text-[10px] border-emerald-500/30 text-emerald-400 h-4 px-1.5">Done</Badge>}
                          {step.status === 'error' && <Badge variant="outline" className="text-[9px] sm:text-[10px] border-red-500/30 text-red-400 h-4 px-1.5">Failed</Badge>}
                          {step.status === 'running' && itemStatus === 'running' && <Badge variant="outline" className="text-[9px] sm:text-[10px] border-blue-500/30 text-blue-400 h-4 px-1.5">Running</Badge>}
                          {!isOpen && <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />}
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 sm:p-3">
          <p className="text-[10px] sm:text-xs text-red-400 font-medium mb-1">Error</p>
          <p className="text-[10px] font-mono whitespace-pre-wrap line-clamp-4 sm:line-clamp-6">{error}</p>
        </div>
      )}

      {output && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowRaw(!showRaw)} className="text-[10px] text-muted-foreground h-6 px-2">
            <Terminal className="h-3 w-3 mr-1" />
            {showRaw ? 'Hide' : 'Show'} Raw
          </Button>
          {showRaw && (
            <div className="rounded-md bg-card border p-2.5 sm:p-3 max-h-64 overflow-y-auto mt-1">
              <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap">{output}</pre>
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

  const handleClearCompleted = async () => {
    for (const item of items.filter(i => i.status === 'completed')) { await handleRemove(item.id); }
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
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold tracking-tight">Build Queue</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Manage and execute your build pipeline</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onToggleOutput && (isRunning || queueRunning) && (
            <Button variant={outputPanelOpen ? 'default' : 'outline'} size="sm" onClick={onToggleOutput} className="text-xs gap-1.5">
              <Terminal className="h-3.5 w-3.5" />
              Output
              {(isRunning || queueRunning) && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              )}
            </Button>
          )}
          {stats.total > 0 && !isRunning && (
            <Button variant="outline" size="sm" onClick={handleClearAll} className="text-xs gap-1.5">
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear All ({stats.total})</span>
              <span className="sm:hidden">Clear</span>
            </Button>
          )}
          {isRunning && (
            <Button variant="outline" size="sm" onClick={handleStopAll} className="text-xs gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10">
              <Square className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Stop All</span>
              <span className="sm:hidden">Stop</span>
            </Button>
          )}
          <Button onClick={handleStart} disabled={isRunning || stats.pending === 0} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-emerald-50 text-xs gap-1.5">
            {isRunning ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="hidden sm:inline">Running...</span><span className="sm:hidden">...</span></>
            ) : (
              <><Play className="h-3.5 w-3.5" /><span className="hidden sm:inline">Start Queue ({stats.pending})</span><span className="sm:hidden">Start ({stats.pending})</span></>
            )}
          </Button>
        </div>
      </div>

      {/* Stats — 2 cols mobile, 5 cols desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
        {(['pending', 'running', 'completed', 'failed', 'needs-attention'] as const).map((status) => {
          const cfg = statusConfig[status];
          const Icon = cfg.icon;
          return (
            <Card key={status} className={stats[status] > 0 ? '' : 'opacity-50'}>
              <CardContent className="pt-3 sm:pt-4 pb-2.5 sm:pb-3">
                <div className="flex items-center gap-2">
                  <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${cfg.color} ${status === 'running' ? 'animate-spin' : ''}`} />
                  <span className="text-base sm:text-lg font-bold">{stats[status]}</span>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">{cfg.label}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      {/* Queue items */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 sm:py-12 text-center">
            <Clock className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-xs sm:text-sm text-muted-foreground">Queue is empty</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Add specs from the Specs tab to start building</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const cfg = statusConfig[item.status] || statusConfig.pending;
            const Icon = cfg.icon;
            const isExpanded = expandedItem === item.id;

            return (
              <Card key={item.id} className="relative overflow-hidden">
                <div className={`absolute left-0 top-0 h-full w-1 ${
                  item.status === 'completed' ? 'bg-emerald-500' :
                  item.status === 'failed' ? 'bg-red-500' :
                  item.status === 'running' ? 'bg-blue-500' :
                  item.status === 'needs-attention' ? 'bg-amber-500' :
                  'bg-muted-foreground/30'
                }`} />
                <CardContent className="pt-3 pb-2 pl-4 sm:pt-4 sm:pb-3 sm:pl-5">
                  <div className="flex items-center justify-between gap-2">
                    <button className="flex items-center gap-2 text-left flex-1 min-w-0" onClick={() => setExpandedItem(isExpanded ? null : item.id)}>
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${cfg.color} ${item.status === 'running' ? 'animate-spin' : ''} shrink-0`} />
                      <span className="font-medium text-xs sm:text-sm truncate">{specName(item.spec_file)}</span>
                      <Badge variant="outline" className={`text-[9px] sm:text-[10px] shrink-0 ${
                        item.kind === 'FeatureSpec' ? 'border-purple-500/30 text-purple-400' : 'border-emerald-500/30 text-emerald-400'
                      }`}>{item.kind === 'FeatureSpec' ? 'Feature' : 'App'}</Badge>
                      {item.engine === 'gemini-cli' && (
                        <Badge variant="outline" className="text-[9px] sm:text-[10px] border-blue-500/30 text-blue-400 gap-1 shrink-0">
                          <Terminal className="h-2.5 w-2.5" />Gemini
                        </Badge>
                      )}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] sm:text-xs text-muted-foreground hidden sm:inline mr-2">
                        {formatTime(item.added_at)}
                        {item.duration_ms ? ` · ${formatDuration(item.duration_ms)}` : ''}
                      </span>
                      {item.status === 'failed' && (
                        <Button variant="ghost" size="icon" onClick={() => handleRetry(item.id)} className="h-7 w-7">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {item.status === 'pending' && !isRunning && (
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(item.id)} className="h-7 w-7 text-muted-foreground hover:text-red-400">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 ml-5 sm:ml-7">
                      <div className="text-[10px] sm:text-[11px] text-muted-foreground space-y-0.5 mb-3 pl-1">
                        <p><span className="text-muted-foreground/60">Spec:</span> {item.spec_file.split('/').pop()}</p>
                        {item.engine && item.engine !== 'factory' && <p><span className="text-muted-foreground/60">Engine:</span> <span className="text-blue-400">{item.engine}</span></p>}
                        {item.started_at && <p><span className="text-muted-foreground/60">Started:</span> {new Date(item.started_at).toLocaleString()}</p>}
                        {item.completed_at && <p><span className="text-muted-foreground/60">Finished:</span> {new Date(item.completed_at).toLocaleString()}</p>}
                        {item.duration_ms && <p><span className="text-muted-foreground/60">Duration:</span> {formatDuration(item.duration_ms)}</p>}
                      </div>
                      <ActivityTimeline output={item.output} error={item.error} itemStatus={item.status} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
