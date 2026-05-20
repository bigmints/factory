'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Activity,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  TrendingUp,
  Database,
} from 'lucide-react';

interface ModelUsage {
  model: string;
  provider: string;
  count: number;
  tokens_in: number;
  tokens_out: number;
}

interface ErrorBreakdown {
  error_source: string;
  count: number;
}

interface BuildEntry {
  id: string;
  spec_file?: string;
  story_file?: string;
  kind: string;
  timestamp: string;
  duration_ms: number | null;
  status: string;
  model: string | null;
  provider: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error_source: string | null;
  notes: string;
}

interface ReportStats {
  totalBuilds: number;
  successfulBuilds: number;
  failedBuilds: number;
  uniqueStories?: number;
  uniqueSpecs?: number;
  totalTokensIn: number;
  totalTokensOut: number;
  avgDurationMs: number;
  modelUsage: ModelUsage[];
  errorBreakdown: ErrorBreakdown[];
}

interface ReportViewerProps {
  entries: BuildEntry[];
  stats: ReportStats;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function storyName(path: string): string {
  return path.split('/').pop()?.replace('.yaml', '') || path;
}

export function ReportViewer({ entries, stats }: ReportViewerProps) {
  const successRate = stats.totalBuilds > 0
    ? Math.round((stats.successfulBuilds / stats.totalBuilds) * 100)
    : 0;
  const totalTokens = stats.totalTokensIn + stats.totalTokensOut;

  const llmErrors = stats.errorBreakdown.find(e => e.error_source === 'llm')?.count || 0;
  const engineErrors = stats.errorBreakdown.find(e => e.error_source === 'engine')?.count || 0;

  return (
    <div className="space-y-6 md:space-y-8 flex flex-col">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Activity, value: stats.totalBuilds, label: 'Total Builds', sub: `${stats.uniqueStories ?? stats.uniqueSpecs ?? 0} unique stories` },
          { icon: CheckCircle2, value: `${successRate}%`, label: 'Success Rate', sub: `${stats.successfulBuilds} passed · ${stats.failedBuilds} failed` },
          { icon: Zap, value: formatTokens(totalTokens), label: 'Tokens Used', sub: `${formatTokens(stats.totalTokensIn)} in · ${formatTokens(stats.totalTokensOut)} out` },
          { icon: Clock, value: stats.avgDurationMs > 0 ? formatDuration(stats.avgDurationMs) : '—', label: 'Avg Duration', sub: 'per build run' },
        ].map((stat, i) => (
          <Card key={i}>
            <CardContent className="p-5 space-y-2 flex flex-col justify-between h-full">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <stat.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xl font-bold tracking-tight leading-none">{stat.value}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground font-semibold uppercase tracking-wider">{stat.label}</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/80 font-mono mt-2 pt-2 border-t truncate">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Model Usage + Error Breakdown — 1 col mobile, 2 cols desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Model Usage */}
        <Card>
          <CardContent className="p-5 md:p-6 flex flex-col justify-between overflow-hidden">
            <div>
              <div className="flex items-center gap-2.5 text-muted-foreground mb-4">
                <Cpu className="h-4 w-4 shrink-0" />
                <span className="text-xs font-bold uppercase tracking-wider">Model Usage</span>
              </div>
              {stats.modelUsage.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6">No model data recorded yet</p>
              ) : (
                <div className="space-y-4">
                  {stats.modelUsage.map((m) => {
                    const pct = stats.totalBuilds > 0
                      ? Math.round((m.count / stats.totalBuilds) * 100)
                      : 0;
                    return (
                      <div key={`${m.provider}-${m.model}`} className="space-y-1.5">
                        <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs sm:text-sm font-bold truncate">{m.model}</span>
                            <Badge variant="outline" className="text-[9px] font-bold px-1.5 py-0 shrink-0">
                              {m.provider}
                            </Badge>
                          </div>
                          <span className="text-[10px] sm:text-xs text-muted-foreground shrink-0 font-medium">
                            {m.count} build{m.count !== 1 ? 's' : ''} · {formatTokens(m.tokens_in + m.tokens_out)} tokens
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden border">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error Breakdown */}
        <Card>
          <CardContent className="p-5 md:p-6 flex flex-col justify-between overflow-hidden">
            <div>
              <div className="flex items-center gap-2.5 text-muted-foreground mb-4">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="text-xs font-bold uppercase tracking-wider">Error Breakdown</span>
              </div>
              {stats.failedBuilds === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground/60 space-y-2">
                  <CheckCircle2 className="h-10 w-10 text-muted-foreground" />
                  <p className="text-xs font-medium">No errors recorded</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted">
                    <div className="flex items-center gap-2.5">
                      <div className="h-2 w-2 rounded-full bg-destructive shrink-0" />
                      <span className="text-xs font-bold">LLM Errors</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-black text-destructive">{llmErrors}</span>
                      <p className="text-[10px] text-muted-foreground font-medium hidden sm:block">API failures, parse errors</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted">
                    <div className="flex items-center gap-2.5">
                      <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                      <span className="text-xs font-bold">Engine Errors</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-black text-amber-500">{engineErrors}</span>
                      <p className="text-[10px] text-muted-foreground font-medium hidden sm:block">Compilation, toolchain</p>
                    </div>
                  </div>
                  {stats.failedBuilds - llmErrors - engineErrors > 0 && (
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted">
                      <div className="flex items-center gap-2.5">
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/60 shrink-0" />
                        <span className="text-xs font-bold text-muted-foreground">Unclassified</span>
                      </div>
                      <span className="text-sm font-black text-muted-foreground">{stats.failedBuilds - llmErrors - engineErrors}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Build History Timeline */}
      <Card>
        <CardContent className="p-5 md:p-6 overflow-hidden">
          <div className="flex items-center gap-2.5 text-muted-foreground mb-4">
            <TrendingUp className="h-4 w-4 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider">Build History</span>
          </div>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/60 space-y-2">
              <Database className="h-10 w-10 opacity-35" />
              <p className="text-sm font-medium">No builds recorded yet</p>
              <p className="text-xs text-muted-foreground">Run a build to start tracking</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Header — hidden on mobile, shown on tablet+ */}
              <div className="hidden sm:grid sm:grid-cols-[1fr_90px_110px_90px_90px_70px] gap-3 px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-bold border-b">
                <span>Story</span>
                <span>Status</span>
                <span>Model</span>
                <span>Tokens</span>
                <span>Duration</span>
                <span>Type</span>
              </div>
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="px-3 py-3 hover:bg-muted/30 border border-transparent hover:border-border rounded-lg transition-all duration-200"
                >
                  {/* Mobile: stacked layout */}
                  <div className="sm:hidden space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold truncate text-foreground">{storyName(entry.story_file || entry.spec_file || '')}</span>
                      <span className="text-[10px] text-muted-foreground font-medium shrink-0">{formatDate(entry.timestamp)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {entry.status === 'completed' ? (
                        <Badge variant="outline" className="text-[9px] font-bold border-green-500/30 text-green-500 bg-green-500/5">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                          Pass
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[9px]">
                          <XCircle className="h-2.5 w-2.5 mr-1" />
                          Fail
                        </Badge>
                      )}
                      {entry.model && (
                        <Badge variant="outline" className="text-[9px] font-mono">
                          {entry.model}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[9px]">
                        {entry.kind === 'FeatureSpec' || entry.kind === 'FeatureStory' ? 'feat' : 'app'}
                      </Badge>
                    </div>
                  </div>
                  {/* Desktop: grid layout */}
                  <div className="hidden sm:grid sm:grid-cols-[1fr_90px_110px_90px_90px_70px] gap-3 items-center">
                    <div className="truncate">
                      <span className="text-xs font-bold text-foreground">{storyName(entry.story_file || entry.spec_file || '')}</span>
                      <span className="text-[10px] text-muted-foreground font-medium ml-2">{formatDate(entry.timestamp)}</span>
                    </div>
                    <div>
                      {entry.status === 'completed' ? (
                        <Badge variant="outline" className="text-[9px] font-bold border-green-500/30 text-green-500 bg-green-500/5">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                          Pass
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[9px]">
                          <XCircle className="h-2.5 w-2.5 mr-1" />
                          Fail
                        </Badge>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground/90 font-medium truncate">
                      {entry.model || '—'}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono font-medium">
                      {(entry.tokens_in || 0) + (entry.tokens_out || 0) > 0
                        ? formatTokens((entry.tokens_in || 0) + (entry.tokens_out || 0))
                        : '—'}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {entry.duration_ms ? formatDuration(entry.duration_ms) : '—'}
                    </span>
                    <Badge variant="secondary" className="text-[9px]">
                      {entry.kind === 'FeatureSpec' || entry.kind === 'FeatureStory' ? 'feat' : 'app'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
