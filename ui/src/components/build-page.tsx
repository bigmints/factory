'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Terminal, Loader2, XCircle, CheckCircle2, RefreshCw, X,
  Square, Package, Play, Rocket, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueItem {
  id: string;
  specFile?: string;
  storyFile?: string;
  displayName?: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBasename(p: string) {
  return p?.split('/').pop() ?? p;
}

function humanName(item: QueueItem, idx: number): string {
  if (item.displayName) return item.displayName;
  const specName = item.storyFile || item.specFile || '';
  if (!specName) return `Build item ${idx + 1}`;
  return specName.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '');
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number | null) {
  if (!ms) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BuildPage() {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buildOutput, setBuildOutput] = useState('');
  const [startingQueue, setStartingQueue] = useState(false);
  const logOffsetRef = useRef(0);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // ── Data Fetching ──────────────────────────────────────────────────────────

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();
      const items: QueueItem[] = data.items ?? data ?? [];
      setQueueItems(items);
      setQueueRunning(items.some(i => i.status === 'running'));
    } catch {}
  }, []);

  // Poll queue every 3 s
  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  // Stream live log while a build is running
  useEffect(() => {
    if (!queueRunning) {
      logOffsetRef.current = 0;
      return;
    }
    setBuildOutput('Connecting to pipeline logs…\n');
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

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [buildOutput]);

  // Auto-select running item; fallback to first item
  useEffect(() => {
    const running = queueItems.find(i => i.status === 'running');
    if (running) {
      setSelectedId(prev =>
        prev && queueItems.some(i => i.id === prev) ? prev : running.id
      );
    } else {
      setSelectedId(prev => {
        if (prev && queueItems.some(i => i.id === prev)) return prev;
        return queueItems[0]?.id ?? null;
      });
    }
  }, [queueItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ───────────────────────────────────────────────────────────────

  const queueStats = useMemo<QueueStats>(() => {
    const s = { pending: 0, running: 0, completed: 0, failed: 0, total: queueItems.length };
    queueItems.forEach(i => {
      if (i.status === 'running') s.running++;
      else if (i.status === 'completed') s.completed++;
      else if (i.status === 'failed') s.failed++;
      else s.pending++;
    });
    return s;
  }, [queueItems]);

  const selectedItem = queueItems.find(i => i.id === selectedId) ?? null;
  const isSelectedRunning = selectedItem?.status === 'running';

  const panelLog = selectedItem
    ? (isSelectedRunning
        ? (buildOutput || selectedItem.output || '')
        : (selectedItem.output || selectedItem.error || ''))
    : (buildOutput || '');

  const panelLabel = selectedItem
    ? humanName(selectedItem, queueItems.indexOf(selectedItem))
    : 'Build console';

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleStartQueue = async () => {
    setStartingQueue(true);
    try {
      const res = await fetch('/api/queue/start', { method: 'POST' });
      if (res.ok) { toast.success('Build queue started'); fetchQueue(); }
      else { const d = await res.json(); toast.error(d.error ?? 'Failed to start queue'); }
    } catch { toast.error('Failed to start queue'); }
    finally { setStartingQueue(false); }
  };

  const handleStopQueue = async () => {
    try {
      const res = await fetch('/api/queue/stop', { method: 'POST' });
      if (res.ok) { toast.success('Build runner stopped'); fetchQueue(); }
      else toast.error('Failed to stop queue');
    } catch { toast.error('Failed to stop queue'); }
  };

  const handleClearQueue = async () => {
    try {
      const res = await fetch('/api/queue/clear', { method: 'POST' });
      if (res.ok) { toast.success('Queue history cleared'); fetchQueue(); }
      else toast.error('Failed to clear queue');
    } catch { toast.error('Failed to clear queue'); }
  };

  const handleRetry = async (id: string) => {
    try {
      const res = await fetch(`/api/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry' }),
      });
      if (res.ok) { toast.success('Retrying…'); fetchQueue(); handleStartQueue(); }
      else toast.error('Failed to retry item');
    } catch { toast.error('Failed to retry'); }
  };

  const handleRemove = async (id: string) => {
    try {
      const res = await fetch('/api/queue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) { toast.success('Removed from queue'); fetchQueue(); }
      else toast.error('Failed to remove item');
    } catch { toast.error('Failed to remove'); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5 h-full">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Build</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {queueStats.total} item{queueStats.total !== 1 ? 's' : ''} ·{' '}
            {queueStats.pending} pending · {queueStats.running} running ·{' '}
            {queueStats.completed} done · {queueStats.failed} failed
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!queueRunning ? (
            <Button
              size="sm"
              disabled={startingQueue || queueStats.pending === 0}
              onClick={handleStartQueue}
              className="gap-1.5 text-xs h-8 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow"
            >
              <Rocket className={cn('h-3.5 w-3.5', startingQueue && 'animate-bounce')} />
              {startingQueue ? 'Starting…' : 'Start Queue'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleStopQueue}
              className="gap-1.5 text-xs h-8"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleClearQueue}
            className="gap-1.5 text-xs h-8"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0">

        {/* Left: Timeline */}
        <Card className="border border-border/80 bg-background/55 backdrop-blur-md shadow-lg overflow-hidden lg:col-span-4 flex flex-col" style={{ height: 'calc(100vh - 200px)' }}>
          <CardHeader className="border-b border-border/50 p-4 shrink-0">
            <CardTitle className="text-sm font-bold">Build Timeline</CardTitle>
            <CardDescription className="text-[11px] mt-0.5">
              Click any item to view its logs →
            </CardDescription>
          </CardHeader>

          <ScrollArea className="flex-1">
            {queueItems.length > 0 ? (
              <div className="relative py-3 px-4">
                {/* Vertical line */}
                <div className="absolute left-[27px] top-0 bottom-0 w-px bg-border/60" />
                <div className="space-y-3">
                  {queueItems.map((item, idx) => {
                    const isRunning  = item.status === 'running';
                    const isFailed   = item.status === 'failed';
                    const isDone     = item.status === 'completed';
                    const isPending  = !isRunning && !isFailed && !isDone;
                    const isSelected = item.id === selectedId;
                    const dur = formatDuration(item.durationMs);

                    return (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 cursor-pointer group"
                        onClick={() => setSelectedId(item.id)}
                      >
                        {/* Dot */}
                        <div className={cn(
                          'relative z-10 h-7 w-7 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all',
                          isRunning && 'border-primary bg-primary/20 animate-pulse',
                          isFailed  && 'border-rose-500 bg-rose-500/20',
                          isDone    && 'border-emerald-500 bg-emerald-500/20',
                          isPending && 'border-border bg-muted',
                        )}>
                          {isRunning && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />}
                          {isFailed  && <XCircle className="h-3.5 w-3.5 text-rose-500" />}
                          {isDone    && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                          {isPending && <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />}
                        </div>

                        {/* Card */}
                        <div className={cn(
                          'flex-1 min-w-0 p-2.5 rounded-lg border text-xs transition-all',
                          isRunning && 'border-primary/40 bg-primary/5',
                          isFailed  && 'border-rose-500/30 bg-rose-500/5',
                          isDone    && 'border-emerald-500/20 bg-emerald-500/5',
                          isPending && 'border-border/60 bg-background/40',
                          isSelected && 'ring-2 ring-primary/60 ring-offset-1 ring-offset-background',
                          !isSelected && 'group-hover:border-border/80',
                        )}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-foreground truncate" title={humanName(item, idx)}>
                              {humanName(item, idx)}
                            </span>
                            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                              {isFailed && (
                                <Button size="icon" variant="ghost" className="h-5 w-5 text-primary hover:bg-primary/10 rounded" onClick={() => handleRetry(item.id)}>
                                  <RefreshCw className="h-3 w-3" />
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded" onClick={() => handleRemove(item.id)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground flex-wrap">
                            <Badge variant="outline" className={cn(
                              'text-[8px] font-bold h-4 px-1.5 rounded uppercase border',
                              isRunning ? 'bg-blue-500/10 text-blue-400 border-blue-500/25 animate-pulse' :
                              isFailed  ? 'bg-rose-500/10 text-rose-400 border-rose-500/25' :
                              isDone    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' :
                                          'bg-muted border-border text-muted-foreground',
                            )}>
                              {item.status}
                            </Badge>
                            <span>{item.kind.replace('Story', '')}</span>
                            {dur && <span className="font-mono">{dur}</span>}
                            {item.addedAt && (
                              <span className="ml-auto font-mono" title={item.addedAt}>{formatTime(item.addedAt)}</span>
                            )}
                            {(item.output || item.error) && !isSelected && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" title="Has logs — click to view" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-center text-muted-foreground px-6">
                <Package className="h-10 w-10 text-muted-foreground/25 mb-3" />
                <p className="text-xs font-semibold text-foreground mb-1">Queue is empty</p>
                <p className="text-[11px] text-muted-foreground max-w-xs">
                  Click <strong>Build Ready Stories</strong> on the Plan board or queue individual stories from there.
                </p>
              </div>
            )}
          </ScrollArea>
        </Card>

        {/* Right: Log console */}
        <Card className="border border-border/80 bg-zinc-950 shadow-2xl lg:col-span-8 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
          {/* Console header */}
          <div className="bg-zinc-900 border-b border-white/5 px-4 py-3 shrink-0 flex items-center justify-between select-none">
            <span className="flex items-center gap-2 text-zinc-300 text-xs font-bold font-mono min-w-0">
              <Terminal className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate" title={panelLabel}>{panelLabel}</span>
              {isSelectedRunning && (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              )}
              {selectedItem && !isSelectedRunning && (
                <Badge variant="outline" className={cn(
                  'text-[8px] font-bold h-4 px-1.5 rounded uppercase border ml-1 shrink-0',
                  selectedItem.status === 'failed'    ? 'bg-rose-500/10 text-rose-400 border-rose-500/25' :
                  selectedItem.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' :
                  'bg-muted border-border text-muted-foreground',
                )}>
                  {selectedItem.status}
                </Badge>
              )}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider shrink-0 ml-2">
              {isSelectedRunning ? 'live' : selectedItem ? 'stored' : 'idle'}
            </span>
          </div>

          {/* Log body */}
          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-zinc-300 space-y-0.5 select-text scrollbar-thin scrollbar-thumb-zinc-800">
            {panelLog ? (
              panelLog.split('\n').map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'leading-5 whitespace-pre-wrap px-0.5 rounded',
                    line.startsWith('✗') || line.startsWith('✘') || line.toLowerCase().includes('error') ? 'text-rose-400' :
                    line.startsWith('✓') || line.startsWith('✔') ? 'text-emerald-400' :
                    line.startsWith('●') || line.startsWith('→') ? 'text-zinc-400' :
                    line.startsWith('[') ? 'text-sky-400' :
                    'text-zinc-300',
                  )}
                >
                  {line || '\u00A0'}
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <Terminal className="h-8 w-8 text-zinc-700 mb-3" />
                <p className="text-zinc-500 italic text-xs">
                  {selectedItem
                    ? `No logs captured for this ${selectedItem.kind.replace('Story', '')} build yet.`
                    : 'Select a build item on the left to view its logs.'}
                </p>
              </div>
            )}
            <div ref={terminalEndRef} />
          </div>
        </Card>
      </div>
    </div>
  );
}
