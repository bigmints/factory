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
    <div className="flex flex-col gap-4">
      {/* ── Page Header & Stats ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-1">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
            Build Workspace
          </h1>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Manage your autonomous compilation pipelines, review historical steps, and inspect system output logs.
          </p>
        </div>
      </div>

      {/* ── Gmail-Style Top Action Toolbar ── */}
      <div className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800 rounded-xl p-2 gap-3 text-xs select-none shadow-md">
        <div className="flex items-center gap-1.5">
          {!queueRunning ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={startingQueue || queueStats.pending === 0}
              onClick={handleStartQueue}
              className="gap-2 text-zinc-300 hover:text-white hover:bg-zinc-800/80 h-8 px-2.5 rounded-lg transition-colors"
            >
              <Play className={cn('h-3.5 w-3.5 text-emerald-400 fill-emerald-400/20', startingQueue && 'animate-bounce')} />
              <span className="font-medium text-[11px]">Start Queue</span>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStopQueue}
              className="gap-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 h-8 px-2.5 rounded-lg transition-colors"
            >
              <Square className="h-3.5 w-3.5 fill-rose-400/20" />
              <span className="font-medium text-[11px]">Stop Runner</span>
            </Button>
          )}

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          <Button
            variant="ghost"
            size="sm"
            disabled={queueItems.length === 0}
            onClick={handleClearQueue}
            className="gap-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 h-8 px-2.5 rounded-lg transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
            <span className="font-medium text-[11px]">Clear Workspace</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchQueue}
            className="gap-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 h-8 px-2.5 rounded-lg transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />
            <span className="font-medium text-[11px]">Refresh</span>
          </Button>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-mono pr-2">
          <span>
            {queueItems.length > 0 ? `1-${queueItems.length} of ${queueItems.length}` : '0 of 0'}
          </span>
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "h-2 w-2 rounded-full transition-all",
              queueRunning ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
            )} />
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
              {queueRunning ? 'Active' : 'Idle'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Split Layout Grid (Gmail Style) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        
        {/* Left Side: Inbox List (Build Queue) */}
        <div className="lg:col-span-5 xl:col-span-5 border border-zinc-800 bg-zinc-950/40 rounded-xl overflow-hidden shadow-xl flex flex-col min-w-0">
          <div className="bg-zinc-900/40 border-b border-zinc-800 px-4 py-3 shrink-0 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-zinc-400" />
              Build Queue ({queueItems.length})
            </span>
            <span className="text-[10px] text-zinc-500 font-medium">
              {queueStats.pending} pending · {queueStats.running} running
            </span>
          </div>

          <div className="divide-y divide-zinc-800/50 overflow-y-auto max-h-[65vh] scrollbar-thin select-none">
            {queueItems.length > 0 ? (
              queueItems.map((item, idx) => {
                const isRunning  = item.status === 'running';
                const isFailed   = item.status === 'failed';
                const isDone     = item.status === 'completed';
                const isPending  = !isRunning && !isFailed && !isDone;
                const isSelected = item.id === selectedId;
                const dur = formatDuration(item.durationMs);

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center justify-between gap-3 px-4 py-3 cursor-pointer transition-all duration-150 relative border-l-2 text-xs group',
                      isSelected
                        ? 'bg-zinc-900/80 border-l-violet-500 text-white shadow-inner'
                        : 'border-l-transparent text-zinc-400 hover:bg-zinc-900/30 hover:text-zinc-200'
                    )}
                    onClick={() => setSelectedId(item.id)}
                  >
                    {/* Status Dot / Avatar (Like Gmail checkbox/star area) */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="shrink-0 flex items-center justify-center w-5 h-5">
                        {isRunning && <Loader2 className="h-4 w-4 text-violet-500 animate-spin" />}
                        {isFailed  && <XCircle className="h-4 w-4 text-rose-500" />}
                        {isDone    && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                        {isPending && (
                          <span className="h-4 w-4 flex items-center justify-center">
                            <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
                          </span>
                        )}
                      </div>

                      {/* Sender Column: Spec File Name */}
                      <span className={cn(
                        "font-semibold truncate w-28 shrink-0 text-left",
                        isSelected || isRunning || isPending ? "text-zinc-100" : "text-zinc-400 group-hover:text-zinc-200"
                      )}>
                        {humanName(item, idx)}
                      </span>

                      {/* Subject / Snippet Column: Phase, kind and priority */}
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="text-zinc-500 font-bold shrink-0 text-[10px]">
                          [{item.kind.replace('Story', '')}]
                        </span>
                        <span className="text-zinc-600 group-hover:text-zinc-400 truncate text-[11px]">
                          {item.displayName || `Phase ${item.priority || 1}`}
                        </span>
                      </div>
                    </div>

                    {/* Time / Actions (Like Gmail Date / Hover Actions) */}
                    <div className="flex items-center gap-3 shrink-0 h-5">
                      {/* Standard Timestamp or Duration preview */}
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono group-hover:hidden">
                        {dur && <span className="text-zinc-400 font-medium">{dur}</span>}
                        {item.addedAt && <span>{formatTime(item.addedAt)}</span>}
                      </div>

                      {/* Floating actions that show on hover */}
                      <div className="hidden group-hover:flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        {isFailed && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md"
                            title="Retry Build"
                            onClick={() => handleRetry(item.id)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-zinc-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-md"
                          title="Remove from queue"
                          onClick={() => handleRemove(item.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-center text-zinc-500 px-6 py-12">
                <Package className="h-10 w-10 text-zinc-700/60 mb-3" />
                <p className="text-xs font-semibold text-zinc-300 mb-1">Your build inbox is empty</p>
                <p className="text-[11px] text-zinc-500 max-w-xs">
                  Ready components will show up here automatically when stories are enqueued from the dashboard.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Message Details (Log output / Console pane) */}
        <div className="lg:col-span-7 xl:col-span-7 border border-zinc-800 bg-zinc-950 rounded-xl shadow-xl overflow-hidden flex flex-col min-w-0 min-h-[500px]">
          {selectedItem ? (
            <div className="flex flex-col h-full">
              {/* Detailed Email-style Header */}
              <div className="bg-zinc-900/40 border-b border-zinc-800 px-6 py-4 flex flex-col gap-3.5 shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Terminal className="h-4 w-4 text-violet-400 shrink-0" />
                    <h2 className="text-sm font-bold text-white truncate" title={panelLabel}>
                      {panelLabel}
                    </h2>
                    {isSelectedRunning && (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {selectedItem.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRetry(selectedItem.id)}
                        className="h-7 text-[11px] gap-1 px-2.5 border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800"
                      >
                        <RefreshCw className="h-3 w-3 text-zinc-400" />
                        Retry
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRemove(selectedItem.id)}
                      className="h-7 text-[11px] gap-1 px-2.5 border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-rose-400 hover:border-rose-900 hover:bg-rose-950/20"
                    >
                      <Trash2 className="h-3 w-3" />
                      Discard
                    </Button>
                  </div>
                </div>

                {/* Sender/Receiver Meta row */}
                <div className="flex items-start justify-between text-xs gap-3">
                  <div className="flex items-center gap-3">
                    {/* User status avatar */}
                    <div className={cn(
                      "h-8 w-8 rounded-full border flex items-center justify-center font-bold text-xs select-none shrink-0",
                      selectedItem.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                      selectedItem.status === 'failed' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
                      selectedItem.status === 'running' ? 'bg-violet-500/10 border-violet-500/30 text-violet-400 animate-pulse' :
                      'bg-zinc-800 border-zinc-700 text-zinc-400'
                    )}>
                      {selectedItem.status === 'completed' ? '✓' :
                       selectedItem.status === 'failed' ? '✗' :
                       selectedItem.status === 'running' ? '●' : 'P'}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-zinc-200">
                          {selectedItem.kind.replace('Story', '')} build agent
                        </span>
                        <span className="text-zinc-500 text-[10px]">
                          &lt;pipeline-worker@{selectedItem.id.slice(0, 8)}&gt;
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        to factory-logs-console · phase {selectedItem.priority || 1}
                      </p>
                    </div>
                  </div>

                  <div className="text-right text-[10px] text-zinc-500 font-mono shrink-0">
                    <p title={selectedItem.addedAt}>{formatTime(selectedItem.addedAt)}</p>
                    {selectedItem.durationMs && (
                      <p className="text-zinc-400 mt-0.5">Time elapsed: {formatDuration(selectedItem.durationMs)}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Log stream ("Email Content Body") */}
              <div className="p-5 font-mono text-[11px] text-zinc-300 space-y-0.5 select-text overflow-y-auto flex-1 max-h-[60vh] bg-zinc-950/60 scrollbar-thin">
                {panelLog ? (
                  panelLog.split('\n').map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        'leading-5 whitespace-pre-wrap px-1 rounded transition-colors',
                        line.startsWith('✗') || line.startsWith('✘') || line.toLowerCase().includes('error') ? 'text-rose-400 bg-rose-950/10 font-semibold' :
                        line.startsWith('✓') || line.startsWith('✔') ? 'text-emerald-400 bg-emerald-950/5' :
                        line.startsWith('●') || line.startsWith('→') ? 'text-zinc-400 font-semibold' :
                        line.startsWith('[') ? 'text-sky-400' :
                        'text-zinc-300 hover:bg-zinc-900/20',
                      )}
                    >
                      {line || '\u00A0'}
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center py-16">
                    <Terminal className="h-8 w-8 text-zinc-800 mb-3" />
                    <p className="text-zinc-500 italic text-xs">
                      No runtime log entries have been received.
                    </p>
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-zinc-500">
              <Package className="h-12 w-12 text-zinc-800 mb-4" />
              <h3 className="text-zinc-300 font-bold text-sm mb-1">No story build selected</h3>
              <p className="text-xs max-w-sm">
                Select a message row from the queue list on the left to inspect detailed live build telemetry and logs.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
