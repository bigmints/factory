'use client';

import { useState, useEffect, useSyncExternalStore, useRef } from 'react';
import { toast } from 'sonner';
import { useFactoryStore } from '@/stores/factory-store';
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
  Shield, Zap, MoreHorizontal, Terminal, X, StopCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useTpmChat } from '@/hooks/use-tpm-chat';
import { tpmStore, type ChatMessage } from '@/lib/tpm-chat-store';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const EMPTY_MESSAGES: ChatMessage[] = [];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'stories' | 'queue' | 'completed'>('stories');
  const [input, setInput] = useState('');
  
  const { theme, setTheme } = useTheme();

  const fetchAll = useFactoryStore(s => s.fetchAll);
  const startPolling = useFactoryStore(s => s.startPolling);
  const stopPolling = useFactoryStore(s => s.stopPolling);
  const activeProject = useFactoryStore(s => s.activeProject);
  const projects = useFactoryStore(s => s.projects);
  const setActiveProject = useFactoryStore(s => s.setActiveProject);
  const stories = useFactoryStore(s => s.stories);
  const featureStories = useFactoryStore(s => s.featureStories);
  const queueStatusMap = useFactoryStore(s => s.queueStatusMap);

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

  const onSend = () => {
    if (!input.trim() || streaming) return;
    handleSend(input, activeProject?.id);
    setInput('');
  };

  // Combine and map stories
  const items = [];
  if (activeTab === 'stories') {
    stories.forEach(s => items.push({ ...s, type: 'app', displayName: s.metadata?.name || s.file }));
    featureStories.forEach(s => items.push({ ...s, type: 'feature', displayName: s.name || s.feature?.name || s.file }));
  } else if (activeTab === 'queue') {
    Object.values(queueStatusMap).forEach((q: any) => {
      if (['ready-to-build', 'building', 'paused'].includes(q.status)) {
        items.push({ type: 'queue', displayName: q.displayName || q.storyFile, status: q.status, addedAt: q.addedAt });
      }
    });
  } else if (activeTab === 'completed') {
    Object.values(queueStatusMap).forEach((q: any) => {
      if (['done', 'failed'].includes(q.status)) {
        items.push({ type: 'queue', displayName: q.displayName || q.storyFile, status: q.status, completedAt: q.completedAt });
      }
    });
  }

  const PROSE = "prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-1.5 prose-pre:rounded-md prose-pre:text-[10.5px] prose-code:text-[10.5px] prose-code:bg-white/10 prose-code:px-1 prose-code:py-px prose-code:rounded prose-code:font-mono prose-a:text-indigo-400";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-300 font-sans flex flex-col selection:bg-zinc-800">
      
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between px-6 border-b border-white/5 bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-indigo-500/20 text-indigo-400">
            <Zap className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold text-white">Factory</span>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900 border border-white/5 text-xs font-medium text-zinc-400 mr-2">
            Factory TPM <ChevronDown className="h-3 w-3 opacity-50 ml-1" />
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-full" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-full" onClick={() => tpmStore.clear()}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-full gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> Feedback
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-full">
            <Settings className="h-4 w-4" />
          </Button>
          <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 ml-2 border border-white/10 shrink-0" />
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col items-center overflow-y-auto px-4 py-12 md:py-16 scrollbar-none">
        <div className="w-full max-w-4xl flex flex-col gap-6">
          
          {/* Project Selector Header */}
          <div className="flex items-center justify-between w-full">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 px-3 rounded-md bg-zinc-900/50 hover:bg-zinc-900 border border-white/5 text-sm font-medium text-zinc-300 gap-2">
                  {activeProject ? activeProject.name : 'Select Project'} <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-[#111] border-white/10 text-zinc-300">
                {projects.map(p => (
                  <DropdownMenuItem key={p.id} onClick={() => setActiveProject(p.id)} className="hover:bg-zinc-800 hover:text-white">
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="ghost" size="sm" className="h-8 text-xs font-medium text-zinc-400 hover:text-white gap-1.5">
              Configure project <Settings2 className="h-3 w-3" />
            </Button>
          </div>

          {/* Central Card Area */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-[#111] overflow-hidden shadow-2xl">
            
            {/* TPM Chat Messages Area (only visible if there are messages) */}
            {messages.length > 0 && (
              <div className="flex flex-col gap-4 p-6 bg-[#0d0d0d] border-b border-white/5 max-h-[500px] overflow-y-auto">
                {messages.map((msg, i) => (
                  <div key={i} className={cn("flex flex-col max-w-[85%]", msg.role === 'user' ? "self-end" : "self-start")}>
                    {msg.role === 'user' ? (
                      <div className="bg-zinc-800 text-zinc-100 px-4 py-2.5 rounded-2xl rounded-tr-sm text-[13px] leading-snug">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-1">
                            {msg.toolCalls.map(tc => (
                              <div key={tc.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900 border border-white/5 text-[10px] text-zinc-400 font-mono">
                                {tc.status === 'running' ? <Terminal className="h-3 w-3 text-amber-500 animate-pulse" /> : <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                                {tc.name}
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.content && (
                          <div className={cn(PROSE, "text-zinc-300 text-[13px]")}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {streaming && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
                  <div className="self-start flex items-center gap-1.5 py-2">
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                    </span>
                    <span className="text-xs text-zinc-500">Thinking...</span>
                  </div>
                )}
                <div ref={endOfMessagesRef} />
              </div>
            )}

            {/* Input Area */}
            <div className="p-1">
              <div className="relative bg-zinc-900/50 rounded-xl overflow-hidden focus-within:bg-zinc-900 transition-colors">
                <Textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Write..."
                  className="min-h-[100px] w-full resize-none bg-transparent border-0 px-5 py-4 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-0"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onSend();
                    }
                  }}
                />
                <div className="absolute right-3 bottom-3">
                  {streaming ? (
                    <Button 
                      size="icon" 
                      variant="ghost"
                      className="h-8 w-8 rounded-lg text-zinc-400 hover:text-white"
                      onClick={() => { tpmStore.abortController?.abort(); tpmStore.setStreaming(false); }}
                    >
                      <StopCircle className="h-5 w-5" />
                    </Button>
                  ) : (
                    <Button 
                      size="icon" 
                      className={cn(
                        "h-8 w-8 rounded-lg transition-all",
                        input.trim() ? "bg-indigo-500 text-white hover:bg-indigo-600" : "bg-white/5 text-white/20 hover:bg-white/10"
                      )}
                      onClick={onSend}
                      disabled={!input.trim()}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-6 px-6 pt-3 pb-0 border-b border-white/5">
              {[
                { id: 'stories', label: 'Stories' },
                { id: 'queue', label: 'Active Queue' },
                { id: 'completed', label: 'Completed' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={cn(
                    "pb-3 text-xs font-medium transition-colors relative",
                    activeTab === tab.id ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Sessions Header */}
            <div className="flex flex-col">
              <div className="flex items-center gap-2 px-6 py-4">
                <Activity className="h-4 w-4 text-zinc-500" />
                <h3 className="text-sm font-medium text-zinc-300">Sessions</h3>
              </div>
              
              {/* List Area */}
              <div className="flex flex-col px-4 pb-4">
                {items.length === 0 ? (
                  <div className="py-8 text-center text-xs text-zinc-600">
                    No items found in {activeTab}.
                  </div>
                ) : (
                  items.map((item: any, idx) => (
                    <div key={idx} className="group flex items-start gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
                      <div className="mt-0.5 shrink-0">
                        {item.status === 'done' || activeTab === 'stories' ? (
                          <CheckCircle2 className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400" />
                        ) : item.status === 'failed' ? (
                          <div className="h-4 w-4 rounded-full border border-red-500/50 bg-red-500/10" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <p className="text-sm text-zinc-300 truncate">
                          <span className="text-zinc-500 font-mono text-xs mr-2">{item.type || 'story'}:</span>
                          {item.displayName}
                        </p>
                        <p className="text-xs text-zinc-600 mt-1">
                          {item.completedAt ? `Completed ${new Date(item.completedAt).toLocaleDateString()}` : 
                           item.addedAt ? `Added ${new Date(item.addedAt).toLocaleDateString()}` : 
                           item.status || 'Draft'}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
                
                {items.length > 0 && (
                  <button className="text-xs text-zinc-500 hover:text-zinc-300 mt-4 ml-3 text-left font-medium">
                    View more
                  </button>
                )}
              </div>
            </div>

            {/* Footer Strip */}
            <div className="bg-zinc-900/40 border-t border-white/5 px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <ClockIcon className="h-3.5 w-3.5" />
                Schedule skill-based agents
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1.5 text-zinc-400 hover:text-white bg-black/20 hover:bg-black/40 rounded-full border border-white/5">
                  <Zap className="h-3 w-3" /> Performance
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1.5 text-zinc-400 hover:text-white bg-black/20 hover:bg-black/40 rounded-full border border-white/5">
                  <Lightbulb className="h-3 w-3" /> Design
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1.5 text-zinc-400 hover:text-white bg-black/20 hover:bg-black/40 rounded-full border border-white/5">
                  <Shield className="h-3 w-3" /> Security
                </Button>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

function ClockIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
