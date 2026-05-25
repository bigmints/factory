'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Terminal, Loader2, XCircle, CheckCircle2, RefreshCw,
  Square, Play, Trash2, Search, Clock, Cpu,
  GitBranch, Zap, AlertTriangle, ChevronRight, Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueItem {
  id: string;
  specFile?: string;
  storyFile?: string;
  displayName?: string;
  kind: string;
  status: string;
  priority: number;
  phase?: number;
  engine?: string;
  addedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  output: string;
  error: string | null;
  durationMs: number | null;
  dependsOn?: string[];
}

interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  blocked: number;
  total: number;
}

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function humanName(item: QueueItem, idx: number, nameMap?: Map<string, string>): string {
  if (item.displayName) return item.displayName;
  const specName = item.storyFile || item.specFile || '';
  if (!specName) return `Build #${idx + 1}`;
  const slug = specName.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '');
  // Look up actual story name from scaffold/stories API
  if (nameMap && nameMap.has(slug)) return nameMap.get(slug)!;
  return slug;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

function formatDuration(ms: number | null): string | null {
  if (!ms) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function getLogPreview(item: QueueItem): string {
  if (item.error) {
    const lines = item.error.trim().split('\n').filter(l => l.trim());
    return lines.at(-1)?.substring(0, 90) ?? 'Build failed';
  }
  if (item.output) {
    const lines = item.output.trim().split('\n').filter(l => l.trim() && !l.includes('.sst'));
    if (lines.length > 0) return lines.at(-1)!.substring(0, 90);
  }
  if (item.status === 'running') return 'Compiling — validation gates in progress...';
  if (item.status === 'pending') return 'Queued — waiting for dependencies to resolve';
  if (item.status === 'completed') return 'Artifacts emitted • AGENTS.md written • committed';
  if (item.status === 'blocked') return 'Blocked by unresolved dependency';
  return 'No output yet';
}

function kindLabel(kind: string): string {
  if (kind === 'AppStory') return 'App';
  if (kind === 'FeatureStory') return 'Feature';
  return kind;
}

// ─── Status Pill ─────────────────────────────────────────────────────────────

function StatusPill({ 
  status, 
  startedAt, 
  durationMs 
}: { 
  status: string; 
  startedAt?: string | null; 
  durationMs?: number | null; 
}) {
  const map: Record<string, string> = {
    running: 'bg-violet-500/15 text-violet-300 border-violet-500/30 animate-pulse',
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    failed: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    blocked: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/30',
    'needs-attention': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  };
  const duration = durationMs ? formatDuration(durationMs) : null;
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border font-mono',
        map[status] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'
      )}>
        {status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />}
        {status === 'completed' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
        {status === 'failed' && <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />}
        {status}
      </span>
      {duration && (
        <span className="text-[10px] text-zinc-500 font-mono">({duration})</span>
      )}
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border px-4 py-2 min-w-[64px]', color)}>
      <span className="text-xl font-bold font-mono tabular-nums leading-none">{value}</span>
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mt-0.5">{label}</span>
    </div>
  );
}

// ─── Log Line renderer ────────────────────────────────────────────────────────

function LogLine({ line }: { line: string }) {
  const isError = line.startsWith('✗') || line.startsWith('✘') || /\berror\b/i.test(line);
  const isSuccess = line.startsWith('✓') || line.startsWith('✔');
  const isStep = line.startsWith('●') || line.startsWith('→') || line.startsWith('[');
  const isWarn = /\bwarn/i.test(line);

  return (
    <div className={cn(
      'leading-5 whitespace-pre-wrap font-mono text-[11px] px-1 py-[1px] rounded',
      isError && 'text-rose-400 bg-rose-950/20 font-semibold',
      isSuccess && !isError && 'text-emerald-400',
      isStep && !isError && !isSuccess && 'text-sky-400 font-semibold',
      isWarn && !isError && !isSuccess && !isStep && 'text-amber-400',
      !isError && !isSuccess && !isStep && !isWarn && 'text-zinc-300',
    )}>
      {line || '\u00A0'}
    </div>
  );
}

// ─── Build Page ───────────────────────────────────────────────────────────────

export function BuildPage() {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buildOutput, setBuildOutput] = useState('');
  const [startingQueue, setStartingQueue] = useState(false);
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  // Mobile: toggle between queue list and logs panel
  const [mobilePanelTab, setMobilePanelTab] = useState<'queue' | 'logs'>('queue');
  const logOffsetRef = useRef(0);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // ── Story name resolution (slug → human name from scaffold/stories APIs) ──
  const [storyNameMap, setStoryNameMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const getSlug = (path: string) => (path.split('/').pop() || '').replace(/\.ya?ml$/i, '');
    async function loadNames() {
      const map = new Map<string, string>();
      try {
        const res = await fetch('/api/stories');
        if (res.ok) {
          const data = await res.json();
          const all = [...(data.stories || []), ...(data.featureStories || [])];
          for (const s of all) {
            const slug = getSlug(s.file || '');
            const name = s.name || s.metadata?.name || '';
            if (slug && name) map.set(slug, name);
          }
        }
      } catch { /* ignore */ }
      try {
        const res = await fetch('/api/app-rollup');
        if (res.ok) {
          const data = await res.json();
          for (const feature of (data.features || [])) {
            for (const s of (feature.stories || [])) {
              const slug = getSlug(s.file || '');
              if (slug && s.name) map.set(slug, s.name); // rollup always wins
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

  // ── Data ──────────────────────────────────────────────────────────────────

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

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  // Stream live log
  useEffect(() => {
    if (!queueRunning) {
      logOffsetRef.current = 0;
      return;
    }
    setBuildOutput('Connecting to pipeline...\n');
    logOffsetRef.current = 0;
    const pollLog = async () => {
      try {
        const res = await fetch(`/api/queue/log?offset=${logOffsetRef.current}`);
        const data = await res.json();
        if (data.log) { setBuildOutput(prev => prev + data.log); logOffsetRef.current = data.offset; }
      } catch {}
    };
    pollLog();
    const interval = setInterval(pollLog, 1500);
    return () => clearInterval(interval);
  }, [queueRunning]);

  useEffect(() => { terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [buildOutput]);

  // Auto-select running item
  useEffect(() => {
    const running = queueItems.find(i => i.status === 'running');
    if (running) {
      setSelectedId(prev => prev && queueItems.some(i => i.id === prev) ? prev : running.id);
    } else {
      setSelectedId(prev => {
        if (prev && queueItems.some(i => i.id === prev)) return prev;
        return queueItems[0]?.id ?? null;
      });
    }
  }, [queueItems]); // eslint-disable-line

  // ── Derived ───────────────────────────────────────────────────────────────

  const stats = useMemo<QueueStats>(() => {
    const s = { pending: 0, running: 0, completed: 0, failed: 0, blocked: 0, total: queueItems.length };
    queueItems.forEach(i => {
      if (i.status === 'running') s.running++;
      else if (i.status === 'completed') s.completed++;
      else if (i.status === 'failed') s.failed++;
      else if (i.status === 'blocked') s.blocked++;
      else s.pending++;
    });
    return s;
  }, [queueItems]);

  const filteredItems = useMemo(() => {
    return queueItems.filter(item => {
      const name = humanName(item, queueItems.indexOf(item), storyNameMap).toLowerCase();
      const matchesSearch = !searchQuery || name.includes(searchQuery.toLowerCase()) ||
        item.kind.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.status.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (filterStatus === 'active') return item.status === 'running' || item.status === 'pending';
      if (filterStatus === 'completed') return item.status === 'completed';
      if (filterStatus === 'failed') return item.status === 'failed' || item.status === 'blocked';
      return true;
    });
  }, [queueItems, filterStatus, searchQuery]);

  const selectedItem = queueItems.find(i => i.id === selectedId) ?? null;
  const isSelectedRunning = selectedItem?.status === 'running';
  const panelLog = selectedItem
    ? (isSelectedRunning
      ? (buildOutput || selectedItem.output || '')
      : (selectedItem.output || selectedItem.error || ''))
    : (buildOutput || '');

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleStartQueue = async () => {
    setStartingQueue(true);
    try {
      const res = await fetch('/api/queue/start', { method: 'POST' });
      if (res.ok) { toast.success('Pipeline started'); fetchQueue(); }
      else { const d = await res.json(); toast.error(d.error ?? 'Failed to start pipeline'); }
    } catch { toast.error('Failed to start pipeline'); }
    finally { setStartingQueue(false); }
  };

  const handleStopQueue = async () => {
    try {
      const res = await fetch('/api/queue/stop', { method: 'POST' });
      if (res.ok) { toast.success('Pipeline stopped'); fetchQueue(); }
      else toast.error('Failed to stop pipeline');
    } catch { toast.error('Failed to stop pipeline'); }
  };

  const handleClearQueue = async () => {
    try {
      const res = await fetch('/api/queue/clear', { method: 'POST' });
      if (res.ok) { toast.success('Completed runs cleared'); fetchQueue(); }
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
      if (res.ok) { toast.success('Build re-queued'); fetchQueue(); handleStartQueue(); }
      else toast.error('Retry failed');
    } catch { toast.error('Retry failed'); }
  };

  const handleRemove = async (id: string) => {
    try {
      const res = await fetch('/api/queue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) { toast.success('Removed from queue'); fetchQueue(); }
      else toast.error('Failed to remove');
    } catch { toast.error('Failed to remove'); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3 h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-1">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'h-2.5 w-2.5 rounded-full ring-2 transition-all shrink-0',
            queueRunning
              ? 'bg-violet-400 ring-violet-500/30 animate-pulse'
              : 'bg-zinc-600 ring-zinc-700/30'
          )} />
          <div>
            <h1 className="text-sm md:text-base font-bold tracking-tight text-white font-sans">Build Pipeline</h1>
            <p className="text-[11px] text-zinc-500 font-sans">
              {queueRunning
                ? `Running — ${stats.running} active build${stats.running !== 1 ? 's' : ''}`
                : stats.pending > 0
                  ? `${stats.pending} build${stats.pending !== 1 ? 's' : ''} queued`
                  : 'Idle — no pending builds'}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={fetchQueue}
            className="tap-shrink h-8 px-2.5 flex items-center gap-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 text-[11px] font-sans"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            disabled={stats.completed === 0}
            onClick={handleClearQueue}
            className="tap-shrink h-8 px-2.5 flex items-center gap-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-[11px] font-sans disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear done</span>
          </button>

          {!queueRunning ? (
            <button
              disabled={startingQueue || stats.pending === 0}
              onClick={handleStartQueue}
              className="tap-shrink h-8 px-3 flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[11px] font-sans shadow-lg shadow-violet-900/30 disabled:opacity-40"
            >
              {startingQueue
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Play className="h-3.5 w-3.5 fill-white" />}
              Run
            </button>
          ) : (
            <button
              onClick={handleStopQueue}
              className="tap-shrink h-8 px-3 flex items-center gap-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-rose-400 font-semibold text-[11px] font-sans border border-zinc-700"
            >
              <Square className="h-3.5 w-3.5 fill-rose-400" />
              Stop
            </button>
          )}
        </div>
      </div>



      {/* Mobile tab toggle: Queue | Logs */}
      <div className="flex md:hidden items-center gap-1 px-1">
        <button
          onClick={() => setMobilePanelTab('queue')}
          className={cn(
            'tap-shrink flex-1 h-8 rounded-lg text-[11px] font-semibold font-sans transition-all',
            mobilePanelTab === 'queue'
              ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          Queue ({filteredItems.length})
        </button>
        <button
          onClick={() => { setMobilePanelTab('logs'); }}
          className={cn(
            'tap-shrink flex-1 h-8 rounded-lg text-[11px] font-semibold font-sans transition-all flex items-center justify-center gap-1.5',
            mobilePanelTab === 'logs'
              ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
              : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          <Terminal className="h-3 w-3" />
          Logs
          {queueRunning && <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />}
        </button>
      </div>

      {/* ── Split Layout ── */}
      {/* On mobile: toggle between queue list and log panel */}
      {/* On desktop: side-by-side grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 md:gap-4 h-[calc(100vh-170px)] lg:h-[calc(100vh-120px)] min-h-0">

        {/* Left: Queue list — hidden on mobile when logs tab is active */}
        <div className={cn(
          'lg:col-span-4 flex flex-col border border-zinc-800 bg-zinc-950/40 rounded-xl overflow-hidden shadow-xl',
          mobilePanelTab === 'logs' ? 'hidden lg:flex' : 'flex'
        )}>

          {/* Search + filter */}
          <div className="p-2.5 border-b border-zinc-800/80 flex flex-col gap-2 bg-zinc-900/30">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Filter builds..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/60 focus:border-violet-500/50 font-sans"
              />
            </div>
            <div className="flex items-center gap-1">
              {(['all', 'active', 'completed', 'failed'] as StatusFilter[]).map(f => {
                const label = f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'completed' ? 'Completed' : 'Failed';
                const count = f === 'all' ? stats.total
                  : f === 'active' ? (stats.running + stats.pending)
                  : f === 'completed' ? stats.completed
                  : (stats.failed + stats.blocked);
                const countColor = f === 'active' ? 'text-violet-400'
                  : f === 'completed' ? 'text-emerald-400'
                  : f === 'failed' ? 'text-rose-400'
                  : 'text-zinc-400';

                return (
                  <button
                    key={f}
                    onClick={() => setFilterStatus(f)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide transition-all font-sans flex items-center gap-1',
                      filterStatus === f
                        ? 'bg-zinc-700 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    )}
                  >
                    <span>{label}</span>
                    <span className={cn('font-mono font-bold', countColor)}>
                      ({count})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Build list */}
          <div className="divide-y divide-zinc-900/60 overflow-y-auto flex-1 scrollbar-thin">
            {filteredItems.length > 0 ? (
              filteredItems.map((item, idx) => {
                const isSelected = item.id === selectedId;
                const isRunning = item.status === 'running';
                const isFailed = item.status === 'failed' || item.status === 'blocked';
                const isDone = item.status === 'completed';

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-start gap-3 px-3.5 py-3 cursor-pointer transition-all duration-150 group relative',
                      isSelected
                        ? 'bg-zinc-800/70 border-l-2 border-l-violet-500'
                        : 'border-l-2 border-l-transparent hover:bg-zinc-900/50 hover:border-l-zinc-700'
                    )}
                    onClick={() => {
                      setSelectedId(item.id);
                      // On mobile, switch to logs tab when selecting a build
                      setMobilePanelTab('logs');
                    }}
                  >
                    {/* Kind icon */}
                    <div className={cn(
                      'shrink-0 mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center border text-xs font-bold font-mono',
                      isRunning ? 'bg-violet-500/10 border-violet-500/30 text-violet-400' :
                      isDone ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                      isFailed ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                      'bg-zinc-800/80 border-zinc-700/50 text-zinc-400'
                    )}>
                      {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                       isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                       isFailed ? <XCircle className="h-3.5 w-3.5" /> :
                       <Package className="h-3.5 w-3.5" />}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={cn(
                          'text-xs font-semibold truncate font-sans',
                          isSelected || isRunning ? 'text-white' : 'text-zinc-200 group-hover:text-white'
                        )}>
                          {humanName(item, idx, storyNameMap)}
                        </span>
                        <span className="text-[10px] text-zinc-600 font-mono shrink-0 tabular-nums">
                          {formatRelativeTime(item.addedAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded border font-mono font-semibold uppercase tracking-wider',
                          'bg-zinc-800/60 border-zinc-700/50 text-zinc-500'
                        )}>
                          {kindLabel(item.kind)}
                        </span>
                        {item.phase && item.phase > 0 && (
                          <span className="text-[10px] text-zinc-600 font-mono">
                            phase {item.phase}
                          </span>
                        )}
                        <StatusPill status={item.status} />
                      </div>

                      <p className="text-[10.5px] text-zinc-600 truncate mt-1 font-sans leading-snug">
                        {getLogPreview(item)}
                      </p>

                      {/* Always-visible touch actions (mobile) + hover on desktop */}
                      <div className="flex items-center gap-1 mt-2 md:hidden" onClick={e => e.stopPropagation()}>
                        {isFailed && (
                          <button
                            className="tap-shrink px-2 py-1 rounded-md text-[10px] text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 flex items-center gap-1"
                            onClick={() => handleRetry(item.id)}
                          >
                            <RefreshCw className="h-3 w-3" /> Retry
                          </button>
                        )}
                        <button
                          className="tap-shrink px-2 py-1 rounded-md text-[10px] text-zinc-500 hover:text-rose-400 bg-zinc-800 hover:bg-rose-950/30 flex items-center gap-1"
                          onClick={() => handleRemove(item.id)}
                        >
                          <XCircle className="h-3 w-3" /> Remove
                        </button>
                      </div>
                    </div>

                    {/* Desktop hover actions */}
                    <div className="hidden md:group-hover:flex items-center gap-1 shrink-0 absolute right-2 top-3" onClick={e => e.stopPropagation()}>
                      {isFailed && (
                        <button
                          className="p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-700"
                          title="Retry"
                          onClick={() => handleRetry(item.id)}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30"
                        title="Remove"
                        onClick={() => handleRemove(item.id)}
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    </div>

                    {isSelected && (
                      <ChevronRight className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-2 hidden md:block" />
                    )}
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-center px-6">
                <Cpu className="h-8 w-8 text-zinc-700/50 mb-3" />
                <p className="text-xs font-semibold text-zinc-400 mb-1 font-sans">No builds in queue</p>
                <p className="text-[11px] text-zinc-600 leading-normal font-sans max-w-[200px]">
                  Queue stories from the Roadmap board to start building.
                </p>
              </div>
            )}
          </div>

          {/* Footer count */}
          <div className="border-t border-zinc-800/60 px-3.5 py-2 flex items-center justify-between bg-zinc-900/20">
            <span className="text-[10px] text-zinc-600 font-mono tabular-nums">
              {filteredItems.length} of {queueItems.length} builds
            </span>
            {queueRunning && (
              <span className="flex items-center gap-1 text-[10px] text-violet-400 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
                Runner active
              </span>
            )}
          </div>
        </div>

        {/* Right: Terminal / detail panel — hidden on mobile when queue tab is active */}
        <div className={cn(
          'lg:col-span-8 border border-zinc-800 bg-zinc-950 rounded-xl shadow-xl overflow-hidden flex flex-col min-h-0',
          mobilePanelTab === 'queue' ? 'hidden lg:flex' : 'flex'
        )}>

          {selectedItem ? (
            <>
              {/* Build header */}
              <div className="border-b border-zinc-800 bg-zinc-900/30 px-5 py-3 shrink-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-white leading-tight font-sans truncate">
                      {humanName(selectedItem, queueItems.indexOf(selectedItem), storyNameMap)}
                    </h2>
                    
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-zinc-500 font-mono mt-1">
                      <span className="uppercase tracking-wider font-bold text-zinc-400">
                        {kindLabel(selectedItem.kind)}
                      </span>
                      {selectedItem.phase !== undefined && selectedItem.phase > 0 && (
                        <span>· phase {selectedItem.phase}</span>
                      )}
                      {selectedItem.engine && (
                        <span>· engine: {selectedItem.engine}</span>
                      )}
                      {selectedItem.dependsOn && selectedItem.dependsOn.length > 0 && (
                        <span className="text-zinc-600">
                          · depends on: {selectedItem.dependsOn.join(', ')}
                        </span>
                      )}
                      <span className="text-zinc-700">
                        · id: {selectedItem.id.replace('q_', '').slice(0, 8)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedItem.status === 'failed' || selectedItem.status === 'blocked' ? (
                      <Button
                        size="sm"
                        onClick={() => handleRetry(selectedItem.id)}
                        className="h-7 px-2.5 gap-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-sans border border-zinc-700 font-medium"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retry
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemove(selectedItem.id)}
                      className="h-7 px-2 text-[10px] text-zinc-500 hover:text-rose-400 hover:bg-rose-950/20 font-sans font-medium flex items-center gap-1"
                      title="Remove build from queue"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </Button>
                    <StatusPill 
                      status={selectedItem.status} 
                      startedAt={selectedItem.startedAt}
                      durationMs={selectedItem.durationMs}
                    />
                  </div>
                </div>




              </div>

              {/* Terminal output */}

              <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
                {panelLog ? (
                  <div className="space-y-px">
                    {panelLog.split('\n').map((line, i) => (
                      <LogLine key={i} line={line} />
                    ))}
                    <div ref={terminalEndRef} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center py-16">
                    <Terminal className="h-8 w-8 text-zinc-800 mb-3" />
                    <p className="text-xs text-zinc-600 italic font-sans">
                      {selectedItem.status === 'pending'
                        ? 'Build is queued — output will appear once the runner starts.'
                        : 'No log output recorded.'}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <Terminal className="h-10 w-10 text-zinc-800 mb-4" />
              <p className="text-sm font-semibold text-zinc-400 mb-1 font-sans">No build selected</p>
              <p className="text-xs text-zinc-600 max-w-xs leading-normal font-sans">
                Select a build from the queue list to view its logs and status.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
