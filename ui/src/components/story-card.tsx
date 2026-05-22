'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface StoryData {
  file: string;
  kind?: 'AppStory' | 'FeatureStory' | 'AppSpec' | 'FeatureSpec';
  valid: boolean;
  status: string;
  metadata?: {
    name?: string;
    slug?: string;
    description?: string;
    icon?: string;
    color?: string;
    group?: string;
  };
  deployment?: {
    port?: number;
    region?: string;
    customDomain?: string;
  };
  database?: {
    firestoreId?: string;
    collections?: string[];
  };
  api?: {
    resources?: Array<{ name: string }>;
  };
  // For feature stories
  feature?: {
    name?: string;
    description?: string;
  };
  target?: {
    app?: string;
  };
  pages?: any[];
  model?: {
    collection?: string;
  };
  phase?: number;
  dependsOn?: string[];
}

interface StoryCardProps {
  story: StoryData;
  onValidate: (file: string) => void;
  onBuild: (file: string) => void;
  onEnqueue?: (file: string, kind: string, extra?: any) => void;
  onView?: (file: string, name: string) => void;
  isValidating?: boolean;
  isBuilding?: boolean;
  queueStatus?: string;
}

export function StoryCard({
  story,
  onValidate,
  onBuild,
  onEnqueue,
  onView,
  isValidating,
  isBuilding,
  queueStatus,
}: StoryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isFeature = story.kind === 'FeatureStory' || story.kind === 'FeatureSpec' || !!story.feature;
  const name = isFeature ? (story.feature?.name || story.file) : (story.metadata?.name || story.file);
  const slug = isFeature ? `→ ${story.target?.app || 'app'}` : `@factory/${story.metadata?.slug || 'app'}`;
  const icon = isFeature ? (story.metadata?.icon || '🧩') : (story.metadata?.icon || '📦');
  const description = isFeature ? story.feature?.description : story.metadata?.description;
  const isSequenced = isFeature && !!(story.phase || (story.dependsOn && story.dependsOn.length > 0));

  return (
    <div className="flex flex-col hover:bg-muted/20 transition-colors duration-150">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4">
        {/* Left info */}
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <span className={cn(
            "h-2 w-2 rounded-full shrink-0 transition-all",
            story.status === 'ready' || story.status === 'done' ? "bg-emerald-500" :
            story.status === 'in-progress' || story.status === 'running' ? "bg-blue-500 animate-pulse" :
            story.status === 'failed' ? "bg-red-500" : "bg-muted-foreground/30"
          )} />
          <span className="text-lg shrink-0 select-none">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground truncate">{name}</span>
              <Badge variant={isFeature ? "secondary" : "outline"} className="text-[9px] font-semibold h-4 px-2 rounded-full shrink-0 border-border bg-muted/40">
                {isFeature ? 'Feature' : 'App'}
              </Badge>
              {isFeature && story.phase !== undefined && (
                <Badge variant="outline" className="text-[9px] font-semibold h-4 px-2 rounded-full shrink-0 border-border">
                  Phase {story.phase}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {description || slug || "No description provided."}
            </p>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-muted/40 font-semibold border-border">
            {story.status || 'draft'}
          </Badge>
          
          <div className="h-4 w-px bg-border mx-1 hidden sm:block" />

          {onView && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onView(story.file, name)}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground font-medium rounded-md hover:bg-muted"
            >
              Edit
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => onValidate(story.file)}
            disabled={isValidating || isBuilding}
            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground font-medium rounded-md hover:bg-muted"
          >
            {isValidating ? 'Validating...' : 'Validate'}
          </Button>

          {isSequenced && !queueStatus ? (
            <span className="text-[10px] text-muted-foreground px-2 font-medium bg-muted/30 py-1 rounded">
              Sequenced
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onBuild(story.file)}
              disabled={isValidating || isBuilding}
              className="h-8 px-2.5 text-xs text-primary hover:text-primary/80 font-semibold rounded-md hover:bg-primary/5"
            >
              {isBuilding ? 'Building...' : 'Build'}
            </Button>
          )}

          {onEnqueue && !isSequenced && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEnqueue(story.file, isFeature ? 'FeatureStory' : 'AppStory', { phase: story.phase, dependsOn: story.dependsOn })}
              disabled={isValidating || isBuilding}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground font-medium rounded-md hover:bg-muted"
            >
              Queue
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md text-muted-foreground hover:bg-muted"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-6 py-4 bg-muted/20 border-t border-border/40 text-xs text-muted-foreground space-y-2.5 animate-in fade-in duration-150">
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/80">
            <span>File:</span> <span className="text-foreground">{story.file}</span>
            {slug && <span className="text-muted-foreground/40">|</span>}
            {slug && <span>Target: <span className="text-foreground">{slug}</span></span>}
          </div>
          {description && <p className="leading-relaxed text-foreground/90 max-w-2xl">{description}</p>}
          
          {/* Dependencies / database metadata */}
          {!isFeature && (story.deployment || story.database || story.api) && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1.5 border-t border-border/20">
              {story.deployment?.port && <div>Port: <span className="text-foreground font-mono">{story.deployment.port}</span></div>}
              {story.deployment?.region && <div>Region: <span className="text-foreground">{story.deployment.region}</span></div>}
              {story.database?.collections && <div>Collections: <span className="text-foreground font-mono">{(story.database.collections as unknown[]).length}</span></div>}
              {story.api?.resources && <div>API: <span className="text-foreground font-mono">{(story.api.resources as unknown[]).length} resources</span></div>}
            </div>
          )}
          {isFeature && (story.pages || story.model || story.dependsOn) && (
            <div className="flex flex-col gap-2 pt-1.5 border-t border-border/20">
              <div className="flex gap-x-6">
                {story.pages && <div>Pages: <span className="text-foreground font-mono">{story.pages.length}</span></div>}
                {story.model?.collection && <div>Model: <span className="text-foreground font-mono">{story.model.collection}</span></div>}
              </div>
              {story.dependsOn && story.dependsOn.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/75">Depends on:</span>
                  {story.dependsOn.map(dep => (
                    <Badge key={dep} variant="outline" className="text-[9px] scale-90 border-border bg-muted/40 font-mono">{dep}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
