'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  spec_file: string;
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
  uniqueSpecs: number;
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

function specName(path: string): string {
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
    <div className="space-responsive">
      {/* Summary Cards — 2 cols mobile, 4 cols desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[9px] sm:text-[10px] uppercase tracking-wider font-medium">Total Builds</span>
            </div>
            <p className="text-xl sm:text-2xl font-bold">{stats.totalBuilds}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{stats.uniqueSpecs} unique specs</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span className="text-[9px] sm:text-[10px] uppercase tracking-wider font-medium">Success Rate</span>
            </div>
            <p className="text-xl sm:text-2xl font-bold">{successRate}%</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              {stats.successfulBuilds} passed · {stats.failedBuilds} failed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span className="text-[9px] sm:text-[10px] uppercase tracking-wider font-medium">Tokens Used</span>
            </div>
            <p className="text-xl sm:text-2xl font-bold">{formatTokens(totalTokens)}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              {formatTokens(stats.totalTokensIn)} in · {formatTokens(stats.totalTokensOut)} out
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              <span className="text-[9px] sm:text-[10px] uppercase tracking-wider font-medium">Avg Duration</span>
            </div>
            <p className="text-xl sm:text-2xl font-bold">{stats.avgDurationMs > 0 ? formatDuration(stats.avgDurationMs) : '—'}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">per build</p>
          </CardContent>
        </Card>
      </div>

      {/* Model Usage + Error Breakdown — 1 col mobile, 2 cols desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* Model Usage */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-3">
              <Cpu className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">Model Usage</span>
            </div>
            {stats.modelUsage.length === 0 ? (
              <p className="text-xs text-muted-foreground">No model data recorded yet</p>
            ) : (
              <div className="space-y-2.5">
                {stats.modelUsage.map((m) => {
                  const pct = stats.totalBuilds > 0
                    ? Math.round((m.count / stats.totalBuilds) * 100)
                    : 0;
                  return (
                    <div key={`${m.provider}-${m.model}`}>
                      <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-medium truncate">{m.model}</span>
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">
                            {m.provider}
                          </Badge>
                        </div>
                        <span className="text-[10px] sm:text-xs text-muted-foreground shrink-0">
                          {m.count} build{m.count !== 1 ? 's' : ''} · {formatTokens(m.tokens_in + m.tokens_out)} tokens
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error Breakdown */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-3">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">Error Breakdown</span>
            </div>
            {stats.failedBuilds === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mb-2 text-emerald-500/40" />
                <p className="text-xs">No errors recorded</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2.5 rounded-md bg-red-500/5 border border-red-500/10">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                    <span className="text-xs font-medium">LLM Errors</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold">{llmErrors}</span>
                    <p className="text-[10px] text-muted-foreground hidden sm:block">API failures, parse errors</p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-md bg-orange-500/5 border border-orange-500/10">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                    <span className="text-xs font-medium">Engine Errors</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold">{engineErrors}</span>
                    <p className="text-[10px] text-muted-foreground hidden sm:block">Compilation, toolchain</p>
                  </div>
                </div>
                {stats.failedBuilds - llmErrors - engineErrors > 0 && (
                  <div className="flex items-center justify-between p-2.5 rounded-md bg-muted/50 border">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                      <span className="text-xs font-medium">Unclassified</span>
                    </div>
                    <span className="text-sm font-bold">{stats.failedBuilds - llmErrors - engineErrors}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Build History Timeline */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <TrendingUp className="h-3.5 w-3.5 shrink-0" />
            <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">Build History</span>
          </div>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Database className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs">No builds recorded yet</p>
              <p className="text-[10px] sm:text-xs mt-1">Run a build to start tracking</p>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Header — hidden on mobile, shown on tablet+ */}
              <div className="hidden sm:grid sm:grid-cols-[1fr_80px_100px_80px_80px_60px] gap-2 px-2 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider font-medium border-b">
                <span>Spec</span>
                <span>Status</span>
                <span>Model</span>
                <span>Tokens</span>
                <span>Duration</span>
                <span>Type</span>
              </div>
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="px-2 py-2.5 hover:bg-accent/50 rounded-md transition-colors"
                >
                  {/* Mobile: stacked layout */}
                  <div className="sm:hidden space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium truncate">{specName(entry.spec_file)}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(entry.timestamp)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {entry.status === 'completed' ? (
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                          Pass
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-600 border-red-500/20">
                          <XCircle className="h-2.5 w-2.5 mr-1" />
                          Fail
                        </Badge>
                      )}
                      {entry.model && <span className="text-[10px] text-muted-foreground">{entry.model}</span>}
                      <Badge variant="secondary" className="text-[9px] px-1.5">
                        {entry.kind === 'FeatureSpec' ? 'feat' : 'app'}
                      </Badge>
                    </div>
                  </div>
                  {/* Desktop: grid layout */}
                  <div className="hidden sm:grid sm:grid-cols-[1fr_80px_100px_80px_80px_60px] gap-2 items-center">
                    <div className="truncate">
                      <span className="text-xs font-medium">{specName(entry.spec_file)}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">{formatDate(entry.timestamp)}</span>
                    </div>
                    <div>
                      {entry.status === 'completed' ? (
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                          Pass
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-600 border-red-500/20">
                          <XCircle className="h-2.5 w-2.5 mr-1" />
                          Fail
                        </Badge>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {entry.model || '—'}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {(entry.tokens_in || 0) + (entry.tokens_out || 0) > 0
                        ? formatTokens((entry.tokens_in || 0) + (entry.tokens_out || 0))
                        : '—'}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {entry.duration_ms ? formatDuration(entry.duration_ms) : '—'}
                    </span>
                    <Badge variant="secondary" className="text-[9px] px-1.5">
                      {entry.kind === 'FeatureSpec' ? 'feat' : 'app'}
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
