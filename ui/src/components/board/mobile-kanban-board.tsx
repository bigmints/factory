'use client';

import React, { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { EPIC_COLORS } from './constants';
import { KanbanColumn } from './kanban-column';

export function MobileKanbanBoard({
  backlogStories, readyStories, buildingStories, doneStories,
  mergedStories, epicColorMap,
  handleOpenDrawer, handleValidateStory, handleSingleBuild, activeAction,
  showEpicLegend, appRollup, bootstrapped, scaffoldStoryFile,
}: {
  backlogStories: any[]; readyStories: any[]; buildingStories: any[]; doneStories: any[];
  mergedStories: any[]; epicColorMap: Map<string, any>;
  handleOpenDrawer: any; handleValidateStory: any; handleSingleBuild: any; activeAction: any;
  showEpicLegend: boolean; appRollup: any;
  bootstrapped: boolean; scaffoldStoryFile: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeCol, setActiveCol] = useState(0);

  const COLS = [
    { title: 'Backlog', desc: 'Scaffold drafts or spec blueprints', badge: 'bg-amber-500/5 text-amber-300 border-amber-500/10', stories: backlogStories, status: 'draft', dot: 'bg-amber-400' },
    { title: 'Ready to Build', desc: 'Verified specifications awaiting launch', badge: 'bg-teal-500/5 text-teal-300 border-teal-500/10', stories: readyStories, status: 'ready', dot: 'bg-teal-400' },
    { title: 'In Progress', desc: 'Actively compiling or iterating', badge: 'bg-blue-500/5 text-blue-300 border-blue-500/10', stories: buildingStories, status: 'in-progress', dot: 'bg-blue-400' },
    { title: 'Completed', desc: 'Code written and tests passed', badge: 'bg-emerald-500/5 text-emerald-300 border-emerald-500/10', stories: doneStories, status: 'done', dot: 'bg-emerald-400' },
  ] as const;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const colWidth = el.scrollWidth / COLS.length;
    const idx = Math.round(el.scrollLeft / colWidth);
    setActiveCol(Math.max(0, Math.min(COLS.length - 1, idx)));
  };

  // Scroll to a column on dot click
  const scrollToCol = (i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const colWidth = el.scrollWidth / COLS.length;
    el.scrollTo({ left: i * colWidth, behavior: 'smooth' });
  };

  return (
    <div className="space-y-3">
      {/* Epic Legend (desktop only, mobile would be too crowded) */}
      {showEpicLegend && appRollup?.features && appRollup.features.length > 0 && (
        <div className="shrink-0 hidden md:flex flex-wrap items-center gap-2 px-3 py-2 mb-3 bg-muted/15 border border-border/40 rounded-xl select-none">
          <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/70 shrink-0">Epic Colors:</span>
          {appRollup.features.map((f: any, idx: number) => {
            const swatchColors = ['#8b5cf6','#0ea5e9','#f59e0b','#f43f5e','#14b8a6','#d946ef','#84cc16','#f97316'];
            const color = EPIC_COLORS[idx % EPIC_COLORS.length];
            return (
              <span key={f.id} className="flex items-center gap-1.5 text-[10px] text-foreground">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: swatchColors[idx % swatchColors.length] }} />
                <span className="font-medium">{f.name}</span>
                <Badge variant="outline" className={cn('text-[7.5px] font-bold h-3.5 px-1 rounded border ml-0.5', color.badge)}>
                  {f.stories?.length ?? 0} stories
                </Badge>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Desktop: 4-column Kanban (view-only) ── */}
      <div className="hidden md:grid md:grid-cols-2 xl:grid-cols-4 gap-4" style={{ height: 'calc(100vh - 220px)' }}>
        {COLS.map((col) => (
          <KanbanColumn
            key={col.title}
            title={col.title}
            description={col.desc}
            badgeColor={col.badge}
            stories={col.stories}
            epicColorMap={epicColorMap}
            onSelect={handleOpenDrawer}
            onValidate={handleValidateStory}
            onBuild={handleSingleBuild}
            activeAction={activeAction}
            allStories={mergedStories}
            bootstrapped={bootstrapped}
            scaffoldStoryFile={scaffoldStoryFile}
          />
        ))}
      </div>

      {/* ── Mobile: full-height horizontal snap carousel ── */}
      <div
        className="flex md:hidden flex-col"
        style={{
          height: 'calc(100dvh - 176px - env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Column dot indicator */}
        <div className="flex items-center justify-center gap-2 pb-2 shrink-0">
          {COLS.map((col, i) => (
            <button
              key={col.title}
              onClick={() => scrollToCol(i)}
              className="flex flex-col items-center gap-1 tap-shrink"
            >
              <div className={cn(
                'rounded-full transition-all duration-300',
                activeCol === i
                  ? `h-2 w-6 ${col.dot}`
                  : 'h-1.5 w-1.5 bg-muted-foreground/30'
              )} />
            </button>
          ))}
          <span className="text-[9px] text-muted-foreground/40 ml-1 font-medium">
            {COLS[activeCol].title}
          </span>
        </div>

        {/* Scrollable columns — each takes full screen width */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex flex-1 min-h-0 overflow-x-auto snap-x-mandatory gap-0"
          style={{ scrollbarWidth: 'none' } as React.CSSProperties}
        >
          {COLS.map((col, i) => (
            <div
              key={col.title}
              className="kanban-slide snap-center px-1"
            >
              <KanbanColumn
                title={col.title}
                description={col.desc}
                badgeColor={col.badge}
                stories={col.stories}
                epicColorMap={epicColorMap}
                onSelect={handleOpenDrawer}
                onValidate={handleValidateStory}
                onBuild={handleSingleBuild}
                activeAction={activeAction}
                allStories={mergedStories}
                bootstrapped={bootstrapped}
                scaffoldStoryFile={scaffoldStoryFile}
              />
            </div>
          ))}
        </div>


    </div>
    </div>
  );
}
