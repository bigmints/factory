'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
  User,
  Save,
  Loader2,
  Sparkles,
  Copy,
  Check,
  X,
  FileText,
  Terminal,
  Zap,
  Package,
  Layers,
  SaveAll,
  ScanSearch,
  FolderTree,
  Blocks,
  FileCode,
  AlertTriangle,
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

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ParsedSpec {
  kind: 'app' | 'feature';
  filename: string;
  yaml: string;
  name: string;
  phase?: number;
  dependsOn?: string[];
  saved?: boolean;
}

interface SpecChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSpecSaved: () => void;
}

function extractAllSpecs(content: string): ParsedSpec[] {
  const specs: ParsedSpec[] = [];
  const appPattern = /=== APP_SPEC:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_SPEC ===/g;
  let match;
  while ((match = appPattern.exec(content)) !== null) {
    const yaml = match[2].trim();
    const name = extractNameFromYaml(yaml) || match[1].replace('.yaml', '');
    specs.push({ kind: 'app', filename: match[1], yaml, name });
  }
  const featurePattern = /=== FEATURE_SPEC:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_SPEC ===/g;
  while ((match = featurePattern.exec(content)) !== null) {
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
    specs.push({ kind: 'feature', filename: match[1], yaml, name, phase, dependsOn });
  }
  if (specs.length === 0) {
    const yamlMatch = content.match(/```yaml\n([\s\S]*?)```/);
    if (yamlMatch) {
      const yaml = yamlMatch[1].trim();
      const name = extractNameFromYaml(yaml) || 'Untitled App';
      specs.push({ kind: 'app', filename: slugify(name) + '.yaml', yaml, name });
    }
  }
  return specs;
}

function extractNameFromYaml(yaml: string): string | null {
  const appNameMatch = yaml.match(/appName:\s*"([^"]+)"/);
  if (appNameMatch) return appNameMatch[1];
  const featureNameMatch = yaml.match(/name:\s*"([^"]+)"/);
  if (featureNameMatch) return featureNameMatch[1];
  return null;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function SpecChat({ open, onOpenChange, onSpecSaved }: SpecChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [savedSpecs, setSavedSpecs] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [isExistingApp, setIsExistingApp] = useState(false);
  const [existingAppName, setExistingAppName] = useState('');

  const [repoContext, setRepoContext] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');

  // Mobile navigation switcher: 'chat' | 'preview'
  const [mobilePane, setMobilePane] = useState<'chat' | 'preview'>('chat');

  useEffect(() => {
    if (open) {
      fetch('/api/specs')
        .then((r) => r.json())
        .then((data) => {
          if (data.specs && data.specs.length > 0) {
            setIsExistingApp(true);
            const firstApp = data.specs[0];
            const name = firstApp.metadata?.name || firstApp.metadata?.slug || firstApp.file?.replace('.yaml', '') || 'app';
            setExistingAppName(name);
          } else {
            setIsExistingApp(false);
            setExistingAppName('');
          }
        })
        .catch(() => {
          setIsExistingApp(false);
          setExistingAppName('');
        });

      setScanning(true);
      setScanError('');
      fetch('/api/repo-scan')
        .then((r) => r.json())
        .then((data) => {
          if (data.error) {
            setScanError(data.error);
          } else {
            setRepoContext(data);
          }
        })
        .catch((err) => setScanError(err.message || 'Scan failed'))
        .finally(() => setScanning(false));
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

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
    setSavedSpecs(new Set());

    if (inputRef.current) inputRef.current.style.height = 'auto';

    const assistantMsg: Message = { role: 'assistant', content: '' };
    setMessages([...newMessages, assistantMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          isExistingApp,
          existingAppName,
          repoContext,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Chat request failed');
      }
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              accumulated += parsed.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: accumulated };
                return updated;
              });
            }
          } catch {
            // Skip
          }
        }
      }
    } catch (err: any) {
      toast.error('Chat failed', { description: err.message });
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

  const allSpecs: ParsedSpec[] = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const specs = extractAllSpecs(messages[i].content);
        if (specs.length > 0) return specs;
      }
    }
    return [];
  })();

  const activeSpec = allSpecs[activeTab] || null;
  const hasSpecs = allSpecs.length > 0;
  const allSaved = allSpecs.length > 0 && allSpecs.every((s) => savedSpecs.has(s.filename));

  const handleSaveSpec = async (spec: ParsedSpec) => {
    setSaving(true);
    try {
      const res = await fetch('/api/specs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: spec.name,
          content: spec.yaml,
          kind: spec.kind === 'feature' ? 'feature' : 'app',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Saved ${spec.kind === 'feature' ? 'feature' : 'app'} spec`, { description: data.file });
        setSavedSpecs((prev) => new Set(prev).add(spec.filename));
        onSpecSaved();
      } else {
        toast.error('Save failed', { description: data.error });
      }
    } catch {
      toast.error('Failed to save spec');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    let successCount = 0;
    let failCount = 0;

    const sortedSpecs = [...allSpecs].sort((a, b) => {
      const phaseA = a.kind === 'app' ? 0 : (a.phase ?? 99);
      const phaseB = b.kind === 'app' ? 0 : (b.phase ?? 99);
      return phaseA - phaseB;
    });

    for (const spec of sortedSpecs) {
      if (savedSpecs.has(spec.filename)) continue;
      try {
        const res = await fetch('/api/specs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: spec.name,
            content: spec.yaml,
            kind: spec.kind === 'feature' ? 'feature' : 'app',
          }),
        });
        const data = await res.json();
        if (res.ok) {
          successCount++;
          setSavedSpecs((prev) => new Set(prev).add(spec.filename));
          if (spec.kind === 'feature' && data.file) {
            try {
              await fetch('/api/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  specFile: data.file,
                  kind: 'FeatureSpec',
                  phase: spec.phase ?? 0,
                  dependsOn: spec.dependsOn ?? [],
                }),
              });
            } catch { /* non-critical */ }
          }
        } else {
          failCount++;
          toast.error(`Failed: ${spec.filename}`, { description: data.error });
        }
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`Saved ${successCount} spec${successCount > 1 ? 's' : ''}`, {
        description: failCount > 0 ? `${failCount} failed` : 'Auto-enqueued for build',
      });
      onSpecSaved();
    }
    setSavingAll(false);
  };

  const handleCopy = async () => {
    if (!activeSpec) return;
    await navigator.clipboard.writeText(activeSpec.yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isEmpty = messages.length === 0;

  const phaseColor = (phase?: number) => {
    switch (phase) {
      case 1: return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 2: return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 3: return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-0 z-50 flex flex-col w-screen h-screen max-w-none m-0 rounded-none border-0 p-0 gap-0 overflow-hidden outline-none bg-background translate-x-0 translate-y-0 sm:max-w-none top-0 left-0 [&>button]:hidden">
        
        {/* Top Header */}
        <DialogHeader className="border-b border-border/40 px-4 py-3 flex-row items-center justify-between space-y-0 h-14 sm:h-16 shrink-0 bg-card/60 backdrop-blur-xl sticky top-0 z-50 shadow-xs">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="inline-flex shrink-0 items-center justify-center rounded-xl bg-sky-500/10 p-2 shadow-xs glow-blue">
              <Sparkles className="size-4.5 text-sky-400 animate-pulse" />
            </div>
            <div className="space-y-0.5 min-w-0">
              <DialogTitle className="text-sm sm:text-base font-bold tracking-tight truncate text-foreground">
                Spec Architecture Studio
              </DialogTitle>
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">
                {isExistingApp
                  ? `Expanding framework components for ${existingAppName}`
                  : 'AI Spec Decomposition & Orchestration Engine'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasSpecs && !streaming && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-[10px] sm:text-xs font-semibold gap-1.5 rounded-full tap-shrink border-border/50 hover:bg-muted/40"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
                </Button>
                {!allSaved && (
                  <Button
                    size="sm"
                    className="h-8 px-3 text-[10px] sm:text-xs font-semibold gap-1.5 rounded-full tap-shrink bg-sky-500 hover:bg-sky-600 active:scale-95 shadow-md shadow-sky-500/10 text-white"
                    onClick={handleSaveAll}
                    disabled={savingAll}
                  >
                    {savingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SaveAll className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">Save All ({allSpecs.length - savedSpecs.size})</span>
                    <span className="sm:hidden">Save ({allSpecs.length - savedSpecs.size})</span>
                  </Button>
                )}
                {allSaved && (
                  <Badge variant="outline" className="h-8 px-3 text-[10px] sm:text-xs font-semibold gap-1.5 border-emerald-500/20 bg-emerald-500/5 text-emerald-400 rounded-full">
                    <Check className="h-3.5 w-3.5" />
                    <span>All Saved</span>
                  </Badge>
                )}
              </>
            )}
            <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block bg-border/40" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full hover:bg-rose-500/10 hover:text-rose-400 transition-colors tap-shrink border border-border/10"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Mobile Tab Segment Switcher */}
        {hasSpecs && (
          <div className="lg:hidden flex bg-muted/40 px-3 py-2 border-b border-border/30 shrink-0">
            <div className="w-full rounded-xl bg-muted/70 p-1 flex items-center border border-border/30 shadow-inner">
              <button
                className={cn(
                  "flex-1 text-xs font-bold py-1.5 rounded-lg transition-all min-h-[38px] flex items-center justify-center gap-1.5 tap-shrink",
                  mobilePane === 'chat' ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setMobilePane('chat')}
              >
                <Bot className="h-3.5 w-3.5 text-sky-400" />
                Chat Workspace
              </button>
              <button
                className={cn(
                  "flex-1 text-xs font-bold py-1.5 rounded-lg transition-all min-h-[38px] flex items-center justify-center gap-1.5 tap-shrink",
                  mobilePane === 'preview' ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setMobilePane('preview')}
              >
                <FileText className="h-3.5 w-3.5 text-emerald-400" />
                Specs Output ({allSpecs.length})
              </button>
            </div>
          </div>
        )}

        {/* Main Split Panel Content */}
        <div className="flex flex-1 overflow-hidden relative">

          {/* Left Panel: Chat Interface */}
          <div className={cn(
            "flex flex-col border-r border-border/40 bg-card/20 backdrop-blur-md relative",
            mobilePane === 'chat' || !hasSpecs ? "flex w-full lg:w-[35%] lg:min-w-[390px] lg:max-w-[480px]" : "hidden lg:flex lg:w-[35%] lg:min-w-[390px] lg:max-w-[480px]"
          )}>
            
            {/* Context Banners */}
            {isExistingApp && isEmpty && (
              <div className="mx-4 mt-4 px-3 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-amber-400 text-[10px] sm:text-xs font-medium flex items-center gap-2 shadow-inner">
                <Layers className="h-4 w-4 shrink-0 text-amber-400 animate-pulse" />
                <span className="truncate">Active Project Context: <strong className="text-foreground">{existingAppName}</strong></span>
              </div>
            )}

            {isEmpty && (
              <div className={cn(
                "mx-4 mt-3 px-3 py-2.5 rounded-xl border text-[10px] sm:text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors",
                scanning ? "border-sky-500/20 bg-sky-500/5 text-sky-400" :
                repoContext ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" :
                scanError ? "border-rose-500/20 bg-rose-500/5 text-rose-400" : ""
              )}>
                {scanning ? (
                  <><ScanSearch className="h-4 w-4 text-sky-400 animate-pulse shrink-0" /> <span>Analyzing codebase structure...</span></>
                ) : repoContext ? (
                  <><ScanSearch className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="truncate text-foreground/90 font-medium">
                      Codebase Base: {repoContext.stack?.framework || 'Next.js'} ({Object.keys(repoContext.dependencies || {}).length} packages detected)
                    </span>
                  </>
                ) : scanError ? (
                  <><ScanSearch className="h-4 w-4 text-rose-400 shrink-0" /> <span>Codebase lookup unavailable</span></>
                ) : null}
              </div>
            )}

            {/* Message Thread */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 sm:py-6 space-y-5 scrollbar-thin">
              {isEmpty ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-5 sm:gap-6 py-10 max-w-sm mx-auto">
                  <div className="relative">
                    <div className="absolute inset-0 bg-sky-500/20 blur-2xl rounded-full animate-pulse" />
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-500 text-white shadow-2xl transition-transform duration-300 hover:scale-105">
                      <Bot className="h-8 w-8" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm sm:text-base font-bold text-foreground">Describe your project goal</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {repoContext
                        ? "State the page, system, or features you\'d like to construct. The engine will decompose the requirement into a production-grade plan."
                        : "Describe the application idea and stack preferences. I'll translate it into modular, clean spec models."}
                    </p>
                  </div>

                  {/* Environment Details list */}
                  {repoContext && (
                    <div className="w-full pt-4 space-y-2">
                      {repoContext.agentInstructions && (
                        <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[11px] sm:text-xs border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-left">
                          <FileCode className="h-4 w-4 shrink-0" />
                          <span className="font-semibold truncate">Loaded agent rules context (AGENTS.md)</span>
                        </div>
                      )}
                      
                      <div className="grid grid-cols-2 gap-2 text-left text-[10px] sm:text-xs">
                        <div className="flex items-center gap-2 rounded-xl px-3 py-2 border border-border/30 bg-muted/20">
                          <Blocks className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                          <span className="text-muted-foreground truncate">{repoContext.stack?.framework || 'Next.js 15'}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-xl px-3 py-2 border border-border/30 bg-muted/20">
                          <FolderTree className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                          <span className="text-muted-foreground truncate">{repoContext.fileTree?.length || 0} files</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300",
                        msg.role === 'assistant' ? "flex-row" : "flex-row-reverse"
                      )}
                    >
                      <Avatar className={cn(
                        "h-7 w-7 shrink-0 mt-0.5 border",
                        msg.role === 'assistant' ? "border-sky-500/20 shadow-xs" : "border-border/60 shadow-xs"
                      )}>
                        <AvatarFallback
                          className={cn(
                            'text-[9px] font-bold',
                            msg.role === 'assistant'
                              ? 'bg-sky-500 text-white'
                              : 'bg-zinc-800 text-zinc-100'
                          )}
                        >
                          {msg.role === 'assistant' ? 'AI' : 'US'}
                        </AvatarFallback>
                      </Avatar>
                      <div className={cn(
                        "flex-1 flex flex-col min-w-0",
                        msg.role === 'user' ? "items-end text-right" : "items-start text-left"
                      )}>
                        <span className="text-[8px] sm:text-[9px] font-bold text-muted-foreground/60 mb-1 uppercase tracking-widest px-1">
                          {msg.role === 'assistant' ? 'Architect Engine' : 'Requestor'}
                        </span>
                        <div className={cn(
                          "max-w-[92%] text-xs sm:text-sm rounded-2xl p-3 sm:p-4 leading-relaxed",
                          msg.role === 'assistant'
                            ? "bg-card border border-border/40 text-foreground/90 shadow-sm glass-panel"
                            : "bg-sky-500 text-white shadow-md shadow-sky-500/10 font-medium"
                        )}>
                          {msg.role === 'assistant'
                            ? <div className="prose prose-sm dark:prose-invert max-w-none">{renderAssistantContent(msg.content)}</div>
                            : <p className="whitespace-pre-wrap">{msg.content}</p>
                          }
                          {streaming && i === messages.length - 1 && msg.role === 'assistant' && (
                            <div className="flex gap-1 mt-3 h-4 items-center">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-bounce delay-0" />
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-bounce delay-150" />
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-bounce delay-300" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="p-3 sm:p-4 shrink-0 bg-transparent border-t border-border/30 backdrop-blur-sm relative z-30">
              <div className="relative flex flex-col rounded-2xl bg-card border border-border/50 shadow-xl overflow-hidden focus-within:ring-2 focus-within:ring-sky-500/20 focus-within:border-sky-500/30 transition-all duration-200">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={isExistingApp ? "Tweak or define feature specs..." : "e.g., build a sleek feedback widget..."}
                  className="w-full border-0 p-3.5 pr-12 min-h-[50px] max-h-[140px] outline-none text-xs sm:text-sm leading-relaxed text-foreground resize-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
                  rows={1}
                  disabled={streaming}
                />
                <div className="flex items-center justify-between px-3.5 pb-2.5">
                  <div className="flex items-center gap-1 opacity-45 hover:opacity-100 transition-opacity">
                    <Terminal className="h-3 w-3 text-sky-400" />
                    <span className="text-[9px] font-semibold font-mono tracking-tight text-muted-foreground uppercase">v2.1 active</span>
                  </div>
                  <div className="absolute right-2.5 bottom-2.5">
                    <Button
                      size="icon"
                      className={cn(
                        'rounded-xl h-8 w-8 p-0 transition-all duration-200 tap-shrink',
                        input.trim()
                          ? 'bg-sky-500 hover:bg-sky-600 text-white hover:scale-105 active:scale-95 shadow-lg shadow-sky-500/10'
                          : 'bg-muted text-muted-foreground'
                      )}
                      disabled={!input.trim() || streaming}
                      onClick={() => handleSend()}
                    >
                      {streaming ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArrowUp className="h-3.5 w-3.5 text-white" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel: Spec Preview */}
          <div className={cn(
            "flex flex-1 flex-col bg-card text-foreground relative overflow-hidden",
            hasSpecs && mobilePane === 'preview' ? "flex w-full" : hasSpecs ? "hidden lg:flex lg:flex-1" : "hidden lg:flex lg:flex-1"
          )}>
            
            {/* Horizontal Swipeable Specs Tabs */}
            <div className="border-b border-border/40 bg-muted/20 shrink-0">
              <div className="flex items-center h-12 px-3 justify-between">
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 mr-4 pb-1.5 pt-1.5 select-none snap-x snap-mandatory">
                  {allSpecs.length > 0 ? (
                    allSpecs.map((spec, idx) => (
                      <button
                        key={spec.filename}
                        onClick={() => setActiveTab(idx)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] sm:text-[11px] font-bold whitespace-nowrap transition-all shrink-0 min-h-[34px] snap-center tap-shrink',
                          idx === activeTab
                            ? 'bg-card border border-border/50 text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground hover:bg-card/40'
                        )}
                      >
                        {spec.kind === 'app' ? (
                          <Package className="h-3 w-3 text-sky-400" />
                        ) : (
                          <Layers className="h-3 w-3 text-purple-400" />
                        )}
                        <span className="max-w-[90px] sm:max-w-[130px] truncate">{spec.name}</span>
                        {spec.phase && (
                          <span className={cn('text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded-full border font-bold', phaseColor(spec.phase))}>
                            P{spec.phase}
                          </span>
                        )}
                        {savedSpecs.has(spec.filename) && (
                          <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="flex items-center gap-1.5 text-muted-foreground/60">
                      <FileText className="h-3.5 w-3.5 text-sky-400/30" />
                      <span className="text-[10px] font-bold tracking-widest uppercase font-mono">
                        {streaming ? 'generating spec blueprints...' : 'awaiting spec instructions'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {allSpecs.length > 0 && (
                    <div className="hidden sm:flex items-center gap-1.5 text-[9px] font-semibold">
                      <span className="bg-sky-500/10 text-sky-400 px-2 py-0.5 rounded-full border border-sky-500/10">
                        {allSpecs.filter(s => s.kind === 'app').length} App
                      </span>
                      <span className="bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full border border-purple-500/10">
                        {allSpecs.filter(s => s.kind === 'feature').length} Features
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Spec YAML View */}
            <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.02),transparent)]">
              {activeSpec ? (
                <div className="p-4 sm:p-6 md:p-8 font-mono text-[10px] sm:text-xs md:text-sm leading-relaxed relative">
                  {/* Glow accent */}
                  <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-border/40 relative z-10">
                    <div className="flex items-center gap-2 min-w-0">
                      {activeSpec.kind === 'app' ? (
                        <div className="p-2 rounded-xl bg-sky-500/10 glow-blue shrink-0">
                          <Package className="h-4 w-4 text-sky-400" />
                        </div>
                      ) : (
                        <div className="p-2 rounded-xl bg-purple-500/10 glow-purple shrink-0">
                          <Layers className="h-4 w-4 text-purple-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-foreground text-xs sm:text-sm font-bold truncate">{activeSpec.name}</h3>
                        <p className="text-muted-foreground text-[8px] sm:text-[10px] font-semibold truncate mt-0.5">{activeSpec.filename}</p>
                      </div>
                      {activeSpec.phase && (
                        <span className={cn('text-[8px] sm:text-[9px] px-2 py-0.5 rounded-full border font-bold ml-2 shrink-0', phaseColor(activeSpec.phase))}>
                          Phase {activeSpec.phase}
                        </span>
                      )}
                    </div>
                    {!savedSpecs.has(activeSpec.filename) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 text-[10px] sm:text-xs font-bold gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50 rounded-full tap-shrink"
                        onClick={() => handleSaveSpec(activeSpec)}
                        disabled={saving || streaming}
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3.5 w-3.5 text-emerald-400" />}
                        <span>Save Spec</span>
                      </Button>
                    ) : (
                      <span className="text-emerald-400 text-[10px] sm:text-xs font-bold flex items-center gap-1 bg-emerald-500/5 px-2.5 py-1 rounded-full border border-emerald-500/20 shrink-0">
                        <Check className="h-3.5 w-3.5" /> Saved Blueprint
                      </span>
                    )}
                  </div>
                  
                  <div className="rounded-2xl border border-border/30 bg-card/65 glass-panel p-4 shadow-lg relative overflow-hidden">
                    <pre className="relative z-10 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                      <code className="text-emerald-400/90">{activeSpec.yaml}</code>
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 p-6">
                  <div className="relative">
                    <div className="absolute inset-0 bg-sky-500/10 blur-3xl rounded-full scale-150 animate-pulse" />
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-muted border border-border/30 shadow-inner">
                      <FileCode className="h-7 w-7 text-muted-foreground/35" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-foreground text-sm font-bold tracking-tight">Architect blueprint viewer</h4>
                    <p className="text-[10px] sm:text-xs text-muted-foreground max-w-xs leading-relaxed">
                      YAML spec documents will compile inside this preview panel in real-time as the Architect designs.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Bar info */}
            <div className="h-9 border-t border-border/40 bg-muted/30 shrink-0 px-4 flex items-center justify-between text-[9px] font-bold font-mono text-muted-foreground/60 uppercase tracking-wider">
               <div className="flex items-center gap-4">
                  <span>SPEC ENGINE MODE</span>
                  <span className="hidden sm:inline">{allSpecs.length > 0 ? `${allSpecs.length} specs compiled` : 'Standby'}</span>
               </div>
               <div className="flex items-center gap-4">
                  <span className="hidden sm:inline">Lines: {activeSpec?.yaml.split('\n').length || 0}</span>
                  <span>YAML 1.2</span>
               </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function renderAssistantContent(content: string) {
  const specBlockPattern = /=== (?:APP_SPEC|FEATURE_SPEC):\s*\S+\s*===[\s\S]*?=== END_SPEC ===/g;
  const yamlBlockPattern = /```yaml[\s\S]*?(?:```|$)/g;
  let cleaned = content.replace(specBlockPattern, '___SPEC_BLOCK___');
  cleaned = cleaned.replace(yamlBlockPattern, '___SPEC_BLOCK___');
  const parts = cleaned.split('___SPEC_BLOCK___');

  return parts.map((part, i) => {
    const elements: React.ReactNode[] = [];
    if (part.trim()) {
      elements.push(<p key={`text-${i}`} className="mb-3 last:mb-0 text-foreground/80">{part.trim()}</p>);
    }
    if (i < parts.length - 1) {
      elements.push(
        <div
          key={`spec-${i}`}
          className="my-3 px-3.5 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-[10px] sm:text-[11px] text-emerald-400 flex items-center gap-3 transition-all hover:bg-emerald-500/10 relative overflow-hidden glow-emerald shadow-xs"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 shrink-0">
             <FileText className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex flex-col text-left gap-0.5">
             <span className="font-extrabold uppercase tracking-widest text-[8px] sm:text-[9px] text-emerald-400/80">Spec Blueprint Compiled</span>
             <span className="font-semibold opacity-75 text-[9px] sm:text-[10px] text-muted-foreground">Select panel view to inspect YAML spec</span>
          </div>
          <div className="ml-auto bg-emerald-500/15 p-1 rounded-lg">
             <Check className="h-3.5 w-3.5 text-emerald-400" />
          </div>
        </div>
      );
    }
    return elements;
  });
}
