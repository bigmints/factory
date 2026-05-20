'use client';

import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from './status-badge';
import { cn } from '@/lib/utils';
import {
  Play,
  ShieldCheck,
  Globe,
  Database,
  Server,
  Layers,
  ListPlus,
  Eye,
  ChevronDown,
  ChevronUp,
  Puzzle,
  GitBranch,
  FileCode,
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

  // Auto-detect if this is a feature story / spec
  const isFeature = story.kind === 'FeatureStory' || story.kind === 'FeatureSpec' || !!story.feature;
  const name = isFeature ? (story.feature?.name || story.file) : (story.metadata?.name || story.file);
  const slug = isFeature ? `→ ${story.target?.app || 'app'}` : `@factory/${story.metadata?.slug || 'app'}`;
  const icon = isFeature ? (story.metadata?.icon || '🧩') : (story.metadata?.icon || '📦');
  const description = isFeature ? story.feature?.description : story.metadata?.description;
  const isSequenced = isFeature && !!(story.phase || (story.dependsOn && story.dependsOn.length > 0));

  return (
    <Card className={cn("flex flex-col justify-between overflow-hidden", expanded && "ring-1 ring-ring")}>
      {/* Header Block */}
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0 flex-1">
            <span
              className="text-xl shrink-0 p-2.5 rounded-lg select-none flex items-center justify-center bg-muted border border-border text-foreground"
            >
              {icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-sm font-semibold tracking-tight text-foreground truncate">
                  {name}
                </h3>
                <Badge
                  variant={isFeature ? "secondary" : "outline"}
                  className="text-[9px] font-semibold h-4 px-1.5 rounded-full shrink-0"
                >
                  {isFeature ? 'Feature' : 'App'}
                </Badge>
                {isFeature && story.phase !== undefined && (
                  <Badge variant="outline" className="text-[9px] font-semibold h-4 px-1.5 rounded-full shrink-0">
                    P{story.phase}
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                {slug}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusBadge status={story.status} />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground shrink-0"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Collapsible detailed story specs */}
      {expanded && (
        <CardContent>
          <div className="space-y-4 pt-4 border-t border-border animate-in fade-in slide-in-from-top-2 duration-200">
            {description && (
              <p className="text-xs text-muted-foreground leading-relaxed bg-muted p-4 rounded-lg border border-border">
                {String(description)}
              </p>
            )}

            {/* Grid of stats */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              {/* App Story Info */}
              {!isFeature && (
                <>
                  {story.deployment?.port && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                      <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium">Port {story.deployment.port}</span>
                    </div>
                  )}
                  {story.deployment?.region && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                      <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium">{story.deployment.region}</span>
                    </div>
                  )}
                  {story.database?.collections && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                      <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium">
                        {(story.database.collections as unknown[]).length} Collections
                      </span>
                    </div>
                  )}
                  {story.api?.resources && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                      <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium">
                        {(story.api.resources as unknown[]).length} Resources
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* Feature Story Info */}
              {isFeature && (
                <>
                  <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                    <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium">
                      {story.pages?.length || 0} Pages
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                    <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">
                      {String(story.model?.collection || 'No Database')}
                    </span>
                  </div>
                </>
              )}

              {/* Dependencies row */}
              {isFeature && story.dependsOn && story.dependsOn.length > 0 && (
                <div className="col-span-2 space-y-2 bg-muted p-4 rounded-lg border border-border">
                  <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Depends On Stories</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {story.dependsOn.map((dep) => (
                      <Badge
                        key={dep}
                        variant="secondary"
                        className="text-[10px] font-semibold rounded-md"
                      >
                        {dep}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      )}

      {/* Structured Footer Action Bar */}
      <CardFooter className="flex items-center gap-2 mt-auto">
        {onView && (
          <Button
            size="icon"
            variant="outline"
            onClick={() => onView(story.file, name)}
            className="h-9 w-9 p-0 rounded-md border border-border shrink-0 flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-all duration-200"
            title="View / Edit Story"
          >
            <Eye className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onValidate(story.file)}
          disabled={isValidating || isBuilding}
          className="flex-1 min-w-0 h-9 rounded-md text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-all duration-200 border border-border"
        >
          <ShieldCheck className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
          <span className="truncate">{isValidating ? 'Validating...' : 'Validate'}</span>
        </Button>

        {isSequenced && !queueStatus ? (
          <span className="flex-1 text-[10px] font-medium text-muted-foreground border border-border px-2 py-2 rounded-md text-center bg-muted truncate">
            Use Build All
          </span>
        ) : (
          <Button
            size="sm"
            onClick={() => onBuild(story.file)}
            disabled={isValidating || isBuilding}
            className="flex-1 min-w-0 h-9 rounded-md text-xs font-semibold transition-all duration-200"
          >
            <Play className="h-3.5 w-3.5 mr-1.5 fill-current shrink-0" />
            <span className="truncate">{isBuilding ? 'Building...' : 'Build'}</span>
          </Button>
        )}

        {onEnqueue && !isSequenced && (
          <Button
            size="icon"
            variant="outline"
            onClick={() => onEnqueue(story.file, isFeature ? 'FeatureStory' : 'AppStory', { phase: story.phase, dependsOn: story.dependsOn })}
            disabled={isValidating || isBuilding}
            className="h-9 w-9 p-0 rounded-md border border-border shrink-0 flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-all duration-200"
            title="Add to build queue"
          >
            <ListPlus className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
