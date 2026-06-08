'use client';

import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Eye, ListTodo, Loader2, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { storyStatusMap, EPIC_COLORS, STATUS_SORT_ORDER } from './constants';
import { getEffectiveStatus } from './utils';

// ─── FlatTaskList ─────────────────────────────────────────────────────────────
// Simple, clean flat list of all stories. No hierarchy, no kanban columns.

export function FlatTaskList({
  stories, mergedStories, epicColorMap,
  handleOpenDrawer, handleValidateStory, handleSingleBuild,
  activeAction, bootstrapped, scaffoldStoryFile,
}: {
  stories: any[];
  mergedStories: any[];
  epicColorMap: Map<string, { border: string; badge: string }>;
  handleOpenDrawer: (item: any, ...args: any[]) => void;
  handleValidateStory: (file: string, ...args: any[]) => void;
  handleSingleBuild: (file: string, ...args: any[]) => void;
  activeAction: { type: string; file: string } | null;
  bootstrapped: boolean;
  scaffoldStoryFile: string | null;
}) {
  const sorted = useMemo(() => {
    return [...stories].sort((a, b) => {
      const sa = STATUS_SORT_ORDER[getEffectiveStatus(a)] ?? 99;
      const sb = STATUS_SORT_ORDER[getEffectiveStatus(b)] ?? 99;
      if (sa !== sb) return sa - sb;
      const na = a.name || a.metadata?.name || a.feature?.name || a.file;
      const nb = b.name || b.metadata?.name || b.feature?.name || b.file;
      return na.localeCompare(nb);
    });
  }, [stories]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
        <ListTodo className="h-8 w-8 opacity-30" />
        <p className="text-sm">No tasks found. Add stories or adjust your filters.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/70 bg-background/55 backdrop-blur-md shadow-sm overflow-hidden">
      <div className="divide-y divide-border/40">
        {sorted.map((item) => {
          const status = getEffectiveStatus(item);
          const statusCfg = storyStatusMap[status] || storyStatusMap.unknown;
          const name = item.name || item.metadata?.name || item.feature?.name || item.file.split('/').pop()?.replace(/\.ya?ml$/, '') || item.file;
          const epicName = item.epicParent?.name || item.feature?.name || item.metadata?.group || null;
          const epicColor = item.epicParent?.id ? (epicColorMap.get(item.epicParent.id) || EPIC_COLORS[0]) : null;
          const phase = item.phase ?? item.metadata?.phase;
          const isBuilding = status === 'building';
          const isDone = status === 'done';
          const isReady = status === 'ready-to-build';
          const isActioning = !!(activeAction && activeAction.file === item.file);
          const isScaffold = item.file === scaffoldStoryFile;

          return (
            <div
              key={item.file}
              className={cn(
                'group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/25 cursor-pointer',
                isDone && 'opacity-60 hover:opacity-100',
              )}
              onClick={() => handleOpenDrawer(item)}
            >
              {/* Status dot */}
              <span className={cn('h-2 w-2 rounded-full shrink-0 mt-px', statusCfg.dot)} />

              {/* Name */}
              <span className={cn(
                'flex-1 min-w-0 text-[13px] font-medium truncate',
                isDone ? 'line-through text-muted-foreground' : 'text-foreground',
              )}>
                {name}
              </span>

              {/* Tags row */}
              <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                {/* Status badge */}
                <Badge className={cn('text-[9px] py-0 px-1.5 h-4 rounded border font-semibold', statusCfg.bg)}>
                  {statusCfg.label}
                </Badge>

                {/* Epic tag */}
                {epicName && epicColor && epicName !== name && (
                  <span className={cn('text-[9px] px-1.5 py-0 h-4 rounded border font-medium flex items-center', epicColor.badge)}>
                    {epicName.length > 20 ? epicName.slice(0, 20) + '…' : epicName}
                  </span>
                )}

                {/* Phase */}
                {phase != null && (
                  <span className="text-[9px] px-1.5 py-0 h-4 rounded border font-mono flex items-center bg-muted/50 text-muted-foreground border-border/50">
                    P{phase}
                  </span>
                )}

                {/* Scaffold tag */}
                {isScaffold && (
                  <span className="text-[9px] px-1.5 py-0 h-4 rounded border font-medium flex items-center bg-violet-500/10 text-violet-400 border-violet-500/20">
                    scaffold
                  </span>
                )}
              </div>

              {/* Actions — visible on hover (always visible on mobile) */}
              <div
                className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                onClick={e => e.stopPropagation()}
              >
                {isReady && !isDone && bootstrapped && (
                  <button
                    disabled={isActioning}
                    onClick={() => handleSingleBuild(item.file)}
                    title="Add to build queue"
                    className={cn(
                      'h-6 px-2 text-[10px] font-semibold rounded border transition-all flex items-center gap-1',
                      'bg-teal-500/10 border-teal-500/30 text-teal-400 hover:bg-teal-500/20 active:scale-95',
                      isActioning && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    {isActioning ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}
                    Build
                  </button>
                )}
                {isBuilding && (
                  <span className="h-6 px-2 text-[10px] font-semibold rounded border bg-blue-500/10 border-blue-500/25 text-blue-400 flex items-center gap-1">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Running
                  </span>
                )}
                <button
                  onClick={() => handleOpenDrawer(item)}
                  title="Open details"
                  className="h-6 w-6 flex items-center justify-center rounded border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Eye className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
