'use client';

import { useState, useEffect, useCallback } from 'react';
// Card imports removed
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  Search,
  FileText,
  ChevronDown,
  ChevronRight,
  Layers,
  Cpu,
  Coins,
} from 'lucide-react';

interface BuildEntry {
  id: string;
  spec_file: string;
  kind: string;
  timestamp: string;
  duration_ms: number | null;
  status: string;
  files_generated: string;
  filesGenerated: string[];
  summary: string;
  notes: string;
  model: string | null;
  provider: string | null;
  tokens_in: number;
  tokens_out: number;
}

interface KnowledgeStats {
  totalBuilds: number;
  successfulBuilds: number;
  failedBuilds: number;
  uniqueSpecs: number;
}

export function KnowledgeView() {
  const [entries, setEntries] = useState<BuildEntry[]>([]);
  const [stats, setStats] = useState<KnowledgeStats>({
    totalBuilds: 0, successfulBuilds: 0, failedBuilds: 0, uniqueSpecs: 0,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const fetchKnowledge = useCallback(async (query?: string) => {
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      const res = await fetch(`/api/knowledge?${params}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setStats(data.stats || { totalBuilds: 0, successfulBuilds: 0, failedBuilds: 0, uniqueSpecs: 0 });
    } catch {
      console.error('Failed to fetch knowledge');
    }
  }, []);

  useEffect(() => {
    fetchKnowledge();
  }, [fetchKnowledge]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchKnowledge(searchQuery);
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const specName = (path: string) => {
    return path.split('/').pop()?.replace('.yaml', '') || path;
  };

  const renderInlineMarkdown = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] sm:text-xs">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  };

  return (
    <div className="space-y-6 md:space-y-8 flex flex-col">
      {/* Header */}
      <div>
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight">Knowledge Base</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Build history and institutional knowledge for future reference
        </p>
      </div>

      {/* Stats — 2 cols mobile, 4 cols desktop */}
      {/* Stats row — 2 cols mobile, 4 cols desktop with premium spacing & larger cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {[
          { icon: BookOpen, glowClass: 'glow-blue hover:border-blue-500/20', value: stats.totalBuilds, label: 'Total Builds', iconColor: 'text-blue-400', bgColor: 'bg-blue-500/10' },
          { icon: CheckCircle2, glowClass: 'glow-emerald hover:border-emerald-500/20', value: stats.successfulBuilds, label: 'Successful', iconColor: 'text-emerald-400', bgColor: 'bg-emerald-500/10' },
          { icon: XCircle, glowClass: 'glow-red hover:border-red-500/20', value: stats.failedBuilds, label: 'Failed', iconColor: 'text-red-400', bgColor: 'bg-red-500/10' },
          { icon: Layers, glowClass: 'glow-purple hover:border-purple-500/20', value: stats.uniqueSpecs, label: 'Unique Specs', iconColor: 'text-purple-400', bgColor: 'bg-purple-500/10' },
        ].map((stat, i) => (
          <div key={i} className={cn("glass-panel rounded-2xl p-5 md:p-6 transition-all duration-300 hover:shadow-md tap-shrink", stat.glowClass)}>
            <div className="flex items-center gap-4">
              <div className={cn("flex h-11 w-11 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-2xl", stat.bgColor)}>
                <stat.icon className={cn("h-5 md:h-6 w-5 md:w-6", stat.iconColor)} />
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-xl md:text-2xl font-black tracking-tight leading-none">{stat.value}</p>
                <p className="text-[10px] md:text-xs text-muted-foreground font-bold truncate uppercase tracking-wider">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search builds, outputs, notes..."
          className="w-full h-10 sm:h-11 pl-10 pr-4 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </form>

      <Separator />

      {/* Timeline */}
      {entries.length === 0 ? (
        <div className="glass-panel border border-dashed border-border/60 rounded-2xl p-6 sm:p-10 text-center space-y-3 glow-purple">
          <BookOpen className="h-10 w-10 text-muted-foreground/45 mx-auto mb-1" />
          <p className="text-sm font-semibold text-foreground">No build history yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-[280px] mx-auto leading-relaxed">
            Build history will appear here after queue execution.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => {
            const isExpanded = expandedEntry === entry.id;
            const filesGenerated = entry.filesGenerated || [];

            return (
              <div
                key={entry.id}
                className="glass-panel rounded-2xl p-0 transition-all duration-300 border-border/40 relative overflow-hidden hover:shadow-sm"
              >
                <div className={`absolute left-0 top-0 h-full w-[3px] ${
                  entry.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500'
                }`} />
                <div className="p-4 md:p-5 pl-6 md:pl-8">
                  <button
                    className="flex items-center gap-3 text-left w-full min-h-[40px] focus:outline-none"
                    onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
                    )}
                    {entry.status === 'completed' ? (
                      <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-4.5 w-4.5 text-red-400 shrink-0" />
                    )}
                    <span className="font-bold text-xs sm:text-sm text-foreground truncate">{specName(entry.spec_file)}</span>
                    <Badge variant="outline" className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 border ${
                      entry.kind === 'FeatureSpec' ? 'bg-purple-500/5 border-purple-500/20 text-purple-400' : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                    }`}>
                      {entry.kind === 'FeatureSpec' ? 'Feature' : 'App'}
                    </Badge>
                    {entry.model && (
                      <Badge variant="outline" className="text-[9px] font-bold px-2 py-0.5 rounded-full border border-cyan-500/20 bg-cyan-500/5 text-cyan-400 gap-1 shrink-0 hidden sm:flex">
                        <Cpu className="h-2.5 w-2.5" />
                        {entry.model}{entry.provider ? ` · ${entry.provider}` : ''}
                      </Badge>
                    )}
                    <span className="text-[10px] md:text-xs text-muted-foreground ml-auto shrink-0 font-medium">
                      {formatDate(entry.timestamp)}
                      {entry.duration_ms ? ` · ${formatDuration(entry.duration_ms)}` : ''}
                      {filesGenerated.length > 0 && (
                        <span className="hidden sm:inline"> · {filesGenerated.length} files</span>
                      )}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="mt-4 ml-6 space-y-4 pt-4 border-t border-border/20 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {entry.notes && (
                          <span className="break-all bg-muted/10 px-3 py-2 rounded-xl border border-border/30 w-full sm:w-auto leading-relaxed">
                            {entry.notes}
                          </span>
                        )}
                        {(entry.tokens_in > 0 || entry.tokens_out > 0) && (
                          <span className="flex items-center gap-1.5 shrink-0 bg-amber-500/5 border border-amber-500/20 px-3 py-1.5 rounded-xl text-amber-400/90 font-semibold text-[10px]">
                            <Coins className="h-3.5 w-3.5" />
                            {entry.tokens_in.toLocaleString()} in · {entry.tokens_out.toLocaleString()} out
                          </span>
                        )}
                      </div>

                      {filesGenerated.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Generated Files</p>
                          <div className="flex flex-wrap gap-1.5">
                            {filesGenerated.map((f, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] font-mono font-medium px-2 py-0.5 border border-border/40 bg-muted/20">
                                <FileText className="h-3 w-3 mr-1 text-muted-foreground/80" />
                                <span className="truncate max-w-[120px] sm:max-w-[200px]">{f}</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {entry.summary && (
                        <div className="rounded-xl bg-muted/10 border border-border/30 p-4 space-y-3">
                          {entry.summary.split('\n').map((line, i) => {
                            const trimmed = line.trim();
                            if (!trimmed) return null;
                            if (trimmed.startsWith('# ')) {
                              return <p key={i} className="text-xs sm:text-sm font-bold text-foreground">{trimmed.slice(2)}</p>;
                            }
                            if (trimmed.startsWith('## ')) {
                              return <p key={i} className="text-[10px] sm:text-xs font-bold text-foreground mt-3 uppercase tracking-wider text-muted-foreground/80">{trimmed.slice(3)}</p>;
                            }
                            if (trimmed.startsWith('> ')) {
                              return (
                                <div key={i} className="border-l-2 border-primary/40 pl-3 py-1 bg-muted/5 rounded-r-lg">
                                  <p className="text-xs text-primary font-bold">{trimmed.slice(2)}</p>
                                </div>
                              );
                            }
                            if (trimmed.startsWith('|---') || trimmed.startsWith('| Directory')) {
                              return null;
                            }
                            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                              const cells = trimmed.split('|').filter(Boolean).map(c => c.trim());
                              return (
                                <div key={i} className="flex gap-4 text-[10px] sm:text-xs text-muted-foreground font-mono pl-2 overflow-x-auto leading-relaxed">
                                  <span className="flex-1 min-w-[80px] font-medium">{cells[0]}</span>
                                  <span className="font-semibold text-foreground/80">{cells[1]}</span>
                                </div>
                              );
                            }
                            if (trimmed.startsWith('- ')) {
                              return <p key={i} className="text-[10px] sm:text-xs text-muted-foreground pl-2 leading-relaxed">• {renderInlineMarkdown(trimmed.slice(2))}</p>;
                            }
                            return <p key={i} className="text-[10px] sm:text-xs text-muted-foreground leading-relaxed">{renderInlineMarkdown(trimmed)}</p>;
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
