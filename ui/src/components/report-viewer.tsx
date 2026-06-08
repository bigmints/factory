'use client';

import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
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

export function ReportViewer({ entries, stats: rawStats }: ReportViewerProps) {
  const stats: ReportStats = rawStats ?? {
    totalBuilds: 0,
    successfulBuilds: 0,
    failedBuilds: 0,
    uniqueSpecs: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    avgDurationMs: 0,
    modelUsage: [],
    errorBreakdown: [],
  };

  const totalBuilds = stats.totalBuilds || 0;
  const successfulBuilds = stats.successfulBuilds || 0;
  const failedBuilds = stats.failedBuilds || 0;
  const totalTokensIn = stats.totalTokensIn || 0;
  const totalTokensOut = stats.totalTokensOut || 0;
  const uniqueStories = stats.uniqueStories || stats.uniqueSpecs || 0;
  const avgDurationMs = stats.avgDurationMs || 0;

  const successRate = totalBuilds > 0
    ? Math.round((successfulBuilds / totalBuilds) * 100)
    : 0;
  const totalTokens = totalTokensIn + totalTokensOut;

  const errorBreakdown = stats.errorBreakdown ?? [];
  const llmErrors = errorBreakdown.find(e => e.error_source === 'llm')?.count || 0;
  const engineErrors = errorBreakdown.find(e => e.error_source === 'engine')?.count || 0;

  return (
    <div className="space-y-6 md:space-y-8 flex flex-col">
      {/* Minimal Stats Ribbon */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground border-b border-border/40 pb-4">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500 shrink-0" />
          <span className="font-semibold text-foreground">{totalBuilds}</span> Total Builds
          <span className="text-[10px] text-muted-foreground/60 font-mono">({uniqueStories} unique)</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="font-semibold text-foreground">{successRate}%</span> Success Rate
          <span className="text-[10px] text-muted-foreground/60">({successfulBuilds} passed / {failedBuilds} failed)</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
          <span className="font-semibold text-foreground">{formatTokens(totalTokens)}</span> Tokens Used
          <span className="text-[10px] text-muted-foreground/60 font-mono">({formatTokens(totalTokensIn)} in / {formatTokens(totalTokensOut)} out)</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" />
          Average Duration: <span className="font-semibold text-foreground">{avgDurationMs > 0 ? formatDuration(avgDurationMs) : '—'}</span>
        </span>
      </div>

      {/* Simplified Flat Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Model Usage */}
        <div className="border border-border rounded-xl bg-card/5 p-5 md:p-6 overflow-hidden">
          <div className="flex items-center gap-2 text-muted-foreground mb-4">
            <Cpu className="h-4 w-4 shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Model Usage</span>
          </div>
          {(stats.modelUsage ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground/60 space-y-2">
              <Cpu className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs font-medium">No model data recorded yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {(stats.modelUsage ?? []).map((m) => {
                const pct = totalBuilds > 0
                  ? Math.round((m.count / totalBuilds) * 100)
                  : 0;
                return (
                  <div key={`${m.provider}-${m.model}`} className="space-y-1.5">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold truncate">{m.model}</span>
                        <span className="text-[9px] font-mono border border-border/80 rounded px-1 text-muted-foreground/80 shrink-0">
                          {m.provider}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
                        {m.count} build{m.count !== 1 ? 's' : ''} · {formatTokens(m.tokens_in + m.tokens_out)} tokens
                      </span>
                    </div>
                    <div className="h-1 bg-border/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-foreground rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Error Breakdown */}
        <div className="border border-border rounded-xl bg-card/5 p-5 md:p-6 overflow-hidden">
          <div className="flex items-center gap-2 text-muted-foreground mb-4">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Error Breakdown</span>
          </div>
          {failedBuilds === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground/60 space-y-2">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs font-medium">No errors recorded</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/5">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                  <span className="text-xs font-medium text-foreground">LLM Errors</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-rose-500">{llmErrors}</span>
                  <p className="text-[9px] text-muted-foreground">API failures or parse errors</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/5">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-xs font-medium text-foreground">Engine Errors</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-amber-500">{engineErrors}</span>
                  <p className="text-[9px] text-muted-foreground">Compilation or toolchain failures</p>
                </div>
              </div>
              {failedBuilds - llmErrors - engineErrors > 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground">Unclassified</span>
                  </div>
                  <span className="text-sm font-bold text-muted-foreground">{failedBuilds - llmErrors - engineErrors}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Build History */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground px-1">
          <TrendingUp className="h-4 w-4 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Build History</span>
        </div>
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/60 border border-dashed border-border rounded-xl bg-card/5">
            <Database className="h-8 w-8 opacity-30 mb-2" />
            <p className="text-xs font-medium">No builds recorded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border border border-border rounded-xl bg-card/5 overflow-hidden">
            {/* Header row */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_90px_120px_80px_80px_70px] gap-3 px-4 py-2 bg-muted/40 text-[9px] text-muted-foreground uppercase tracking-wider font-bold">
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
                className="px-4 py-3 hover:bg-muted/20 transition-colors"
              >
                {/* Mobile View */}
                <div className="sm:hidden space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold truncate text-foreground">
                      {storyName(entry.story_file || entry.spec_file || '')}
                    </span>
                    <span className="text-[9px] text-muted-foreground font-mono">{formatDate(entry.timestamp)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.status === 'completed' ? (
                      <span className="text-[9px] font-semibold text-emerald-500 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Pass
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold text-rose-500 flex items-center gap-1">
                        <XCircle className="h-3 w-3" /> Fail
                      </span>
                    )}
                    {entry.model && (
                      <span className="text-[9px] text-muted-foreground font-mono bg-muted/50 border border-border/80 rounded px-1.5 py-0.5">
                        {entry.model}
                      </span>
                    )}
                    <span className="text-[9px] text-muted-foreground font-mono bg-muted/30 px-1 py-0.5 rounded uppercase">
                      {entry.kind === 'FeatureSpec' || entry.kind === 'FeatureStory' ? 'feat' : 'app'}
                    </span>
                  </div>
                </div>

                {/* Desktop View */}
                <div className="hidden sm:grid sm:grid-cols-[1fr_90px_120px_80px_80px_70px] gap-3 items-center">
                  <div className="truncate">
                    <span className="text-xs font-semibold text-foreground">
                      {storyName(entry.story_file || entry.spec_file || '')}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 font-mono ml-2">
                      {formatDate(entry.timestamp)}
                    </span>
                  </div>
                  <div>
                    {entry.status === 'completed' ? (
                      <span className="text-[9px] font-semibold text-emerald-500 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 shrink-0" /> Pass
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold text-rose-500 flex items-center gap-1">
                        <XCircle className="h-3 w-3 shrink-0" /> Fail
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground/90 font-medium truncate font-mono">
                    {entry.model || '—'}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {(entry.tokens_in || 0) + (entry.tokens_out || 0) > 0
                      ? formatTokens((entry.tokens_in || 0) + (entry.tokens_out || 0))
                      : '—'}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {entry.duration_ms ? formatDuration(entry.duration_ms) : '—'}
                  </span>
                  <div>
                    <span className="text-[9px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded uppercase">
                      {entry.kind === 'FeatureSpec' || entry.kind === 'FeatureStory' ? 'feat' : 'app'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
