'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
    <div className="space-responsive">
      {/* Header */}
      <div>
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight">Knowledge Base</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Build history and institutional knowledge for future reference
        </p>
      </div>

      {/* Stats — 2 cols mobile, 4 cols desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-blue-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-base sm:text-lg font-bold block">{stats.totalBuilds}</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">Total Builds</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-base sm:text-lg font-bold block">{stats.successfulBuilds}</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">Successful</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-base sm:text-lg font-bold block">{stats.failedBuilds}</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">Failed</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-purple-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-base sm:text-lg font-bold block">{stats.uniqueSpecs}</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">Unique Specs</span>
              </div>
            </div>
          </CardContent>
        </Card>
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
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No build history yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Build history will appear here after queue execution
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const isExpanded = expandedEntry === entry.id;
            const filesGenerated = entry.filesGenerated || [];

            return (
              <Card key={entry.id} className="relative overflow-hidden">
                <div className={`absolute left-0 top-0 h-full w-1 ${
                  entry.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500'
                }`} />
                <CardContent className="pt-4 pb-3 pl-5">
                  <button
                    className="flex items-center gap-2 sm:gap-3 text-left w-full min-h-[44px]"
                    onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    {entry.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                    )}
                    <span className="font-medium text-xs sm:text-sm truncate">{specName(entry.spec_file)}</span>
                    <Badge variant="outline" className={`text-[9px] sm:text-[10px] shrink-0 ${
                      entry.kind === 'FeatureSpec' ? 'border-purple-500/30 text-purple-400' : 'border-emerald-500/30 text-emerald-400'
                    }`}>
                      {entry.kind === 'FeatureSpec' ? 'Feature' : 'App'}
                    </Badge>
                    {entry.model && (
                      <Badge variant="outline" className="text-[9px] sm:text-[10px] border-cyan-500/30 text-cyan-400 gap-1 shrink-0 hidden sm:flex">
                        <Cpu className="h-2.5 w-2.5" />
                        {entry.model}{entry.provider ? ` · ${entry.provider}` : ''}
                      </Badge>
                    )}
                    <span className="text-[10px] sm:text-xs text-muted-foreground ml-auto shrink-0">
                      {formatDate(entry.timestamp)}
                      {entry.duration_ms ? ` · ${formatDuration(entry.duration_ms)}` : ''}
                      {filesGenerated.length > 0 && (
                        <span className="hidden sm:inline"> · {filesGenerated.length} files</span>
                      )}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 ml-7 space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {entry.notes && <span className="break-all">{entry.notes}</span>}
                        {(entry.tokens_in > 0 || entry.tokens_out > 0) && (
                          <span className="flex items-center gap-1 shrink-0">
                            <Coins className="h-3 w-3 text-amber-400" />
                            {entry.tokens_in.toLocaleString()} in · {entry.tokens_out.toLocaleString()} out
                          </span>
                        )}
                      </div>

                      {filesGenerated.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground font-medium mb-1">Generated Files</p>
                          <div className="flex flex-wrap gap-1">
                            {filesGenerated.map((f, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] sm:text-xs font-mono">
                                <FileText className="h-2.5 w-2.5 mr-1" />
                                <span className="truncate max-w-[120px] sm:max-w-[200px]">{f}</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {entry.summary && (
                        <div className="rounded-md bg-card border p-3 sm:p-4 space-y-2">
                          {entry.summary.split('\n').map((line, i) => {
                            const trimmed = line.trim();
                            if (!trimmed) return null;
                            if (trimmed.startsWith('# ')) {
                              return <p key={i} className="text-xs sm:text-sm font-semibold text-foreground">{trimmed.slice(2)}</p>;
                            }
                            if (trimmed.startsWith('## ')) {
                              return <p key={i} className="text-[10px] sm:text-xs font-semibold text-foreground mt-2 uppercase tracking-wide">{trimmed.slice(3)}</p>;
                            }
                            if (trimmed.startsWith('> ')) {
                              return (
                                <div key={i} className="border-l-2 border-primary/40 pl-3 py-0.5">
                                  <p className="text-xs text-primary font-medium">{trimmed.slice(2)}</p>
                                </div>
                              );
                            }
                            if (trimmed.startsWith('|---') || trimmed.startsWith('| Directory')) {
                              return null;
                            }
                            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                              const cells = trimmed.split('|').filter(Boolean).map(c => c.trim());
                              return (
                                <div key={i} className="flex gap-4 text-[10px] sm:text-xs text-muted-foreground font-mono pl-2 overflow-x-auto">
                                  <span className="flex-1 min-w-[80px]">{cells[0]}</span>
                                  <span>{cells[1]}</span>
                                </div>
                              );
                            }
                            if (trimmed.startsWith('- ')) {
                              return <p key={i} className="text-[10px] sm:text-xs text-muted-foreground pl-2">• {renderInlineMarkdown(trimmed.slice(2))}</p>;
                            }
                            return <p key={i} className="text-[10px] sm:text-xs text-muted-foreground">{renderInlineMarkdown(trimmed)}</p>;
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
