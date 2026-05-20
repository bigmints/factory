'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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

      {/* Stats row — 2 cols mobile, 4 cols desktop with premium spacing */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: BookOpen, value: stats.totalBuilds, label: 'Total Builds' },
          { icon: CheckCircle2, value: stats.successfulBuilds, label: 'Successful' },
          { icon: XCircle, value: stats.failedBuilds, label: 'Failed' },
          { icon: Layers, value: stats.uniqueSpecs, label: 'Unique Specs' },
        ].map((stat, i) => (
          <Card key={i}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <stat.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-xl font-bold tracking-tight leading-none">{stat.value}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground font-semibold uppercase tracking-wider">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
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
          className="w-full h-10 sm:h-11 pl-10 pr-4 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </form>

      <Separator />

      {/* Timeline */}
      {entries.length === 0 ? (
        <Card className="border-dashed flex flex-col items-center justify-center p-6 sm:p-10 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground mb-2" />
          <h3 className="font-semibold text-sm">No build history yet</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Build history will appear here after queue execution.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => {
            const isExpanded = expandedEntry === entry.id;
            const filesGenerated = entry.filesGenerated || [];

            return (
              <Card
                key={entry.id}
                className="relative overflow-hidden"
              >
                <div className={`absolute left-0 top-0 h-full w-[3px] ${
                  entry.status === 'completed' ? 'bg-green-500' : 'bg-destructive'
                }`} />
                <div className="p-4 md:p-5 pl-6 md:pl-8">
                  <button
                    className="flex items-center gap-3 text-left w-full min-h-[40px] focus:outline-none"
                    onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    {entry.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                    <span className="font-bold text-xs sm:text-sm text-foreground truncate">{specName(entry.spec_file)}</span>
                    <Badge variant={entry.kind === 'FeatureSpec' ? 'secondary' : 'default'} className="text-[9px] shrink-0">
                      {entry.kind === 'FeatureSpec' ? 'Feature' : 'App'}
                    </Badge>
                    {entry.model && (
                      <Badge variant="outline" className="text-[9px] gap-1 shrink-0 hidden sm:flex font-mono">
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
                    <div className="mt-4 ml-6 space-y-4 pt-4 border-t border-border animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {entry.notes && (
                          <div className="break-all text-xs bg-muted px-3 py-2 rounded-md border text-muted-foreground w-full sm:w-auto">
                            {entry.notes}
                          </div>
                        )}
                        {(entry.tokens_in > 0 || entry.tokens_out > 0) && (
                          <Badge variant="outline" className="flex items-center gap-1.5 text-[10px]">
                            <Coins className="h-3 w-3 text-muted-foreground" />
                            <span>{entry.tokens_in.toLocaleString()} in · {entry.tokens_out.toLocaleString()} out</span>
                          </Badge>
                        )}
                      </div>

                      {filesGenerated.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Generated Files</p>
                          <div className="flex flex-wrap gap-1.5">
                            {filesGenerated.map((f, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] font-mono font-medium">
                                <FileText className="h-3 w-3 mr-1 text-muted-foreground/80" />
                                <span className="truncate max-w-[120px] sm:max-w-[200px]">{f}</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {entry.summary && (
                        <div className="rounded-lg bg-muted border p-4 space-y-3">
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
                                <div key={i} className="border-l-2 border-primary pl-3 py-1 bg-muted rounded-r-lg">
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
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
