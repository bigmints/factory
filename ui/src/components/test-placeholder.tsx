'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  FlaskConical, CheckCircle2, Cpu, Microscope, Bug, Clock,
  Play, Square, ExternalLink, RefreshCw, Terminal, Activity,
  Server, AlertCircle
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const upcomingFeatures = [
  { icon: Cpu,          label: 'Unit Tests',        desc: 'Auto-generate and run unit tests per module', tag: 'Engine' },
  { icon: Microscope,   label: 'Integration Tests',  desc: 'Validate API contracts and data flows end-to-end', tag: 'Engine' },
  { icon: CheckCircle2, label: 'Type Checks',        desc: 'tsc --noEmit gating per build iteration', tag: 'Compiler' },
  { icon: Bug,          label: 'Lint & Format',      desc: 'ESLint, Biome, Prettier enforcement on generated code', tag: 'Linter' },
  { icon: Clock,        label: 'Runtime Smoke Test', desc: 'Spawn dev server, wait for port, assert HTTP 200', tag: 'Runtime' },
];

export function TestPlaceholder() {
  const [runStatus, setRunStatus] = useState<'stopped' | 'starting' | 'running'>('stopped');
  const [runPid, setRunPid] = useState<number | null>(null);
  const [runPort, setRunPort] = useState<number | null>(null);
  const [runLogs, setRunLogs] = useState<string>('');
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchRunStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/run-app');
      if (res.ok) {
        const json = await res.json();
        setRunStatus(json.status);
        setRunPid(json.pid);
        setRunPort(json.port);
        setRunLogs(json.logs || '');
      }
    } catch (err) {
      console.error('Failed to fetch run status:', err);
    }
  }, []);

  useEffect(() => {
    fetchRunStatus();
    const interval = setInterval(fetchRunStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchRunStatus]);

  // Auto-scroll logs to bottom when they update
  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [runLogs, showLogs]);

  const handleStartApp = async () => {
    setIsActionLoading(true);
    setRunStatus('starting');
    try {
      const res = await fetch('/api/run-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to start dev server');
      toast.success('Local dev server started successfully');
      setRunStatus(json.status || 'starting');
      if (json.pid) setRunPid(json.pid);
      setShowLogs(true);
      fetchRunStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to start server');
      setRunStatus('stopped');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleStopApp = async () => {
    setIsActionLoading(true);
    try {
      const res = await fetch('/api/run-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to stop dev server');
      toast.success('Dev server stopped');
      setRunStatus('stopped');
      setRunPid(null);
      setRunPort(null);
      fetchRunStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to stop server');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSyncRoadmap = async () => {
    setSyncing(true);
    const toastId = toast.loading('Synchronizing spec models with app roadmap...');
    try {
      const res = await fetch('/api/app-rollup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Sync failed');
      }
      toast.success('Roadmap in sync with local storage', { id: toastId });
    } catch (err: any) {
      toast.error(err.message || 'Sync failed', { id: toastId });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-4">
      {/* Dev Server & Sync Panel */}
      <Card className="border border-border/60 bg-card">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Server className="h-4.5 w-4.5 text-primary" />
                Local Verification Environment
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Run, verify, and synchronize the active app workspace in a local sandbox.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-center">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 font-medium shrink-0"
                onClick={handleSyncRoadmap}
                disabled={syncing}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                Sync Spec Roadmap
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-muted/20">
            <div className="flex items-center gap-3">
              <div className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center border shrink-0",
                runStatus === 'running' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" :
                runStatus === 'starting' ? "bg-blue-500/10 border-blue-500/20 text-blue-500 animate-pulse" :
                "bg-muted border-border text-muted-foreground"
              )}>
                <Activity className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-semibold flex items-center gap-2">
                  Dev Server:
                  <Badge variant="outline" className={cn(
                    "text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider",
                    runStatus === 'running' ? "bg-emerald-500/15 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold" :
                    runStatus === 'starting' ? "bg-blue-500/15 border-blue-500/20 text-blue-600 dark:text-blue-400 animate-pulse font-bold" :
                    "bg-muted border-border text-muted-foreground font-semibold"
                  )}>
                    {runStatus}
                  </Badge>
                </p>
                <p className="text-[11px] text-muted-foreground leading-normal">
                  {runStatus === 'running' ? `Dev server listening on port ${runPort || 3000}${runPid ? ` (PID ${runPid})` : ''}` :
                   runStatus === 'starting' ? "Launching development server process..." :
                   "Server is offline. Start it to manually smoke test and preview features."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {runStatus === 'stopped' ? (
                <Button
                  onClick={handleStartApp}
                  disabled={isActionLoading}
                  size="sm"
                  className="h-8 text-xs gap-1.5 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  <Play className="h-3 w-3 fill-current" />
                  Start Dev Server
                </Button>
              ) : (
                <Button
                  onClick={handleStopApp}
                  disabled={isActionLoading}
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 font-semibold text-red-500/90 hover:text-red-600 hover:bg-red-500/10 border-red-500/20 bg-red-500/5"
                >
                  <Square className="h-3 w-3 fill-current" />
                  Stop Server
                </Button>
              )}
              {runStatus === 'running' && (
                <Button
                  onClick={() => window.open(`http://localhost:${runPort || 3000}`, '_blank')}
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 font-semibold"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open App
                </Button>
              )}
            </div>
          </div>

          {/* Collapsible logs */}
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLogs(!showLogs)}
              className="text-xs gap-1.5 text-muted-foreground hover:text-foreground p-0 h-auto font-medium"
            >
              <Terminal className="h-3.5 w-3.5" />
              {showLogs ? "Hide Server Logs" : "Show Server Logs"}
            </Button>

            {showLogs && (
              <div className="relative rounded-md border border-border bg-zinc-950 dark:bg-[#0d1117] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/40 shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider font-bold">npm run dev Output</span>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("w-1.5 h-1.5 rounded-full", runStatus === 'running' ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30")} />
                    <span className="text-[9px] font-mono text-muted-foreground/60">{runStatus === 'running' ? 'Active Stream' : 'Inactive'}</span>
                  </div>
                </div>
                <div className="p-3 text-[10px] leading-relaxed text-zinc-300 font-mono overflow-y-auto max-h-[220px] whitespace-pre-wrap select-text">
                  {runLogs ? runLogs : "Waiting for server output...\n"}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator className="bg-border/60" />

      {/* Title & Roadmap list */}
      <div className="flex flex-col items-center justify-center py-6 text-center space-y-6 px-4">
        {/* Icon */}
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto">
            <FlaskConical className="h-8 w-8 text-violet-400" />
          </div>
          <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">
            Soon
          </span>
        </div>

        {/* Heading */}
        <div className="space-y-1.5 max-w-lg">
          <h2 className="text-lg font-semibold tracking-tight">Agentic Test Suite</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Automated testing is built into the engine&apos;s iteration loop — type checks, lint gates, integration tests, and live smoke runs happen on every build. A dedicated test dashboard is coming soon.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl w-full mt-2">
          {upcomingFeatures.map(({ icon: Icon, label, desc, tag }) => (
            <div
              key={label}
              className="p-4 rounded-xl border border-border/60 bg-muted/20 text-left space-y-2 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="h-8 w-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                  <Icon className="h-4 w-4 text-violet-400" />
                </div>
                <Badge variant="outline" className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {tag}
                </Badge>
              </div>
              <p className="text-xs font-semibold text-foreground">{label}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
