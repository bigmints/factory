'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Terminal, Loader2, XCircle, CheckCircle2, RefreshCw, X,
  Square, Package, Play, Rocket, Trash2, Search, Filter,
  Pin, Mail, Inbox, ChevronDown, Calendar, Archive, Eye,
  Check, Info, FileText, Settings, HelpCircle, User, AlertCircle
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

function getInitials(item: QueueItem): string {
  if (item.kind === 'story') return 'SB';
  if (item.kind === 'app') return 'AB';
  if (item.kind === 'feature') return 'FB';
  return 'BA';
}

function getSnippet(item: QueueItem): string {
  if (item.error) {
    const errorLines = item.error.trim().split('\n').filter(l => l.trim());
    if (errorLines.length > 0) {
      return errorLines[errorLines.length - 1].substring(0, 80);
    }
    return 'Build failed with errors';
  }
  if (item.output) {
    const outputLines = item.output.trim().split('\n').filter(l => l.trim() && !l.includes('.sst') && !l.includes('.meta'));
    if (outputLines.length > 0) {
      for (let i = outputLines.length - 1; i >= 0; i--) {
        const line = outputLines[i].trim();
        if (line.length > 10 && !line.startsWith('✓') && !line.startsWith('✔')) {
          return line.substring(0, 80);
        }
      }
      return outputLines[outputLines.length - 1].substring(0, 80);
    }
  }
  if (item.status === 'running') return 'Compiling assets and running validation gates...';
  if (item.status === 'pending') return 'Queued: Waiting for build dependencies to resolve...';
  if (item.status === 'completed') return 'Finished successfully: Artifacts emitted, AGENTS.md compiled';
  if (item.status === 'failed') return 'Failed: Compilation interrupted by validation gate';
  return 'No live build console logs are available yet.';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BuildPage() {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buildOutput, setBuildOutput] = useState('');
  const [startingQueue, setStartingQueue] = useState(false);
  const [filterTab, setFilterTab] = useState<'focused' | 'other' | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
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

  const filteredItems = useMemo(() => {
    return queueItems.filter(item => {
      const name = humanName(item, queueItems.indexOf(item)).toLowerCase();
      const kind = item.kind.toLowerCase();
      const status = item.status.toLowerCase();
      const matchesSearch = name.includes(searchQuery.toLowerCase()) ||
                            kind.includes(searchQuery.toLowerCase()) ||
                            status.includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (filterTab === 'focused') {
        return item.status === 'running' || item.status === 'pending';
      }
      if (filterTab === 'other') {
        return item.status === 'completed' || item.status === 'failed';
      }
      return true;
    });
  }, [queueItems, filterTab, searchQuery]);

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
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-1 select-none">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2 font-sans">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            Build Workspace
          </h1>
          <p className="text-[11px] text-zinc-400 mt-0.5 font-sans">
            Manage your autonomous compilation pipelines, review historical steps, and inspect system output logs in a desktop-grade client.
          </p>
        </div>
      </div>

      {/* ── Outlook-Style Ribbon / Command Bar ── */}
      <div className="flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-lg select-none">
        {/* Ribbon Top Tabs */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 bg-zinc-950/40 text-[11px] font-medium text-zinc-400">
          <div className="flex gap-4">
            <span className="py-2 px-1 border-b-2 border-blue-500 text-zinc-100 font-semibold cursor-pointer">Home</span>
            <span className="py-2 px-1 hover:text-zinc-200 cursor-pointer">Organize</span>
            <span className="py-2 px-1 hover:text-zinc-200 cursor-pointer">View</span>
            <span className="py-2 px-1 hover:text-zinc-200 cursor-pointer">Help</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-zinc-500">
            <span className={cn(
              "h-1.5 w-1.5 rounded-full transition-all",
              queueRunning ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
            )} />
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
              {queueRunning ? 'Runner Active' : 'Runner Idle'}
            </span>
          </div>
        </div>

        {/* Ribbon Action Items */}
        <div className="flex items-center justify-between p-2 bg-zinc-900/60 text-xs">
          <div className="flex items-center gap-1">
            {!queueRunning ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={startingQueue || queueStats.pending === 0}
                onClick={handleStartQueue}
                className="gap-2 text-zinc-300 hover:text-white hover:bg-zinc-800 h-8 px-3 rounded-md transition-all font-medium text-[11px]"
              >
                <Play className={cn('h-3.5 w-3.5 text-emerald-400 fill-emerald-400/20', startingQueue && 'animate-bounce')} />
                <span>Start Queue</span>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStopQueue}
                className="gap-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 h-8 px-3 rounded-md transition-all font-medium text-[11px]"
              >
                <Square className="h-3.5 w-3.5 fill-rose-400/20 text-rose-400" />
                <span>Stop Runner</span>
              </Button>
            )}

            <div className="h-4 w-px bg-zinc-800 mx-1" />

            <Button
              variant="ghost"
              size="sm"
              disabled={queueItems.length === 0}
              onClick={handleClearQueue}
              className="gap-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 h-8 px-3 rounded-md transition-all font-medium text-[11px]"
            >
              <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
              <span>Clear Workspace</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={fetchQueue}
              className="gap-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 h-8 px-3 rounded-md transition-all font-medium text-[11px]"
            >
              <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />
              <span>Refresh</span>
            </Button>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-mono pr-2">
            <span>
              {queueItems.length > 0 ? `1-${queueItems.length} of ${queueItems.length}` : '0 of 0'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Split Layout Grid (Outlook Style) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        
        {/* Left Column: Inbox List (Build Queue) */}
        <div className="lg:col-span-5 border border-zinc-800 bg-zinc-950/40 rounded-xl overflow-hidden shadow-xl flex flex-col min-w-0">
          
          {/* Outlook-Style Inbox Search Bar */}
          <div className="p-3 border-b border-zinc-800 bg-zinc-900/30 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
              <input
                type="text"
                placeholder="Search mail (specs, features, status)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-1.5 pl-9 pr-8 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-sans"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800"
              title="Filters"
            >
              <Filter className="h-4 w-4" />
            </Button>
          </div>

          {/* Focused / Other Tabs */}
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/10 px-3 py-1.5 text-xs select-none">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setFilterTab('all')}
                className={cn(
                  "py-1 font-semibold relative text-zinc-400 hover:text-zinc-200 transition-all font-sans",
                  filterTab === 'all' && "text-blue-400 border-b-2 border-blue-500"
                )}
              >
                All
              </button>
              <button
                onClick={() => setFilterTab('focused')}
                className={cn(
                  "py-1 font-semibold relative text-zinc-400 hover:text-zinc-200 transition-all font-sans",
                  filterTab === 'focused' && "text-blue-400 border-b-2 border-blue-500"
                )}
              >
                Focused
                {queueStats.running + queueStats.pending > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-blue-500/20 text-blue-400">
                    {queueStats.running + queueStats.pending}
                  </span>
                )}
              </button>
              <button
                onClick={() => setFilterTab('other')}
                className={cn(
                  "py-1 font-semibold relative text-zinc-400 hover:text-zinc-200 transition-all font-sans",
                  filterTab === 'other' && "text-blue-400 border-b-2 border-blue-500"
                )}
              >
                Other
              </button>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-zinc-500 font-sans">
              <span className="font-semibold">{filteredItems.length} items</span>
              <ChevronDown className="h-3 w-3" />
            </div>
          </div>

          {/* Message List */}
          <div className="divide-y divide-zinc-900/60 overflow-y-auto max-h-[65vh] scrollbar-thin select-none">
            {filteredItems.length > 0 ? (
              filteredItems.map((item, idx) => {
                const isRunning  = item.status === 'running';
                const isFailed   = item.status === 'failed';
                const isDone     = item.status === 'completed';
                const isPending  = !isRunning && !isFailed && !isDone;
                const isSelected = item.id === selectedId;

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-start gap-3.5 px-3.5 py-3 cursor-pointer transition-all duration-150 relative border-b border-zinc-900 group',
                      isSelected
                        ? 'bg-zinc-900/80 text-white border-l-4 border-l-blue-500 shadow-inner'
                        : 'border-l-4 border-l-transparent text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200'
                    )}
                    onClick={() => setSelectedId(item.id)}
                  >
                    {/* Status Color Strip */}
                    <div className={cn(
                      "absolute left-0 top-0 bottom-0 w-1",
                      isRunning ? "bg-violet-500 animate-pulse" :
                      isDone ? "bg-emerald-500" :
                      isFailed ? "bg-rose-500" :
                      "bg-zinc-600"
                    )} />

                    {/* Avatar Icon */}
                    <div className="relative shrink-0 mt-0.5">
                      <div className={cn(
                        "h-9 w-9 rounded-full border flex items-center justify-center font-bold text-xs select-none shadow-sm transition-colors font-sans",
                        isSelected
                          ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 group-hover:bg-zinc-800 group-hover:text-zinc-300'
                      )}>
                        {getInitials(item)}
                      </div>
                      <span className={cn(
                        "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-zinc-950 shadow-sm",
                        isRunning ? "bg-violet-400 animate-pulse" :
                        isDone ? "bg-emerald-400" :
                        isFailed ? "bg-rose-400" :
                        "bg-zinc-500"
                      )} />
                    </div>

                    {/* Text block: 3-line layout */}
                    <div className="flex-1 min-w-0 pr-1 font-sans">
                      {/* Line 1: Sender & Time */}
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn(
                          "font-semibold truncate text-[12px]",
                          isSelected || isRunning ? "text-zinc-100" : "text-zinc-300 group-hover:text-zinc-100"
                        )}>
                          {item.kind.charAt(0).toUpperCase() + item.kind.slice(1)} Build Agent
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono shrink-0 group-hover:hidden">
                          {item.addedAt ? formatTime(item.addedAt) : ''}
                        </span>
                        {/* Floating actions that show on hover instead of timestamp */}
                        <div className="hidden group-hover:flex items-center gap-1 shrink-0 bg-transparent animate-in fade-in duration-200" onClick={e => e.stopPropagation()}>
                          {isFailed && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md"
                              title="Retry Build"
                              onClick={() => handleRetry(item.id)}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-zinc-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-md"
                            title="Remove from queue"
                            onClick={() => handleRemove(item.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Line 2: Subject (Build Name) */}
                      <div className={cn(
                        "text-[12px] truncate mt-0.5",
                        isSelected || isRunning ? "text-white font-medium" : "text-zinc-200 group-hover:text-white"
                      )}>
                        {humanName(item, idx)}
                      </div>

                      {/* Line 3: Snippet / Log preview */}
                      <div className="text-[11px] text-zinc-500 group-hover:text-zinc-400 truncate mt-0.5 leading-snug">
                        {getSnippet(item)}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-center text-zinc-500 px-6 py-12">
                <Inbox className="h-10 w-10 text-zinc-700/60 mb-3" />
                <p className="text-xs font-semibold text-zinc-300 mb-1 font-sans">Your build inbox is empty</p>
                <p className="text-[11px] text-zinc-500 max-w-xs leading-normal font-sans">
                  Ready components will show up here automatically when stories or specs are queued from the dashboard.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Message Details (Log output / Reading Pane) */}
        <div className="lg:col-span-7 border border-zinc-800 bg-zinc-950 rounded-xl shadow-xl overflow-hidden flex flex-col min-w-0 min-h-[550px]">
          {selectedItem ? (
            <div className="flex flex-col h-full">
              {/* Detailed Email-style Header */}
              <div className="bg-zinc-900/20 border-b border-zinc-800 p-5 shrink-0 flex flex-col gap-4">
                {/* Subject Line & Badge */}
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-xl font-bold tracking-tight text-white leading-tight break-words select-text font-sans">
                    {panelLabel}
                  </h2>
                  <Badge className={cn(
                    "shrink-0 font-mono text-[10px] uppercase font-bold",
                    selectedItem.status === 'completed' && "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                    selectedItem.status === 'failed' && "bg-rose-500/10 text-rose-400 border-rose-500/30",
                    selectedItem.status === 'running' && "bg-violet-500/10 text-violet-400 border-violet-500/30 animate-pulse",
                    selectedItem.status === 'pending' && "bg-zinc-800 text-zinc-400 border-zinc-700"
                  )}>
                    {selectedItem.status}
                  </Badge>
                </div>

                {/* Reading Pane Command Bar */}
                <div className="flex items-center justify-between border-t border-b border-zinc-800/80 py-1.5 my-1 text-xs select-none">
                  <div className="flex items-center gap-1 font-sans">
                    {selectedItem.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRetry(selectedItem.id)}
                        className="h-8 text-[11px] gap-1.5 px-3 text-zinc-300 hover:text-white hover:bg-zinc-800"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />
                        <span>Retry Build</span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemove(selectedItem.id)}
                      className="h-8 text-[11px] gap-1.5 px-3 text-zinc-400 hover:text-rose-400 hover:bg-rose-950/20"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Discard logs</span>
                    </Button>
                    <div className="h-4 w-px bg-zinc-800 mx-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-[11px] gap-1.5 px-3 text-zinc-400 hover:text-white hover:bg-zinc-800"
                      title="Move to Folder"
                    >
                      <Archive className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Move to</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-[11px] gap-1.5 px-3 text-zinc-400 hover:text-white hover:bg-zinc-800"
                      title="Categorize"
                    >
                      <Pin className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Pin message</span>
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] font-mono">
                    <span>ID: {selectedItem.id.slice(0, 8)}</span>
                  </div>
                </div>

                {/* Sender/Receiver Meta row */}
                <div className="flex items-start justify-between text-xs gap-3">
                  <div className="flex items-center gap-3">
                    {/* User status avatar */}
                    <div className={cn(
                      "h-10 w-10 rounded-full border flex items-center justify-center font-bold text-sm select-none shrink-0 shadow-inner relative font-sans",
                      selectedItem.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                      selectedItem.status === 'failed' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
                      selectedItem.status === 'running' ? 'bg-violet-500/10 border-violet-500/30 text-violet-400' :
                      'bg-zinc-800 border-zinc-700 text-zinc-400'
                    )}>
                      {getInitials(selectedItem)}
                      <span className={cn(
                        "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-zinc-950",
                        selectedItem.status === 'completed' ? 'bg-emerald-400' :
                        selectedItem.status === 'failed' ? 'bg-rose-400' :
                        selectedItem.status === 'running' ? 'bg-violet-400 animate-pulse' :
                        'bg-zinc-500'
                      )} />
                    </div>

                    <div className="min-w-0 font-sans">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-zinc-200">
                          {selectedItem.kind.charAt(0).toUpperCase() + selectedItem.kind.slice(1)} Build Agent
                        </span>
                        <span className="text-zinc-500 text-[10.5px] font-mono">
                          &lt;pipeline-worker@{selectedItem.id.slice(0, 12)}&gt;
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5 font-sans">
                        to <span className="text-zinc-400">factory-logs-console</span> · phase {selectedItem.priority || 1}
                      </p>
                    </div>
                  </div>

                  <div className="text-right text-[11px] text-zinc-500 font-mono shrink-0">
                    <p title={selectedItem.addedAt}>{new Date(selectedItem.addedAt).toLocaleString()}</p>
                    {selectedItem.durationMs && (
                      <p className="text-zinc-400 mt-0.5 font-medium">Time elapsed: {formatDuration(selectedItem.durationMs)}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Log stream ("Email Content Body") */}
              <div className="p-5 font-mono text-[11px] text-zinc-300 space-y-0.5 select-text overflow-y-auto flex-1 max-h-[60vh] bg-zinc-950/60 scrollbar-thin border-t border-zinc-900">
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
              <Inbox className="h-12 w-12 text-zinc-800 mb-4" />
              <h3 className="text-zinc-300 font-bold text-sm mb-1 font-sans">No build agent selected</h3>
              <p className="text-xs max-w-sm leading-normal font-sans">
                Select a message row from the queue list on the left to inspect detailed live build telemetry and logs in the reading pane.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
