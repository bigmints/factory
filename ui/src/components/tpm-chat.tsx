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
import { Separator } from '@/components/ui/separator';
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
      dependsOn = raw.length > 0 ? raw.split(',').map(s => s.trim().replace(/["']/g, '')).filter(Boolean) : [];
    }
    stories.push({ kind: 'feature', filename: match[1], yaml, name, phase, dependsOn });
  }

  // Fallback to generic yaml blocks
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

  // Tool Call Output Popup Modal
  const [selectedToolOutput, setSelectedToolOutput] = useState<{ name: string; result: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load project context & codebase details
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

  // Sync scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Update timer durations for running tool calls
  useEffect(() => {
    if (!streaming) return;
    const interval = setInterval(() => {
      setMessages((prev) => {
        return prev.map((msg) => {
          if (!msg.toolCalls) return msg;
          const updatedCalls = msg.toolCalls.map((tc) => {
            if (tc.status === 'running' && tc.startTime) {
              return { ...tc, duration: Date.now() - tc.startTime };
            }
            return tc;
          });
          return { ...msg, toolCalls: updatedCalls };
        });
      });
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
          messages: newMessages.map((m) => ({ role: m.role, content: m.content }))
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
                if (last && last.role === 'assistant') {
                  last.content += parsed.content;
                }
                return updated;
              });
            } else if (parsed.type === 'tool_start') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  const calls = last.toolCalls || [];
                  if (!calls.some(c => c.id === parsed.id)) {
                    calls.push({
                      id: parsed.id,
                      name: parsed.name,
                      arguments: parsed.arguments,
                      status: 'running',
                      startTime: Date.now(),
                      duration: 0
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
                  const tc = last.toolCalls.find(c => c.id === parsed.id);
                  if (tc) {
                    tc.status = parsed.status || 'success';
                    tc.result = parsed.result;
                    if (tc.startTime) {
                      tc.duration = Date.now() - tc.startTime;
                    }
                  }
                }
                return updated;
              });
            } else if (parsed.type === 'error') {
              toast.error(parsed.error || 'Server error occurred');
            }
          } catch {
            // Skip
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

  // Find proposed stories from assistant briefs
  const allStories: ParsedStory[] = (() => {
    // Check if any assistant message contains decomposed story blocks
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const stories = extractAllStories(messages[i].content);
        if (stories.length > 0) return stories;
      }
    }
    return [];
  })();

  // Also check if tool execution of decompose_requirements returned story blocks!
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
        body: JSON.stringify({
          name: story.name,
          content: story.yaml,
          kind: story.kind === 'feature' ? 'feature' : 'app',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Saved ${story.kind === 'feature' ? 'feature' : 'app'} story`, { description: data.file });
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

    const sortedStories = [...mergedStories].sort((a, b) => {
      const phaseA = a.kind === 'app' ? 0 : (a.phase ?? 99);
      const phaseB = b.kind === 'app' ? 0 : (b.phase ?? 99);
      return phaseA - phaseB;
    });

    for (const story of sortedStories) {
      if (savedStories.has(story.filename)) continue;
      try {
        const res = await fetch('/api/stories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: story.name,
            content: story.yaml,
            kind: story.kind === 'feature' ? 'feature' : 'app',
          }),
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
                body: JSON.stringify({
                  storyFile: data.file,
                  kind: 'FeatureStory',
                  phase: story.phase ?? 0,
                  dependsOn: story.dependsOn ?? [],
                }),
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
    toast.success('Chat history cleared');
  };

  const isEmpty = messages.length === 0;

  const phaseColor = (phase?: number) => {
    switch (phase) {
      case 1: return 'bg-muted text-emerald-600 dark:text-emerald-400 border-emerald-500';
      case 2: return 'bg-muted text-amber-600 dark:text-amber-500 border-amber-500';
      case 3: return 'bg-muted text-purple-600 dark:text-purple-400 border-purple-500';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="flex shrink-0 h-full relative z-40 select-none">
      {/* ── Collapsible Spec stories (Artifact Panel) sliding next to the chat ── */}
      <div className={cn(
        "h-full flex flex-col bg-card border-l border-border transition-all duration-300 ease-in-out shrink-0 relative overflow-hidden",
        isOpen && artifactPanelOpen && hasStories ? "w-[420px] md:w-[450px]" : "w-0 border-l-0"
      )}>
        <div className="w-[450px] h-full flex flex-col">
          
          {/* Stories Horizontal Tab Bar */}
          <div className="border-b border-border bg-muted shrink-0 select-none">
            <div className="flex items-center h-14 px-3 justify-between">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 mr-2 pb-1 pt-1 select-none snap-x snap-mandatory">
                {mergedStories.map((story, idx) => (
                  <button
                    key={story.filename}
                    onClick={() => setActiveTab(idx)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold whitespace-nowrap transition-all shrink-0 min-h-[30px] snap-center tap-shrink border',
                      idx === activeTab
                        ? 'bg-card border-border text-foreground shadow-xs'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40'
                    )}
                  >
                    {story.kind === 'app' ? (
                      <Package className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <Layers className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="max-w-[100px] truncate">{story.name}</span>
                    {story.phase && (
                      <span className={cn('text-[8px] px-1 rounded-md border font-bold', phaseColor(story.phase))}>
                        P{story.phase}
                      </span>
                    )}
                    {savedStories.has(story.filename) && (
                      <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                    )}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
                  onClick={() => setArtifactPanelOpen(false)}
                  title="Close Panel"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Stories YAML Editor/Code view */}
          <div className="flex-1 overflow-auto bg-card select-text">
            {activeStory ? (
              <div className="p-4 sm:p-6 font-mono text-[10px] leading-relaxed relative">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-border relative z-10">
                  <div className="flex items-center gap-2 min-w-0">
                    {activeStory.kind === 'app' ? (
                      <div className="p-1.5 rounded-lg bg-muted border border-border shrink-0">
                        <Package className="h-3.5 w-3.5 text-foreground" />
                      </div>
                    ) : (
                      <div className="p-1.5 rounded-lg bg-muted border border-border shrink-0">
                        <Layers className="h-3.5 w-3.5 text-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-foreground text-xs font-bold truncate">{activeStory.name}</h3>
                      <p className="text-muted-foreground text-[8px] font-semibold truncate mt-0.5">{activeStory.filename}</p>
                    </div>
                    {activeStory.phase && (
                      <span className={cn('text-[8px] px-2 py-0.5 rounded-md border font-bold ml-2 shrink-0', phaseColor(activeStory.phase))}>
                        Phase {activeStory.phase}
                      </span>
                    )}
                  </div>

                  {!savedStories.has(activeStory.filename) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-[10px] font-bold gap-1 rounded-md tap-shrink border-border"
                      onClick={() => handleSaveStory(activeStory)}
                      disabled={saving || streaming}
                    >
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      <span>Save</span>
                    </Button>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400 text-[10px] font-bold flex items-center gap-1 bg-muted px-2 py-0.5 rounded-md border border-emerald-500/30 shrink-0">
                      <Check className="h-3 w-3" /> Enqueued
                    </span>
                  )}
                </div>
                
                <div className="rounded-lg border border-border p-4 shadow-xs relative overflow-hidden bg-[#0d1117] text-white">
                  <pre className="relative z-10 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                    <code className="text-slate-200">{activeStory.yaml}</code>
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center gap-4 p-6 select-none opacity-50">
                <div className="relative">
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-xl bg-muted border border-border shadow-inner">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-foreground">Spec Workspace Empty</h4>
                  <p className="text-[10px] text-muted-foreground max-w-xs leading-relaxed">
                    Decomposed feature blueprints will load on the right panel automatically during chat sessions.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Collapsible Chat Workspace Panel sliding from the right ── */}
      <div className={cn(
        "h-full flex flex-col bg-card border-l border-border transition-all duration-300 ease-in-out shrink-0 relative overflow-hidden",
        isOpen ? "w-[400px] md:w-[420px]" : "w-0 border-l-0"
      )}>
        <div className="w-[420px] h-full flex flex-col relative">
          {/* Header */}
          <header className="border-b border-border px-4 py-3 flex items-center justify-between h-14 shrink-0 bg-card sticky top-0 z-40 shadow-xs select-none">
            <div className="flex items-center space-x-2 min-w-0">
              <div className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary/10 p-1.5 border border-primary/20 text-primary">
                <Brain className="size-4" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <h2 className="text-xs font-bold tracking-tight truncate text-foreground flex items-center gap-1.5">
                  Ask TPM
                  <Badge variant="secondary" className="h-4 px-1 text-[7.5px] uppercase font-mono tracking-wider font-semibold border bg-primary/5 text-primary border-primary/20">
                    Agent
                  </Badge>
                </h2>
                <p className="text-[8px] text-muted-foreground font-semibold truncate">
                  {activeProject ? `Project: ${activeProject.name}` : 'Factory Assistant'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Toggle Artifact Panel */}
              {hasStories && (
                <Button
                  variant={artifactPanelOpen ? "secondary" : "outline"}
                  size="icon"
                  className="h-7 w-7 rounded-md border border-border/50 relative"
                  onClick={() => setArtifactPanelOpen(!artifactPanelOpen)}
                  title="Toggle specs panel"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <Badge className="absolute -top-1 -right-1 h-3.5 min-w-3.5 px-0.5 text-[7px] font-bold bg-indigo-600 text-white flex items-center justify-center rounded-full border border-card shadow-sm">
                    {mergedStories.length}
                  </Badge>
                </Button>
              )}

              {hasStories && !streaming && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 rounded-md border border-border/50"
                    onClick={handleCopy}
                    title="Copy active story spec"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  {!allSaved && (
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-[9px] font-bold gap-1 rounded-md bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90 border-0"
                      onClick={handleSaveAll}
                      disabled={savingAll}
                    >
                      {savingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <SaveAll className="h-3.5 w-3.5" />}
                      <span>Save All</span>
                    </Button>
                  )}
                </>
              )}

              {!isEmpty && (
                <Button
                  variant="outline"
                  size="icon"
                  title="Clear History"
                  className="h-7 w-7 rounded-md hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/20 border-border text-muted-foreground"
                  onClick={clearHistory}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
                onClick={onClose}
                title="Close TPM Chat"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {/* Scanning banner */}
          {isEmpty && (activeProject || repoBlueprint || scanError) && (
            <div className="px-4 mt-3 space-y-1.5">
              {activeProject && (
                <div className="px-2.5 py-1.5 rounded-lg bg-muted/60 border border-border text-foreground text-[9px] font-semibold flex items-center gap-1.5 shadow-xs">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">Active Project: <strong className="text-foreground">{activeProject.name}</strong></span>
                </div>
              )}

              <div className={cn(
                "px-2.5 py-1.5 rounded-lg border text-[9px] font-semibold flex items-center gap-1.5 transition-colors",
                scanning ? "border-border bg-muted/60 text-foreground" :
                repoBlueprint ? "border-border bg-muted/60 text-foreground" :
                scanError ? "border-rose-500/25 bg-rose-500/5 dark:bg-rose-950/15 text-rose-600 dark:text-rose-400" : ""
              )}>
                {scanning ? (
                  <><ScanSearch className="h-3.5 w-3.5 text-muted-foreground shrink-0 animate-pulse" /> <span>Scanning repo...</span></>
                ) : repoBlueprint ? (
                  <><ScanSearch className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate text-foreground/90 font-medium">
                      Stack: {repoBlueprint.stack?.framework || 'Node.js'} ({Object.keys(repoBlueprint.dependencies || {}).length} deps)
                    </span>
                  </>
                ) : scanError ? (
                  <><ScanSearch className="h-3.5 w-3.5 text-rose-500 shrink-0" /> <span>Metadata unavailable</span></>
                ) : null}
              </div>
            </div>
          )}

          {/* Message Thread */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-6 scrollbar-thin">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-4 max-w-[280px] mx-auto select-none animate-in fade-in slide-in-from-bottom-3 duration-300">
                <div className="relative">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary shadow-xs">
                    <Bot className="h-6 w-6" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-xs font-bold text-foreground">Ask the TPM Agent</h3>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Check project status, plan new feature specs, save story blueprints directly to the build queue, or register ADRs in the project.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300",
                      msg.role === 'assistant' ? "flex-row" : "flex-row-reverse"
                    )}
                  >
                    <Avatar className="h-7 w-7 shrink-0 mt-0.5 border border-border">
                      <AvatarFallback
                        className={cn(
                          'text-[9px] font-bold',
                          msg.role === 'assistant'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {msg.role === 'assistant' ? 'TPM' : 'US'}
                      </AvatarFallback>
                    </Avatar>

                    <div className={cn(
                      "flex-1 flex flex-col min-w-0",
                      msg.role === 'user' ? "items-end text-right" : "items-start text-left"
                    )}>
                      <span className="text-[8px] font-bold text-muted-foreground/60 mb-1 uppercase tracking-widest px-1">
                        {msg.role === 'assistant' ? 'Program Manager' : 'Author'}
                      </span>
                      
                      <div className={cn(
                        "max-w-[90%] text-xs rounded-xl p-3 leading-relaxed border flex flex-col gap-3 shadow-xs",
                        msg.role === 'assistant'
                          ? "bg-card border-border text-card-foreground"
                          : "bg-primary text-primary-foreground border-primary font-medium"
                      )}>
                        {msg.content && <p className="whitespace-pre-wrap select-text">{msg.content}</p>}

                        {/* Interactive Tool Calling Badges */}
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="space-y-2 mt-2 w-full">
                            <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">
                              Executed Actions ({msg.toolCalls.length})
                            </div>
                            {msg.toolCalls.map((tc) => (
                              <div
                                key={tc.id}
                                className={cn(
                                  "rounded-lg border p-2 flex flex-col gap-2 transition-all bg-card/70 backdrop-blur-md",
                                  tc.status === 'running' ? "border-violet-500/40 shadow-xs shadow-violet-500/5 animate-pulse" :
                                  tc.status === 'success' ? "border-emerald-500/20 text-foreground" : "border-rose-500/20 text-foreground"
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
                                    <span className="font-mono text-[9px] font-bold text-foreground/80 truncate">
                                      {tc.name}
                                    </span>
                                  </div>
                                  
                                  {tc.duration !== undefined && (
                                    <div className="text-[8px] font-mono font-semibold text-muted-foreground flex items-center gap-1">
                                      <Clock className="h-2 w-2" />
                                      {(tc.duration / 1000).toFixed(1)}s
                                    </div>
                                  )}
                                </div>

                                {tc.arguments && Object.keys(tc.arguments).length > 0 && (
                                  <div className="text-[8px] font-mono bg-muted p-1.5 rounded border border-border/60 text-muted-foreground max-h-20 overflow-y-auto leading-relaxed select-text">
                                    {JSON.stringify(tc.arguments, null, 2)}
                                  </div>
                                )}

                                {tc.result && (
                                  <div className="flex justify-end pt-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 text-[8px] font-bold border-border/80 text-foreground hover:bg-muted shrink-0 flex items-center gap-1 shadow-xs"
                                      onClick={() => setSelectedToolOutput({ name: tc.name, result: tc.result || "" })}
                                    >
                                      <Eye className="h-2.5 w-2.5" />
                                      View Output
                                    </Button>
                                  </div>
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

          {/* Centered Input Area */}
          <div className="p-3 shrink-0 border-t border-border bg-card relative z-30">
            <div className="relative flex flex-col rounded-[20px] bg-background/60 backdrop-blur-md border border-border/60 overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all duration-250 shadow-xs">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message TPM..."
                className="w-full border-0 px-4 py-3.5 pr-12 min-h-[48px] max-h-[140px] outline-hidden text-xs leading-relaxed text-foreground resize-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent scrollbar-none"
                rows={1}
                disabled={streaming}
              />
              <div className="flex items-center justify-between px-4 pb-2.5 pt-0.5">
                <div className="flex items-center gap-1.5 opacity-50 hover:opacity-100 transition-opacity select-none">
                  <Terminal className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[8px] font-semibold font-mono tracking-tight text-muted-foreground uppercase">SSE Active</span>
                </div>
                <div className="absolute right-3 bottom-2.5">
                  <Button
                    size="icon"
                    className={cn(
                      'rounded-full h-7 w-7 p-0 transition-all duration-200 tap-shrink',
                      input.trim()
                        ? 'bg-primary text-primary-foreground hover:scale-105 active:scale-95 shadow-md'
                        : 'bg-muted text-muted-foreground hover:bg-muted'
                    )}
                    disabled={!input.trim() || streaming}
                    onClick={() => handleSend()}
                  >
                    {streaming ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ArrowUp className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tool Call Output Dialog */}
      <Dialog open={!!selectedToolOutput} onOpenChange={() => setSelectedToolOutput(null)}>
        <DialogContent className="fixed z-50 flex flex-col max-h-[85vh] w-[92vw] sm:max-w-2xl border border-border p-0 bg-background/98 backdrop-blur-xl shadow-2xl rounded-xl">
          <DialogHeader className="border-b border-border/80 px-4 py-3 shrink-0 bg-card/60 flex flex-row items-center justify-between space-y-0 h-14">
            <DialogTitle className="text-xs sm:text-sm font-bold flex items-center gap-1.5 text-foreground">
              <Terminal className="h-4 w-4 text-primary shrink-0" />
              <span>Tool Output Log: {selectedToolOutput?.name}</span>
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md shrink-0 text-muted-foreground"
              onClick={() => setSelectedToolOutput(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>

          <div className="flex-1 overflow-auto p-4 bg-muted/40 font-mono text-[9px] sm:text-xs leading-relaxed select-text min-h-0">
            <pre className="whitespace-pre-wrap break-all bg-card border border-border/60 rounded-lg p-3 sm:p-4 text-foreground/80 leading-5">
              {selectedToolOutput?.result}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
