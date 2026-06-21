'use client';

import React, { useRef, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  Square, Terminal, XCircle, RefreshCw, X, Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import type { QueueItem, QueueStats, EpicColor } from './types';
import { storyStatusMap } from './constants';
import { getSlug } from './utils';

// ─── Props ───

export interface QueueTimelineViewProps {
  queueItems: QueueItem[];
  queueRunning: boolean;
  buildOutput: string;
  selectedQueueItemId: string | null;
  onSelectItem: (id: string) => void;
  buildLogsOpen: boolean;
  onBuildLogsOpenChange: (open: boolean) => void;
  onStartQueue: () => void;
  onStopQueue: () => void;
  onClearQueue: () => void;
  onRetryItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onNavigateToBuild?: () => void;
  /** Enriched stories list used to resolve human-readable names & epic colors */
  mergedStories: any[];
  /** Map of epic id → color config for left-border + badge tints */
  epicColorMap: Map<string, EpicColor>;
  /** Pre-computed queue statistics */
  queueStats: QueueStats;
}

// ─── Component ───

export function QueueTimelineView({
  queueItems,
  queueRunning,
  buildOutput,
  selectedQueueItemId,
  onSelectItem,
  buildLogsOpen,
  onBuildLogsOpenChange,
  onStartQueue: _onStartQueue,
  onStopQueue,
  onClearQueue,
  onRetryItem,
  onRemoveItem,
  onNavigateToBuild: _onNavigateToBuild,
  mergedStories,
  epicColorMap,
  queueStats,
}: QueueTimelineViewProps) {
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Resolve the currently selected item & its display metadata
  const selectedQueueItem = useMemo(
    () => queueItems.find(i => i.id === selectedQueueItemId) ?? null,
    [queueItems, selectedQueueItemId],
  );

  const selectedMatchedStory = useMemo(() => {
    if (!selectedQueueItem) return undefined;
    const specName = selectedQueueItem.storyFile || selectedQueueItem.specFile || '';
    return mergedStories.find(s => s.file === specName || getSlug(s.file) === getSlug(specName));
  }, [selectedQueueItem, mergedStories]);

  // For running items: use live streamed log. For others: use stored output.
  const panelLog = selectedQueueItem
    ? (selectedQueueItem.status === 'running'
      ? (buildOutput || selectedQueueItem.output || '')
      : (selectedQueueItem.output || selectedQueueItem.error || ''))
    : (buildOutput || '');

  const panelLabel = selectedQueueItem
    ? (selectedMatchedStory?.name
      || selectedMatchedStory?.metadata?.name
      || selectedMatchedStory?.feature?.name
      || selectedMatchedStory?.dbName
      || (selectedQueueItem as any).displayName
      || selectedQueueItem.storyFile?.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '')
      || 'Select a build')
    : 'Live agent log console';

  const isSelectedRunning = selectedQueueItem?.status === 'running';

  return (
    <div className="max-w-3xl mx-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Queue Timeline — chronological list of items */}
      <Card className="border border-border/80 bg-background/55 backdrop-blur-md shadow-lg overflow-hidden w-full h-[500px] md:h-[calc(100vh-170px)] flex flex-col">
        <CardHeader className="border-b border-border/50 p-4 shrink-0 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-foreground">Build Timeline</CardTitle>
            <CardDescription className="text-[11px] text-muted-foreground mt-0.5">
              {queueStats.total} total · {queueStats['ready-to-build']} pending · {queueStats.building} running · {queueStats.done} done · {queueStats.failed} failed
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={onClearQueue} className="h-7 text-[10px] gap-1 px-2.5 border-border rounded-md hover:bg-muted/80">
              <XCircle className="h-3 w-3" />
              Clear
            </Button>
            {queueRunning && (
              <Button variant="destructive" size="sm" onClick={onStopQueue} className="h-7 text-[10px] gap-1 px-2.5 rounded-md">
                <Square className="h-3 w-3" />
                Stop
              </Button>
            )}
          </div>
        </CardHeader>
        <ScrollArea className="flex-1">
          {queueItems.length > 0 ? (
            <div className="p-3 space-y-2.5">
                {queueItems.map((item, idx) => {
                  const specName = item.storyFile || item.specFile || '';
                  const isRunning = item.status === 'building' || item.status === 'running';
                  const isFailed = item.status === 'failed';
                  const isDone = item.status === 'done';
                  const isSelected = item.id === selectedQueueItemId;
                  const matchedStory = mergedStories.find(s => s.file === specName || getSlug(s.file) === getSlug(specName));
                  const humanReadableName = matchedStory?.name || matchedStory?.metadata?.name || matchedStory?.feature?.name || matchedStory?.dbName || (item as any).displayName || specName.replace(/^(features|apps|done)\//, '').replace(/\.ya?ml$/, '') || `Queue item ${idx + 1}`;
                  const epicParent = matchedStory?.epicParent;
                  const epicColor = epicParent ? epicColorMap.get(epicParent.id) : undefined;
                  const desc = matchedStory?.metadata?.description || matchedStory?.feature?.description || '';
                  const totalTasks = matchedStory?.checklistTasks?.length || 0;
                  const doneTasks = matchedStory?.checklistTasks?.filter((t: any) => t.status === 'done').length || 0;
                  const durationSec = item.durationMs ? Math.round(item.durationMs / 1000) : null;
                  const statusCfg = isRunning ? storyStatusMap.building : isFailed ? storyStatusMap.failed : isDone ? storyStatusMap.done : storyStatusMap.draft;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "rounded-xl border transition-all duration-150 cursor-pointer overflow-hidden",
                        isRunning && "border-primary/40 bg-primary/5 shadow-sm",
                        isFailed && "border-rose-500/30 bg-rose-500/5",
                        isDone && "border-emerald-500/20 bg-emerald-500/5",
                        !isRunning && !isFailed && !isDone && "border-border/50 bg-background/40",
                        isSelected && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
                        epicColor && "border-l-2",
                        epicColor?.border
                      )}
                      onClick={() => { onSelectItem(item.id); onBuildLogsOpenChange(true); }}
                    >
                      <div className="p-3">
                        {/* Top row: name + live dot + actions */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-xs text-foreground truncate" title={humanReadableName}>
                                {humanReadableName}
                              </span>
                              {isRunning && (
                                <span className="relative flex h-1.5 w-1.5 shrink-0">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                                </span>
                              )}
                            </div>
                            {desc && (
                              <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5 leading-normal">{desc}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                            {(isFailed || isDone || item.status === 'paused' || item.status === 'blocked') && (
                              <Button size="icon" variant="ghost" title="Rebuild" className="h-5 w-5 text-primary hover:bg-primary/10 rounded" onClick={() => onRetryItem(item.id)}>
                                <RefreshCw className="h-3 w-3" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded" onClick={() => onRemoveItem(item.id)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Bottom meta row */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge variant="outline" className={cn("text-[8px] font-bold h-4 px-1.5 rounded uppercase border", statusCfg.bg)}>
                            {statusCfg.label}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{item.kind?.replace('Story', '') || 'Story'}</span>
                          {epicParent && epicColor && (
                            <Badge variant="outline" className={cn("text-[8px] font-bold h-4 px-1.5 rounded border", epicColor.badge)}>
                              {epicParent.name}
                            </Badge>
                          )}
                          {totalTasks > 0 && (
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {doneTasks}/{totalTasks} tasks
                            </span>
                          )}
                          {durationSec !== null && isDone && (
                            <span className="text-[10px] text-muted-foreground ml-auto">{durationSec}s</span>
                          )}
                          {item.addedAt && (
                            <span title={item.addedAt} className="text-[10px] text-muted-foreground ml-auto">
                              {new Date(item.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {(item.output || item.error) && (
                            <span title="Has logs" className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center text-muted-foreground px-4">
              <Package className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-xs font-semibold text-foreground">Queue is empty</p>
              <p className="text-[11px] text-muted-foreground max-w-xs mt-1">
                Click <strong>Build Ready Stories</strong> on the board or hit the rocket icon on any story card.
              </p>
            </div>
          )}

        </ScrollArea>
      </Card>

      {/* Build Queue Logs Sliding Drawer */}
      <Sheet open={buildLogsOpen} onOpenChange={onBuildLogsOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl bg-zinc-950 border-l border-border/40 shadow-2xl flex flex-col p-0 overflow-hidden text-zinc-300 font-mono focus:outline-none select-none">
          <div className="bg-zinc-900 border-b border-border/40 px-4 py-3 shrink-0 flex items-center justify-between">
            <span className="flex items-center gap-2 text-zinc-300 text-xs font-bold font-mono min-w-0">
              <Terminal className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate" title={panelLabel}>{panelLabel}</span>
              {isSelectedRunning && (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              )}
              {selectedQueueItem && !isSelectedRunning && (
                <Badge variant="outline" className={cn(
                  "text-[8px] font-bold h-4 px-1.5 rounded uppercase border ml-1 shrink-0",
                  selectedQueueItem.status === 'failed' ? "bg-rose-500/10 text-rose-400 border-rose-500/25" :
                  selectedQueueItem.status === 'done' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" :
                  "bg-muted border-border text-muted-foreground"
                )}>
                  {selectedQueueItem.status}
                </Badge>
              )}
            </span>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                {isSelectedRunning ? 'live' : selectedQueueItem ? 'stored log' : 'idle'}
              </span>
              {selectedQueueItem && !isSelectedRunning && (selectedQueueItem.status === 'done' || selectedQueueItem.status === 'failed') && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] text-primary hover:bg-primary/10 rounded gap-1"
                  onClick={() => { onRetryItem(selectedQueueItem.id); onBuildLogsOpenChange(false); }}
                >
                  <RefreshCw className="h-3 w-3" />
                  Rebuild
                </Button>
              )}
              {selectedQueueItem && !isSelectedRunning && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded gap-1"
                  onClick={() => { onRemoveItem(selectedQueueItem.id); onBuildLogsOpenChange(false); }}
                >
                  <X className="h-3 w-3" />
                  Remove
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-zinc-300 space-y-1 select-text scrollbar-thin scrollbar-thumb-zinc-800">
            {panelLog ? (
              panelLog.split('\n').map((l: string, i: number) => (
                <div key={i} className="leading-5 whitespace-pre-wrap">{l || '\u00A0'}</div>
              ))
            ) : (
              <div className="text-zinc-500 italic py-6 text-center">
                {selectedQueueItem
                  ? `No logs captured for this ${selectedQueueItem.kind.replace('Story', '')} build yet.`
                  : 'Select a build item from the timeline to view its logs.'}
              </div>
            )}
            <div ref={terminalEndRef} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
