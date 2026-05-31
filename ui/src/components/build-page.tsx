'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Terminal, Loader2, XCircle, CheckCircle2,
  Square, Play, Search, Cpu, PauseCircle,
  ChevronRight, Package, Sparkles, ChevronDown, ChevronUp, RotateCcw,
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
  status: 'draft' | 'ready-to-build' | 'building' | 'paused' | 'failed' | 'done' | string;
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
  'ready-to-build': number;
  building: number;
  done: number;
  failed: number;
  paused: number;
  total: number;
}

type StatusFilter = 'all' | 'active' | 'completed' | 'stopped';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a kebab/snake slug into a readable title. */
function slugToTitle(slug: string): string {
  return slug
    .replace(/^fix-/, '')           // strip leading "fix-" prefix
    .replace(/^fix-/, '')           // strip second one e.g. fix-fix-
    .replace(/-/g, ' ')             // dashes → spaces
    .replace(/\b\w/g, c => c.toUpperCase()); // title-case
}

function humanName(item: QueueItem, idx: number, nameMap?: Map<string, string>): string {
  if (item.displayName) return item.displayName;
  const specName = item.storyFile || item.specFile || '';
  if (!specName) return `Build #${idx + 1}`;
  const slug = specName.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '');
  // Prefer resolved story name from API
  if (nameMap && nameMap.has(slug)) return nameMap.get(slug)!;
  // Fall back to humanized slug
  return slugToTitle(slug);
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  if (item.status === 'building') return 'Compiling — validation gates in progress...';
  if (item.status === 'ready-to-build') return 'Queued — waiting for dependencies to resolve';
  if (item.status === 'done') return 'Artifacts emitted • AGENTS.md written • committed';
  if (item.status === 'paused') return 'Paused — stopped by user or blocked by dependency';
  return 'No output yet';
}

function kindLabel(kind: string): string {
  if (kind === 'AppStory') return 'New app';
  if (kind === 'FeatureStory') return 'Feature update';
  return kind;
}

/** Map heartbeat task strings to plain English. */
function taskToLabel(task: string | null, elapsed: number): string | null {
  if (!task) return null;
  if (/orchestrat.*turn\s*(\d+)/i.test(task)) {
    const m = task.match(/(\d+)/);
    const n = m ? parseInt(m[1]) : 1;
    if (n === 1) {
      // Show time-aware message for turn 1 (agy is planning silently)
      if (elapsed < 30)  return 'Preparing task brief…';
      if (elapsed < 90)  return 'AI engineer is reading the codebase…';
      if (elapsed < 180) return 'AI engineer is planning the changes…';
      if (elapsed < 300) return 'AI engineer is writing code…';
      return `AI engineer is working hard… (${Math.floor(elapsed / 60)}m)`;
    }
    if (n === 2) return 'Reviewing output…';
    return `Reviewing and refining… (pass ${n})`;
  }
  if (/delegat/i.test(task)) return 'AI engineer is coding…';
  if (/interven/i.test(task)) return 'Reviewing progress…';
  if (/gather/i.test(task)) return 'Reading codebase…';
  if (/plan/i.test(task)) return 'Planning changes…';
  if (/build/i.test(task)) return 'Writing code…';
  if (/test/i.test(task)) return 'Running tests…';
  if (/commit/i.test(task)) return 'Committing changes…';
  if (/mark_story_done/i.test(task)) return 'Wrapping up…';
  return null;
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
    building: 'bg-violet-500/15 text-violet-300 border-violet-500/30 animate-pulse',
    'ready-to-build': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    done: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    failed: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    paused: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/30',
  };
  const duration = durationMs ? formatDuration(durationMs) : null;
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border font-mono',
        map[status] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'
      )}>
        {status === 'building' && <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />}
        {status === 'done' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
        {status === 'failed' && <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />}
        {status === 'paused' && <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />}
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

// ─── Completed Summary Banner ────────────────────────────────────────────────

function CompletedSummaryBanner({ itemId, durationMs, completedAt }: { itemId: string; durationMs: number | null; completedAt: string | null }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [cli, setCli] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/queue/${itemId}/summary`)
      .then(r => r.json())
      .then(d => {
        setSummary(d.summary || null);
        setCli(d.meta?.cli || null);
      })
      .catch(() => {});
  }, [itemId]);

  return (
    <div className="shrink-0 border-b border-zinc-800/60 bg-emerald-950/20 px-5 py-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-[12px] font-semibold text-emerald-400 font-sans">Done</span>
        {cli && <span className="text-[10px] text-zinc-600 font-mono ml-1">via {cli}</span>}
        <span className="text-[10px] text-zinc-600 font-sans ml-auto flex items-center gap-2">
          {durationMs && <span>took {formatDuration(durationMs)}</span>}
          {completedAt && <span className="text-emerald-700/80">· {formatAbsoluteTime(completedAt)}</span>}
        </span>
      </div>
      {summary ? (
        <p className="text-[11.5px] text-zinc-300 font-sans leading-relaxed">{summary}</p>
      ) : (
        <p className="text-[11px] text-zinc-600 font-sans italic">Loading delivery summary…</p>
      )}
    </div>
  );
}

// ─── Build Page ───────────────────────────────────────────────────────────────

export function BuildPage() {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buildOutput, setBuildOutput] = useState('');
  const [aiSummary, setAiSummary] = useState<{ text: string; ts: string } | null>(null);
  const [heartbeatRaw, setHeartbeatRaw] = useState<string | null>(null);
  const [rawLogOpen, setRawLogOpen] = useState(false);
  const [startingQueue, setStartingQueue] = useState(false);
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  // Mobile: toggle between queue list and logs panel
  const [mobilePanelTab, setMobilePanelTab] = useState<'queue' | 'logs'>('queue');
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const [elapsed, setElapsed] = useState(0); // seconds since startedAt

  // Live elapsed timer — ticks every second while running
  useEffect(() => {
    const runningItem = queueItems.find(i => i.status === 'building');
    if (!runningItem?.startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(runningItem.startedAt!).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [queueItems]);

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
      setQueueRunning(items.some(i => i.status === 'building'));
    } catch {}
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  // ── SSE: live log + AI summary ─────────────────────────────────────────
  useEffect(() => {
    // Close any previous SSE connection
    sseRef.current?.close();
    sseRef.current = null;

    const runningItem = queueItems.find(i => i.status === 'building');
    if (!runningItem) return;

    const slug = (runningItem.storyFile || runningItem.specFile || '')
      .replace(/^(features|apps|done)\//, '')
      .replace(/\.ya?ml$/i, '');
    if (!slug) return;

    setBuildOutput('');
    setAiSummary(null);
    setHeartbeatRaw(null);

    const es = new EventSource(`/api/build-events?slug=${encodeURIComponent(slug)}`);
    sseRef.current = es;

    es.addEventListener('log', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.reset) {
          setBuildOutput(d.text || '');
        } else if (d.text) {
          setBuildOutput(prev => prev + d.text);
        }
      } catch {}
    });

    es.addEventListener('summary', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.text) setAiSummary({ text: d.text, ts: d.ts || new Date().toISOString() });
      } catch {}
    });

    es.addEventListener('heartbeat', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.raw) setHeartbeatRaw(d.raw);
      } catch {}
    });

    es.onerror = () => { es.close(); };

    return () => { es.close(); sseRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueItems.find(i => i.status === 'building')?.id]);

  useEffect(() => { terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [buildOutput, rawLogOpen]);

  // Auto-select running item
  useEffect(() => {
    const running = queueItems.find(i => i.status === 'building');
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
    const s = { 'ready-to-build': 0, building: 0, done: 0, failed: 0, paused: 0, total: queueItems.length };
    queueItems.forEach(i => {
      if (i.status === 'building') s.building++;
      else if (i.status === 'done') s.done++;
      else if (i.status === 'failed') s.failed++;
      else if (i.status === 'paused') s.paused++;
      else s['ready-to-build']++;
    });
    return s;
  }, [queueItems]);

  const filteredItems = useMemo(() => {
    const statusOrder: Record<string, number> = {
      building: 0, 'ready-to-build': 1, paused: 2, failed: 3, done: 5,
    };
    return queueItems
      .filter(item => {
        const name = humanName(item, queueItems.indexOf(item), storyNameMap).toLowerCase();
        const matchesSearch = !searchQuery || name.includes(searchQuery.toLowerCase()) ||
          item.kind.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.status.toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesSearch) return false;
        if (filterStatus === 'active') return item.status === 'building' || item.status === 'ready-to-build';
        if (filterStatus === 'completed') return item.status === 'done';
        if (filterStatus === 'stopped') return item.status === 'failed' || item.status === 'paused';
        return true;
      })
      .sort((a, b) => {
        const groupDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
        if (groupDiff !== 0) return groupDiff;
        // Within completed group: most recently completed first
        if (a.status === 'done' && b.status === 'done') {
          const aT = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const bT = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          return bT - aT;
        }
        // Within other groups: preserve original queue order (addedAt asc)
        return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
      });
  }, [queueItems, filterStatus, searchQuery]);

  const selectedItem = queueItems.find(i => i.id === selectedId) ?? null;
  const isSelectedRunning = selectedItem?.status === 'building';
  const panelLog = selectedItem
    ? (isSelectedRunning
      ? (buildOutput || selectedItem.output || '')
      : (selectedItem.output || selectedItem.error || ''))
    : (buildOutput || '');

  const heartbeatTask = useMemo(() => {
    if (!heartbeatRaw) return null;
    const m = heartbeatRaw.match(/task:\s*(.+)/);
    return m ? taskToLabel(m[1].trim(), elapsed) : null;
  }, [heartbeatRaw, elapsed]);

  // Strip internal headers/separators from log before display
  const cleanLog = (raw: string) =>
    raw
      .split('\n')
      .filter(l => {
        const t = l.trim();
        if (!t) return false;
        if (/^=+$/.test(t)) return false;                    // === separators
        if (/^\[\d{4}-\d{2}-\d{2}.*\] delegate_to_cli/.test(t)) return false; // timestamp header
        if (/^\[\d{4}-\d{2}-\d{2}.*\] CLI exited/.test(t)) return false;
        if (/^CWD:/.test(t)) return false;                   // CWD: /path
        if (/^\(log:/.test(t)) return false;                 // (log: /path)
        if (/^Waiting for CLI to start/.test(t)) return false;
        return true;
      })
      .join('\n');

  const cleanedLog = cleanLog(panelLog);
  const hasRealLog = cleanedLog.trim().length > 0;

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60); const sec = s % 60;
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  };

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
      if (res.ok) { toast.success('Build re-queued'); fetchQueue(); }
      else toast.error('Retry failed');
    } catch { toast.error('Retry failed'); }
  };

  const handleStartTask = async (id: string) => {
    try {
      const res = await fetch(`/api/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (res.ok) {
        toast.success('Task started');
        fetchQueue();
        fetch('/api/queue/start', { method: 'POST' }).then(() => fetchQueue());
      } else {
        toast.error('Failed to start task');
      }
    } catch {
      toast.error('Failed to start task');
    }
  };

  const handleStopTask = async (id: string) => {
    try {
      const res = await fetch(`/api/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      if (res.ok) {
        toast.success('Task stopped');
        fetchQueue();
      } else {
        toast.error('Failed to stop task');
      }
    } catch {
      toast.error('Failed to stop task');
    }
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
                ? `Running — ${stats.building} active build${stats.building !== 1 ? 's' : ''}`
                : stats["ready-to-build"] > 0
                  ? `${stats["ready-to-build"]} build${stats["ready-to-build"] !== 1 ? 's' : ''} queued`
                  : 'Idle — no pending builds'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!queueRunning ? (
            <button
              disabled={startingQueue || stats["ready-to-build"] === 0}
              onClick={handleStartQueue}
              className="tap-shrink h-8 px-3 flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[11px] font-sans shadow-lg shadow-violet-900/30 disabled:opacity-40"
            >
              {startingQueue
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Play className="h-3.5 w-3.5 fill-white" />}
              Run queue
            </button>
          ) : (
            <button
              onClick={handleStopQueue}
              className="tap-shrink h-8 px-3 flex items-center gap-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold text-[11px] font-sans border border-zinc-700"
              title="Pause queue — running builds finish normally"
            >
              <PauseCircle className="h-3.5 w-3.5" />
              Pause queue
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
              {(['all', 'active', 'completed', 'stopped'] as StatusFilter[]).map(f => {
                const label = f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'completed' ? 'Done' : 'Stopped';
                const count = f === 'all' ? stats.total
                  : f === 'active' ? (stats.building + stats["ready-to-build"])
                  : f === 'completed' ? stats.done
                  : (stats.failed + stats.paused);
                const countColor = f === 'active' ? 'text-violet-400'
                  : f === 'completed' ? 'text-emerald-400'
                  : f === 'stopped' ? 'text-zinc-400'
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
                const isRunning = item.status === 'building';
                const isPaused = item.status === 'paused';
                const isFailed = item.status === 'failed';
                const isStopped = isPaused || isFailed;
                const isDone = item.status === 'done';

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
                      isPaused ? 'bg-zinc-800/60 border-zinc-700/40 text-zinc-500' :
                      'bg-zinc-800/80 border-zinc-700/50 text-zinc-400'
                    )}>
                      {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                       isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                       isFailed ? <XCircle className="h-3.5 w-3.5" /> :
                       isPaused ? <Square className="h-3.5 w-3.5" /> :
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
                          {isDone && item.completedAt
                            ? <span className="text-emerald-700">✓ {formatRelativeTime(item.completedAt)}</span>
                            : formatRelativeTime(item.addedAt)}
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

                      {/* Mobile quick actions */}
                      <div className="flex items-center gap-1 mt-2 md:hidden" onClick={e => e.stopPropagation()}>
                        {isRunning && (
                          <button
                            className="tap-shrink px-2 py-1 rounded-md text-[10px] text-zinc-300 bg-zinc-800 hover:bg-zinc-700 flex items-center gap-1 border border-zinc-700 font-semibold"
                            onClick={() => handleStopTask(item.id)}
                          >
                            <Square className="h-3 w-3" /> Stop
                          </button>
                        )}
                        {(isStopped || item.status === 'ready-to-build') && (
                          <button
                            className="tap-shrink px-2 py-1 rounded-md text-[10px] text-zinc-300 bg-zinc-800 hover:bg-zinc-700 flex items-center gap-1 border border-zinc-700 font-semibold"
                            onClick={() => isStopped ? handleRetry(item.id) : handleStartTask(item.id)}
                          >
                            {isStopped
                              ? <><RotateCcw className="h-3 w-3" /> Retry</>
                              : <><Play className="h-3 w-3 fill-current" /> Start</>
                            }
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Desktop hover actions */}
                    <div className="hidden md:group-hover:flex items-center gap-1 shrink-0 absolute right-2 top-3" onClick={e => e.stopPropagation()}>
                      {isRunning && (
                        <button
                          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700"
                          title="Stop this build"
                          onClick={() => handleStopTask(item.id)}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {item.status === 'ready-to-build' && (
                        <button
                          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700"
                          title="Start now"
                          onClick={() => handleStartTask(item.id)}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {isStopped && (
                        <button
                          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700"
                          title="Retry"
                          onClick={() => handleRetry(item.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
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
              {/* ── Build header ── */}
              <div className="border-b border-zinc-800 bg-zinc-900/30 px-5 py-3.5 shrink-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-white leading-tight font-sans truncate">
                      {humanName(selectedItem, queueItems.indexOf(selectedItem), storyNameMap)}
                    </h2>
                    <p className="text-[11px] text-zinc-500 font-sans mt-0.5">
                      {kindLabel(selectedItem.kind)}
                      {selectedItem.status === 'done' && selectedItem.completedAt ? (
                        <span className="text-emerald-600"> · done at {formatAbsoluteTime(selectedItem.completedAt)}</span>
                      ) : selectedItem.startedAt ? (
                        <span className="text-zinc-600"> · started {formatRelativeTime(selectedItem.startedAt)}</span>
                      ) : null}
                      {selectedItem.durationMs && (
                        <span className="text-zinc-600"> · took {formatDuration(selectedItem.durationMs)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Story-level actions — single button per state */}
                    {selectedItem.status === 'building' && (
                      <Button
                        size="sm"
                        onClick={() => handleStopTask(selectedItem.id)}
                        className="h-7 px-2.5 gap-1.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-semibold"
                      >
                        <Square className="h-3 w-3" />
                        Stop
                      </Button>
                    )}
                    {selectedItem.status === 'ready-to-build' && (
                      <Button
                        size="sm"
                        onClick={() => handleStartTask(selectedItem.id)}
                        className="h-7 px-2.5 gap-1.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-semibold"
                      >
                        <Play className="h-3 w-3" />
                        Start
                      </Button>
                    )}
                    {(selectedItem.status === 'paused' || selectedItem.status === 'failed') && (
                      <Button
                        size="sm"
                        onClick={() => handleRetry(selectedItem.id)}
                        className="h-7 px-2.5 gap-1.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-semibold"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Retry
                      </Button>
                    )}
                    <StatusPill
                      status={selectedItem.status}
                      startedAt={selectedItem.startedAt}
                      durationMs={selectedItem.durationMs}
                    />
                  </div>
                </div>
              </div>

              {/* ── Status / log panel ── */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">

                {/* Activity strip — only when running */}
                {isSelectedRunning && (
                  <div className="shrink-0 border-b border-zinc-800/60 bg-zinc-900/50 px-5 py-4">

                    {/* Activity + elapsed time */}
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                        </span>
                        <span className="text-[13px] font-medium text-white font-sans">
                          {heartbeatTask || 'Getting started…'}
                        </span>
                      </div>
                      {elapsed > 0 && (
                        <span className="text-[11px] text-zinc-500 font-mono tabular-nums shrink-0">
                          {formatElapsed(elapsed)}
                        </span>
                      )}
                    </div>

                    {/* AI summary bullets OR time-aware fallback */}
                    {aiSummary ? (
                      <div className="space-y-1.5 pl-4 border-l border-zinc-800">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Sparkles className="h-3 w-3 text-amber-400/70" />
                          <span className="text-[10px] text-zinc-500 font-sans">Updated {new Date(aiSummary.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        {aiSummary.text.split('\n').filter(Boolean).map((line, i) => (
                          <p key={i} className="text-[12px] text-zinc-300 font-sans leading-relaxed">
                            {line.replace(/^[-•*✅🔨🐛⚠️❌]\s*/, '')}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <div className="pl-4 border-l border-zinc-800 space-y-1">
                        <p className="text-[12px] text-zinc-400 font-sans">
                          {elapsed < 30
                            ? 'Sending task to AI engineer…'
                            : elapsed < 90
                            ? 'AI engineer is reading through the codebase.'
                            : elapsed < 180
                            ? 'AI engineer is planning the implementation.'
                            : elapsed < 360
                            ? 'AI engineer is writing code. This typically takes 3–6 minutes.'
                            : `AI engineer has been working for ${Math.floor(elapsed / 60)}m. Complex tasks can take up to 10 minutes.`}
                        </p>
                        <p className="text-[10px] text-zinc-600 font-sans">
                          Output will appear in the log below once the AI starts writing files.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Completed summary — uses build receipt prose */}
                {!isSelectedRunning && selectedItem.status === 'done' && (
                  <CompletedSummaryBanner itemId={selectedItem.id} durationMs={selectedItem.durationMs} completedAt={selectedItem.completedAt} />
                )}

                {!isSelectedRunning && selectedItem.status === 'paused' && (
                  <div className="shrink-0 border-b border-zinc-800/60 bg-zinc-900/40 px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <Square className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-[12px] font-semibold text-zinc-400 font-sans">Stopped by user</span>
                    </div>
                  </div>
                )}

                {!isSelectedRunning && (selectedItem.status === 'failed' || selectedItem.status === 'paused') && (
                  <div className="shrink-0 border-b border-zinc-800/60 bg-rose-950/20 px-5 py-3.5">
                    <div className="flex items-center gap-2 mb-1">
                      <XCircle className="h-3.5 w-3.5 text-rose-400" />
                      <span className="text-[12px] font-semibold text-rose-400 font-sans">
                        {selectedItem.status === 'paused' ? 'Waiting on another task' : 'Something went wrong'}
                      </span>
                    </div>
                    {selectedItem.error && (
                      <p className="text-[11px] text-zinc-400 font-sans line-clamp-2">{selectedItem.error.split('\n').filter(Boolean).at(-1)}</p>
                    )}
                  </div>
                )}

                {/* Raw log — only shown when there's real content */}
                {hasRealLog ? (
                  <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                    <button
                      onClick={() => setRawLogOpen(p => !p)}
                      className="shrink-0 flex items-center justify-between px-5 py-2 border-b border-zinc-800/40 hover:bg-zinc-900/30 transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <Terminal className="h-3 w-3 text-zinc-600 group-hover:text-zinc-400" />
                        <span className="text-[10px] font-medium text-zinc-600 group-hover:text-zinc-400 font-sans">
                          View full log
                        </span>
                        {!rawLogOpen && (
                          <span className="text-[9px] text-zinc-700 font-mono">
                            ({cleanedLog.split('\n').length} lines)
                          </span>
                        )}
                      </div>
                      {rawLogOpen
                        ? <ChevronUp className="h-3 w-3 text-zinc-600" />
                        : <ChevronDown className="h-3 w-3 text-zinc-600" />}
                    </button>

                    {rawLogOpen && (
                      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0 bg-black/30">
                        <div className="space-y-px">
                          {cleanedLog.split('\n').map((line, i) => <LogLine key={i} line={line} />)}
                          <div ref={terminalEndRef} />
                        </div>
                      </div>
                    )}
                  </div>
                ) : selectedItem.status === 'ready-to-build' ? (
                  <div className="flex flex-col items-center justify-center flex-1 text-center py-16">
                    <div className="h-8 w-8 rounded-full border-2 border-zinc-800 border-t-violet-500 animate-spin mb-4" />
                    <p className="text-sm font-medium text-zinc-400 font-sans">Waiting in queue</p>
                    <p className="text-xs text-zinc-600 font-sans mt-1">Will start once the current task finishes.</p>
                  </div>
                ) : null}
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
