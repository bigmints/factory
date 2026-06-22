"use client";

import { useState, useEffect, useSyncExternalStore, useRef } from "react";
import { toast } from "sonner";
import { useFactoryStore } from "@/stores/factory-store";
import { SettingsView } from "./settings-view";
import { AddProject } from "./add-project";
import { AppSidebar } from "./app-sidebar";
import { ReportViewer } from "./report-viewer";
import { KnowledgeViewer } from "./knowledge-viewer";
import { HeaderSelectors } from "./header-selectors";
import { StoryEditor } from "./story-editor";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import {
  SidebarProvider,
  SidebarInset,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  MessageSquare,
  ArrowRight,
  Zap,
  Terminal,
  X,
  StopCircle,
  LayoutGrid,
  List,
  PanelRight,
  PanelLeft,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTpmChat } from "@/hooks/use-tpm-chat";
import { tpmStore, type ChatMessage } from "@/lib/tpm-chat-store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const EMPTY_MESSAGES: ChatMessage[] = [];

export default function Dashboard() {
  const [input, setInput] = useState("");

  const [view, setView] = useState<"board" | "settings" | "reports" | "add-project" | "knowledge">("board");
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, string>>({});
  const [editingStory, setEditingStory] = useState<{ file: string; name: string } | null>(null);

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    let newStatus = "draft";
    if (destination.droppableId === "todo") newStatus = "draft";
    if (destination.droppableId === "inprogress") newStatus = "ready-to-build";
    if (destination.droppableId === "done") newStatus = "done";

    setOptimisticStatuses((prev) => ({ ...prev, [draggableId]: newStatus }));

    try {
      const res = await fetch("/api/stories/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: draggableId, status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      toast.success(`Moved story to ${newStatus}`);
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to move story");
      setOptimisticStatuses((prev) => {
        const next = { ...prev };
        delete next[draggableId];
        return next;
      });
    }
  };
  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const [isRightOpen, setIsRightOpen] = useState(true);
  const [reportEntries, setReportEntries] = useState<any[]>([]);
  const [reportStats, setReportStats] = useState<any>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [knowledgeData, setKnowledgeData] = useState<any>(null);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);

  const fetchKnowledge = async () => {
    setLoadingKnowledge(true);
    try {
      const res = await fetch("/api/knowledge");
      const data = await res.json();
      setKnowledgeData(data);
    } catch {
      toast.error("Failed to fetch knowledge");
    } finally {
      setLoadingKnowledge(false);
    }
  };

  const fetchReports = async () => {
    setLoadingReports(true);
    try {
      const res = await fetch("/api/reports");
      const data = await res.json();
      setReportEntries(data.entries || []);
      setReportStats(data.stats || null);
    } catch {
      toast.error("Failed to fetch reports");
    } finally {
      setLoadingReports(false);
    }
  };

  const fetchAll = useFactoryStore((s) => s.fetchAll);
  const startPolling = useFactoryStore((s) => s.startPolling);
  const stopPolling = useFactoryStore((s) => s.stopPolling);
  const activeProject = useFactoryStore((s) => s.activeProject);
  const stories = useFactoryStore((s) => s.stories);
  const featureStories = useFactoryStore((s) => s.featureStories);
  const queueItems = useFactoryStore((s) => s.queueItems);
  const queueRunning = useFactoryStore((s) => s.queueRunning);

  const { handleSend, streaming } = useTpmChat();
  const messages = useSyncExternalStore(
    (cb) => tpmStore.subscribe(cb),
    () => tpmStore.messages,
    () => EMPTY_MESSAGES,
  );

  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAll();
    startPolling(5000);
    return () => stopPolling();
  }, [fetchAll, startPolling, stopPolling]);

  useEffect(() => {
    if (endOfMessagesRef.current) {
      endOfMessagesRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      setEditingStory(null);
      if (hash === "settings") {
        setView("settings");
      } else if (hash === "reports") {
        setView("reports");
      } else if (hash === "knowledge") {
        setView("knowledge");
      } else {
        setView("board");
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange(); // Run initially

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (view === "reports") {
      fetchReports();
    } else if (view === "knowledge") {
      fetchKnowledge();
    }
  }, [view]);

  useEffect(() => {
    if (activeProject?.id) {
      tpmStore.setProject(activeProject.id);
    }
  }, [activeProject?.id]);

  const onSend = () => {
    if (!input.trim() || streaming) return;
    handleSend(input);
    setInput("");
  };

  // Group stories into 3 states: Todo, In Progress, Done
  const todoItems: any[] = [];
  const inProgressItems: any[] = [];
  const doneItems: any[] = [];

  const allItems: any[] = [];

  const queueFiles = new Set<string>();
  queueItems.forEach((q) => {
    const file = q.storyFile || q.specFile;
    if (file) {
      queueFiles.add(file);
      const displayName = file.split("/").pop() || file;
      allItems.push({
        type: q.kind === "FeatureStory" ? "feature" : "app",
        displayName: displayName,
        status: optimisticStatuses[file] || q.status,
        file: file,
        addedAt: q.addedAt,
        completedAt: q.completedAt,
      });
    }
  });

  stories.forEach((s) => {
    if (!queueFiles.has(s.file)) {
      allItems.push({
        ...s,
        type: "app",
        status: optimisticStatuses[s.file] || s.status || "draft",
        displayName: s.metadata?.name || s.file,
      });
    }
  });
  featureStories.forEach((s) => {
    if (!queueFiles.has(s.file)) {
      allItems.push({
        ...s,
        type: "feature",
        status: optimisticStatuses[s.file] || s.status || "draft",
        displayName: (s as any).name || s.feature?.name || s.file,
      });
    }
  });

  allItems.forEach((item) => {
    if (["done", "failed", "completed"].includes(item.status)) {
      doneItems.push(item);
    } else if (["draft", "todo"].includes(item.status)) {
      todoItems.push(item);
    } else {
      inProgressItems.push(item);
    }
  });

  const renderItem = (
    item: any,
    idx: number,
    state: "todo" | "inprogress" | "done",
    mode: "board" | "list" = "board",
  ) => {
    const isApp = item.type === "app";
    const isDraggable = mode === "board" && !!item.file;

    const content = (
      <div
        onClick={() => setEditingStory({ file: item.file, name: item.displayName })}
        className={cn(
          "group relative transition-all duration-150 cursor-pointer",
          mode === "board"
            ? "p-3 rounded-xl border border-border/50 bg-card shadow-sm flex flex-col gap-2 mb-3 hover:border-border/80 hover:shadow-md"
            : "p-2 rounded-md flex items-center justify-between gap-4 border border-border/40 mb-2 shadow-xs bg-transparent hover:bg-muted/40",
        )}
      >
        <div
          className={cn(
            "flex items-start justify-between gap-2 min-w-0",
            mode === "list" && "items-center flex-1",
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* Minimal Color Dot Indicator */}
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                isApp ? "bg-sky-500" : "bg-indigo-500",
              )}
            />
            <span className="text-[12.5px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
              {item.displayName}
            </span>
            {mode === "list" && item.file && item.file !== item.displayName && (
              <span className="text-[10px] font-mono text-muted-foreground/50 truncate ml-2">
                {item.file.split("/").pop()}
              </span>
            )}
          </div>

          {mode === "board" && (
            <div className="flex items-center gap-1 shrink-0 -mt-0.5">
              {state === "done" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : state === "inprogress" && item.status === "running" ? (
                <div className="h-3 w-3 rounded-full border border-indigo-500 border-t-transparent animate-spin" />
              ) : null}
            </div>
          )}
        </div>

        {mode === "board" && item.file && item.file !== item.displayName && (
          <p className="text-[10px] font-mono text-muted-foreground/50 truncate pl-3.5">
            {item.file.split("/").pop()}
          </p>
        )}

        <div
          className={cn(
            "flex items-center text-[9px] text-muted-foreground",
            mode === "board"
              ? "justify-between mt-0.5 pt-1 border-t border-border/10 pl-3.5"
              : "gap-4 shrink-0",
          )}
        >
          <span className="font-mono uppercase tracking-wider text-[8.5px]">
            {item.type || "story"}
          </span>
          <span className="flex items-center gap-1.5">
            {state === "done" && mode === "list" && (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            )}
            {state === "inprogress" &&
              mode === "list" &&
              item.status === "running" && (
                <div className="h-3 w-3 rounded-full border border-indigo-500 border-t-transparent animate-spin" />
              )}
            {item.completedAt
              ? `Done ${new Date(item.completedAt).toLocaleDateString()}`
              : item.addedAt
                ? `Added ${new Date(item.addedAt).toLocaleDateString()}`
                : item.status || "Draft"}
          </span>
        </div>
      </div>
    );

    if (!isDraggable) {
      return <div key={item.file || String(idx)}>{content}</div>;
    }

    return (
      <Draggable key={item.file} draggableId={item.file} index={idx}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            style={{
              ...provided.draggableProps.style,
              opacity: snapshot.isDragging ? 0.8 : 1,
            }}
          >
            {content}
          </div>
        )}
      </Draggable>
    );
  };

  const PROSE =
    "prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-1.5 prose-pre:rounded-md prose-pre:text-[10.5px] prose-code:text-[10.5px] prose-code:bg-white/10 prose-code:px-1 prose-code:py-px prose-code:rounded prose-code:font-mono prose-a:text-indigo-400";

  return (
    <SidebarProvider open={isLeftOpen} onOpenChange={setIsLeftOpen} className="h-screen overflow-hidden">
      <AppSidebar
        activeTab={view === "board" ? "plan" : view}
        onTabChange={(tab) => {
          setEditingStory(null);
          if (tab === "plan") {
            setView("board");
            window.location.hash = "plan";
          } else {
            setView(tab as any);
            window.location.hash = tab;
          }
        }}
        onAddProject={() => {
          setEditingStory(null);
          setView("add-project");
        }}
        queueRunning={queueRunning}
      />
      <SidebarProvider 
        open={isRightOpen} 
        onOpenChange={setIsRightOpen} 
        className="flex-1 overflow-hidden"
        style={{ "--sidebar-width": "380px" } as React.CSSProperties}
      >
        <SidebarInset className="h-screen overflow-hidden flex flex-col bg-background text-foreground">
          {/* Header */}
          <header className="flex h-14 shrink-0 items-center justify-between px-6 border-b border-border bg-card">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setIsLeftOpen(!isLeftOpen)} className="-ml-1 h-8 w-8 text-muted-foreground hover:text-foreground">
                <PanelLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                Factory{" "}
                {activeProject ? (
                  <span className="text-muted-foreground font-normal">
                    / {activeProject.name}
                  </span>
                ) : (
                  ""
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <HeaderSelectors />
              
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    if (queueRunning) {
                      await fetch("/api/queue/stop", { method: "POST" });
                      toast("Build stopped");
                    } else {
                      await fetch("/api/queue/start", { method: "POST" });
                      toast("Build started");
                    }
                  } catch {
                    toast.error("Failed to toggle build");
                  }
                }}
                className={cn(
                  "h-8 px-3 text-xs font-medium rounded-full gap-1.5 shadow-sm transition-all",
                  queueRunning
                    ? "bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20"
                    : "bg-indigo-500 hover:bg-indigo-600 text-white shadow-indigo-500/20",
                )}
              >
                {queueRunning ? (
                  <>
                    <StopCircle className="h-3.5 w-3.5" /> Stop All
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" /> Build All
                  </>
                )}
              </Button>

              <div className="h-4 w-px bg-border/60 mx-1" />

              <Button 
                variant="ghost" 
                size="icon" 
                className={cn("h-8 w-8 rounded-full", isRightOpen ? "text-indigo-500 bg-accent" : "text-muted-foreground hover:text-foreground hover:bg-accent")}
                onClick={() => setIsRightOpen(!isRightOpen)}
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {/* Main Container */}
          <main className="flex-1 flex overflow-hidden">
            {/* Left: Main Content */}
            <div className="flex-1 flex flex-col overflow-y-auto px-4 py-4 md:py-4 scrollbar-none relative">
              {editingStory && (
                <div className="fixed inset-0 z-[100] bg-background">
                  <div className="w-full h-full flex flex-col">
                    <StoryEditor
                      storyFile={editingStory.file}
                      storyName={editingStory.name}
                      onClose={() => setEditingStory(null)}
                      onSaved={() => fetchAll()}
                    />
                  </div>
                </div>
              )}
              {view === "settings" ? (
                <div className="w-full max-w-2xl mx-auto">
                  <SettingsView />
                </div>
              ) : view === "add-project" ? (
                <div className="w-full max-w-2xl mx-auto py-4">
                  <AddProject 
                    onProjectAdded={() => {
                      setView("board");
                      window.location.hash = "plan";
                    }}
                    onNavigateToPlan={() => {
                      setView("board");
                      window.location.hash = "plan";
                    }}
                  />
                </div>
              ) : view === "reports" ? (
                <div className="w-full max-w-4xl mx-auto">
                  {loadingReports ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                    </div>
                  ) : (
                    <ReportViewer entries={reportEntries} stats={reportStats} />
                  )}
                </div>
              ) : view === "knowledge" ? (
                <div className="w-full max-w-4xl mx-auto">
                  {loadingKnowledge ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                    </div>
                  ) : (
                    <KnowledgeViewer data={knowledgeData} />
                  )}
                </div>
              ) : (
                <div className="w-full max-w-7xl mx-auto flex flex-col gap-4">
                  {/* Control Bar: View Switcher & Actions */}
                  <div className="flex items-center justify-between pb-1 shrink-0">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Workflow Stories
                    </span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-0.5 bg-muted border border-border p-0.5 rounded-lg">
                        <Button
                          variant={viewMode === "board" ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => setViewMode("board")}
                          className="h-6 px-2 text-[11px] gap-1 font-medium rounded-md"
                        >
                          <LayoutGrid className="h-3 w-3" /> Board
                        </Button>
                        <Button
                          variant={viewMode === "list" ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => setViewMode("list")}
                          className="h-6 px-2 text-[11px] gap-1 font-medium rounded-md"
                        >
                          <List className="h-3 w-3" /> List
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* 3-Column Kanban Board / Stacked List */}
                  <DragDropContext onDragEnd={onDragEnd}>
                    <div
                      className={cn(
                        "w-full pb-8",
                        viewMode === "board"
                          ? "grid grid-cols-1 lg:grid-cols-3 gap-4"
                          : "flex flex-col gap-4",
                      )}
                    >
                      {/* Column: Todo */}
                      <Droppable droppableId="todo" isDropDisabled={viewMode !== "board"}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn(
                              "flex flex-col",
                              viewMode === "board"
                                ? "min-h-[500px] bg-transparent"
                                : "min-h-0 bg-transparent",
                            )}
                          >
                            <div
                              className={cn(
                                "flex items-center justify-between shrink-0 mb-3",
                                viewMode === "board" ? "px-1" : "px-2 pb-2",
                              )}
                            >
                              <h3 className="text-[12.5px] font-semibold text-foreground flex items-center gap-1.5">
                                <div className="h-1.5 w-1.5 rounded-full border border-muted-foreground/50 bg-muted/40" />
                                Todo
                              </h3>
                              <span className="text-[10px] font-bold text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                                {todoItems.length}
                              </span>
                            </div>
                            <div
                              className={cn(
                                "flex flex-col flex-1",
                                viewMode === "board"
                                  ? "overflow-y-auto max-h-[700px] scrollbar-none px-1"
                                  : "px-0 overflow-visible",
                              )}
                            >
                              {todoItems.length === 0 ? (
                                <div className="py-8 text-center text-xs text-muted-foreground/60">
                                  No pending stories
                                </div>
                              ) : (
                                todoItems.map((item, idx) => renderItem(item, idx, "todo", viewMode))
                              )}
                              {provided.placeholder}
                            </div>
                          </div>
                        )}
                      </Droppable>

                      {/* Column: Ready to Build */}
                      <Droppable droppableId="inprogress" isDropDisabled={viewMode !== "board"}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn(
                              "flex flex-col",
                              viewMode === "board"
                                ? "min-h-[500px] bg-transparent"
                                : "min-h-0 bg-transparent mt-4",
                            )}
                          >
                            <div
                              className={cn(
                                "flex items-center justify-between shrink-0 mb-3",
                                viewMode === "board" ? "px-1" : "px-2 pb-2",
                              )}
                            >
                              <h3 className="text-[12.5px] font-semibold text-foreground flex items-center gap-1.5">
                                <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                Ready to Build
                              </h3>
                              <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                {inProgressItems.length}
                              </span>
                            </div>
                            <div
                              className={cn(
                                "flex flex-col flex-1",
                                viewMode === "board"
                                  ? "overflow-y-auto max-h-[700px] scrollbar-none px-1"
                                  : "px-0 overflow-visible",
                              )}
                            >
                              {inProgressItems.length === 0 ? (
                                <div className="py-8 text-center text-xs text-muted-foreground/60">
                                  No active tasks
                                </div>
                              ) : (
                                inProgressItems.map((item, idx) => renderItem(item, idx, "inprogress", viewMode))
                              )}
                              {provided.placeholder}
                            </div>
                          </div>
                        )}
                      </Droppable>

                      {/* Column: Done */}
                      <Droppable droppableId="done" isDropDisabled={viewMode !== "board"}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn(
                              "flex flex-col",
                              viewMode === "board"
                                ? "min-h-[500px] bg-transparent"
                                : "min-h-0 bg-transparent mt-4",
                            )}
                          >
                            <div
                              className={cn(
                                "flex items-center justify-between shrink-0 mb-3",
                                viewMode === "board" ? "px-1" : "px-2 pb-2",
                              )}
                            >
                              <h3 className="text-[12.5px] font-semibold text-foreground flex items-center gap-1.5">
                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                Done
                              </h3>
                              <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                {doneItems.length}
                              </span>
                            </div>
                            <div
                              className={cn(
                                "flex flex-col flex-1",
                                viewMode === "board"
                                  ? "overflow-y-auto max-h-[700px] scrollbar-none px-1"
                                  : "px-0 overflow-visible",
                              )}
                            >
                              {doneItems.length === 0 ? (
                                <div className="py-8 text-center text-xs text-muted-foreground/60">
                                  No completed items
                                </div>
                              ) : (
                                doneItems.map((item, idx) => renderItem(item, idx, "done", viewMode))
                              )}
                              {provided.placeholder}
                            </div>
                          </div>
                        )}
                      </Droppable>
                    </div>
                  </DragDropContext>
                </div>
              )}
            </div>
          </main>
        </SidebarInset>

        {/* Right: Sidebar Chat */}
        <Sidebar side="right" variant="sidebar" className="border-l border-border hidden md:flex">
              <SidebarHeader className="p-4 border-b border-border flex items-center justify-between flex-row">
                <h3 className="text-sm font-semibold text-foreground">
                  TPM Chat
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setIsRightOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </SidebarHeader>

              <SidebarContent className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 opacity-50">
                    <MessageSquare className="h-8 w-8 mb-2" />
                    <p className="text-sm">No messages yet.</p>
                    <p className="text-xs">Ask the TPM to add a story!</p>
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex flex-col max-w-[90%]",
                        msg.role === "user" ? "self-end" : "self-start",
                      )}
                    >
                      {msg.role === "user" ? (
                        <div className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-4 py-2.5 rounded-2xl rounded-tr-sm text-[13px] leading-snug border border-zinc-200/50 dark:border-transparent">
                          {msg.content}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {msg.toolCalls && msg.toolCalls.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-1">
                              {msg.toolCalls.map((tc) => (
                                <div
                                  key={tc.id}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted border border-border text-[10px] text-muted-foreground font-mono"
                                >
                                  {tc.status === "running" ? (
                                    <Terminal className="h-3 w-3 text-amber-500 animate-pulse" />
                                  ) : (
                                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                  )}
                                  {tc.name}
                                </div>
                              ))}
                            </div>
                          )}
                          {msg.content && (
                            <div
                              className={cn(PROSE, "text-foreground text-[13px]")}
                            >
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}

              {streaming &&
                messages[messages.length - 1]?.role === "assistant" &&
                !messages[messages.length - 1]?.content && (
                  <div className="self-start flex items-center gap-1.5 py-2">
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">
                      Thinking...
                    </span>
                  </div>
                )}
              <div ref={endOfMessagesRef} />
            </SidebarContent>

            {/* Input Area */}
            <SidebarFooter className="p-4 border-t border-border shrink-0 bg-card">
              <div className="relative bg-muted/50 rounded-xl overflow-hidden focus-within:bg-muted transition-colors border border-border">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Message TPM..."
                  className="min-h-[80px] w-full resize-none bg-transparent border-0 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
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
                      onClick={() => {
                        tpmStore.abortController?.abort();
                        tpmStore.setStreaming(false);
                      }}
                    >
                      <StopCircle className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      className={cn(
                        "h-7 w-7 rounded-lg transition-all",
                        input.trim()
                          ? "bg-indigo-500 text-white hover:bg-indigo-600"
                          : "bg-muted text-muted-foreground/30 hover:bg-muted/80",
                      )}
                      onClick={onSend}
                      disabled={!input.trim()}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </SidebarFooter>
          </Sidebar>
        </SidebarProvider>
    </SidebarProvider>
  );
}
