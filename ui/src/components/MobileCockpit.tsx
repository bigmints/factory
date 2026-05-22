'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Play,
  Square,
  Trash2,
  RotateCcw,
  Activity,
  Terminal,
  Sparkles,
  Clock,
  Loader2,
  Send,
  Smartphone,
  Layers,
  Check,
  Cpu,
  CornerDownLeft,
} from 'lucide-react';

interface Heartbeat {
  project: string;
  last_seen: string;
  task: string;
  status: string;
}

interface QueueItem {
  id: string;
  story_file: string;
  spec_file: string;
  kind: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'needs-attention';
  priority: number;
  phase: number;
  depends_on?: string;
  target_app?: string;
  engine: string;
  added_at: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  error?: string;
}

interface ParsedStory {
  kind: 'app' | 'feature';
  filename: string;
  yaml: string;
  name: string;
  phase?: number;
  dependsOn?: string[];
}

function extractNameFromYaml(yaml: string): string {
  const appNameMatch = yaml.match(/^appName:\s*["']([^"']+)["']/m);
  if (appNameMatch) return appNameMatch[1];
  const featNameMatch = yaml.match(/^\s*name:\s*["']([^"']+)["']/m);
  if (featNameMatch) return featNameMatch[1];
  return '';
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

  if (stories.length === 0) {
    const appPatternOld = /=== APP_SPEC:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_SPEC ===/g;
    while ((match = appPatternOld.exec(content)) !== null) {
      const yaml = match[2].trim();
      const name = extractNameFromYaml(yaml) || match[1].replace('.yaml', '');
      stories.push({ kind: 'app', filename: match[1], yaml, name });
    }
    const featurePatternOld = /=== FEATURE_SPEC:\s*(\S+)\s*===\s*```yaml\n([\s\S]*?)```\s*=== END_SPEC ===/g;
    while ((match = featurePatternOld.exec(content)) !== null) {
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
  }

  return stories;
}

export function MobileCockpit() {
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [buildOutput, setBuildOutput] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestionStep, setIngestionStep] = useState<string>('');
  const [prompt, setPrompt] = useState('');

  // Log Sheet State
  const [logsOpen, setLogsOpen] = useState(false);
  
  // App context details loaded from scans
  const [isExistingApp, setIsExistingApp] = useState(false);
  const [existingAppName, setExistingAppName] = useState('');
  const [repoBlueprint, setRepoBlueprint] = useState<any>(null);

  const logOffsetRef = useRef(0);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Poll Heartbeat & Queue status
  const fetchData = useCallback(async () => {
    try {
      // Fetch heartbeat
      const hbRes = await fetch('/api/heartbeat');
      if (hbRes.ok) {
        const hbData = await hbRes.json();
        if (hbData && hbData.length > 0) {
          setHeartbeat(hbData[0]);
        }
      }

      // Fetch queue
      const qRes = await fetch('/api/queue');
      if (qRes.ok) {
        const qData = await qRes.json();
        setQueueItems(qData.items || []);
        const running = (qData.items || []).some((i: any) => i.status === 'running');
        setIsRunning(running || qData.isRunning || false);
      }
    } catch (e) {
      console.error('Error fetching cockpit data:', e);
    }
  }, []);

  // Fetch codebase context initially
  useEffect(() => {
    fetch('/api/stories')
      .then((r) => r.json())
      .then((data) => {
        const loadedStories = data.stories || data.specs || [];
        if (loadedStories.length > 0) {
          setIsExistingApp(true);
          const firstApp = loadedStories[0];
          const name = firstApp.metadata?.name || firstApp.metadata?.slug || firstApp.file?.replace('.yaml', '') || 'app';
          setExistingAppName(name);
        }
      })
      .catch(() => {});

    fetch('/api/repo-scan')
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setRepoBlueprint(data);
      })
      .catch(() => {});

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Handle terminal scrolling
  useEffect(() => {
    if (logsOpen && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildOutput, logsOpen]);

  // Log Polling during running build
  useEffect(() => {
    if (!isRunning) {
      logOffsetRef.current = 0;
      return;
    }

    setBuildOutput('Waiting for log feedback...\n');
    logOffsetRef.current = 0;
    
    // Automatically open sheet console when build starts
    setLogsOpen(true);

    const pollLog = async () => {
      try {
        const res = await fetch(`/api/queue/log?offset=${logOffsetRef.current}`);
        const data = await res.json();
        if (data.log) {
          // unescape quotes, double backslashes and literal newline markers in raw output
          const cleanedLog = data.log
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .replace(/\\t/g, '\t');
          
          setBuildOutput((prev) => prev + cleanedLog);
          logOffsetRef.current = data.offset;
        }
      } catch { /* ignore */ }
    };

    pollLog();
    const interval = setInterval(pollLog, 1500);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Quick Ingestion Pipeline
  const handleQuickIngestion = async () => {
    if (!prompt.trim() || ingesting) return;
    setIngesting(true);
    setPrompt('');
    
    try {
      setIngestionStep('Decomposing instructions into stories...');
      toast.info('Decomposing instructions with AI...', { duration: 3000 });

      // Call streaming chat with current prompt
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt.trim() }],
          isExistingApp,
          existingAppName,
          repoBlueprint,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to connect to agent');
      }
      if (!res.body) throw new Error('Empty response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataVal = trimmed.slice(6);
          if (dataVal === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataVal);
            if (parsed.content) {
              accumulatedContent += parsed.content;
            }
          } catch {}
        }
      }

      setIngestionStep('Parsing specifications...');
      const stories = extractAllStories(accumulatedContent);

      if (stories.length === 0) {
        throw new Error('AI did not produce valid story specifications. Try refining your request.');
      }

      // Sort app story first, then features
      const sortedStories = [...stories].sort((a, b) => {
        if (a.kind === 'app') return -1;
        if (b.kind === 'app') return 1;
        return (a.phase ?? 0) - (b.phase ?? 0);
      });

      setIngestionStep(`Saving ${sortedStories.length} spec files...`);
      let successCount = 0;

      for (const story of sortedStories) {
        const saveRes = await fetch('/api/stories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: story.name,
            content: story.yaml,
            kind: story.kind,
          }),
        });

        const saveData = await saveRes.json();
        if (!saveRes.ok) {
          throw new Error(`Failed to save story "${story.name}": ${saveData.error}`);
        }

        setIngestionStep(`Enqueuing story: ${story.name}...`);
        
        // Enqueue item
        const qRes = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyFile: story.kind === 'feature' ? `features/${saveData.file}` : saveData.file,
            kind: story.kind === 'feature' ? 'FeatureStory' : 'AppStory',
            phase: story.phase ?? 0,
            dependsOn: story.dependsOn ?? [],
          }),
        });

        if (!qRes.ok) {
          const qData = await qRes.json();
          // Skip 409 conflict, that means it's already queued
          if (qRes.status !== 409) {
            throw new Error(`Failed to enqueue "${story.name}": ${qData.error}`);
          }
        }
        successCount++;
      }

      setIngestionStep('Initializing autonomous daemon execution...');
      
      // Trigger execution start
      const startRes = await fetch('/api/queue/start', { method: 'POST' });
      const startData = await startRes.json();

      if (!startRes.ok && startRes.status !== 409) {
        throw new Error(`Queue execution failed to start: ${startData.error}`);
      }

      toast.success(`Success! Saved & Enqueued ${successCount} specifications.`, {
        description: 'Autonomous development loop started.',
      });
      
      // Auto-open terminal console sheet
      setLogsOpen(true);

    } catch (e: any) {
      toast.error('Quick Ingestion Failed', { description: e.message });
    } finally {
      setIngesting(false);
      setIngestionStep('');
      fetchData();
    }
  };

  // Queue Mutators
  const handleStartQueue = async () => {
    try {
      const res = await fetch('/api/queue/start', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success('Queue started successfully', { description: data.message });
      } else {
        toast.error('Start failed', { description: data.error });
      }
      fetchData();
    } catch {
      toast.error('Start request failed');
    }
  };

  const handleStopQueue = async () => {
    try {
      const res = await fetch('/api/queue/stop', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.warning('Queue halted and running builds killed', { description: data.message });
      } else {
        toast.error('Stop failed', { description: data.error });
      }
      fetchData();
    } catch {
      toast.error('Stop request failed');
    }
  };

  const handleClearQueue = async () => {
    try {
      const res = await fetch('/api/queue/clear', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success('SQLite build history and queue cleared', { description: data.message });
      } else {
        toast.error('Clear failed', { description: data.error });
      }
      fetchData();
    } catch {
      toast.error('Clear request failed');
    }
  };

  const handleRetryItem = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry' }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Retrying spec: ${name}`);
        // Trigger queue start again in case it is idle
        fetch('/api/queue/start', { method: 'POST' }).catch(() => {});
      } else {
        toast.error('Retry failed', { description: data.error });
      }
      fetchData();
    } catch {
      toast.error('Retry request failed');
    }
  };

  const handleRemoveItem = async (id: string, name: string) => {
    try {
      const res = await fetch('/api/queue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Removed spec: ${name}`);
      } else {
        toast.error('Remove failed', { description: data.error });
      }
      fetchData();
    } catch {
      toast.error('Remove request failed');
    }
  };

  // Helper formatting values
  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'completed':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'failed':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'blocked':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      default:
        return 'bg-muted text-muted-foreground border-border/50';
    }
  };

  const getCleanStoryName = (path: string) => {
    return path.split('/').pop()?.replace('.yaml', '') || path;
  };

  // Live log compiler phase updates
  const getTimelineChecks = () => {
    const checks = [
      { id: 'gather', name: 'Gather Application Context', done: false, active: false },
      { id: 'plan', name: 'Plan & Design Solution', done: false, active: false },
      { id: 'write', name: 'Generate & Compile Modules', done: false, active: false },
      { id: 'lint', name: 'Lint & Format Verification', done: false, active: false },
      { id: 'typecheck', name: 'Type Checking (tsc)', done: false, active: false },
      { id: 'test', name: 'Automated Test Validation', done: false, active: false },
      { id: 'smoke', name: 'Runtime Smoke Test Gating', done: false, active: false },
      { id: 'commit', name: 'Version Control Commit', done: false, active: false },
    ];

    if (!buildOutput) return checks;

    // Check progress keywords in unescaped log stream
    const lowerOutput = buildOutput.toLowerCase();
    
    if (lowerOutput.includes('context gather') || lowerOutput.includes('appintegrationcontext') || lowerOutput.includes('gather')) {
      checks[0].active = true;
    }
    if (lowerOutput.includes('plan') || lowerOutput.includes('architect') || lowerOutput.includes('writing plan')) {
      checks[0].done = true;
      checks[1].active = true;
    }
    if (lowerOutput.includes('build') || lowerOutput.includes('writing file') || lowerOutput.includes('generated') || lowerOutput.includes('write_file')) {
      checks[0].done = true;
      checks[1].done = true;
      checks[2].active = true;
    }
    if (lowerOutput.includes('lint') || lowerOutput.includes('eslint') || lowerOutput.includes('biome') || lowerOutput.includes('formatting')) {
      checks[0].done = true;
      checks[1].done = true;
      checks[2].done = true;
      checks[3].active = true;
    }
    if (lowerOutput.includes('tsc') || lowerOutput.includes('type check') || lowerOutput.includes('typescript')) {
      checks[0].done = true;
      checks[1].done = true;
      checks[2].done = true;
      checks[3].done = true;
      checks[4].active = true;
    }
    if (lowerOutput.includes('test') || lowerOutput.includes('vitest') || lowerOutput.includes('jest') || lowerOutput.includes('runner')) {
      checks[0].done = true;
      checks[1].done = true;
      checks[2].done = true;
      checks[3].done = true;
      checks[4].done = true;
      checks[5].active = true;
    }
    if (lowerOutput.includes('smoke') || lowerOutput.includes('dev server') || lowerOutput.includes('http 200')) {
      checks[0].done = true;
      checks[1].done = true;
      checks[2].done = true;
      checks[3].done = true;
      checks[4].done = true;
      checks[5].done = true;
      checks[6].active = true;
    }
    if (lowerOutput.includes('commit') || lowerOutput.includes('git') || lowerOutput.includes('pushing') || lowerOutput.includes('pushed')) {
      checks[0].done = true;
      checks[1].done = true;
      checks[2].done = true;
      checks[3].done = true;
      checks[4].done = true;
      checks[5].done = true;
      checks[6].done = true;
      checks[7].active = true;
    }

    // Set trailing items as done if we're finished successfully
    const activeItem = queueItems.find(i => i.status === 'running');
    if (!activeItem && queueItems.some(i => i.status === 'completed' && Date.now() - new Date(i.completed_at || '').getTime() < 10000)) {
      checks.forEach(c => c.done = true);
    }

    return checks;
  };

  const timelineChecks = getTimelineChecks();

  return (
    <div className="flex flex-col min-h-screen pb-20 w-full space-y-4 md:space-y-6">
      
      {/* 1. CONNECTIVITY HEADER */}
      <Card className="overflow-hidden transition-all duration-300 relative">
        <div className="absolute top-0 right-0 h-40 w-40 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 text-primary animate-pulse shadow-inner">
              <Smartphone className="h-6 w-6" />
              <div className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 border-2 border-background">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm tracking-tight text-foreground truncate">
                  {heartbeat?.project || existingAppName || 'Remote Factory Daemon'}
                </span>
                <Badge variant="outline" className="px-2 py-0.5 text-[9px] uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                  Online
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {heartbeat?.task ? `Active: ${heartbeat.task}` : isRunning ? 'Executing daemon build task...' : 'Daemon standing by - waiting for specs'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto border-t sm:border-t-0 pt-3 sm:pt-0 w-full sm:w-auto">
            <Badge variant="outline" className="px-2.5 py-1 text-[10px] bg-muted/50 border-border text-muted-foreground flex items-center gap-1.5">
              <Cpu className="h-3 w-3 text-primary animate-spin" style={{ animationDuration: '4s' }} />
              Driver: {heartbeat?.status === 'idle' ? 'idle' : 'worker'}
            </Badge>
            {heartbeat?.last_seen && (
              <span className="text-[10px] text-muted-foreground/60 ml-auto sm:ml-0">
                Seen: {new Date(heartbeat.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 2. INSTANT INGESTION DECK */}
      <Card className="overflow-hidden transition-all duration-300 relative">
        <CardHeader className="p-4 sm:p-5 pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary animate-bounce" />
            Quick Spec Ingestion
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Type specs to plan, auto-enqueue, and start compilation instantly in one action.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 pt-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="e.g. Add an elegant contact form page with email linter validation..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleQuickIngestion()}
                disabled={ingesting}
                className="bg-muted border-border text-xs h-10 pr-9 focus:ring-1 focus:ring-primary focus-visible:ring-0"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center text-muted-foreground/40 font-mono text-[9px] pointer-events-none select-none">
                <CornerDownLeft className="h-3.5 w-3.5" />
              </div>
            </div>
            <Button
              onClick={handleQuickIngestion}
              disabled={!prompt.trim() || ingesting}
              className="h-10 px-4 bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 text-xs select-none shadow-sm transition-transform active:scale-95"
            >
              {ingesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </div>

          {ingesting && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/10 rounded-lg text-[10px] sm:text-xs text-primary/80 animate-pulse">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="font-semibold">{ingestionStep}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. QUEUE STACK & AUTONOMOUS CONTROLS */}
      <Card className="overflow-hidden transition-all duration-300">
        <CardHeader className="p-4 sm:p-5 pb-3 flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Orchestrator Stack
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Manage the active queue of agent compilation workflows.
            </CardDescription>
          </div>

          {/* Core autonomous triggers */}
          <div className="flex items-center gap-1">
            {!isRunning ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartQueue}
                disabled={queueItems.length === 0}
                className="h-8 px-2.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20 hover:border-emerald-500/30 text-xs font-semibold"
              >
                <Play className="h-3.5 w-3.5 fill-emerald-400 mr-1" />
                Start
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopQueue}
                className="h-8 px-2.5 bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20 hover:border-destructive/30 text-xs font-semibold"
              >
                <Square className="h-3.5 w-3.5 fill-destructive mr-1 animate-pulse" />
                Halt
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearQueue}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Clear all"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 pt-0">
          <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
            {queueItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 border border-dashed border-border/50 rounded-xl bg-muted/10 text-center">
                <Layers className="h-7 w-7 text-muted-foreground/30 mb-2" />
                <p className="text-xs font-semibold text-muted-foreground">The compilation stack is empty</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">Use quick ingestion above to build something.</p>
              </div>
            ) : (
              queueItems.map((item) => {
                const name = getCleanStoryName(item.story_file || item.spec_file);
                const isItemRunning = item.status === 'running';
                const isFailed = item.status === 'failed' || item.status === 'needs-attention';
                const isPending = item.status === 'pending';

                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-all duration-200 ${
                      isItemRunning
                        ? 'bg-accent border-primary shadow-sm animate-pulse'
                        : 'bg-muted border-border hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-xs text-foreground truncate">
                          {name}
                        </span>
                        <Badge
                          variant="outline"
                          className={`px-1.5 py-0 text-[9px] uppercase tracking-wide border font-bold ${getStatusBadgeVariant(
                            item.status
                          )}`}
                        >
                          {item.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1 flex-wrap">
                        <span>Type: {item.kind === 'FeatureStory' ? 'Feature' : 'App'}</span>
                        {item.phase !== undefined && <span>Phase: {item.phase}</span>}
                        {item.duration_ms && (
                          <span>Built: {(item.duration_ms / 1000).toFixed(1)}s</span>
                        )}
                        {item.engine && (
                          <Badge variant="ghost" className="px-1 py-0 h-4 bg-muted text-[9px] font-mono text-muted-foreground border-none">
                            {item.engine}
                          </Badge>
                        )}
                      </div>
                      {item.error && (
                        <p className="text-[9px] text-destructive font-mono mt-1 leading-snug line-clamp-1 border-l border-destructive pl-2">
                          Error: {item.error}
                        </p>
                      )}
                    </div>

                    {/* Circular Action targets */}
                    <div className="flex items-center gap-1 shrink-0">
                      {isFailed && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleRetryItem(item.id, name)}
                          className="h-7 w-7 rounded-full border-orange-500/20 hover:border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10 text-orange-400 active:scale-95 transition-transform"
                          title="Retry compilation"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      )}
                      {isPending && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleRemoveItem(item.id, name)}
                          className="h-7 w-7 rounded-full border-destructive/20 hover:border-destructive/30 bg-destructive/5 hover:bg-destructive/10 text-destructive active:scale-95 transition-transform"
                          title="Remove from stack"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. SLIDE-UP LOG CONSOLE (BOTTOM DRAWER) */}
      <Sheet open={logsOpen} onOpenChange={setLogsOpen}>
        <div className="fixed bottom-4 right-4 z-40">
          <SheetTrigger asChild>
            <Button
              className="rounded-full shadow-lg shadow-black/30 h-11 px-4 bg-zinc-950 text-zinc-100 hover:bg-zinc-900 border border-zinc-800 text-xs font-semibold flex items-center gap-1.5 select-none focus:ring-0"
            >
              <Terminal className="h-4 w-4" />
              Logs
              {isRunning && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              )}
            </Button>
          </SheetTrigger>
        </div>

        <SheetContent side="bottom" showCloseButton={true} className="h-[80vh] flex flex-col p-0 gap-0 border-t border-border bg-background rounded-t-2xl overflow-hidden focus:outline-hidden">
          <SheetHeader className="px-4 py-3.5 border-b border-border shrink-0 bg-muted">
            <SheetTitle className="text-sm font-bold flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              Live Console Output
              {isRunning && (
                <Badge variant="outline" className="px-1.5 py-0 text-[9px] uppercase tracking-wide bg-emerald-500/10 text-emerald-400 border-emerald-500/20 animate-pulse">
                  Streaming
                </Badge>
              )}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Compile pipeline checklist (progress timeline) */}
            <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border p-4 shrink-0 overflow-y-auto bg-background">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wide mb-3 flex items-center gap-1">
                <Activity className="h-3.5 w-3.5 text-primary" />
                Compilation Stages
              </h3>
              <div className="space-y-3">
                {timelineChecks.map((check) => (
                  <div key={check.id} className="flex items-center gap-2.5">
                    {check.done ? (
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/15 border border-green-500/20 text-green-400">
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                    ) : check.active ? (
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/30 text-primary">
                        <Loader2 className="h-3 w-3 animate-spin stroke-[3]" />
                      </div>
                    ) : (
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground/30">
                        <Clock className="h-3 w-3" />
                      </div>
                    )}
                    <span className={`text-[11px] font-medium leading-none ${
                      check.done
                        ? 'text-foreground/80'
                        : check.active
                        ? 'text-primary font-bold'
                        : 'text-muted-foreground/50'
                    }`}>
                      {check.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pristine high-fidelity dark terminal scrollarea */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0c0c0d]">
              <ScrollArea className="flex-1 p-4 font-mono text-[10px] leading-relaxed text-zinc-300">
                <pre className="whitespace-pre-wrap leading-relaxed select-text pr-2">
                  {buildOutput || 'No logs compiled yet. Spawn a story to watch daemon output...'}
                </pre>
                <div ref={terminalEndRef} />
              </ScrollArea>
            </div>
          </div>
        </SheetContent>
      </Sheet>

    </div>
  );
}
