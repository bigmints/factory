'use client';

import { useEffect, useRef, useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  Square,
  Save,
  Loader2,
  Copy,
  Check,
  X,
  FileText,
  Terminal,
  Package,
  Layers,
  SaveAll,
  Clock,
  Trash2,
  Brain,
  ListTodo,
  BookOpen,
  Cpu,
  Zap,
  FileSearch,
  GitBranch,
  Hash,
  ExternalLink,
  ScanSearch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { tpmStore } from '@/lib/tpm-chat-store';
import type { ToolCall, ChatMessage, ParsedStory, MentionItem } from '@/lib/tpm-chat-store';

// ─── Prose (cowork pattern) ───────────────────────────────────────────────────

const PROSE = [
  'prose prose-sm dark:prose-invert max-w-none',
  'prose-p:my-1 prose-p:leading-snug',
  'prose-headings:font-semibold prose-headings:tracking-tight',
  'prose-h1:text-sm prose-h2:text-xs prose-h3:text-xs',
  'prose-headings:mt-2 prose-headings:mb-0.5',
  'prose-ul:my-1 prose-ul:pl-3.5 prose-ol:my-1 prose-ol:pl-3.5',
  'prose-li:my-0',
  'prose-pre:my-1.5 prose-pre:rounded-md prose-pre:text-[10.5px] prose-pre:leading-relaxed',
  'prose-code:text-[10.5px] prose-code:bg-muted prose-code:px-1 prose-code:py-px prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none',
  'prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:text-muted-foreground prose-blockquote:pl-2.5 prose-blockquote:my-1.5',
  'prose-table:text-[11px] prose-th:font-medium prose-th:py-1 prose-td:py-1',
  'prose-hr:border-border prose-hr:my-2',
  'prose-a:text-foreground prose-a:underline-offset-2',
].join(' ');

// ─── Story extraction ─────────────────────────────────────────────────────────

function extractAllStories(content: string): ParsedStory[] {
  const stories: ParsedStory[] = [];
  const appPat = /=== APP_STORY:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_STORY ===/g;
  const featPat = /=== FEATURE_STORY:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_STORY ===/g;
  let m;
  while ((m = appPat.exec(content)) !== null) {
    const yaml = m[2].trim();
    stories.push({ kind: 'app', filename: m[1], yaml, name: extractName(yaml) || m[1].replace('.yaml', '') });
  }
  while ((m = featPat.exec(content)) !== null) {
    const yaml = m[2].trim();
    const phase = yaml.match(/^phase:\s*(\d+)/m)?.[1];
    const deps = yaml.match(/^dependsOn:\s*\[([^\]]*)\]$/m)?.[1];
    stories.push({
      kind: 'feature', filename: m[1], yaml,
      name: extractName(yaml) || m[1].replace('.yaml', ''),
      phase: phase ? parseInt(phase) : undefined,
      dependsOn: deps ? deps.split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean) : undefined,
    });
  }
  if (!stories.length) {
    const yaml = content.match(/```yaml\n([\s\S]*?)```/)?.[1]?.trim();
    if (yaml) stories.push({ kind: 'app', filename: (extractName(yaml) || 'spec').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.yaml', yaml, name: extractName(yaml) || 'Spec' });
  }
  return stories;
}

function extractName(yaml: string) {
  return yaml.match(/appName:\s*"([^"]+)"/)?.[1] || yaml.match(/name:\s*"([^"]+)"/)?.[1] || null;
}

// ─── Tool helpers ─────────────────────────────────────────────────────────────

function toolIcon(name: string) {
  if (name.includes('status') || name === 'get_project_status') return <Hash className="h-2.5 w-2.5" />;
  if (name.includes('story') || name.includes('stories')) return <FileText className="h-2.5 w-2.5" />;
  if (name.includes('scaffold')) return <Layers className="h-2.5 w-2.5" />;
  if (name.includes('queue')) return <ListTodo className="h-2.5 w-2.5" />;
  if (name.includes('knowledge') || name.includes('adr')) return <BookOpen className="h-2.5 w-2.5" />;
  if (name.includes('heartbeat') || name.includes('logs')) return <Cpu className="h-2.5 w-2.5" />;
  if (name.includes('decompose')) return <Zap className="h-2.5 w-2.5" />;
  if (name.includes('apply')) return <GitBranch className="h-2.5 w-2.5" />;
  return <Terminal className="h-2.5 w-2.5" />;
}

function toolChipClass(status: ToolCall['status']) {
  if (status === 'running') return 'bg-amber-500/8 border-amber-500/25 text-amber-600 dark:text-amber-400 animate-pulse';
  if (status === 'success') return 'bg-muted/60 border-border/50 text-muted-foreground';
  return 'bg-destructive/8 border-destructive/25 text-destructive';
}

// ─── Quick actions ────────────────────────────────────────────────────────────

const QUICK = [
  { label: 'Status', msg: "What's the project status?" },
  { label: 'Stories', msg: 'List all stories.' },
  { label: 'Queue', msg: 'Show the build queue.' },
];

// ─── Thinking dots ─────────────────────────────────────────────────────────────

function ThinkingDots({ elapsed }: { elapsed: number }) {
  const s = elapsed / 1000;
  const label = s < 3 ? 'Working…' : s < 8 ? `Thinking… ${s.toFixed(0)}s` : `Still working… ${s.toFixed(0)}s`;
  return (
    <div className="flex items-center gap-2 py-1 select-none">
      {[0, 150, 300].map(d => (
        <span key={d} className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce"
          style={{ animationDelay: `${d}ms`, animationDuration: '0.8s' }} />
      ))}
      <span className="text-[11px] text-muted-foreground/60 tabular-nums">{label}</span>
    </div>
  );
}

// ─── Tool chip ────────────────────────────────────────────────────────────────

function ToolChip({ tc, onInspect }: { tc: ToolCall; onInspect: (tc: ToolCall) => void }) {
  return (
    <button
      onClick={() => tc.status !== 'running' && onInspect(tc)}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border transition-all',
        tc.status !== 'running' && 'hover:scale-[1.02] active:scale-[0.98] cursor-pointer',
        tc.status === 'running' && 'cursor-default',
        toolChipClass(tc.status),
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
        tc.status === 'running' ? 'bg-amber-500' : tc.status === 'success' ? 'bg-emerald-500' : 'bg-destructive')} />
      {toolIcon(tc.name)}
      <span>{tc.name}</span>
      {tc.duration !== undefined && tc.status === 'success' && (
        <span className="opacity-40 flex items-center gap-0.5"><Clock className="h-2 w-2" />{(tc.duration / 1000).toFixed(1)}s</span>
      )}
      {tc.status !== 'running' && <ExternalLink className="h-2 w-2 opacity-25" />}
    </button>
  );
}

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_MENTIONS: MentionItem[] = [];

// ─── Component ────────────────────────────────────────────────────────────────

export function TpmChat({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  // ── Subscribe to singleton store ──────────────────────────────────────────
  const messages = useSyncExternalStore(
    (cb) => tpmStore.subscribe(cb),
    () => tpmStore.messages,
    () => EMPTY_MESSAGES,
  );
  const streaming = useSyncExternalStore(
    (cb) => tpmStore.subscribe(cb),
    () => tpmStore.streaming,
    () => false,
  );
  const mentionItems = useSyncExternalStore(
    (cb) => tpmStore.subscribe(cb),
    () => tpmStore.mentionItems,
    () => EMPTY_MENTIONS,
  );

  // ── Local UI state (non-persistent) ──────────────────────────────────────
  const [input, setInput] = useState('');
  const [streamStart, setStreamStart] = useState<number | null>(null);
  const [streamElapsed, setStreamElapsed] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  const [savedStories, setSavedStories] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [activeProject, setActiveProject] = useState<{ name: string; path: string } | null>(null);
  const [repoBlueprint, setRepoBlueprint] = useState<Record<string, unknown> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<{ match: string; index: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [selectedTool, setSelectedTool] = useState<ToolCall | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionRef = useRef<HTMLDivElement>(null);

  // ── Load project + mentions once ─────────────────────────────────────────
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      const a = d.projects?.find((p: { id: string }) => p.id === d.activeId);
      setActiveProject(a || null);
      if (a?.id) {
        tpmStore.setProject(a.id);
      }
    }).catch(() => {});

    setScanning(true);
    fetch('/api/repo-scan').then(r => r.json()).then(d => !d.error && setRepoBlueprint(d)).catch(() => {}).finally(() => setScanning(false));

    fetch('/api/stories').then(r => r.json()).then(d => {
      const items: MentionItem[] = [];
      for (const s of (d.stories || []) as { file?: string; metadata?: { name?: string }; status?: string }[]) {
        const slug = (s.file || '').replace(/\.ya?ml$/, '');
        items.push({ id: `app-${slug}`, label: s.metadata?.name || slug, type: 'story', slug, status: s.status });
      }
      for (const s of (d.featureStories || []) as { file?: string; name?: string; feature?: { name?: string }; status?: string }[]) {
        const slug = (s.file || '').replace(/features\//, '').replace(/\.ya?ml$/, '');
        items.push({ id: `feat-${slug}`, label: s.name || s.feature?.name || slug, type: 'story', slug, status: s.status });
      }
      tpmStore.setMentionItems(items);
    }).catch(() => {});
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!streaming) { setStreamElapsed(0); return; }
    const t = setInterval(() => setStreamElapsed(Date.now() - (streamStart || Date.now())), 200);
    return () => clearInterval(t);
  }, [streaming, streamStart]);

  // ── Live timer for tool durations ─────────────────────────────────────────
  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => tpmStore.tickRunningToolCalls(), 100);
    return () => clearInterval(t);
  }, [streaming]);

  // ── Mention outside click ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mentionQuery) return;
    const h = (e: MouseEvent) => {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) setMentionQuery(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [mentionQuery]);

  // ── Focus input when panel opens ─────────────────────────────────────────
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen]);

  // ── Filtered mentions ─────────────────────────────────────────────────────
  const filteredMentions = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.match.toLowerCase();
    return mentionItems.filter(m => m.label.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, mentionItems]);

  // ── Insert mention ────────────────────────────────────────────────────────
  const insertMention = useCallback((item: MentionItem) => {
    if (!mentionQuery || !inputRef.current) return;
    const before = input.slice(0, mentionQuery.index);
    const cursor = inputRef.current.selectionStart || 0;
    const after = input.slice(cursor);
    setInput(`${before}@${item.label} ${after}`);
    setMentionQuery(null);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = before.length + item.label.length + 2;
        inputRef.current.selectionStart = pos;
        inputRef.current.selectionEnd = pos;
      }
    }, 0);
  }, [input, mentionQuery]);

  // ── Input change with @ detect ────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const t = e.target;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 200) + 'px';
    const cursor = t.selectionStart || 0;
    const m = val.slice(0, cursor).match(/(?:^|\s)@([^@\s]*)$/);
    if (m) { setMentionQuery({ match: m[1], index: cursor - m[1].length - 1 }); setMentionIdx(0); }
    else setMentionQuery(null);
  };

  // ── Context injection for @mentions ───────────────────────────────────────
  const buildWithContext = useCallback(async (text: string): Promise<string> => {
    const refs = Array.from(text.matchAll(/@([\w-]+)/g));
    if (!refs.length) return text;
    const blocks: string[] = [];
    for (const [, slug] of refs) {
      const item = mentionItems.find(m => m.slug === slug || m.label.toLowerCase() === slug.toLowerCase());
      if (item?.slug) {
        try {
          const r = await fetch(`/api/stories/${encodeURIComponent(item.slug)}`);
          if (r.ok) {
            const d = await r.json() as { content?: string };
            if (d.content) blocks.push(`[Context for @${item.label}]\n\`\`\`yaml\n${d.content}\n\`\`\``);
          }
        } catch {}
      }
    }
    return blocks.length ? `${text}\n\n---\n${blocks.join('\n\n')}` : text;
  }, [mentionItems]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = async (text?: string) => {
    const raw = text || input.trim();
    if (!raw || streaming) return;

    const content = await buildWithContext(raw);
    const userMsg: ChatMessage = { role: 'user', content: raw };
    const newMsgs = [...messages, userMsg];
    tpmStore.setMessages(newMsgs);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    tpmStore.setStreaming(true);
    const now = Date.now();
    setStreamStart(now);
    setActiveTab(0);
    setSavedStories(new Set());

    tpmStore.setMessages([...newMsgs, { role: 'assistant', content: '', toolCalls: [] }]);

    const abort = new AbortController();
    tpmStore.abortController = abort;

    try {
      const res = await fetch('/api/tpm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          messages: [
            ...newMsgs.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content },
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' })) as { error?: string };
        throw new Error(err.error || 'Chat request failed');
      }
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data: ')) continue;
          const data = t.slice(6);
          if (data === '[DONE]') continue;
          try {
            const p = JSON.parse(data);
            if (p.type === 'text' && p.content) tpmStore.appendToLast(p.content);
            else if (p.type === 'tool_start') {
              tpmStore.addToolCall({ id: p.id, name: p.name, arguments: p.arguments, status: 'running', startTime: Date.now(), duration: 0 });
            } else if (p.type === 'tool_end') {
              tpmStore.updateLastToolCall(p.id, { status: p.status || 'success', result: p.result, duration: p.startTime ? Date.now() - p.startTime : undefined });
            } else if (p.type === 'error') toast.error(p.error || 'Server error');
          } catch {}
        }
      }

      // Telemetry
      const durationMs = Date.now() - now;
      const last = tpmStore.messages[tpmStore.messages.length - 1];
      if (last?.role === 'assistant') {
        const tokenCount = Math.round(last.content.length / 4);
        const msgs = [...tpmStore.messages];
        msgs[msgs.length - 1] = { ...last, tokenCount, durationMs, tokensPerSec: Math.round(tokenCount / durationMs * 1000) };
        tpmStore.setMessages(msgs);
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      toast.error('TPM failed', { description: (err as Error).message });
      tpmStore.setMessages(newMsgs);
    } finally {
      tpmStore.setStreaming(false);
      tpmStore.abortController = null;
    }
  };

  const handleStop = () => {
    tpmStore.abortController?.abort();
    tpmStore.setStreaming(false);
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery && filteredMentions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % filteredMentions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + filteredMentions.length) % filteredMentions.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); insertMention(filteredMentions[mentionIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Stories ───────────────────────────────────────────────────────────────
  const allStories = useMemo((): ParsedStory[] => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const s = extractAllStories(messages[i].content);
        if (s.length) return s;
      }
    }
    return [];
  }, [messages]);

  const toolStories = useMemo((): ParsedStory[] => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        for (const tc of messages[i].toolCalls || []) {
          if (tc.name === 'decompose_requirements' && tc.result) {
            const s = extractAllStories(tc.result);
            if (s.length) return s;
          }
        }
      }
    }
    return [];
  }, [messages]);

  const mergedStories = [...allStories, ...toolStories];
  const activeStory = mergedStories[activeTab] || null;
  const hasStories = mergedStories.length > 0;
  const allSaved = hasStories && mergedStories.every(s => savedStories.has(s.filename));

  const prevLen = useRef(0);
  useEffect(() => {
    if (mergedStories.length > prevLen.current && mergedStories.length > 0) setArtifactOpen(true);
    prevLen.current = mergedStories.length;
  }, [mergedStories.length]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const saveStory = async (story: ParsedStory) => {
    setSaving(true);
    try {
      const res = await fetch('/api/stories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: story.name, content: story.yaml, kind: story.kind }) });
      const d = await res.json() as { file?: string; error?: string };
      if (res.ok) { toast.success(`Saved ${story.kind}`, { description: d.file }); setSavedStories(p => new Set(p).add(story.filename)); }
      else toast.error('Save failed', { description: d.error });
    } catch { toast.error('Save failed'); } finally { setSaving(false); }
  };

  const saveAll = async () => {
    setSavingAll(true);
    let ok = 0, fail = 0;
    const sorted = [...mergedStories].sort((a, b) => (a.kind === 'app' ? 0 : a.phase ?? 99) - (b.kind === 'app' ? 0 : b.phase ?? 99));
    for (const s of sorted) {
      if (savedStories.has(s.filename)) continue;
      try {
        const res = await fetch('/api/stories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: s.name, content: s.yaml, kind: s.kind }) });
        const d = await res.json() as { file?: string; error?: string };
        if (res.ok) {
          ok++;
          setSavedStories(p => new Set(p).add(s.filename));
          if (s.kind === 'feature' && d.file) {
            try { await fetch('/api/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyFile: d.file, kind: 'FeatureStory', phase: s.phase ?? 0, dependsOn: s.dependsOn ?? [] }) }); } catch {}
          }
        } else fail++;
      } catch { fail++; }
    }
    if (ok) toast.success(`Saved ${ok}`, { description: fail ? `${fail} failed` : 'Enqueued' });
    setSavingAll(false);
  };

  const copyYaml = async () => {
    if (!activeStory) return;
    await navigator.clipboard.writeText(activeStory.yaml);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const copyMsg = async (idx: number, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedMsg(idx); setTimeout(() => setCopiedMsg(null), 2000);
  };

  const isEmpty = messages.length === 0;
  const lastAsstIdx = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i; return -1; })();

  // ── Render ────────────────────────────────────────────────────────────────
  // NOTE: Never return null — always render, hide with CSS translation.
  // This keeps the SSE stream alive when user switches tabs.

  return (
    <div
      className={cn(
        // Always flex on desktop so the component stays mounted (keeps SSE streams alive)
        // Width collapses to 0 when closed rather than display:none
        'md:flex md:shrink-0 md:self-stretch md:h-screen md:overflow-hidden transition-all duration-300',
        isOpen ? 'md:w-auto' : 'md:w-0 md:overflow-hidden',
        // Mobile: fixed full-height drawer when open, hidden otherwise
        isOpen ? 'fixed right-0 top-0 bottom-0 z-40 flex md:static md:z-auto shadow-2xl md:shadow-none' : 'hidden md:flex',
      )}
    >
      {/* Artifact panel */}
      <div className={cn(
        'flex flex-col bg-card border-l border-border transition-all duration-300 shrink-0 overflow-hidden self-stretch',
        artifactOpen && hasStories ? 'w-[380px]' : 'w-0 border-l-0',
      )}>
        <div className="w-[380px] h-full flex flex-col">
          {/* Tabs */}
          <div className="border-b border-border bg-muted/30 shrink-0 flex items-center h-10 px-2 gap-1.5">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 min-w-0">
              {mergedStories.map((s, idx) => (
                <button key={s.filename} onClick={() => setActiveTab(idx)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors shrink-0 border',
                    idx === activeTab ? 'bg-background border-border text-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}>
                  {s.kind === 'app' ? <Package className="h-2.5 w-2.5" /> : <Layers className="h-2.5 w-2.5" />}
                  <span className="max-w-[80px] truncate">{s.name}</span>
                  {savedStories.has(s.filename) && <Check className="h-2.5 w-2.5 text-emerald-500 shrink-0" />}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setArtifactOpen(false)} aria-label="Close artifact details">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* YAML */}
          <div className="flex-1 overflow-auto select-text">
            {activeStory ? (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="p-1 rounded bg-muted border border-border shrink-0">
                      {activeStory.kind === 'app' ? <Package className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{activeStory.name}</p>
                      <p className="text-[9px] text-muted-foreground font-mono truncate">{activeStory.filename}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyYaml} aria-label="Copy YAML to clipboard">
                      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </Button>
                    {!savedStories.has(activeStory.filename) ? (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => saveStory(activeStory)} disabled={saving}>
                        {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />} Save
                      </Button>
                    ) : (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">
                        <Check className="h-3 w-3" /> Saved
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-zinc-950 dark:bg-[#0d1117] overflow-hidden">
                  <pre className="p-3 text-[10px] leading-relaxed text-slate-200 whitespace-pre-wrap font-mono overflow-x-auto">{activeStory.yaml}</pre>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full opacity-30 select-none">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main chat */}
      <div className="flex flex-col bg-background border-l border-border shrink-0 w-[360px] self-stretch min-h-0">
        <div className="w-[360px] flex-1 flex flex-col min-h-0">

        {/* Header — h-10 (compact, matches cowork h-12 spirit) */}
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3 bg-background/60 backdrop-blur-md">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Brain className="h-3 w-3" />
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase text-foreground">TPM</span>
            {activeProject && <><span className="w-px h-3 bg-border/40" /><span className="text-[10px] text-muted-foreground/60 truncate max-w-[100px]">{activeProject.name}</span></>}
            {streaming && <span className="relative flex h-1.5 w-1.5 ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" /></span>}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            {hasStories && (
              <Button variant={artifactOpen ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6 relative" onClick={() => setArtifactOpen(!artifactOpen)} aria-label="Toggle artifact panel">
                <Layers className="h-3 w-3" />
                <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-primary-foreground text-[7px] font-bold border border-background">{mergedStories.length}</span>
              </Button>
            )}
            {hasStories && !allSaved && !streaming && (
              <Button size="sm" className="h-6 px-1.5 text-[9px] gap-0.5 font-semibold" onClick={saveAll} disabled={savingAll}>
                {savingAll ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <SaveAll className="h-2.5 w-2.5" />}
                Save
              </Button>
            )}
            {!isEmpty && (
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => { tpmStore.clear(); toast.success('Cleared'); }} aria-label="Clear chat history">
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={onClose} aria-label="Close chat">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </header>

        {/* Repo context strip */}
        {(scanning || repoBlueprint) && (
          <div className="px-3 py-1 border-b border-border/40 bg-muted/10 flex items-center gap-1.5 shrink-0">
            <ScanSearch className={cn('h-2.5 w-2.5 shrink-0', scanning ? 'text-muted-foreground animate-pulse' : 'text-primary')} />
            <span className="text-[9px] text-muted-foreground truncate">
              {scanning ? 'Scanning…' : `${(repoBlueprint as any)?.stack?.framework || 'Node.js'} · ${mentionItems.length} stories`}
            </span>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: 'thin' }}>
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full gap-5 text-center select-none">
              <div>
                <h2 className="text-lg font-semibold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-foreground via-foreground/90 to-foreground/60 mb-1.5">
                  Ask the TPM
                </h2>
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed max-w-[220px]">
                  Status, stories, queue, decisions. Type <kbd className="px-1 py-px bg-muted rounded border border-border font-mono text-[9px]">@</kbd> to reference a story.
                </p>
              </div>
              {activeProject && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/50 text-[10px] w-full max-w-[200px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-foreground font-medium truncate">{activeProject.name}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-1 justify-center max-w-[240px]">
                {QUICK.map(q => (
                  <button key={q.label} onClick={() => handleSend(q.msg)}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-all">
                    {q.label}
                  </button>
                ))}
                <button onClick={() => { setInput('Plan new feature: '); inputRef.current?.focus(); }}
                  className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-all">
                  Plan feature…
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={cn('animate-in fade-in duration-200', msg.role === 'user' ? 'flex flex-col items-end' : '')}>
                  {msg.role === 'user' ? (
                    // User bubble — bg-muted, asymmetric radius (cowork pattern)
                    <div className="bg-muted text-foreground px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap font-medium tracking-tight max-w-[80%]"
                      style={{ borderRadius: '16px 16px 3px 16px' }}>
                      {msg.content}
                    </div>
                  ) : (
                    // Assistant — no bubble, document flow
                    <div className="group">
                      {/* Tool chips */}
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {msg.toolCalls.map(tc => <ToolChip key={tc.id} tc={tc} onInspect={setSelectedTool} />)}
                        </div>
                      )}
                      {/* Markdown */}
                      {msg.content && (
                        <div className={cn(PROSE, 'text-foreground text-[13px]')}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                      {/* Telemetry + copy — last msg, done */}
                      {i === lastAsstIdx && !streaming && msg.tokenCount && (
                        <div className="flex items-center gap-1 mt-1.5 ml-0.5">
                          <span className="w-px h-2.5 bg-border/40" />
                          <span className="text-[9px] tabular-nums text-muted-foreground/50">~{msg.tokenCount < 1000 ? msg.tokenCount : `${(msg.tokenCount / 1000).toFixed(1)}k`}</span>
                          <span className="text-[9px] tabular-nums text-muted-foreground/40">· {((msg.durationMs || 0) / 1000).toFixed(1)}s</span>
                          {(msg.tokensPerSec || 0) > 0 && <span className="text-[9px] tabular-nums text-emerald-500/50">· {msg.tokensPerSec}/s</span>}
                          <button onClick={() => copyMsg(i, msg.content)}
                            className="ml-0.5 h-5 px-1.5 flex items-center gap-1 rounded hover:bg-muted text-muted-foreground/40 hover:text-muted-foreground transition-all"
                            aria-label="Copy message">
                            {copiedMsg === i ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : <Copy className="h-2.5 w-2.5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {/* Thinking dots */}
              {streaming && (() => {
                const last = messages[messages.length - 1];
                return last?.role === 'assistant' && !last.content && !last.toolCalls?.length;
              })() && <ThinkingDots elapsed={streamElapsed} />}
            </div>
          )}
        </div>

        {/* Quick actions strip */}
        {!isEmpty && !streaming && (
          <div className="px-3 pb-1 flex gap-1 flex-wrap shrink-0">
            {QUICK.map(q => (
              <button key={q.label} onClick={() => handleSend(q.msg)}
                className="text-[9px] font-medium px-2 py-0.5 rounded-full border border-border bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground transition-all">
                {q.label}
              </button>
            ))}
          </div>
        )}

        {/* Input — cowork-style glassmorphic, rounded-[20px] */}
        <div className="px-3 pb-4 pt-2 bg-background/40 backdrop-blur-xl shrink-0 border-t border-border/40">
          <div className="relative flex flex-col bg-background/70 backdrop-blur-md border border-border/60 shadow-sm focus-within:border-foreground/25 focus-within:ring-1 focus-within:ring-foreground/10 transition-all" style={{ borderRadius: 16 }}>
            {/* @mention popover */}
            {mentionQuery && filteredMentions.length > 0 && (
              <div ref={mentionRef}
                className="absolute bottom-[calc(100%+6px)] left-0 right-0 bg-background/95 backdrop-blur-xl border border-border/50 shadow-2xl overflow-hidden z-[100] animate-in fade-in slide-in-from-bottom-2 duration-150"
                style={{ borderRadius: 10 }}>
                <div className="px-2.5 py-1 border-b border-border/30 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold bg-muted/20 flex items-center gap-1">
                  <FileSearch className="h-2.5 w-2.5" />{filteredMentions.length} match{filteredMentions.length !== 1 ? 'es' : ''}
                </div>
                <div className="max-h-40 overflow-y-auto p-0.5 space-y-px">
                  {filteredMentions.map((m, idx) => (
                    <button key={m.id} onClick={() => insertMention(m)}
                      className={cn('flex items-center gap-2 px-2 py-1.5 rounded-md text-left w-full transition-all',
                        idx === mentionIdx ? 'bg-foreground/10 text-foreground' : 'hover:bg-foreground/5 text-muted-foreground')}>
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="text-[11px] truncate font-medium flex-1">{m.label}</span>
                      {m.status && (
                        <span className={cn('text-[8px] px-1 py-px rounded-full font-semibold shrink-0',
                          m.status === 'done' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                          m.status === 'in-progress' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                          'bg-muted text-muted-foreground')}>
                          {m.status}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={streaming ? 'Generating…' : 'Message TPM… or @ to reference a story'}
              className="w-full border-0 px-4 py-3 pr-10 min-h-[44px] max-h-[200px] bg-transparent text-foreground placeholder:text-muted-foreground/40 text-[13px] leading-snug resize-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 outline-none"
              rows={1}
            />

            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 pb-2 pt-0">
              <p className="text-[9px] text-muted-foreground/30">⏎ send · ⇧⏎ newline</p>
              <div className="flex items-center gap-1">
                {streaming ? (
                  <Button size="icon" variant="outline" className="h-7 w-7 rounded-lg border-foreground/20 text-foreground/50 hover:bg-foreground/10" onClick={handleStop} aria-label="Stop text generation">
                    <Square className="h-3 w-3 fill-current" />
                  </Button>
                ) : (
                  <Button size="icon"
                    className={cn('h-7 w-7 rounded-lg shadow-sm transition-all',
                      input.trim() ? 'bg-foreground text-background hover:opacity-90' : 'bg-foreground/8 text-foreground/25 cursor-not-allowed')}
                    disabled={!input.trim()} onClick={() => handleSend()} aria-label="Send message">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          <p className="text-center text-[9px] text-muted-foreground/30 mt-1.5">TPM can make mistakes. Verify decisions.</p>
        </div>
        </div>
      </div>

      {/* Tool output dialog */}
      <Dialog open={!!selectedTool} onOpenChange={() => setSelectedTool(null)}>
        <DialogContent className="flex flex-col max-h-[75vh] w-full sm:max-w-lg border border-border p-0 bg-background shadow-2xl rounded-2xl">
          <DialogHeader className="border-b border-border px-4 py-2.5 shrink-0 flex flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-[11px] font-semibold flex items-center gap-1.5 font-mono">
              {selectedTool && <>
                <span className={cn('w-2 h-2 rounded-full shrink-0', selectedTool.status === 'success' ? 'bg-emerald-500' : 'bg-destructive')} />
                {selectedTool.name}
                {selectedTool.duration && <span className="text-[10px] text-muted-foreground/50 font-normal">{(selectedTool.duration / 1000).toFixed(2)}s</span>}
              </>}
            </DialogTitle>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedTool(null)} aria-label="Close tool details">
              <X className="h-3.5 w-3.5" />
            </Button>
          </DialogHeader>
          {selectedTool && (
            <div className="flex-1 overflow-auto p-3 space-y-2.5 min-h-0">
              {selectedTool.arguments && Object.keys(selectedTool.arguments).length > 0 && (
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold mb-1">Input</p>
                  <pre className="text-[10px] text-foreground/70 bg-muted/30 rounded-lg border border-border/30 p-2.5 overflow-x-auto whitespace-pre-wrap font-mono">{JSON.stringify(selectedTool.arguments, null, 2)}</pre>
                </div>
              )}
              {selectedTool.result && (
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold mb-1">Output</p>
                  <pre className="text-[10px] text-foreground/70 bg-muted/30 rounded-lg border border-border/30 p-2.5 overflow-x-auto whitespace-pre-wrap font-mono select-text max-h-[35vh] overflow-y-auto">{selectedTool.result}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
