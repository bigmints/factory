'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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

  // Mobile: which pane to show
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
      case 1: return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 2: return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 3: return 'bg-violet-500/10 text-violet-500 border-violet-500/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-0 z-50 flex flex-col w-screen h-screen max-w-none m-0 rounded-none border-0 p-0 gap-0 overflow-hidden outline-none bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 translate-x-0 translate-y-0 sm:max-w-none top-0 left-0 [&>button]:hidden">
        {/* Top Header */}
        <DialogHeader className="border-b px-3 sm:px-4 md:px-6 py-3 sm:py-4 mb-0 flex-row items-center justify-between space-y-0 h-12 sm:h-14 md:h-16 shrink-0 bg-card/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="inline-flex shrink-0 items-center justify-center rounded-lg sm:rounded-xl bg-primary/10 p-2 sm:p-2.5">
              <Zap className="size-4 sm:size-5 text-primary" aria-hidden={true} />
            </div>
            <div className="space-y-0.5 min-w-0">
              <DialogTitle className="text-sm sm:text-base font-semibold tracking-tight truncate">
                Spec Generator
              </DialogTitle>
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">
                {isExistingApp
                  ? `Adding features to ${existingAppName}`
                  : 'AI-powered spec decomposition'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {hasSpecs && !streaming && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 sm:h-8 px-2 sm:px-4 text-[10px] sm:text-xs font-semibold gap-1 border-primary/20 hover:bg-primary/5 hover:border-primary/40 transition-all"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy YAML'}</span>
                </Button>
                {!allSaved && (
                  <Button
                    size="sm"
                    className="h-7 sm:h-8 px-2 sm:px-4 text-[10px] sm:text-xs font-semibold gap-1 shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    onClick={handleSaveAll}
                    disabled={savingAll}
                  >
                    {savingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <SaveAll className="h-3 w-3" />}
                    <span className="hidden sm:inline">Save All ({allSpecs.length - savedSpecs.size})</span>
                    <span className="sm:hidden">Save</span>
                  </Button>
                )}
                {allSaved && (
                  <Badge variant="outline" className="h-7 sm:h-8 px-2 sm:px-4 text-[10px] sm:text-xs font-semibold gap-1 border-emerald-500/30 text-emerald-500">
                    <Check className="h-3 w-3" />
                    <span className="hidden sm:inline">All Saved</span>
                  </Badge>
                )}
              </>
            )}
            <Separator orientation="vertical" className="h-5 sm:h-6 mx-1 sm:mx-2" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 sm:h-8 sm:w-8 rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
          </div>
        </DialogHeader>

        {/* Mobile pane switcher */}
        {hasSpecs && (
          <div className="lg:hidden flex border-b bg-muted/30 px-2 sm:px-3 py-1.5 shrink-0">
            <button
              className={cn(
                "flex-1 text-xs font-medium py-2 rounded-lg transition-colors min-h-[44px] flex items-center justify-center gap-1.5",
                mobilePane === 'chat' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setMobilePane('chat')}
            >
              <Bot className="h-3.5 w-3.5" />
              Chat
            </button>
            <button
              className={cn(
                "flex-1 text-xs font-medium py-2 rounded-lg transition-colors min-h-[44px] flex items-center justify-center gap-1.5",
                mobilePane === 'preview' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setMobilePane('preview')}
            >
              <FileText className="h-3.5 w-3.5" />
              Specs ({allSpecs.length})
            </button>
          </div>
        )}

        {/* Main Split Content */}
        <div className="flex flex-1 overflow-hidden relative">

          {/* Left Pane: Chat Interface */}
          <div className={cn(
            "flex flex-col border-r bg-card/30 backdrop-blur-sm",
            // Mobile: show/hide based on pane
            mobilePane === 'chat' || !hasSpecs ? "flex w-full lg:w-[35%] lg:min-w-[380px] lg:max-w-[500px]" : "hidden lg:flex",
            // Desktop: always show with fixed width
            "lg:w-[35%] lg:min-w-[380px] lg:max-w-[500px]"
          )}>
            {/* Existing app badge */}
            {isExistingApp && isEmpty && (
              <div className="mx-3 sm:mx-4 md:mx-6 mt-3 sm:mt-4 px-3 py-2 rounded-xl bg-amber-500/5 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] sm:text-xs font-medium flex items-center gap-2">
                <Layers className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                <span className="truncate">Existing app: <strong>{existingAppName}</strong> — feature specs only</span>
              </div>
            )}

            {/* Repo scan status */}
            {isEmpty && (
              <div className={cn(
    "mx-3 sm:mx-4 md:mx-6 mt-2 sm:mt-3 px-3 py-2 rounded-xl border text-[10px] sm:text-xs font-medium flex items-center gap-2",
    scanning && "border-blue-500/20 bg-blue-500/5",
    repoContext && !scanning && "border-emerald-500/20 bg-emerald-500/5",
    scanError && !repoContext && !scanning && "border-red-500/20 bg-red-500/5",
)} >
                {scanning ? (
                  <><ScanSearch className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-blue-500 animate-pulse shrink-0" /> <span className="text-blue-600 dark:text-blue-400">Scanning...</span></>
                ) : repoContext ? (
                  <><ScanSearch className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-emerald-500 shrink-0" />
                    <span className="text-emerald-600 dark:text-emerald-400 truncate">
                      {repoContext.stack?.framework} · {Object.keys(repoContext.dependencies || {}).length} deps
                    </span>
                  </>
                ) : scanError ? (
                  <><ScanSearch className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-red-500 shrink-0" /> <span className="text-red-600 dark:text-red-400 truncate">Scan failed</span></>
                ) : null}
              </div>
            )}

            {/* Messages Scroll Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8 space-y-4 sm:space-y-6 md:space-y-8 scrollbar-thin">
              {isEmpty ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 sm:gap-6 py-6 sm:py-10">
                  <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl sm:rounded-3xl bg-primary shadow-2xl shadow-primary/20 ring-4 ring-primary/5 transition-transform hover:scale-110">
                    <Bot className="h-8 w-8 sm:h-10 sm:w-10 text-primary-foreground" />
                  </div>
                  <div className="space-y-1.5 sm:space-y-2">
                    <h3 className="text-base sm:text-lg font-bold tracking-tight">
                      {repoContext ? 'Project Context Loaded' : scanning ? 'Scanning...' : 'What shall we build?'}
                    </h3>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-[240px] sm:max-w-[280px]">
                      {repoContext
                        ? 'Describe the feature or app you want and I\'ll generate specs aligned with your codebase.'
                        : 'Describe your app and I\'ll break it down into modular, buildable specs.'}
                    </p>
                  </div>

                  {/* Scan Summary */}
                  {repoContext && (
                    <div className="w-full pt-3 sm:pt-4 space-y-1.5 sm:space-y-2 max-w-sm">
                      <div className={cn(
                        "flex items-center gap-2 sm:gap-3 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 text-[10px] sm:text-sm border",
                        repoContext.agentInstructions
                          ? "border-emerald-500/20 bg-emerald-500/5"
                          : "border-amber-500/20 bg-amber-500/5"
                      )}>
                        <FileCode className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0", repoContext.agentInstructions ? "text-emerald-500" : "text-amber-500")} />
                        <span className="font-medium truncate">
                          {repoContext.agentInstructions
                            ? '✓ agents.md loaded'
                            : '⚠️ No agents.md'}
                        </span>
                      </div>

                      {repoContext.stack && (
                        <div className="flex items-center gap-2 sm:gap-3 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 text-[10px] sm:text-sm border border-border/50 bg-muted/30">
                          <Blocks className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-blue-500" />
                          <span className="text-muted-foreground truncate">
                            <strong className="text-foreground">{repoContext.stack.framework}</strong>
                            {repoContext.stack.language && ` · ${repoContext.stack.language}`}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-2 sm:gap-3 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 text-[10px] sm:text-sm border border-border/50 bg-muted/30">
                        <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-purple-500" />
                        <span className="text-muted-foreground">
                          <strong className="text-foreground">{Object.keys(repoContext.dependencies || {}).length}</strong> deps
                        </span>
                      </div>

                      <div className="flex items-center gap-2 sm:gap-3 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-3 text-[10px] sm:text-sm border border-border/50 bg-muted/30">
                        <FolderTree className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-cyan-500" />
                        <span className="text-muted-foreground">
                          <strong className="text-foreground">{repoContext.fileTree?.length || 0}</strong> files scanned
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 sm:space-y-6 md:space-y-8">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex gap-2 sm:gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
                        msg.role === 'assistant' ? "flex-row" : "flex-row-reverse"
                      )}
                    >
                      <Avatar className={cn(
                        "h-6 w-6 sm:h-8 sm:w-8 shrink-0 mt-0.5 border ring-2 ring-offset-2 ring-transparent",
                        msg.role === 'assistant' ? "ring-primary/10" : "ring-muted"
                      )}>
                        <AvatarFallback
                          className={cn(
                            'text-[8px] sm:text-[10px] font-bold',
                            msg.role === 'assistant'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {msg.role === 'assistant' ? 'AI' : 'YOU'}
                        </AvatarFallback>
                      </Avatar>
                      <div className={cn(
                        "flex-1 flex flex-col min-w-0 group",
                        msg.role === 'user' ? "items-end text-right" : "items-start text-left"
                      )}>
                        <span className="text-[8px] sm:text-[10px] font-bold text-muted-foreground/60 mb-1 sm:mb-2 uppercase tracking-widest px-1">
                          {msg.role === 'assistant' ? 'Architect Engine' : 'You'}
                        </span>
                        <div className={cn(
                          "max-w-[90%] sm:max-w-[95%] text-[11px] sm:text-xs md:text-sm rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 leading-relaxed",
                          msg.role === 'assistant'
                            ? "bg-card border border-border/50 text-foreground shadow-sm"
                            : "bg-primary text-primary-foreground shadow-md shadow-primary/10"
                        )}>
                          {msg.role === 'assistant'
                            ? <div className="prose prose-sm dark:prose-invert max-w-none">{renderAssistantContent(msg.content, allSpecs.length)}</div>
                            : <p className="whitespace-pre-wrap">{msg.content}</p>
                          }
                          {streaming && i === messages.length - 1 && msg.role === 'assistant' && (
                            <div className="flex gap-1 mt-2 sm:mt-3 h-3 sm:h-4 items-center">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce delay-0" />
                              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce delay-150" />
                              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce delay-300" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-3 sm:p-4 md:p-6 shrink-0 bg-transparent relative z-30">
              <div className="relative flex flex-col rounded-2xl sm:rounded-3xl bg-card/80 backdrop-blur-xl border border-border/50 shadow-2xl ring-4 ring-primary/5 overflow-hidden transition-all focus-within:ring-primary/10 focus-within:border-primary/30">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={isExistingApp ? "Describe features to add..." : "Describe the app to build..."}
                  className="w-full border-0 p-3 sm:p-4 min-h-[50px] sm:min-h-[60px] max-h-[120px] sm:max-h-[160px] outline-none text-[11px] sm:text-sm leading-relaxed text-foreground resize-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent pr-10 sm:pr-14"
                  rows={1}
                  disabled={streaming}
                />
                <div className="flex items-center justify-between p-2 sm:p-3 pt-0">
                  <div className="flex items-center gap-1 opacity-40 hover:opacity-100 transition-opacity">
                    <Terminal className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    <span className="text-[8px] sm:text-[10px] font-medium tracking-tight">DECOMPOSITION ENGINE v2.0</span>
                  </div>
                  <div className="absolute right-2 sm:right-3 bottom-2 sm:bottom-3">
                    <Button
                      size="icon"
                      className={cn(
                        'rounded-xl sm:rounded-2xl h-7 w-7 sm:h-9 sm:w-9 p-0 shadow-lg transition-all',
                        input.trim()
                          ? 'bg-primary text-primary-foreground hover:scale-105 active:scale-95'
                          : 'bg-muted text-muted-foreground'
                      )}
                      disabled={!input.trim() || streaming}
                      onClick={() => handleSend()}
                    >
                      {streaming ? (
                        <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                      ) : (
                        <ArrowUp className="h-3 w-3 sm:h-4 sm:w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Pane: Spec Preview */}
          <div className={cn(
            "flex flex-1 flex-col bg-card text-foreground relative overflow-hidden group/preview",
            // Mobile: show/hide based on pane
            hasSpecs && mobilePane === 'preview' ? "flex w-full" : hasSpecs ? "hidden lg:flex" : "hidden lg:flex",
            // When no specs, hide on mobile but show on desktop
            !hasSpecs && "hidden lg:flex"
          )}>
            {/* Tab Bar */}
            <div className="border-b border-border bg-muted/50 shrink-0">
              <div className="flex items-center h-10 sm:h-12 px-2 sm:px-4 justify-between">
                <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 mr-2 sm:mr-4">
                  {allSpecs.length > 0 ? (
                    allSpecs.map((spec, idx) => (
                      <button
                        key={spec.filename}
                        onClick={() => setActiveTab(idx)}
                        className={cn(
                          'flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 rounded-lg text-[10px] sm:text-[11px] font-semibold whitespace-nowrap transition-all shrink-0 min-h-[33px]',
                          idx === activeTab
                            ? 'bg-muted/50 text-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        )}
                      >
                        {spec.kind === 'app' ? (
                          <Package className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-blue-400" />
                        ) : (
                          <Layers className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-emerald-400" />
                        )}
                        <span className="max-w-[80px] sm:max-w-[120px] truncate">{spec.name}</span>
                        {spec.phase && (
                          <span className={cn('text-[8px] sm:text-[9px] px-1 py-0.5 rounded-full border font-bold', phaseColor(spec.phase))}>
                            P{spec.phase}
                          </span>
                        )}
                        {savedSpecs.has(spec.filename) && (
                          <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-emerald-400" />
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="flex items-center gap-1.5 sm:gap-2 text-muted-foreground">
                      <FileText className="h-3 w-3 sm:h-4 sm:w-4 text-emerald-400/30" />
                      <span className="text-[10px] sm:text-[11px] font-bold tracking-widest uppercase">
                        {streaming ? 'generating...' : 'awaiting specs'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  {allSpecs.length > 0 && (
                    <div className="hidden sm:flex items-center gap-2 text-[9px] sm:text-[10px] text-muted-foreground">
                      <span className="bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded font-bold">
                        {allSpecs.filter(s => s.kind === 'app').length} app
                      </span>
                      <span className="bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-bold">
                        {allSpecs.filter(s => s.kind === 'feature').length} features
                      </span>
                    </div>
                  )}
                  {streaming && (
                    <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] sm:text-[9px] font-bold tracking-tighter animate-pulse">
                      LIVE
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Preview Content */}
            <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.03),transparent)]">
              {activeSpec ? (
                <div className="p-4 sm:p-6 md:p-10 font-mono text-[10px] sm:text-xs md:text-sm leading-relaxed selection:bg-emerald-500/30">
                  <div className="flex items-center justify-between mb-3 sm:mb-6 pb-2 sm:pb-4 border-b border-border">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      {activeSpec.kind === 'app' ? (
                        <div className="p-1.5 sm:p-2 rounded-lg bg-blue-500/10 shrink-0">
                          <Package className="h-3 w-3 sm:h-4 sm:w-4 text-blue-400" />
                        </div>
                      ) : (
                        <div className="p-1.5 sm:p-2 rounded-lg bg-emerald-500/10 shrink-0">
                          <Layers className="h-3 w-3 sm:h-4 sm:w-4 text-emerald-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-foreground text-xs sm:text-sm font-bold truncate">{activeSpec.name}</h3>
                        <p className="text-muted-foreground text-[8px] sm:text-[10px] font-mono truncate">{activeSpec.filename}</p>
                      </div>
                      {activeSpec.phase && (
                        <span className={cn('text-[8px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full border font-bold ml-1 sm:ml-2 shrink-0', phaseColor(activeSpec.phase))}>
                          P{activeSpec.phase}
                        </span>
                      )}
                    </div>
                    {!savedSpecs.has(activeSpec.filename) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 sm:h-7 md:h-8 px-2 sm:px-3 text-[9px] sm:text-[10px] font-bold gap-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50"
                        onClick={() => handleSaveSpec(activeSpec)}
                        disabled={saving || streaming}
                      >
                        {saving ? <Loader2 className="h-2.5 w-2.5 sm:h-3 sm:w-3 animate-spin" /> : <Save className="h-2.5 w-2.5 sm:h-3 sm:w-3" />}
                        <span className="hidden sm:inline">Save</span>
                      </Button>
                    ) : (
                      <span className="text-emerald-400 text-[9px] sm:text-[10px] font-bold flex items-center gap-1 shrink-0">
                        <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3" /> Saved
                      </span>
                    )}
                  </div>
                  <pre className="relative z-10 whitespace-pre-wrap">
                    <code className="text-emerald-300/90">{activeSpec.yaml}</code>
                  </pre>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 sm:gap-6 p-4 sm:p-6 md:p-10">
                  <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-150 animate-pulse" />
                    <div className="relative flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-2xl sm:rounded-[2.5rem] bg-muted border border-border shadow-2xl">
                      <Terminal className="h-8 w-8 sm:h-10 sm:w-10 text-emerald-400/20" />
                    </div>
                  </div>
                  <div className="space-y-1.5 sm:space-y-2 relative">
                    <h4 className="text-foreground text-sm sm:text-base font-bold tracking-tight">Awaiting Architecture</h4>
                    <p className="text-[10px] sm:text-xs text-muted-foreground leading-relaxed max-w-[280px] sm:max-w-[320px]">
                      Your specs will appear here as tabs — one app spec and multiple feature specs, organized by phase.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Bar */}
            <div className="h-8 sm:h-10 border-t border-border bg-muted/80 shrink-0 px-3 sm:px-4 md:px-6 flex items-center justify-between text-[8px] sm:text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
               <div className="flex items-center gap-2 sm:gap-4">
                  <span>UTF-8</span>
                  <span className="hidden sm:inline">{allSpecs.length > 0 ? `${allSpecs.length} specs` : 'YAML Validated'}</span>
               </div>
               <div className="flex items-center gap-2 sm:gap-4">
                  <span className="hidden sm:inline">Lines: {activeSpec?.yaml.split('\n').length || 0}</span>
                  <span>LF</span>
               </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function renderAssistantContent(content: string, specCount: number) {
  const specBlockPattern = /=== (?:APP_SPEC|FEATURE_SPEC):\s*\S+\s*===[\s\S]*?=== END_SPEC ===/g;
  const yamlBlockPattern = /```yaml[\s\S]*?(?:```|$)/g;
  let cleaned = content.replace(specBlockPattern, '___SPEC_BLOCK___');
  cleaned = cleaned.replace(yamlBlockPattern, '___SPEC_BLOCK___');
  const parts = cleaned.split('___SPEC_BLOCK___');

  return parts.map((part, i) => {
    const elements: React.ReactNode[] = [];
    if (part.trim()) {
      elements.push(<p key={`text-${i}`} className="mb-2 sm:mb-4 last:mb-0">{part.trim()}</p>);
    }
    if (i < parts.length - 1) {
      elements.push(
        <div
          key={`spec-${i}`}
          className="my-2 sm:my-4 px-3 sm:px-4 py-2 sm:py-3 rounded-xl sm:rounded-2xl bg-emerald-500/5 border border-emerald-500/10 text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-2 sm:gap-3 group transition-all hover:bg-emerald-500/10"
        >
          <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg sm:rounded-xl bg-emerald-500/10 shrink-0">
             <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
          </div>
          <div className="flex flex-col gap-0.5">
             <span className="font-bold tracking-tight uppercase tracking-widest text-[8px] sm:text-[9px]">Spec Generated</span>
             <span className="font-medium opacity-80 text-[9px] sm:text-[10px]">View in preview →</span>
          </div>
          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
             <Check className="h-3 w-3 sm:h-4 sm:w-4" />
          </div>
        </div>
      );
    }
    return elements;
  });
}
