'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Check, ChevronDown, ChevronRight, Loader2, Rocket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, ListStoryRowProps } from './types';
import { storyStatusMap } from './constants';
import { getEffectiveStatus, getSlug, getRelatedStories } from './utils';

export function ListStoryRow({
  item,
  expanded,
  onToggleExpand,
  onSelect,
  onValidate,
  onBuild,
  onToggleTask,
  updatingTaskId,
  activeAction,
  allStories,
  bootstrapped = true
}: ListStoryRowProps) {
  const name = item.name || item.metadata?.name || item.feature?.name || item.dbName || item.file;
  const isFeature = item.kind === 'FeatureStory' || !!item.feature;
  const effectiveStatus = getEffectiveStatus(item);
  const statusCfg = storyStatusMap[effectiveStatus] || storyStatusMap.unknown;
  const hasTasks = item.checklistTasks && item.checklistTasks.length > 0;
  const isActionLoading = !!(activeAction && activeAction.file === item.file);
  const isDone = effectiveStatus === 'done' || effectiveStatus === 'completed';

  // Pending deps — shown inline in name only
  const { prerequisites } = getRelatedStories(item, allStories || []);
  const pendingPrereqs = prerequisites.filter(p => {
    const s = getEffectiveStatus(p);
    return s !== 'done' && s !== 'completed';
  });
  const targetApp = item.target?.app || item.targetApp;
  let isScaffoldGated = false;
  if (isFeature && targetApp && !bootstrapped) {
    const parentApp = allStories?.find(s =>
      s.kind === 'AppStory' && (getSlug(s.file) === getSlug(targetApp) || s.metadata?.slug === targetApp)
    );
    const parentStatus = parentApp ? getEffectiveStatus(parentApp) : 'unknown';
    isScaffoldGated = parentStatus !== 'done' && parentStatus !== 'completed';
  }
  const totalPendingDeps = (isScaffoldGated ? 1 : 0) + pendingPrereqs.length;

  return (
    <div className="overflow-hidden">
      {/* ── Single-line row ── */}
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/20 transition-colors group">
        {/* Expand chevron */}
        {hasTasks ? (
          <button
            onClick={onToggleExpand}
            className="h-4 w-4 flex items-center justify-center text-muted-foreground/40 hover:text-foreground shrink-0"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <div className="w-4 shrink-0" />
        )}

        {/* Name */}
        <span
          onClick={() => onSelect(item, 'story')}
          className="flex-1 text-xs font-medium text-foreground hover:text-primary cursor-pointer truncate min-w-0"
          title={name}
        >
          {name.replace('features/', '')}
          {totalPendingDeps > 0 && !isDone && (
            <span className="ml-1.5 text-[9px] text-amber-400/60 font-normal">
              · {totalPendingDeps} dep{totalPendingDeps > 1 ? 's' : ''} pending
            </span>
          )}
        </span>

        {/* Prioritization */}
        {item.phase !== undefined && (
          <Badge variant="outline" className="text-[8px] font-semibold h-4 px-1.5 rounded border-border bg-muted/20 shrink-0 select-none leading-none flex items-center text-muted-foreground/80">
            Phase {item.phase}
          </Badge>
        )}
        {item.priority !== undefined && (
          <Badge variant="outline" className="text-[8px] font-bold h-4 px-1.5 rounded border-amber-500/20 text-amber-500 bg-amber-500/5 shrink-0 select-none leading-none flex items-center">
            P{item.priority}
          </Badge>
        )}

        {/* Status badge */}
        <Badge className={cn("text-[8px] font-bold h-4 px-1.5 rounded border shrink-0 select-none", statusCfg.bg)}>
          {statusCfg.label}
        </Badge>

        {/* Rocket — hover-only, hidden when done */}
        {!isDone ? (
          <button
            disabled={isActionLoading}
            onClick={() => onBuild(item.file, item.kind || 'AppStory')}
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/30 hover:text-primary hover:bg-primary/10 transition-all shrink-0 opacity-0 group-hover:opacity-100"
            title="Build"
          >
            {isActionLoading && activeAction?.type === 'build'
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Rocket className="h-3 w-3" />}
          </button>
        ) : (
          <div className="w-5 shrink-0" />
        )}
      </div>

      {/* ── Expanded checklist panel ── */}
      {expanded && hasTasks && (
        <div className="px-8 pb-2 pt-1 bg-muted/10 border-t border-border/20 space-y-0.5">
          {item.checklistTasks.map((task: Task) => {
            const isComp = task.status === 'done';
            return (
              <div key={task.fullId} className="flex items-center gap-2 py-0.5">
                <button
                  disabled={updatingTaskId !== null}
                  onClick={() => onToggleTask(task.fullId, isComp ? 'ready-to-build' : 'done')}
                  className={cn(
                    "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 transition-all",
                    isComp ? "bg-emerald-500 border-emerald-500 text-white" : "border-border/60 hover:border-muted-foreground"
                  )}
                >
                  {isComp && <Check className="h-2 w-2 stroke-[3]" />}
                </button>
                <span
                  onClick={() => onSelect(task, 'task', item, item.epicParent)}
                  className={cn(
                    "text-[10px] cursor-pointer truncate flex-1",
                    isComp ? "text-muted-foreground/40 line-through" : "text-foreground hover:text-primary"
                  )}
                >
                  <span className="font-mono text-[8px] text-muted-foreground/30 mr-1">{task.id}</span>
                  {task.title}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
