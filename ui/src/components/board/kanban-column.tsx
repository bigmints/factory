'use client';

import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { KanbanColumnProps } from './types';
import { getSlug, getRelatedStories } from './utils';
import { StoryKanbanCard } from './story-kanban-card';

export function KanbanColumn({
  title,
  description,
  badgeColor,
  stories,
  epicColorMap,
  onSelect,
  onValidate,
  onBuild,
  activeAction,
  allStories,
  bootstrapped = true,
  scaffoldStoryFile,
}: KanbanColumnProps) {
  // Group stories into clusters of related items using their prerequisite, dependent, and peer links
  const clusters = useMemo(() => {
    if (!stories || stories.length === 0) return [];
    
    // Only group stories in "Ready to Build" column to keep the interface simple and clean.
    if (title !== 'Ready to Build') {
      return stories.map(s => [s]);
    }
    
    const pool = allStories || stories;
    
    const visited = new Set<string>();
    const result: any[][] = [];

    const getStoryBySlug = (slug: string) => {
      return stories.find(s => getSlug(s.file) === slug);
    };

    stories.forEach(story => {
      const slug = getSlug(story.file);
      if (visited.has(slug)) return;

      const cluster: any[] = [];
      const queue: any[] = [story];
      visited.add(slug);

      while (queue.length > 0) {
        const current = queue.shift();
        cluster.push(current);

        const { prerequisites, dependents, peers } = getRelatedStories(current, pool);
        const related = [...prerequisites, ...dependents, ...peers];

        related.forEach(rel => {
          const relSlug = getSlug(rel.file);
          const storyInCol = getStoryBySlug(relSlug);
          if (storyInCol && !visited.has(relSlug)) {
            visited.add(relSlug);
            queue.push(storyInCol);
          }
        });
      }
      result.push(cluster);
    });

    // Sort stories within each cluster in execution order by their index in the input stories array
    const sortedResult = result.map(cluster => {
      return [...cluster].sort((a, b) => {
        const idxA = stories.findIndex(s => getSlug(s.file) === getSlug(a.file));
        const idxB = stories.findIndex(s => getSlug(s.file) === getSlug(b.file));
        return idxA - idxB;
      });
    });

    // Sort the clusters themselves based on the original index of their first story
    return sortedResult.sort((a, b) => {
      const idxA = stories.findIndex(s => getSlug(s.file) === getSlug(a[0].file));
      const idxB = stories.findIndex(s => getSlug(s.file) === getSlug(b[0].file));
      return idxA - idxB;
    });
  }, [stories, allStories, title]);

  return (
    <div
      className="flex flex-col h-full bg-muted/30 border border-border/40 rounded-xl overflow-hidden transition-all duration-300 hover:bg-muted/40"
    >
      {/* Header info */}
      <div className="p-4 bg-muted/20 border-b border-border/30 space-y-1 shrink-0 select-none">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-foreground/90 tracking-tight">{title}</h2>
          <Badge variant="outline" className={cn("text-[9px] font-bold px-2.5 h-4.5 rounded-full border backdrop-blur-md select-none", badgeColor)}>
            {stories.length}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground/60 leading-normal line-clamp-1">{description}</p>
      </div>


      {/* Story list */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/20 scrollbar-thin scrollbar-thumb-muted-foreground/10 scrollbar-track-transparent">
        {clusters.length > 0 ? (
          clusters.map((cluster, clusterIdx) => {
            if (cluster.length === 1) {
              const item = cluster[0];
              return (
                <StoryKanbanCard
                  key={item.file}
                  item={item}
                  epicColor={item.epicParent ? epicColorMap.get(item.epicParent.id) : undefined}
                  onSelect={onSelect}
                  onValidate={onValidate}
                  onBuild={onBuild}
                  activeAction={activeAction}
                  allStories={allStories}
                  bootstrapped={bootstrapped}
                />
              );
            }

            // Cluster group
            return (
              <div key={`cluster-${clusterIdx}-${cluster[0].file}`}>
                {/* Group label */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/30">
                  <span className="text-[9px] text-muted-foreground/50 font-semibold uppercase tracking-wider">Build Sequence</span>
                  <span className="text-[9px] text-muted-foreground/40">{cluster.length} items</span>
                </div>
                <div>
                  {cluster.map((item) => (
                    <StoryKanbanCard
                      key={item.file}
                      item={item}
                      epicColor={item.epicParent ? epicColorMap.get(item.epicParent.id) : undefined}
                      onSelect={onSelect}
                      onValidate={onValidate}
                      onBuild={onBuild}
                      activeAction={activeAction}
                      allStories={allStories}
                      bootstrapped={bootstrapped}
                    />
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="h-32 border border-dashed border-border/60 rounded-xl flex items-center justify-center text-center p-4 select-none">
            <span className="text-[10px] text-muted-foreground/50 italic font-semibold">Column empty</span>
          </div>
        )}
      </div>
    </div>
  );
}
