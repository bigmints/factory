'use client';

import { useState, useEffect, useSyncExternalStore, useRef } from 'react';
import { toast } from 'sonner';
import { useFactoryStore } from '@/stores/factory-store';
import { SettingsView } from './settings-view';
import { AppSidebar } from './app-sidebar';
import { ReportViewer } from './report-viewer';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CheckCircle2, Trash2, Settings, Moon, Sun, MessageSquare,
  ArrowRight, ChevronDown, Settings2, Activity, Lightbulb,
  Shield, Zap, MoreHorizontal, Terminal, X, StopCircle,
  LayoutGrid, List
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useTpmChat } from '@/hooks/use-tpm-chat';
import { tpmStore, type ChatMessage } from '@/lib/tpm-chat-store';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const EMPTY_MESSAGES: ChatMessage[] = [];

export default function Dashboard() {
  const [input, setInput] = useState('');
  
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<'board' | 'settings' | 'reports'>('board');
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [reportEntries, setReportEntries] = useState<any[]>([]);
  const [reportStats, setReportStats] = useState<any>(null);
  const [loadingReports, setLoadingReports] = useState(false);

  const fetchReports = async () => {
    setLoadingReports(true);
    try {
      const res = await fetch('/api/reports');
      const data = await res.json();
      setReportEntries(data.entries || []);
      setReportStats(data.stats || null);
    } catch {
      toast.error('Failed to fetch reports');
    } finally {
      setLoadingReports(false);
    }
  };

  const fetchAll = useFactoryStore(s => s.fetchAll);
  const startPolling = useFactoryStore(s => s.startPolling);
  const stopPolling = useFactoryStore(s => s.stopPolling);
  const activeProject = useFactoryStore(s => s.activeProject);
  const projects = useFactoryStore(s => s.projects);
  const stories = useFactoryStore(s => s.stories);
  const featureStories = useFactoryStore(s => s.featureStories);
  const queueStatusMap = useFactoryStore(s => s.queueStatusMap);
  const queueItems = useFactoryStore(s => s.queueItems);
  const queueRunning = useFactoryStore(s => s.queueRunning);

  const { handleSend, streaming } = useTpmChat();
  const messages = useSyncExternalStore(
    (cb) => tpmStore.subscribe(cb),
    () => tpmStore.messages,
    () => EMPTY_MESSAGES
  );

  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAll();
    startPolling(5000);
    return () => stopPolling();
  }, [fetchAll, startPolling, stopPolling]);

  useEffect(() => {
    if (endOfMessagesRef.current) {
      endOfMessagesRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'settings') {
        setView('settings');
      } else if (hash === 'reports') {
        setView('reports');
      } else {
        setView('board');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Run initially

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (view === 'reports') {
      fetchReports();
    }
  }, [view]);

  useEffect(() => {
    if (activeProject?.id) {
      tpmStore.setProject(activeProject.id);
    }
  }, [activeProject?.id]);

  const onSend = () => {
    if (!input.trim() || streaming) return;
    handleSend(input, activeProject?.id);
    setInput('');
  };

  // Group stories into 3 states: Todo, In Progress, Done
  const todoItems: any[] = [];
  const inProgressItems: any[] = [];
  const doneItems: any[] = [];

  const queueFiles = new Set<string>();
  queueItems.forEach((q) => {
    const file = q.storyFile || q.specFile;
    if (file) {
      queueFiles.add(file);
      const displayName = file.split('/').pop() || file;
      const itemData = {
        type: q.kind === 'FeatureStory' ? 'feature' : 'app',
        displayName: displayName,
        status: q.status,
        file: file,
        addedAt: q.addedAt,
        completedAt: q.completedAt
      };
      if (['done', 'failed', 'completed'].includes(q.status)) {
        doneItems.push(itemData);
      } else {
        inProgressItems.push(itemData);
      }
    }
  });

  stories.forEach(s => {
    if (!queueFiles.has(s.file)) {
      todoItems.push({ ...s, type: 'app', displayName: s.metadata?.name || s.file });
    }
  });
  featureStories.forEach(s => {
    if (!queueFiles.has(s.file)) {
      todoItems.push({ ...s, type: 'feature', displayName: (s as any).name || s.feature?.name || s.file });
    }
  });

  const renderItem = (item: any, idx: number, state: 'todo' | 'inprogress' | 'done') => {
    const isApp = item.type === 'app';
    return (
      <div 
        key={idx} 
        className="group relative bg-background border border-border/40 p-3 rounded-lg hover:border-border/80 transition-all duration-150 cursor-pointer flex flex-col gap-1.5 shadow-xs"
      >
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {/* Minimal Color Dot Indicator */}
            <span className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              isApp ? "bg-sky-500" : "bg-indigo-500"
            )} />
            <span className="text-[12.5px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
              {item.displayName}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0 -mt-0.5">
            {state === 'done' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : state === 'inprogress' ? (
              <div className="h-3 w-3 rounded-full border border-indigo-500 border-t-transparent animate-spin" />
            ) : null}
          </div>
        </div>

        {item.file && item.file !== item.displayName && (
          <p className="text-[10px] font-mono text-muted-foreground/50 truncate pl-3.5">
            {item.file.split('/').pop()}
          </p>
        )}

        <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-border/20 pl-3.5 text-[9px] text-muted-foreground">
          <span className="font-mono uppercase tracking-wider text-[8.5px]">
            {item.type || 'story'}
          </span>
          <span>
            {item.completedAt ? `Done ${new Date(item.completedAt).toLocaleDateString()}` : 
             item.addedAt ? `Added ${new Date(item.addedAt).toLocaleDateString()}` : 
             item.status || 'Draft'}
          </span>
        </div>
      </div>
    );
  };

  const PROSE = "prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-1.5 prose-pre:rounded-md prose-pre:text-[10.5px] prose-code:text-[10.5px] prose-code:bg-white/10 prose-code:px-1 prose-code:py-px prose-code:rounded prose-code:font-mono prose-a:text-indigo-400";

  return (
    <SidebarProvider className="h-screen overflow-hidden">
      <AppSidebar
        activeTab={view === 'board' ? 'plan' : view}
        onTabChange={(tab) => {
          if (tab === 'plan') {
            setView('board');
            window.location.hash = 'plan';
          } else {
            setView(tab as any);
            window.location.hash = tab;
          }
        }}
        queueRunning={queueRunning}
      />
      <SidebarInset className="h-screen overflow-hidden flex flex-col bg-background text-foreground">
        
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between px-6 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-semibold text-foreground flex items-center gap-2">
              Factory {activeProject ? <span className="text-muted-foreground font-normal">/ {activeProject.name}</span> : ''}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted border border-border text-xs font-medium text-muted-foreground mr-2">
              Factory TPM <ChevronDown className="h-3 w-3 opacity-50 ml-1" />
            </div>
            <ThemeToggle className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent rounded-full [&_svg]:h-4 [&_svg]:w-4" />
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-full gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> Feedback
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className={cn("h-8 w-8 rounded-full", view === 'settings' ? "text-indigo-500 bg-accent" : "text-muted-foreground hover:text-foreground hover:bg-accent")}
              onClick={() => {
                setView(view === 'settings' ? 'board' : 'settings');
                window.location.hash = view === 'settings' ? 'board' : 'settings';
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 ml-2 border border-white/10 shrink-0" />
          </div>
        </header>

        {/* Main Container */}
        <main className="flex-1 flex overflow-hidden">
          
          {/* Left: Main Content */}
          <div className="flex-1 flex flex-col overflow-y-auto px-4 py-8 md:py-12 scrollbar-none">
            {view === 'settings' ? (
              <div className="w-full max-w-2xl mx-auto">
                <SettingsView />
              </div>
            ) : view === 'reports' ? (
              <div className="w-full max-w-4xl mx-auto">
                {loadingReports ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                  </div>
                ) : (
                  <ReportViewer entries={reportEntries} stats={reportStats} />
                )}
              </div>
            ) : (
              <div className="w-full max-w-7xl mx-auto flex flex-col gap-4">
                
                {/* Control Bar: View Switcher */}
                <div className="flex items-center justify-between pb-1 shrink-0">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Workflow Stories</span>
                  <div className="flex items-center gap-0.5 bg-muted border border-border p-0.5 rounded-lg">
                    <Button
                      variant={viewMode === 'board' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('board')}
                      className="h-6 px-2 text-[11px] gap-1 font-medium rounded-md"
                    >
                      <LayoutGrid className="h-3 w-3" /> Board
                    </Button>
                    <Button
                      variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('list')}
                      className="h-6 px-2 text-[11px] gap-1 font-medium rounded-md"
                    >
                      <List className="h-3 w-3" /> List
                    </Button>
                  </div>
                </div>

                {/* 3-Column Kanban Board / Stacked List */}
                <div className={cn(
                  "w-full pb-8",
                  viewMode === 'board' ? "grid grid-cols-1 lg:grid-cols-3 gap-4" : "flex flex-col gap-4"
                )}>
                  
                  {/* Column: Todo */}
                  <div className={cn(
                    "flex flex-col rounded-xl border border-border bg-card/20 overflow-hidden",
                    viewMode === 'board' ? "min-h-[500px]" : "min-h-0"
                  )}>
                    <div className="px-4 py-2.5 border-b border-border bg-muted/10 flex items-center justify-between shrink-0">
                      <h3 className="text-[12.5px] font-semibold text-foreground flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full border border-muted-foreground/50 bg-muted/40" />
                        Todo
                      </h3>
                      <span className="text-[10px] font-bold text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                        {todoItems.length}
                      </span>
                    </div>
                    <div className={cn(
                      "p-2.5 flex flex-col gap-2 flex-1",
                      viewMode === 'board' ? "overflow-y-auto max-h-[700px] scrollbar-none" : "overflow-visible"
                    )}>
                      {todoItems.length === 0 ? (
                        <div className="py-8 text-center text-xs text-muted-foreground/60">No pending stories</div>
                      ) : todoItems.map((item, idx) => renderItem(item, idx, 'todo'))}
                    </div>
                  </div>

                  {/* Column: In Progress */}
                  <div className={cn(
                    "flex flex-col rounded-xl border border-border bg-card/20 overflow-hidden",
                    viewMode === 'board' ? "min-h-[500px]" : "min-h-0"
                  )}>
                    <div className="px-4 py-2.5 border-b border-border bg-muted/10 flex items-center justify-between shrink-0">
                      <h3 className="text-[12.5px] font-semibold text-foreground flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                        In Progress
                      </h3>
                      <span className="text-[10px] font-bold text-indigo-500 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                        {inProgressItems.length}
                      </span>
                    </div>
                    <div className={cn(
                      "p-2.5 flex flex-col gap-2 flex-1",
                      viewMode === 'board' ? "overflow-y-auto max-h-[700px] scrollbar-none" : "overflow-visible"
                    )}>
                      {inProgressItems.length === 0 ? (
                        <div className="py-8 text-center text-xs text-muted-foreground/60">No active tasks</div>
                      ) : inProgressItems.map((item, idx) => renderItem(item, idx, 'inprogress'))}
                    </div>
                  </div>

                  {/* Column: Done */}
                  <div className={cn(
                    "flex flex-col rounded-xl border border-border bg-card/20 overflow-hidden",
                    viewMode === 'board' ? "min-h-[500px]" : "min-h-0"
                  )}>
                    <div className="px-4 py-2.5 border-b border-border bg-muted/10 flex items-center justify-between shrink-0">
                      <h3 className="text-[12.5px] font-semibold text-foreground flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Done
                      </h3>
                      <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                        {doneItems.length}
                      </span>
                    </div>
                    <div className={cn(
                      "p-2.5 flex flex-col gap-2 flex-1",
                      viewMode === 'board' ? "overflow-y-auto max-h-[700px] scrollbar-none" : "overflow-visible"
                    )}>
                      {doneItems.length === 0 ? (
                        <div className="py-8 text-center text-xs text-muted-foreground/60">No completed items</div>
                      ) : doneItems.map((item, idx) => renderItem(item, idx, 'done'))}
                    </div>
                  </div>

                </div>
              </div>
            )}
       </div>

        {/* Right: Sidebar Chat */}
        <div className="w-[380px] border-l border-border bg-card flex flex-col shrink-0 h-full hidden md:flex">
          <div className="p-4 border-b border-border shrink-0 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">TPM Chat</h3>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 opacity-50">
                <MessageSquare className="h-8 w-8 mb-2" />
                <p className="text-sm">No messages yet.</p>
                <p className="text-xs">Ask the TPM to add a story!</p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={cn("flex flex-col max-w-[90%]", msg.role === 'user' ? "self-end" : "self-start")}>
                  {msg.role === 'user' ? (
                    <div className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-4 py-2.5 rounded-2xl rounded-tr-sm text-[13px] leading-snug border border-zinc-200/50 dark:border-transparent">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-1">
                          {msg.toolCalls.map(tc => (
                            <div key={tc.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted border border-border text-[10px] text-muted-foreground font-mono">
                              {tc.status === 'running' ? <Terminal className="h-3 w-3 text-amber-500 animate-pulse" /> : <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                              {tc.name}
                            </div>
                          ))}
                        </div>
                      )}
                      {msg.content && (
                        <div className={cn(PROSE, "text-foreground text-[13px]")}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            
            {streaming && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
              <div className="self-start flex items-center gap-1.5 py-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                </span>
                <span className="text-xs text-muted-foreground font-medium">Thinking...</span>
              </div>
            )}
            <div ref={endOfMessagesRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-border shrink-0 bg-card">
            <div className="relative bg-muted/50 rounded-xl overflow-hidden focus-within:bg-muted transition-colors border border-border">
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Message TPM..."
                className="min-h-[80px] w-full resize-none bg-transparent border-0 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
              />
              <div className="absolute right-2 bottom-2">
                {streaming ? (
                  <Button 
                    size="icon" 
                    variant="ghost"
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={() => { tpmStore.abortController?.abort(); tpmStore.setStreaming(false); }}
                  >
                    <StopCircle className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button 
                    size="icon" 
                    className={cn(
                      "h-7 w-7 rounded-lg transition-all",
                      input.trim() ? "bg-indigo-500 text-white hover:bg-indigo-600" : "bg-muted text-muted-foreground/30 hover:bg-muted/80"
                    )}
                    onClick={onSend}
                    disabled={!input.trim()}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

      </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
