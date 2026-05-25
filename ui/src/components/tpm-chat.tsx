'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
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
  Dot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ToolCall {
  id: string;
  name: string;
  arguments: any;
  status: 'running' | 'success' | 'failed';
  result?: string;
  startTime?: number;
  duration?: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

interface ParsedStory {
  kind: 'app' | 'feature';
  filename: string;
  yaml: string;
  name: string;
  phase?: number;
  dependsOn?: string[];
  saved?: boolean;
}

function extractAllStories(content: string): ParsedStory[] {
  const stories: ParsedStory[] = [];

  const appPatternNew = /=== APP_STORY:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_STORY ===/g;
  let match;
  while ((match = appPatternNew.exec(content)) !== null) {
    const yaml = match[2].trim();
    const name = extractNameFromYaml(yaml) || match[1].replace('.yaml', '');
    stories.push({ kind: 'app', filename: match[1], yaml, name });
  }

  const featurePatternNew = /=== FEATURE_STORY:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_STORY ===/g;
  while ((match = featurePatternNew.exec(content)) !== null) {
    const yaml = match[2].trim();
    const name = extractNameFromYaml(yaml) || match[1].replace('.yaml', '');
    const phaseMatch = yaml.match(/^phase:\s*(\d+)/m);
    const phase = phaseMatch ? parseInt(phaseMatch[1]) : undefined;
    const depsMatch = yaml.match(/^dependsOn:\s*\[([^\]]*)]$/m);
    let dependsOn: string[] | undefined;
    if (depsMatch) {
      const raw = depsMatch[1].trim();
      dependsOn = raw.length > 0 ? raw.split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean) : [];
    }
    stories.push({ kind: 'feature', filename: match[1], yaml, name, phase, dependsOn });
  }

  if (stories.length === 0) {
    const yamlMatch = content.match(/```yaml\n([\s\S]*?)```/);
    if (yamlMatch) {
      const yaml = yamlMatch[1].trim();
      const name = extractNameFromYaml(yaml) || 'Untitled App';
      stories.push({ kind: 'app', filename: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.yaml', yaml, name });
    }
  }
  return stories;
}

function extractNameFromYaml(yaml: string): string | null {
  const appNameMatch = yaml.match(/appName:\s*"([^"]+)"/);
  if (appNameMatch) return appNameMatch[1];
  const featureNameMatch = yaml.match(/name:\s*"([^"]+)"/);
  if (featureNameMatch) return featureNameMatch[1];
  return null;
}

export function TpmChat({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [savedStories, setSavedStories] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);

  const [activeProject, setActiveProject] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [repoBlueprint, setRepoBlueprint] = useState<any>(null);

  const [selectedToolOutput, setSelectedToolOutput] = useState<{ name: string; result: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => {
        const active = data.projects?.find((p: any) => p.id === data.activeId);
        setActiveProject(active || null);
      })
      .catch(() => {});

    setScanning(true);
    setScanError('');
    fetch('/api/repo-scan')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setScanError(data.error);
        else setRepoBlueprint(data);
      })
      .catch((err) => setScanError(err.message || 'Scan failed'))
      .finally(() => setScanning(false));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!streaming) return;
    const interval = setInterval(() => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.toolCalls) return msg;
          return {
            ...msg,
            toolCalls: msg.toolCalls.map((tc) =>
              tc.status === 'running' && tc.startTime
                ? { ...tc, duration: Date.now() - tc.startTime }
                : tc
            ),
          };
        })
      );
    }, 100);
    return () => clearInterval(interval);
  }, [streaming]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 160) + 'px';
  };

  const handleSend = async (text?: string) => {
    const content = text || input.trim();
    if (!content || streaming) return;

    const userMsg: Message = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);
    setActiveTab(0);
    setSavedStories(new Set());

    if (inputRef.current) inputRef.current.style.height = 'auto';

    const assistantMsg: Message = { role: 'assistant', content: '', toolCalls: [] };
    setMessages([...newMessages, assistantMsg]);

    try {
      const res = await fetch('/api/tpm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Chat request failed');
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
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'text' && parsed.content) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') last.content += parsed.content;
                return updated;
              });
            } else if (parsed.type === 'tool_start') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
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
                if (last && last.role === 'assistant' && last.toolCalls) {
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
              toast.error(parsed.error || 'Server error occurred');
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err: any) {
      toast.error('Ask TPM failed', { description: err.message });
      setMessages(newMessages);
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const allStories: ParsedStory[] = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const stories = extractAllStories(messages[i].content);
        if (stories.length > 0) return stories;
      }
    }
    return [];
  })();

  const allStoriesFromTools: ParsedStory[] = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].toolCalls) {
        for (const tc of messages[i].toolCalls || []) {
          if (tc.name === 'decompose_requirements' && tc.result) {
            const stories = extractAllStories(tc.result);
            if (stories.length > 0) return stories;
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

  const prevStoriesLength = useRef(0);
  useEffect(() => {
    if (mergedStories.length > prevStoriesLength.current && mergedStories.length > 0) {
      setArtifactPanelOpen(true);
    }
    prevStoriesLength.current = mergedStories.length;
  }, [mergedStories.length]);

  const handleSaveStory = async (story: ParsedStory) => {
    setSaving(true);
    try {
      const res = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: story.name, content: story.yaml, kind: story.kind === 'feature' ? 'feature' : 'app' }),
      });
      const data = await res.json();
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
    let successCount = 0;
    let failCount = 0;

    const sorted = [...mergedStories].sort((a, b) => {
      const pa = a.kind === 'app' ? 0 : (a.phase ?? 99);
      const pb = b.kind === 'app' ? 0 : (b.phase ?? 99);
      return pa - pb;
    });

    for (const story of sorted) {
      if (savedStories.has(story.filename)) continue;
      try {
        const res = await fetch('/api/stories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: story.name, content: story.yaml, kind: story.kind === 'feature' ? 'feature' : 'app' }),
        });
        const data = await res.json();
        if (res.ok) {
          successCount++;
          setSavedStories((prev) => new Set(prev).add(story.filename));
          if (story.kind === 'feature' && data.file) {
            try {
              await fetch('/api/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storyFile: data.file, kind: 'FeatureStory', phase: story.phase ?? 0, dependsOn: story.dependsOn ?? [] }),
              });
            } catch { /* non-critical */ }
          }
        } else {
          failCount++;
          toast.error(`Failed: ${story.filename}`, { description: data.error });
        }
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`Saved ${successCount} stor${successCount > 1 ? 'ies' : 'y'}`, {
        description: failCount > 0 ? `${failCount} failed` : 'Auto-enqueued for build',
      });
    }
    setSavingAll(false);
  };

  const handleCopy = async () => {
    if (!activeStory) return;
    await navigator.clipboard.writeText(activeStory.yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearHistory = () => {
    setMessages([]);
    setSavedStories(new Set());
    setActiveTab(0);
    toast.success('Chat cleared');
  };

  const isEmpty = messages.length === 0;

  const phaseColor = (phase?: number) => {
    switch (phase) {
      case 1: return 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/5';
      case 2: return 'text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/5';
      case 3: return 'text-purple-600 dark:text-purple-400 border-purple-500/40 bg-purple-500/5';
      default: return 'text-muted-foreground border-border bg-muted';
    }
  };

  if (!isOpen && !artifactPanelOpen) return null;

  return (
    <div className="flex shrink-0 h-full">
      {/* ── Artifact / Stories panel ── */}
      <div className={cn(
        'h-full flex flex-col bg-background border-l border-border transition-all duration-300 ease-in-out shrink-0 overflow-hidden',
        isOpen && artifactPanelOpen && hasStories ? 'w-96' : 'w-0 border-l-0'
      )}>
        <div className="w-96 h-full flex flex-col">
          {/* Tab bar */}
          <div className="border-b border-border bg-card/50 shrink-0">
            <div className="flex items-center h-12 px-3 gap-2">
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1">
                {mergedStories.map((story, idx) => (
                  <button
                    key={story.filename}
                    onClick={() => setActiveTab(idx)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                      idx === activeTab
                        ? 'bg-background text-foreground shadow-sm border border-border'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}
                  >
                    {story.kind === 'app'
                      ? <Package className="h-3 w-3" />
                      : <Layers className="h-3 w-3" />}
                    <span className="max-w-24 truncate">{story.name}</span>
                    {story.phase && (
                      <span className={cn('text-xs px-1 rounded border font-semibold', phaseColor(story.phase))}>
                        P{story.phase}
                      </span>
                    )}
                    {savedStories.has(story.filename) && (
                      <Check className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground"
                onClick={() => setArtifactPanelOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Story content */}
          <div className="flex-1 overflow-auto">
            {activeStory ? (
              <div className="p-4 font-mono text-xs leading-relaxed">
                {/* Story header */}
                <div className="flex items-start justify-between mb-4 pb-3 border-b border-border gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 rounded-md bg-muted border border-border shrink-0">
                      {activeStory.kind === 'app'
                        ? <Package className="h-3 w-3" />
                        : <Layers className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{activeStory.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{activeStory.filename}</p>
                    </div>
                  </div>
                  {!savedStories.has(activeStory.filename) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-xs gap-1 shrink-0"
                      onClick={() => handleSaveStory(activeStory)}
                      disabled={saving || streaming}
                    >
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      Save
                    </Button>
                  ) : (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 shrink-0">
                      <Check className="h-3 w-3" /> Saved
                    </span>
                  )}
                </div>

                {/* YAML block */}
                <div className="rounded-lg border border-border bg-zinc-950 dark:bg-zinc-900 overflow-hidden">
                  <pre className="p-4 whitespace-pre-wrap overflow-x-auto leading-relaxed text-zinc-100">
                    <code>{activeStory.yaml}</code>
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 p-8 opacity-40">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">No story selected</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main chat panel ── */}
      <div className={cn(
        'h-full flex flex-col bg-background border-l border-border transition-all duration-300 ease-in-out shrink-0 overflow-hidden',
        isOpen ? 'w-96' : 'w-0 border-l-0'
      )}>
        <div className="w-96 h-full flex flex-col">

          {/* ── Header ── */}
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
                <Brain className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground">TPM</span>
                  <Badge variant="secondary" className="h-4 px-1.5 text-xs font-medium">
                    Agent
                  </Badge>
                </div>
                {activeProject && (
                  <p className="text-xs text-muted-foreground truncate">{activeProject.name}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {hasStories && (
                <Button
                  variant={artifactPanelOpen ? 'secondary' : 'ghost'}
                  size="icon"
                  className="size-7 relative"
                  onClick={() => setArtifactPanelOpen(!artifactPanelOpen)}
                  title="Toggle specs"
                >
                  <Layers className="h-4 w-4" />
                  <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold border border-background">
                    {mergedStories.length}
                  </span>
                </Button>
              )}

              {hasStories && !streaming && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={handleCopy}
                    title="Copy YAML"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  {!allSaved && (
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs gap-1 font-medium"
                      onClick={handleSaveAll}
                      disabled={savingAll}
                    >
                      {savingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <SaveAll className="h-3 w-3" />}
                      Save all
                    </Button>
                  )}
                </>
              )}

              {!isEmpty && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={clearHistory}
                  title="Clear"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={onClose}
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {/* ── Context pill (only on empty state) ── */}
          {isEmpty && (activeProject || repoBlueprint || scanning) && (
            <div className="px-4 pt-3 pb-0 flex flex-col gap-1.5">
              {activeProject && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Dot className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span className="font-medium text-foreground truncate">{activeProject.name}</span>
                </div>
              )}
              {scanning && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <ScanSearch className="h-3.5 w-3.5 shrink-0 animate-pulse" />
                  Scanning repo…
                </div>
              )}
              {!scanning && repoBlueprint && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <ScanSearch className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">
                    {repoBlueprint.stack?.framework || 'Node.js'} · {Object.keys(repoBlueprint.dependencies || {}).length} deps
                  </span>
                </div>
              )}
              {!scanning && scanError && (
                <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Repo metadata unavailable
                </div>
              )}
            </div>
          )}

          {/* ── Message thread ── */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {isEmpty ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center h-full gap-5 py-16 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
                  <Bot className="size-7" />
                </div>
                <div className="space-y-1.5 max-w-56">
                  <h3 className="text-sm font-semibold text-foreground">Ask the TPM Agent</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Plan features, decompose stories, check build status, or register decisions in the project.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-200',
                      msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                    )}
                  >
                    {/* Avatar */}
                    <Avatar className="size-7 shrink-0 mt-0.5">
                      <AvatarFallback
                        className={cn(
                          'text-xs font-semibold',
                          msg.role === 'assistant'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {msg.role === 'assistant' ? 'AI' : 'Me'}
                      </AvatarFallback>
                    </Avatar>

                    <div className={cn(
                      'flex flex-col gap-1 min-w-0 max-w-72',
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    )}>
                      {/* Bubble */}
                      <div className={cn(
                        'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                        msg.role === 'assistant'
                          ? 'bg-muted text-foreground rounded-tl-sm'
                          : 'bg-primary text-primary-foreground rounded-tr-sm'
                      )}>
                        {msg.content && (
                          <p className="whitespace-pre-wrap select-text">{msg.content}</p>
                        )}

                        {/* Tool calls */}
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className={cn('space-y-1.5 mt-3', msg.content && 'border-t border-current/10 pt-3')}>
                            {msg.toolCalls.map((tc) => (
                              <div
                                key={tc.id}
                                className={cn(
                                  'rounded-lg border px-2.5 py-2 text-xs flex flex-col gap-1.5 bg-background/50',
                                  tc.status === 'running' ? 'border-violet-500/30 animate-pulse' :
                                  tc.status === 'success' ? 'border-emerald-500/20' : 'border-rose-500/20'
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {tc.status === 'running' ? (
                                      <Loader2 className="h-3 w-3 animate-spin text-violet-500 shrink-0" />
                                    ) : tc.status === 'success' ? (
                                      <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                    ) : (
                                      <AlertTriangle className="h-3 w-3 text-rose-500 shrink-0" />
                                    )}
                                    <span className="font-mono text-xs font-medium text-foreground truncate">
                                      {tc.name}
                                    </span>
                                  </div>
                                  {tc.duration !== undefined && (
                                    <span className="text-xs font-mono text-muted-foreground flex items-center gap-0.5 shrink-0">
                                      <Clock className="h-2.5 w-2.5" />
                                      {(tc.duration / 1000).toFixed(1)}s
                                    </span>
                                  )}
                                </div>

                                {tc.result && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 text-xs gap-1 w-full justify-start text-muted-foreground hover:text-foreground px-1"
                                    onClick={() => setSelectedToolOutput({ name: tc.name, result: tc.result || '' })}
                                  >
                                    <Eye className="h-3 w-3" />
                                    View output
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Input ── */}
          <div className="shrink-0 border-t border-border p-3">
            <div className={cn(
              'relative flex flex-col rounded-xl border bg-background transition-all duration-150',
              'focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10',
              streaming ? 'opacity-70' : 'opacity-100'
            )}>
              <Textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message TPM…"
                className="w-full border-0 px-4 py-3 pr-12 min-h-10 max-h-32 text-sm leading-relaxed resize-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
                rows={1}
                disabled={streaming}
              />
              <div className="absolute right-2.5 bottom-2.5">
                <Button
                  size="icon"
                  className={cn(
                    'size-7 rounded-full transition-all duration-150',
                    input.trim()
                      ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground'
                  )}
                  disabled={!input.trim() || streaming}
                  onClick={() => handleSend()}
                >
                  {streaming
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ArrowUp className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <p className="text-center text-xs text-muted-foreground/50 mt-2">
              ⌘↵ to send · shift↵ for newline
            </p>
          </div>
        </div>
      </div>

      {/* ── Tool output dialog ── */}
      <Dialog open={!!selectedToolOutput} onOpenChange={() => setSelectedToolOutput(null)}>
        <DialogContent className="flex flex-col max-h-screen w-11/12 sm:max-w-2xl border border-border p-0 bg-background shadow-2xl rounded-xl">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3 space-y-0 shrink-0">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              {selectedToolOutput?.name}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={() => setSelectedToolOutput(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4 min-h-0">
            <pre className="whitespace-pre-wrap break-all rounded-lg border border-border bg-muted p-4 text-xs leading-relaxed text-foreground font-mono select-text">
              {selectedToolOutput?.result}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
