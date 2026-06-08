'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EpicColor } from './types';
import { storyStatusMap } from './constants';
import { getEffectiveStatus, getSlug, getStorySlugs, getRelatedStories } from './utils';

export function StoryKanbanCard({
  item,
  epicColor,
  onSelect,
  onValidate,
  onBuild,
  activeAction,
  allStories,
  bootstrapped = true
}: {
  item: any;
  epicColor?: EpicColor;
  onSelect: (item: any, type: 'task' | 'story', parentStory?: any, parentFeature?: any) => void;
  onValidate: (file: string, kind: string) => void;
  onBuild: (file: string, kind: string) => void;
  activeAction: { type: string; file: string } | null;
  allStories?: any[];
  bootstrapped?: boolean;
}) {
  const name = item.name || item.metadata?.name || item.feature?.name || item.dbName || item.file;
  const effectiveStatus = getEffectiveStatus(item);
  const statusCfg = storyStatusMap[effectiveStatus] || storyStatusMap.unknown;
  const totalTasks = item.checklistTasks ? item.checklistTasks.length : 0;
  const doneTasks = item.checklistTasks ? item.checklistTasks.filter((t: any) => t.status === 'completed').length : 0;
  const desc = item.metadata?.description || item.feature?.description || '';
  const isActive = effectiveStatus === 'building';

  // Architect-level Gating Visualizer: Check if base app scaffold exists and if there are pending prerequisites
  const targetApp = item.target?.app || item.targetApp;
  const isFeature = item.kind === 'FeatureStory' || !!item.feature;
  let isScaffoldGated = false;
  if (isFeature && targetApp && !bootstrapped) {
    const parentApp = allStories?.find(s => 
      s.kind === 'AppStory' && (getSlug(s.file) === getSlug(targetApp) || s.metadata?.slug === targetApp)
    );
    const parentStatus = parentApp ? getEffectiveStatus(parentApp) : 'unknown';
    isScaffoldGated = parentStatus !== 'done';
  }

  const { prerequisites } = getRelatedStories(item, allStories || []);
  const pendingPrereqs = prerequisites.filter(p => {
    const s = getEffectiveStatus(p);
    return s !== 'done';
  });
  const isPrereqGated = pendingPrereqs.length > 0;

  return (
    <div
      onClick={() => onSelect(item, 'story')}
      className={cn(
        "group flex flex-col gap-1.5 px-3 py-2.5 cursor-pointer select-none transition-colors border-b border-border/30 last:border-b-0 border-l-2 hover:bg-muted/40",
        item.placeholder && "opacity-50",
        isActive && "bg-primary/5 border-l-primary",
        !isActive && (epicColor?.border?.replace('border-l-', 'border-l-') || "border-l-border/40")
      )}
    >
      {/* Name + status dot */}
      <div className="flex items-start justify-between gap-1.5">
        <span className="font-medium text-xs text-foreground group-hover:text-primary transition-colors leading-snug line-clamp-2 flex-1" title={name}>
          {name.replace('features/', '')}
        </span>
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 mt-1", statusCfg.dot)} title={statusCfg.label} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {item.epicParent && epicColor && (
          <Badge variant="outline" className={cn("text-[7.5px] font-semibold h-3.5 px-1.5 rounded border leading-none shrink-0", epicColor.badge)}>
            {item.epicParent.name}
          </Badge>
        )}
        {item.phase !== undefined && (
          <Badge variant="outline" className="text-[7.5px] font-semibold h-3.5 px-1 rounded border-border bg-muted/20 shrink-0 leading-none flex items-center">
            Phase {item.phase}
          </Badge>
        )}
        {item.priority !== undefined && (
          <Badge variant="outline" className="text-[7.5px] font-extrabold h-3.5 px-1 rounded border-amber-500/20 text-amber-500 bg-amber-500/5 shrink-0 leading-none flex items-center">
            P{item.priority}
          </Badge>
        )}
        {/* Dependency tree badge — replaces 'Gated' / 'N pending' labels */}
        {(isScaffoldGated || isPrereqGated) && effectiveStatus !== 'done' && (() => {
          // Total unbuilt deps = scaffold (1 if gated) + pending prereqs
          const total = (isScaffoldGated ? 1 : 0) + pendingPrereqs.length;
          return (
            <span
              className="inline-flex items-center gap-0.5 text-[8px] font-semibold text-amber-400/90 shrink-0"
              title={[
                isScaffoldGated ? 'Scaffold not built yet' : '',
                pendingPrereqs.length > 0 ? `${pendingPrereqs.length} prerequisite${pendingPrereqs.length > 1 ? 's' : ''} pending` : '',
              ].filter(Boolean).join(' · ')}
            >
              {/* Minimal tree icon */}
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-amber-400/80" aria-hidden>
                <circle cx="6" cy="2" r="1.5"/>
                <circle cx="2.5" cy="8" r="1.5"/>
                <circle cx="9.5" cy="8" r="1.5"/>
                <line x1="6" y1="3.5" x2="6" y2="6" stroke="currentColor" strokeWidth="1"/>
                <line x1="6" y1="6" x2="2.5" y2="6.5" stroke="currentColor" strokeWidth="1"/>
                <line x1="6" y1="6" x2="9.5" y2="6.5" stroke="currentColor" strokeWidth="1"/>
              </svg>
              {total}
            </span>
          );
        })()}
        {totalTasks > 0 && (
          <span className="text-[9px] text-muted-foreground/50 ml-auto font-mono tabular-nums">{doneTasks}/{totalTasks}</span>
        )}
      </div>

      {/* Dependencies */}
      {item.dependsOn && item.dependsOn.length > 0 && (
        <div className="flex items-center gap-1 overflow-hidden">
          <Link2 className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
          <div className="flex flex-wrap gap-1 min-w-0">
            {item.dependsOn.map((depSlug: string) => {
              const depStory = allStories?.find(s => getStorySlugs(s).includes(depSlug));
              const status = depStory ? getEffectiveStatus(depStory) : 'unknown';
              const depColor = status === 'done'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                : status === 'building'
                ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25'
                : 'bg-muted/50 text-muted-foreground border-border';
              return (
                <Badge
                  key={depSlug}
                  variant="outline"
                  className={cn("text-[8px] font-medium h-3.5 px-1 rounded-xs cursor-pointer select-none transition-colors hover:bg-muted/60 max-w-[100px] truncate", depColor)}
                  onClick={(e) => { e.stopPropagation(); if (depStory) onSelect(depStory, 'story'); }}
                  title={`${depSlug} (${status})`}
                >
                  {depSlug}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
