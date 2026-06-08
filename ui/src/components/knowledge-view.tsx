'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  BookOpen,
  Search,
  FileText,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Clock,
  Activity,
  Layers,
  Map,
  ScrollText,
  Workflow,
  Zap,
  Server,
  Factory,
  Tag,
  Database,
} from 'lucide-react';

interface ADR {
  id: string;
  title: string;
  status: string;
  date: string;
  content: string;
  file: string;
}

interface WorklogEntry {
  date: string;
  message: string;
}

interface FailureEntry {
  id: string;
  title: string;
  date: string;
  category: string;
  duration: string;
  error: string;
  action: string;
  content: string;
  file: string;
}

interface WorkflowEntry {
  id: string;
  title: string;
  content: string;
  file: string;
}

interface ContextData {
  project?: { name?: string; status?: string; last_updated?: string; last_commit?: string };
  stack?: Record<string, string>;
  agentic?: Record<string, string>;
  architecture?: Record<string, string>;
  key_decisions?: Array<{ id: string; summary: string }>;
}

interface HeartbeatData {
  heartbeat?: { last_seen?: string; host?: string; task?: string; status?: string };
}

interface KnowledgeStats {
  adrs: number;
  failures: number;
  workflows: number;
  worklogEntries: number;
}

type SectionId = 'context' | 'adrs' | 'failures' | 'workflows' | 'worklog';

const SECTIONS: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: 'context', label: 'Context', icon: Layers },
  { id: 'adrs', label: 'ADRs', icon: GitBranch },
  { id: 'failures', label: 'Failures', icon: AlertTriangle },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'worklog', label: 'Worklog', icon: ScrollText },
];

function MarkdownBlock({ content }: { content: string }) {
  // Simple markdown renderer for headings, lists, code blocks, and paragraphs
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }
    if (trimmed.startsWith('# ')) {
      elements.push(<h2 key={i} className="text-sm font-bold text-foreground mt-4 mb-1">{trimmed.slice(2)}</h2>);
    } else if (trimmed.startsWith('## ')) {
      elements.push(<h3 key={i} className="text-xs font-bold text-foreground/80 uppercase tracking-wider mt-3 mb-1">{trimmed.slice(3)}</h3>);
    } else if (trimmed.startsWith('### ')) {
      elements.push(<h4 key={i} className="text-xs font-semibold text-foreground mt-2 mb-0.5">{trimmed.slice(4)}</h4>);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(<p key={i} className="text-xs text-muted-foreground pl-3 leading-relaxed before:content-['•'] before:mr-2">{trimmed.slice(2)}</p>);
    } else if (trimmed.startsWith('```')) {
      // Collect code block
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} className="mt-2 mb-2 rounded-md bg-muted border text-[10px] font-mono overflow-x-auto p-3 text-muted-foreground leading-relaxed">
          {codeLines.join('\n')}
        </pre>
      );
    } else if (trimmed.startsWith('> ')) {
      elements.push(
        <div key={i} className="border-l-2 border-primary pl-3 py-0.5 my-1">
          <p className="text-xs text-primary font-medium">{trimmed.slice(2)}</p>
        </div>
      );
    } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      elements.push(<p key={i} className="text-xs font-semibold text-foreground">{trimmed.slice(2, -2)}</p>);
    } else if (trimmed.startsWith('---')) {
      elements.push(<Separator key={i} className="my-3" />);
    } else {
      // Inline markdown: bold and code
      const parts = trimmed.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      elements.push(
        <p key={i} className="text-xs text-muted-foreground leading-relaxed">
          {parts.map((part, j) => {
            if (part.startsWith('**') && part.endsWith('**')) return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
            if (part.startsWith('`') && part.endsWith('`')) return <code key={j} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{part.slice(1, -1)}</code>;
            return part;
          })}
        </p>
      );
    }
    i++;
  }
  return <div className="space-y-1">{elements}</div>;
}

function AdrStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s.includes('implemented') || s.includes('approved')) return <Badge className="text-[10px] bg-green-500/15 text-green-600 border-green-500/30">{status}</Badge>;
  if (s.includes('proposed')) return <Badge className="text-[10px] bg-blue-500/15 text-blue-600 border-blue-500/30">{status}</Badge>;
  if (s.includes('deprecated') || s.includes('rejected')) return <Badge variant="destructive" className="text-[10px]">{status}</Badge>;
  return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
}

function CollapsibleCard({
  icon: Icon,
  title,
  badge,
  badgeVariant,
  meta,
  children,
  defaultOpen = false,
  accentColor,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  badgeVariant?: string;
  meta?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accentColor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="relative overflow-hidden border-border/50">
      {accentColor && <div className={`absolute left-0 top-0 h-full w-[3px] ${accentColor}`} />}
      <div className={accentColor ? 'pl-6' : ''}>
        <button
          className="flex items-center gap-3 w-full p-4 md:p-5 text-left focus:outline-none"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-semibold text-xs sm:text-sm text-foreground flex-1 truncate">{title}</span>
          {badge && <Badge variant="secondary" className="text-[10px] shrink-0">{badge}</Badge>}
          {meta && <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">{meta}</span>}
        </button>
        {open && (
          <div className="px-4 pb-4 md:px-5 md:pb-5 pt-0 border-t border-border animate-in fade-in slide-in-from-top-2 duration-200">
            {children}
          </div>
        )}
      </div>
    </Card>
  );
}

export function KnowledgeView() {
  const [activeSection, setActiveSection] = useState<SectionId>('context');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [adrs, setAdrs] = useState<ADR[]>([]);
  const [context, setContext] = useState<ContextData>({});
  const [heartbeat, setHeartbeat] = useState<HeartbeatData>({});
  const [worklog, setWorklog] = useState<WorklogEntry[]>([]);
  const [failures, setFailures] = useState<FailureEntry[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<KnowledgeStats>({ adrs: 0, failures: 0, workflows: 0, worklogEntries: 0 });
  const [appRollup, setAppRollup] = useState<any>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const fetchAppRollup = useCallback(async () => {
    try {
      const res = await fetch('/api/app-rollup');
      if (res.ok) {
        const json = await res.json();
        setAppRollup(json);
      }
    } catch {}
  }, []);

  const fetchKnowledge = useCallback(async (q = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const res = await fetch(`/api/knowledge?${params}`);
      const data = await res.json();
      setAdrs(data.adrs || []);
      setContext(data.context || {});
      setHeartbeat(data.heartbeat || {});
      setWorklog(data.worklog || []);
      setFailures(data.failures || []);
      setWorkflows(data.workflows || []);
      setStats(data.stats || { adrs: 0, failures: 0, workflows: 0, worklogEntries: 0 });
    } catch {
      console.error('Failed to fetch knowledge');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKnowledge(debouncedQuery);
    fetchAppRollup();
  }, [fetchKnowledge, fetchAppRollup, debouncedQuery]);

  const hb = heartbeat?.heartbeat || heartbeat as Record<string, string>;
  const hbStatus = hb?.status || 'unknown';
  const hbIsAlive = hbStatus === 'alive';
  const hbLastSeen = hb?.last_seen ? new Date(hb.last_seen as string) : null;
  const hbAge = hbLastSeen ? Math.round((Date.now() - hbLastSeen.getTime()) / 60000) : null;

  const formatHeartbeatAge = (minutes: number) => {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-6 md:space-y-8 flex flex-col">
      {/* Active App Header Block (Moved under ADRs & Knowledge) */}
      {appRollup ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border/55 pb-4 gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="h-10 w-10 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-center shrink-0">
              <Factory className="h-5 w-5 text-primary shrink-0 animate-pulse" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm md:text-lg font-extrabold tracking-tight text-foreground flex items-center gap-1.5 flex-wrap">
                <span className="truncate">{appRollup.name || 'Loading Project...'}</span>
                <Badge variant="outline" className="text-[9px] font-bold px-1.5 py-0.5 border-border bg-muted/40 uppercase shrink-0">
                  v{appRollup.version || '0.0.1'}
                </Badge>
              </h1>
              {/* Stack badges */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground/80 mt-1">
                {appRollup.stack && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground/80 py-0.5 px-1.5 bg-muted/20 flex items-center gap-1">
                      <Zap className="h-2.5 w-2.5 text-amber-500 shrink-0" /> {appRollup.stack.framework}
                    </Badge>
                    {appRollup.stack.language && (
                      <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground/80 py-0.5 px-1.5 bg-muted/20 flex items-center gap-1">
                        <Tag className="h-2.5 w-2.5 text-blue-500 shrink-0" /> {appRollup.stack.language}
                      </Badge>
                    )}
                    {appRollup.stack.database && (
                      <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground/80 py-0.5 px-1.5 bg-muted/20 flex items-center gap-1">
                        <Database className="h-2.5 w-2.5 text-purple-500 shrink-0" /> {appRollup.stack.database}
                      </Badge>
                    )}
                  </div>
                )}
                {appRollup.description && (
                  <span className="hidden md:inline text-[10px] text-muted-foreground/60 border-l border-border/40 pl-3 max-w-xl truncate" title={appRollup.description}>
                    {appRollup.description}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Heartbeat pill */}
          <div className={cn(
            'flex items-center gap-2 px-2.5 py-1 rounded-full border text-[10px] font-medium shrink-0 self-start sm:self-center',
            hbIsAlive ? 'border-green-500/40 bg-green-500/10 text-green-600' : 'border-muted bg-muted/50 text-muted-foreground'
          )}>
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', hbIsAlive ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground')} />
            <span>{hbIsAlive ? 'Agent alive' : 'No heartbeat'}</span>
            {hbAge !== null && <span className="text-muted-foreground font-mono">{formatHeartbeatAge(hbAge)}</span>}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Knowledge Base</h1>
            <p className="text-sm text-muted-foreground">
              ADRs, architecture context, workflows, and failure records
            </p>
          </div>
          {/* Heartbeat pill */}
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium shrink-0',
            hbIsAlive ? 'border-green-500/40 bg-green-500/10 text-green-600' : 'border-muted bg-muted/50 text-muted-foreground'
          )}>
            <span className={cn('h-2 w-2 rounded-full shrink-0', hbIsAlive ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground')} />
            <span className="hidden sm:block">{hbIsAlive ? 'Agent alive' : 'No heartbeat'}</span>
            {hbAge !== null && <span className="text-muted-foreground">{formatHeartbeatAge(hbAge)}</span>}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { icon: GitBranch, value: stats.adrs, label: 'ADRs', id: 'adrs' as SectionId },
          { icon: AlertTriangle, value: stats.failures, label: 'Failures', id: 'failures' as SectionId },
          { icon: Workflow, value: stats.workflows, label: 'Workflows', id: 'workflows' as SectionId },
          { icon: ScrollText, value: stats.worklogEntries, label: 'Worklog', id: 'worklog' as SectionId },
        ].map((stat) => (
          <button
            key={stat.id}
            onClick={() => setActiveSection(stat.id)}
            className="text-left focus:outline-none"
          >
            <Card className={cn('transition-all hover:border-primary/50 border-border/50', activeSection === stat.id && 'border-primary')}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  activeSection === stat.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                )}>
                  <stat.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-none">{stat.value}</p>
                  <p className="text-xs text-foreground/80 font-bold uppercase tracking-wider mt-1">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {/* Section tabs + Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 flex-wrap">
          {SECTIONS.map(sec => (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                activeSection === sec.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <sec.icon className="h-3.5 w-3.5" />
              {sec.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search knowledge..."
            className="w-full h-9 pl-9 pr-4 rounded-lg border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <Separator />

      {/* Context Section */}
      {activeSection === 'context' && (
        <div className="space-y-4">
          {/* Project card */}
          {context.project && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  Project
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 pt-0">
                {Object.entries(context.project || {}).map(([k, v]) => (
                  <div key={k} className={cn("flex flex-col gap-0.5", k === 'readme_summary' && "col-span-full mt-2")}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k.replace(/_/g, ' ')}</span>
                    {k === 'readme_summary' ? (
                      <div className="text-xs text-muted-foreground border rounded-lg p-3 bg-muted/40 max-h-60 overflow-y-auto mt-1 select-text">
                        <MarkdownBlock content={String(v)} />
                      </div>
                    ) : (
                      <span className="text-xs text-foreground font-medium">{String(v)}</span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Stack + Architecture in 2 cols */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {context.stack && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    Stack
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {Object.entries(context.stack).map(([k, v]) => (
                    <div key={k} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:w-32 shrink-0">{k.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-foreground font-medium">{String(v)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {context.architecture && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Map className="h-4 w-4 text-primary" />
                    Architecture
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {Object.entries(context.architecture).map(([k, v]) => (
                    <div key={k} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:w-32 shrink-0">{k.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-foreground font-medium">{String(v)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Key Decisions */}
          {context.key_decisions && context.key_decisions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  Key Decisions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {context.key_decisions.map((d) => (
                  <div key={d.id} className="flex items-start gap-3">
                    <Badge variant="outline" className="text-[10px] font-mono shrink-0 mt-0.5">ADR-{d.id}</Badge>
                    <p className="text-xs text-muted-foreground leading-relaxed">{d.summary}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Heartbeat */}
          {Object.keys(hb).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Last Heartbeat
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-0">
                {Object.entries(hb).map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-foreground font-medium truncate" title={String(v)}>
                      {k === 'last_seen' ? formatDate(String(v)) : String(v)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ADRs Section */}
      {activeSection === 'adrs' && (
        <div className="space-y-3">
          {adrs.length === 0 ? (
            <EmptyState icon={GitBranch} title="No ADRs yet" description="Architectural Decision Records will appear here from docs/adr/" />
          ) : adrs.map(adr => (
            <CollapsibleCard
              key={adr.id}
              icon={GitBranch}
              title={adr.title}
              badge={adr.id}
              meta={adr.date}
              accentColor="bg-blue-500"
              defaultOpen={adrs.length === 1}
            >
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <AdrStatusBadge status={adr.status} />
                  {adr.date && <span className="text-[10px] text-muted-foreground">{adr.date}</span>}
                </div>
                <div className="rounded-lg bg-muted/50 border p-4">
                  <MarkdownBlock content={adr.content} />
                </div>
              </div>
            </CollapsibleCard>
          ))}
        </div>
      )}

      {/* Failures Section */}
      {activeSection === 'failures' && (
        <div className="space-y-3">
          {failures.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No failures recorded" description="Build failures will be documented here for future reference" />
          ) : failures.map(f => (
            <CollapsibleCard
              key={f.id}
              icon={AlertTriangle}
              title={f.title}
              badge={f.category}
              meta={formatDate(f.date)}
              accentColor="bg-destructive"
            >
              <div className="mt-4 space-y-4">
                {f.duration && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Duration: {f.duration}
                  </div>
                )}
                {f.error && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Error</p>
                    <pre className="text-xs font-mono bg-destructive/10 border border-destructive/20 rounded-md p-3 text-destructive overflow-x-auto whitespace-pre-wrap">{f.error}</pre>
                  </div>
                )}
                {f.action && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Action</p>
                    <div className="rounded-lg bg-muted/50 border p-3">
                      <MarkdownBlock content={f.action} />
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleCard>
          ))}
        </div>
      )}

      {/* Workflows Section */}
      {activeSection === 'workflows' && (
        <div className="space-y-3">
          {workflows.length === 0 ? (
            <EmptyState icon={Workflow} title="No workflows found" description="Workflow guides from .factory/workflows/ will appear here" />
          ) : workflows.map(w => (
            <CollapsibleCard
              key={w.id}
              icon={Workflow}
              title={w.title}
              badge={w.file}
              accentColor="bg-primary"
              defaultOpen={workflows.length === 1}
            >
              <div className="mt-4 rounded-lg bg-muted/50 border p-4">
                <MarkdownBlock content={w.content} />
              </div>
            </CollapsibleCard>
          ))}
        </div>
      )}

      {/* Worklog Section */}
      {activeSection === 'worklog' && (
        <div className="space-y-2">
          {worklog.length === 0 ? (
            <EmptyState icon={ScrollText} title="No worklog entries" description="Agent worklog entries from .factory/context/worklog.yaml will appear here" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {worklog.map((entry, i) => (
                    <div key={i} className="flex items-start gap-4 p-3 md:p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2 shrink-0 mt-0.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                        <span className="text-[10px] text-muted-foreground font-mono w-32 shrink-0">
                          {entry.date ? formatDate(entry.date) : '—'}
                        </span>
                      </div>
                      <p className="text-xs text-foreground leading-relaxed">{entry.message}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <Card className="border-dashed flex flex-col items-center justify-center p-8 sm:p-10 text-center bg-card/5 border-border/50">
      <Icon className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">{description}</p>
    </Card>
  );
}
