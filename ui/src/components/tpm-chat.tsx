'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
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
  ScanSearch,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Trash2,
  Brain,
  ChevronDown,
  ChevronRight,
  ListTodo,
  BookOpen,
  Cpu,
  Zap,
  FileSearch,
  GitBranch,
  Hash,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'running' | 'success' | 'failed';
  result?: string;
  startTime?: number;
  duration?: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  tokenCount?: number;
  durationMs?: number;
  tokensPerSec?: number;
}

interface ParsedStory {
  kind: 'app' | 'feature';
  filename: string;
  yaml: string;
  name: string;
  phase?: number;
  dependsOn?: string[];
}

interface MentionItem {
  id: string;
  label: string;
  type: 'story' | 'queue' | 'knowledge';
  slug?: string;
  status?: string;
}

// ─── Prose class chain (cowork pattern) ──────────────────────────────────────

const PROSE = [
  'prose prose-sm dark:prose-invert max-w-none',
  'prose-p:my-1.5 prose-p:leading-relaxed',
  'prose-headings:font-semibold prose-headings:tracking-tight',
  'prose-h1:text-sm prose-h2:text-[13px] prose-h3:text-xs',
  'prose-headings:mt-3 prose-headings:mb-1',
  'prose-ul:my-1.5 prose-ul:pl-4 prose-ol:my-1.5 prose-ol:pl-4',
  'prose-li:my-0.5',
  'prose-pre:my-2 prose-pre:rounded-lg prose-pre:text-[11px] prose-pre:leading-relaxed',
  'prose-code:text-[11px] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none',
  'prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:text-muted-foreground prose-blockquote:pl-3 prose-blockquote:my-2',
  'prose-table:text-xs prose-th:font-medium prose-th:py-1.5 prose-td:py-1.5',
  'prose-hr:border-border prose-hr:my-3',
  'prose-a:text-foreground prose-a:underline-offset-2',
].join(' ');

// ─── Persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'tpm-chat-messages-v3';

function loadPersistedMessages(): Message[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

function persistMessages(msgs: Message[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-50)));
  } catch {}
}

// ─── Story extraction ─────────────────────────────────────────────────────────

function extractAllStories(content: string): ParsedStory[] {
  const stories: ParsedStory[] = [];
  const appPattern =
    /=== APP_STORY:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_STORY ===/g;
  const featurePattern =
    /=== FEATURE_STORY:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_STORY ===/g;

  let match;
  while ((match = appPattern.exec(content)) !== null) {
    const yaml = match[2].trim();
    const name = extractNameFromYaml(yaml) || match[1].replace('.yaml', '');
    stories.push({ kind: 'app', filename: match[1], yaml, name });
  }
  while ((match = featurePattern.exec(content)) !== null) {
    const yaml = match[2].trim();
    const name = extractNameFromYaml(yaml) || match[1].replace('.yaml', '');
    const phaseM = yaml.match(/^phase:\s*(\d+)/m);
    const depsM = yaml.match(/^dependsOn:\s*\[([^\]]*)\]$/m);
    const phase = phaseM ? parseInt(phaseM[1]) : undefined;
    const dependsOn = depsM
      ? depsM[1]
          .trim()
          .split(',')
          .map((s) => s.trim().replace(/['"]/g, ''))
          .filter(Boolean)
      : undefined;
    stories.push({ kind: 'feature', filename: match[1], yaml, name, phase, dependsOn });
  }
  if (stories.length === 0) {
    const yaml = content.match(/```yaml\n([\s\S]*?)```/)?.[1]?.trim();
    if (yaml) {
      const name = extractNameFromYaml(yaml) || 'Untitled';
      stories.push({
        kind: 'app',
        filename: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.yaml',
        yaml,
        name,
      });
    }
  }
  return stories;
}

function extractNameFromYaml(yaml: string): string | null {
  return (
    yaml.match(/appName:\s*"([^"]+)"/)?.[1] ||
    yaml.match(/name:\s*"([^"]+)"/)?.[1] ||
    null
  );
}

// ─── Tool helpers ─────────────────────────────────────────────────────────────

function toolIcon(name: string) {
  if (name.includes('status') || name === 'get_project_status') return <Hash className="h-3 w-3" />;
  if (name.includes('story') || name.includes('stories')) return <FileText className="h-3 w-3" />;
  if (name.includes('scaffold')) return <Layers className="h-3 w-3" />;
  if (name.includes('queue')) return <ListTodo className="h-3 w-3" />;
  if (name.includes('knowledge') || name.includes('adr')) return <BookOpen className="h-3 w-3" />;
  if (name.includes('heartbeat') || name.includes('logs')) return <Cpu className="h-3 w-3" />;
  if (name.includes('decompose')) return <Zap className="h-3 w-3" />;
  if (name.includes('apply')) return <GitBranch className="h-3 w-3" />;
  return <Terminal className="h-3 w-3" />;
}

function toolChipColor(status: string) {
  if (status === 'running')
    return 'bg-amber-500/8 border-amber-500/25 text-amber-500 animate-pulse';
  if (status === 'success')
    return 'bg-muted/50 border-border/40 text-muted-foreground';
  return 'bg-destructive/8 border-destructive/25 text-destructive';
}

// ─── Quick actions ────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Project status', message: "What's the current project status?" },
  { label: 'List stories', message: 'List all stories and their statuses.' },
  { label: 'Build queue', message: 'Show me the build queue.' },
  { label: 'Plan feature…', message: 'Plan new feature: ', prefill: true },
];

// ─── ThinkingDots (three-dot amber bounce, cowork pattern) ────────────────────

function ThinkingDots({ elapsed }: { elapsed: number }) {
  const label =
    elapsed < 3000
      ? 'Working…'
      : elapsed < 8000
      ? `Thinking… ${(elapsed / 1000).toFixed(0)}s`
      : `Still working… ${(elapsed / 1000).toFixed(0)}s`;

  return (
    <div className="flex items-center gap-2.5 py-2 select-none animate-in fade-in duration-300">
      <div className="flex items-center gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce"
            style={{ animationDelay: `${delay}ms`, animationDuration: '0.8s' }}
          />
        ))}
      </div>
      <span className="text-[12px] text-muted-foreground/60 tabular-nums">{label}</span>
    </div>
  );
}

// ─── Tool chip (inline, clickable) ───────────────────────────────────────────

function ToolChip({
  tc,
  onInspect,
}: {
  tc: ToolCall;
  onInspect: (tc: ToolCall) => void;
}) {
  return (
    <button
      onClick={() => tc.status !== 'running' && onInspect(tc)}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium border transition-all',
        tc.status !== 'running' && 'hover:scale-[1.02] active:scale-[0.98] cursor-pointer',
        tc.status === 'running' && 'cursor-default',
        toolChipColor(tc.status)
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          tc.status === 'running' ? 'bg-amber-500' :
          tc.status === 'success' ? 'bg-emerald-500' : 'bg-destructive'
        )}
      />
      <span className="flex items-center gap-1">
        {toolIcon(tc.name)}
        {tc.name}
      </span>
      {tc.duration !== undefined && tc.status === 'success' && (
        <span className="opacity-50 flex items-center gap-0.5">
          <Clock className="h-2.5 w-2.5" />
          {(tc.duration / 1000).toFixed(1)}s
        </span>
      )}
      {tc.status !== 'running' && <ExternalLink className="h-2.5 w-2.5 opacity-30" />}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TpmChat({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>(() => loadPersistedMessages());
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamStart, setStreamStart] = useState<number | null>(null);
  const [streamElapsed, setStreamElapsed] = useState(0);

  // Artifacts panel
  const [activeTab, setActiveTab] = useState(0);
  const [savedStories, setSavedStories] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);

  // Project context
  const [activeProject, setActiveProject] = useState<{ name: string; path: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [repoBlueprint, setRepoBlueprint] = useState<Record<string, unknown> | null>(null);

  // Mention system
  const [mentionQuery, setMentionQuery] = useState<{ match: string; index: number } | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const mentionPopoverRef = useRef<HTMLDivElement>(null);

  // Tool output dialog
  const [selectedTool, setSelectedTool] = useState<ToolCall | null>(null);

  // Copy state
  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState<number | null>(null);

  // Abort
  const abortRef = useRef<AbortController | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Load project + repo ───────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => {
        const active = data.projects?.find((p: { id: string }) => p.id === data.activeId);
        setActiveProject(active || null);
      })
      .catch(() => {});

    setScanning(true);
    fetch('/api/repo-scan')
      .then((r) => r.json())
      .then((d) => !d.error && setRepoBlueprint(d))
      .catch(() => {})
      .finally(() => setScanning(false));

    fetch('/api/stories')
      .then((r) => r.json())
      .then((data) => {
        const items: MentionItem[] = [];
        for (const s of (data.stories || []) as { file?: string; metadata?: { name?: string }; status?: string }[]) {
          const slug = s.file?.replace(/\.ya?ml$/, '') || '';
          items.push({ id: `app-${slug}`, label: s.metadata?.name || slug, type: 'story', slug, status: s.status });
        }
        for (const s of (data.featureStories || []) as { file?: string; name?: string; feature?: { name?: string }; status?: string }[]) {
          const slug = (s.file?.replace(/features\//, '') || '').replace(/\.ya?ml$/, '');
          items.push({ id: `feat-${slug}`, label: s.name || s.feature?.name || slug, type: 'story', slug, status: s.status });
        }
        setMentionItems(items);
      })
      .catch(() => {});
  }, []);

  // ── Persist messages ──────────────────────────────────────────────────────
  useEffect(() => { persistMessages(messages); }, [messages]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ── Elapsed timer (for ThinkingDots) ─────────────────────────────────────
  useEffect(() => {
    if (!streaming) { setStreamElapsed(0); return; }
    const t = setInterval(() => setStreamElapsed(Date.now() - (streamStart || Date.now())), 200);
    return () => clearInterval(t);
  }, [streaming, streamStart]);

  // ── Live timer for running tool calls ─────────────────────────────────────
  useEffect(() => {
    if (!streaming) return;
    const interval = setInterval(() => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.toolCalls) return msg;
          const updated = msg.toolCalls.map((tc) =>
            tc.status === 'running' && tc.startTime
              ? { ...tc, duration: Date.now() - tc.startTime }
              : tc
          );
          return { ...msg, toolCalls: updated };
        })
      );
    }, 100);
    return () => clearInterval(interval);
  }, [streaming]);

  // ── @-mention close on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!mentionQuery) return;
    const handler = (e: MouseEvent) => {
      if (mentionPopoverRef.current && !mentionPopoverRef.current.contains(e.target as Node)) {
        setMentionQuery(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mentionQuery]);

  // ── Filtered mentions ─────────────────────────────────────────────────────
  const filteredMentions = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.match.toLowerCase();
    return mentionItems.filter((m) => m.label.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, mentionItems]);

  // ── Insert @mention ───────────────────────────────────────────────────────
  const insertMention = useCallback(
    (item: MentionItem) => {
      if (!mentionQuery || !inputRef.current) return;
      const before = input.slice(0, mentionQuery.index);
      const cursorPos = inputRef.current.selectionStart || 0;
      const after = input.slice(cursorPos);
      const newVal = `${before}@${item.label} ${after}`;
      setInput(newVal);
      setMentionQuery(null);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const pos = before.length + item.label.length + 2;
          inputRef.current.selectionStart = pos;
          inputRef.current.selectionEnd = pos;
        }
      }, 0);
    },
    [input, mentionQuery]
  );

  // ── Input change with @ detection ────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 200) + 'px';

    const cursorPos = target.selectionStart || 0;
    const before = val.slice(0, cursorPos);
    const m = before.match(/(?:^|\s)@([^@\s]*)$/);
    if (m) {
      setMentionQuery({ match: m[1], index: cursorPos - m[1].length - 1 });
      setMentionSelectedIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  // ── Build message with @-mention context ──────────────────────────────────
  const buildMessageWithContext = useCallback(
    async (text: string): Promise<string> => {
      const atMentions = Array.from(text.matchAll(/@([\w-]+)/g));
      if (!atMentions.length) return text;
      const blocks: string[] = [];
      for (const [, slug] of atMentions) {
        const item = mentionItems.find(
          (m) => m.slug === slug || m.label.toLowerCase() === slug.toLowerCase()
        );
        if (item?.slug) {
          try {
            const res = await fetch(`/api/stories/${encodeURIComponent(item.slug)}`);
            if (res.ok) {
              const d = await res.json();
              if (d.content) blocks.push(`[Context for @${item.label}]\n\`\`\`yaml\n${d.content}\n\`\`\``);
            }
          } catch {}
        }
      }
      return blocks.length ? `${text}\n\n---\n${blocks.join('\n\n')}` : text;
    },
    [mentionItems]
  );

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = async (text?: string) => {
    const raw = text || input.trim();
    if (!raw || streaming) return;

    const content = await buildMessageWithContext(raw);
    const userMsg: Message = { role: 'user', content: raw };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    setStreaming(true);
    const now = Date.now();
    setStreamStart(now);
    setActiveTab(0);
    setSavedStories(new Set());

    const assistantMsg: Message = { role: 'assistant', content: '', toolCalls: [] };
    setMessages([...newMessages, assistantMsg]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch('/api/tpm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          messages: [
            ...newMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content },
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error((err as { error: string }).error || 'Chat request failed');
      }
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text' && parsed.content) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') last.content += parsed.content;
                return updated;
              });
            } else if (parsed.type === 'tool_start') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  const calls = last.toolCalls || [];
                  if (!calls.some((c) => c.id === parsed.id)) {
                    calls.push({
                      id: parsed.id,
                      name: parsed.name,
                      arguments: parsed.arguments,
                      status: 'running',
                      startTime: Date.now(),
                      duration: 0,
                    });
                  }
                  last.toolCalls = calls;
                }
                return updated;
              });
            } else if (parsed.type === 'tool_end') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant' && last.toolCalls) {
                  const tc = last.toolCalls.find((c) => c.id === parsed.id);
                  if (tc) {
                    tc.status = parsed.status || 'success';
                    tc.result = parsed.result;
                    if (tc.startTime) tc.duration = Date.now() - tc.startTime;
                  }
                }
                return updated;
              });
            } else if (parsed.type === 'error') {
              toast.error(parsed.error || 'Server error');
            }
          } catch {
            // skip malformed
          }
        }
      }

      // Add token telemetry
      const durationMs = Date.now() - now;
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          const approxTokens = Math.round(last.content.length / 4);
          last.tokenCount = approxTokens;
          last.durationMs = durationMs;
          last.tokensPerSec = Math.round((approxTokens / durationMs) * 1000);
        }
        return updated;
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      toast.error('TPM chat failed', { description: (err as Error).message });
      setMessages(newMessages);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionSelectedIndex((s) => (s + 1) % filteredMentions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionSelectedIndex((s) => (s - 1 + filteredMentions.length) % filteredMentions.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); insertMention(filteredMentions[mentionSelectedIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Stories ───────────────────────────────────────────────────────────────
  const allStories: ParsedStory[] = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const s = extractAllStories(messages[i].content);
        if (s.length > 0) return s;
      }
    }
    return [];
  })();

  const allStoriesFromTools: ParsedStory[] = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        for (const tc of messages[i].toolCalls || []) {
          if (tc.name === 'decompose_requirements' && tc.result) {
            const s = extractAllStories(tc.result);
            if (s.length > 0) return s;
          }
        }
      }
    }
    return [];
  })();

  const mergedStories = [...allStories, ...allStoriesFromTools];
  const activeStory = mergedStories[activeTab] || null;
  const hasStories = mergedStories.length > 0;
  const allSaved = mergedStories.length > 0 && mergedStories.every((s) => savedStories.has(s.filename));

  const prevStoriesLen = useRef(0);
  useEffect(() => {
    if (mergedStories.length > prevStoriesLen.current && mergedStories.length > 0) setArtifactPanelOpen(true);
    prevStoriesLen.current = mergedStories.length;
  }, [mergedStories.length]);

  // ── Save actions ──────────────────────────────────────────────────────────
  const handleSaveStory = async (story: ParsedStory) => {
    setSaving(true);
    try {
      const res = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: story.name, content: story.yaml, kind: story.kind }),
      });
      const data = await res.json() as { file?: string; error?: string };
      if (res.ok) {
        toast.success(`Saved ${story.kind} story`, { description: data.file });
        setSavedStories((prev) => new Set(prev).add(story.filename));
      } else {
        toast.error('Save failed', { description: data.error });
      }
    } catch {
      toast.error('Failed to save story');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    let ok = 0, fail = 0;
    const sorted = [...mergedStories].sort((a, b) => (a.kind === 'app' ? 0 : (a.phase ?? 99)) - (b.kind === 'app' ? 0 : (b.phase ?? 99)));
    for (const story of sorted) {
      if (savedStories.has(story.filename)) continue;
      try {
        const res = await fetch('/api/stories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: story.name, content: story.yaml, kind: story.kind }),
        });
        const data = await res.json() as { file?: string; error?: string };
        if (res.ok) {
          ok++;
          setSavedStories((prev) => new Set(prev).add(story.filename));
          if (story.kind === 'feature' && data.file) {
            try {
              await fetch('/api/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storyFile: data.file, kind: 'FeatureStory', phase: story.phase ?? 0, dependsOn: story.dependsOn ?? [] }),
              });
            } catch {}
          }
        } else { fail++; }
      } catch { fail++; }
    }
    if (ok > 0) toast.success(`Saved ${ok} stor${ok > 1 ? 'ies' : 'y'}`, { description: fail > 0 ? `${fail} failed` : 'Auto-enqueued' });
    setSavingAll(false);
  };

  const handleCopy = async () => {
    if (!activeStory) return;
    await navigator.clipboard.writeText(activeStory.yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyMsg = async (idx: number, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedMsg(idx);
    setTimeout(() => setCopiedMsg(null), 2000);
  };

  const clearHistory = () => {
    setMessages([]);
    setSavedStories(new Set());
    setActiveTab(0);
    localStorage.removeItem(STORAGE_KEY);
    toast.success('Chat cleared');
  };

  const isEmpty = messages.length === 0;
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  const phaseLabel = (phase?: number) =>
    phase === 1 ? 'P1 Foundation' : phase === 2 ? 'P2 Core' : phase === 3 ? 'P3 Polish' : `P${phase}`;

  if (!isOpen) return null;

  return (
    <div className="flex shrink-0 h-full">

      {/* ── Artifact panel ── */}
      <div className={cn(
        'h-full flex flex-col bg-card border-l border-border transition-all duration-300 ease-in-out shrink-0 overflow-hidden',
        isOpen && artifactPanelOpen && hasStories ? 'w-[420px]' : 'w-0 border-l-0'
      )}>
        <div className="w-[420px] h-full flex flex-col">
          {/* Tab bar */}
          <div className="border-b border-border bg-muted/40 shrink-0 flex items-center h-12 px-3 gap-2">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1">
              {mergedStories.map((story, idx) => (
                <button
                  key={story.filename}
                  onClick={() => setActiveTab(idx)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors shrink-0 border',
                    idx === activeTab
                      ? 'bg-background border-border text-foreground shadow-sm'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40'
                  )}
                >
                  {story.kind === 'app' ? <Package className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                  <span className="max-w-[90px] truncate">{story.name}</span>
                  {story.phase && (
                    <span className="text-[9px] px-1 rounded border border-border bg-muted text-muted-foreground font-semibold">
                      {phaseLabel(story.phase)}
                    </span>
                  )}
                  {savedStories.has(story.filename) && <Check className="h-3 w-3 text-emerald-500 shrink-0" />}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setArtifactPanelOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* YAML content */}
          <div className="flex-1 overflow-auto select-text">
            {activeStory ? (
              <div className="p-5">
                {/* Header */}
                <div className="flex items-center justify-between mb-4 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 rounded-md bg-muted border border-border shrink-0">
                      {activeStory.kind === 'app' ? <Package className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{activeStory.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">{activeStory.filename}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy} title="Copy YAML">
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                    {!savedStories.has(activeStory.filename) ? (
                      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={() => handleSaveStory(activeStory)} disabled={saving}>
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save
                      </Button>
                    ) : (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <Check className="h-3 w-3" /> Saved
                      </span>
                    )}
                  </div>
                </div>
                {/* YAML block */}
                <div className="rounded-lg border border-border bg-zinc-950 dark:bg-[#0d1117] overflow-hidden">
                  <pre className="p-4 text-[11px] leading-relaxed text-slate-200 whitespace-pre-wrap overflow-x-auto font-mono">
                    {activeStory.yaml}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-8 opacity-40 select-none">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">No story selected</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main chat panel ── */}
      <div className={cn(
        'h-full flex flex-col bg-background border-l border-border shrink-0 overflow-hidden',
        isOpen ? 'w-[400px]' : 'w-0 border-l-0'
      )}>
        <div className="w-[400px] h-full flex flex-col">

          {/* Header (h-12, matches cowork) */}
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4 bg-background/40 backdrop-blur-md">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary border border-primary/20 shrink-0">
                <Brain className="h-3.5 w-3.5" />
              </div>
              <span className="text-[11px] font-bold tracking-widest uppercase text-foreground">TPM Agent</span>
              {activeProject && (
                <>
                  <span className="w-px h-3 bg-border/40 mx-0.5" />
                  <span className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]">{activeProject.name}</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {hasStories && (
                <Button
                  variant={artifactPanelOpen ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7 relative"
                  onClick={() => setArtifactPanelOpen(!artifactPanelOpen)}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[7px] font-bold border border-background">
                    {mergedStories.length}
                  </span>
                </Button>
              )}
              {hasStories && !allSaved && !streaming && (
                <Button size="sm" className="h-6 px-2 text-[10px] gap-1 font-semibold" onClick={handleSaveAll} disabled={savingAll}>
                  {savingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <SaveAll className="h-3 w-3" />}
                  Save all
                </Button>
              )}
              {!isEmpty && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={clearHistory}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {/* Context strip (scanning/blueprint) */}
          {!isEmpty && (repoBlueprint || scanning) && (
            <div className="px-4 py-1.5 border-b border-border/40 bg-muted/20 flex items-center gap-1.5">
              <ScanSearch className={cn('h-3 w-3 shrink-0', scanning ? 'text-muted-foreground animate-pulse' : 'text-primary')} />
              <span className="text-[10px] text-muted-foreground truncate">
                {scanning ? 'Scanning…' : `${(repoBlueprint as any)?.stack?.framework || 'Node.js'} · ${Object.keys((repoBlueprint as any)?.dependencies || {}).length} deps`}
              </span>
            </div>
          )}

          {/* Message thread */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 py-8"
            style={{ scrollbarWidth: 'thin' }}
          >
            {isEmpty ? (
              /* ── Empty state ── */
              <div className="flex flex-col items-center justify-center h-full gap-6 text-center select-none">
                <div>
                  <h2 className="text-[22px] font-semibold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-foreground via-foreground/90 to-foreground/60 mb-2">
                    Ask the TPM
                  </h2>
                  <p className="text-[13px] text-muted-foreground/60 leading-relaxed max-w-[260px]">
                    Check status, plan features, update stories, search decisions. Type{' '}
                    <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] border border-border font-mono">@</kbd>{' '}
                    to reference a story.
                  </p>
                </div>
                {(activeProject || repoBlueprint || scanning) && (
                  <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
                    {activeProject && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/50 text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-foreground font-medium truncate">{activeProject.name}</span>
                      </div>
                    )}
                    {(scanning || repoBlueprint) && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/50 text-[11px]">
                        <ScanSearch className={cn('h-3.5 w-3.5 shrink-0', scanning ? 'animate-pulse text-muted-foreground' : 'text-primary')} />
                        <span className="text-muted-foreground truncate">
                          {scanning ? 'Scanning repo…' : `${(repoBlueprint as any)?.stack?.framework || 'Node.js'} · ${mentionItems.length} stories indexed`}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {/* Quick actions */}
                <div className="flex flex-wrap gap-1.5 justify-center max-w-[290px]">
                  {QUICK_ACTIONS.map((qa) => (
                    <button
                      key={qa.label}
                      onClick={() => qa.prefill ? (setInput(qa.message), inputRef.current?.focus()) : handleSend(qa.message)}
                      className="text-[11px] font-medium px-3 py-1.5 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                    >
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className={cn('animate-in fade-in slide-in-from-bottom-1 duration-200', msg.role === 'user' ? 'flex flex-col items-end py-1 gap-1' : 'py-1')}>

                    {msg.role === 'user' ? (
                      /* ── User bubble (cowork: bg-muted, asymmetric radius) ── */
                      <div
                        className="bg-muted text-foreground px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap font-medium tracking-tight max-w-[75%]"
                        style={{ borderRadius: '18px 18px 4px 18px' }}
                      >
                        {msg.content}
                      </div>
                    ) : (
                      /* ── Assistant message (no bubble background — document flow) ── */
                      <div className="group">
                        {/* Tool chips row */}
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2.5">
                            {msg.toolCalls.map((tc) => (
                              <ToolChip key={tc.id} tc={tc} onInspect={(t) => setSelectedTool(t)} />
                            ))}
                          </div>
                        )}

                        {/* Markdown content */}
                        {msg.content && (
                          <div className={cn(PROSE, 'text-foreground')}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}

                        {/* Token telemetry + copy (only last assistant msg, only when done) */}
                        {i === lastAssistantIdx && !streaming && msg.tokenCount && (
                          <div className="flex items-center gap-1 mt-2 ml-0.5">
                            <span className="w-px h-3 bg-border/40 mx-0.5" />
                            <span className="text-[10px] tabular-nums text-muted-foreground/50 font-medium">
                              ~{msg.tokenCount < 1000 ? msg.tokenCount : `${(msg.tokenCount / 1000).toFixed(1)}k`}
                            </span>
                            <span className="text-[10px] tabular-nums text-muted-foreground/40">
                              · {((msg.durationMs || 0) / 1000).toFixed(1)}s
                            </span>
                            {msg.tokensPerSec && msg.tokensPerSec > 0 && (
                              <span className="text-[10px] tabular-nums text-emerald-500/50 font-medium">
                                · {msg.tokensPerSec}/s
                              </span>
                            )}
                            <button
                              onClick={() => handleCopyMsg(i, msg.content)}
                              className="ml-1 h-6 px-2 flex items-center gap-1.5 rounded-md hover:bg-muted text-muted-foreground/50 hover:text-muted-foreground transition-all"
                            >
                              {copiedMsg === i ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Thinking dots (while streaming and last msg has no content yet) */}
                {streaming && (() => {
                  const last = messages[messages.length - 1];
                  return last?.role === 'assistant' && !last.content && (!last.toolCalls || last.toolCalls.length === 0);
                })() && (
                  <ThinkingDots elapsed={streamElapsed} />
                )}
              </div>
            )}
          </div>

          {/* Quick actions strip (not-empty, not-streaming) */}
          {!isEmpty && !streaming && (
            <div className="px-4 pb-1.5 flex gap-1.5 flex-wrap shrink-0">
              {QUICK_ACTIONS.slice(0, 3).map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => handleSend(qa.message)}
                  className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          )}

          {/* ── Input (cowork-style: rounded-[20px], backdrop-blur) ── */}
          <div className="px-4 pb-6 pt-3 bg-background/40 backdrop-blur-xl shrink-0 border-t border-border/40">
            <div className="relative flex flex-col bg-background/60 backdrop-blur-md border border-border/60 shadow-sm focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-foreground/10 transition-all" style={{ borderRadius: 20 }}>

              {/* @mention popover */}
              {mentionQuery && filteredMentions.length > 0 && (
                <div
                  ref={mentionPopoverRef}
                  className="absolute bottom-[calc(100%+8px)] left-0 right-0 bg-background/95 backdrop-blur-xl border border-border/50 shadow-2xl overflow-hidden z-[100] animate-in fade-in slide-in-from-bottom-2 duration-150"
                  style={{ borderRadius: 12 }}
                >
                  <div className="px-3 py-1.5 border-b border-border/30 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-bold bg-muted/20 flex items-center gap-1.5">
                    <FileSearch className="h-3 w-3" />
                    {filteredMentions.length} match{filteredMentions.length !== 1 ? 'es' : ''}
                  </div>
                  <div className="max-h-[200px] overflow-y-auto p-1 space-y-px">
                    {filteredMentions.map((m, idx) => (
                      <button
                        key={m.id}
                        onClick={() => insertMention(m)}
                        className={cn(
                          'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left w-full transition-all',
                          idx === mentionSelectedIndex ? 'bg-foreground/10 text-foreground' : 'hover:bg-foreground/5 text-muted-foreground'
                        )}
                      >
                        <span className={cn(
                          'flex h-5 w-5 items-center justify-center rounded shrink-0',
                          idx === mentionSelectedIndex ? 'bg-background text-foreground shadow-sm' : 'bg-muted/50 text-muted-foreground/70'
                        )}>
                          <FileText className="h-3 w-3" />
                        </span>
                        <span className="text-[12px] truncate font-medium flex-1">{m.label}</span>
                        {m.status && (
                          <span className={cn(
                            'text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0',
                            m.status === 'done' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                            m.status === 'in-progress' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                            'bg-muted text-muted-foreground'
                          )}>
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
                placeholder={streaming ? 'Generating…' : 'Message TPM… or type @ to reference a story'}
                className="w-full border-0 px-5 py-3.5 pr-12 min-h-[48px] max-h-[200px] bg-transparent text-foreground placeholder:text-muted-foreground/50 text-[14.5px] leading-relaxed resize-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 outline-none"
                rows={1}
              />

              {/* Toolbar row */}
              <div className="flex items-center justify-between px-4 pb-3 pt-1">
                <p className="text-[10px] text-muted-foreground/40">
                  Return to send · Shift + Return for new line
                </p>
                <div className="flex items-center gap-1.5">
                  {streaming ? (
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 rounded-lg border-foreground/20 text-foreground/60 hover:bg-foreground/10"
                      onClick={handleStop}
                      title="Stop"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      className={cn(
                        'h-8 w-8 rounded-lg shadow-sm transition-all',
                        input.trim()
                          ? 'bg-foreground text-background hover:opacity-90'
                          : 'bg-foreground/10 text-foreground/30 cursor-not-allowed'
                      )}
                      disabled={!input.trim()}
                      onClick={() => handleSend()}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <p className="text-center text-[10px] text-muted-foreground/40 mt-2">
              TPM can make mistakes. Verify important decisions.
            </p>
          </div>
        </div>
      </div>

      {/* ── Tool output dialog (bottom-sheet style, cowork pattern) ── */}
      <Dialog open={!!selectedTool} onOpenChange={() => setSelectedTool(null)}>
        <DialogContent className="fixed inset-x-0 bottom-0 top-auto translate-y-0 sm:relative sm:inset-auto sm:translate-y-0 flex flex-col max-h-[75vh] w-full sm:max-w-xl border border-border p-0 bg-background shadow-2xl sm:rounded-2xl rounded-t-2xl">
          <DialogHeader className="border-b border-border px-4 py-3 shrink-0 flex flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2 font-mono">
              {selectedTool && (
                <>
                  <span className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    selectedTool.status === 'success' ? 'bg-emerald-500' : 'bg-destructive'
                  )} />
                  {selectedTool.name}
                  {selectedTool.duration && (
                    <span className="text-[11px] text-muted-foreground/50 font-normal ml-1">
                      {(selectedTool.duration / 1000).toFixed(2)}s
                    </span>
                  )}
                </>
              )}
            </DialogTitle>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedTool(null)}>
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          {selectedTool && (
            <div className="flex-1 overflow-auto p-4 space-y-3 min-h-0">
              {selectedTool.arguments && Object.keys(selectedTool.arguments).length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-bold mb-1.5">Input</p>
                  <pre className="text-[11px] text-foreground/70 bg-muted/30 rounded-lg border border-border/30 p-3 overflow-x-auto whitespace-pre-wrap font-mono">
                    {JSON.stringify(selectedTool.arguments, null, 2)}
                  </pre>
                </div>
              )}
              {selectedTool.result && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-bold mb-1.5">Output</p>
                  <pre className="text-[11px] text-foreground/70 bg-muted/30 rounded-lg border border-border/30 p-3 overflow-x-auto whitespace-pre-wrap font-mono select-text max-h-[40vh] overflow-y-auto">
                    {selectedTool.result}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
