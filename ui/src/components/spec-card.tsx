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

interface SpecData {
  file: string;
  kind?: 'AppSpec' | 'FeatureSpec';
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
  // For feature specs
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

interface SpecCardProps {
  spec: SpecData;
  onValidate: (file: string) => void;
  onBuild: (file: string) => void;
  onEnqueue?: (file: string, kind: string, extra?: any) => void;
  onView?: (file: string, name: string) => void;
  isValidating?: boolean;
  isBuilding?: boolean;
  queueStatus?: string;
}

export function SpecCard({
  spec,
  onValidate,
  onBuild,
  onEnqueue,
  onView,
  isValidating,
  isBuilding,
  queueStatus,
}: SpecCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Auto-detect if this is a feature spec
  const isFeature = spec.kind === 'FeatureSpec' || !!spec.feature;
  const name = isFeature ? (spec.feature?.name || spec.file) : (spec.metadata?.name || spec.file);
  const slug = isFeature ? `→ ${spec.target?.app || 'app'}` : `@factory/${spec.metadata?.slug || 'app'}`;
  const icon = isFeature ? (spec.metadata?.icon || '🧩') : (spec.metadata?.icon || '📦');
  const description = isFeature ? spec.feature?.description : spec.metadata?.description;
  const isSequenced = isFeature && !!(spec.phase || (spec.dependsOn && spec.dependsOn.length > 0));

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
                {isFeature && spec.phase !== undefined && (
                  <Badge variant="outline" className="text-[9px] font-semibold h-4 px-1.5 rounded-full shrink-0">
                    P{spec.phase}
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                {slug}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusBadge status={spec.status} />
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

      {/* Collapsible detailed specifications */}
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
              {/* App Spec Info */}
              {!isFeature && (
                <>
                  {spec.deployment?.port && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                      <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium">Port {spec.deployment.port}</span>
                    </div>
                  )}
                  {spec.deployment?.region && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                      <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium">{spec.deployment.region}</span>
                    </div>
                  )}
                  {spec.database?.collections && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                      <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium">
                        {(spec.database.collections as unknown[]).length} Collections
                      </span>
                    </div>
                  )}
                  {spec.api?.resources && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                      <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium">
                        {(spec.api.resources as unknown[]).length} Resources
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* Feature Spec Info */}
              {isFeature && (
                <>
                  <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                    <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium">
                      {spec.pages?.length || 0} Pages
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground bg-muted p-3 rounded-lg border border-border">
                    <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">
                      {String(spec.model?.collection || 'No Database')}
                    </span>
                  </div>
                </>
              )}

              {/* Dependencies row */}
              {isFeature && spec.dependsOn && spec.dependsOn.length > 0 && (
                <div className="col-span-2 space-y-2 bg-muted p-4 rounded-lg border border-border">
                  <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Depends On Specs</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {spec.dependsOn.map((dep) => (
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
            onClick={() => onView(spec.file, name)}
            className="h-9 w-9 p-0 rounded-md border border-border shrink-0 flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-all duration-200"
            title="View / Edit Spec"
          >
            <Eye className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onValidate(spec.file)}
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
            onClick={() => onBuild(spec.file)}
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
            onClick={() => onEnqueue(spec.file, isFeature ? 'FeatureSpec' : 'AppSpec', { phase: spec.phase, dependsOn: spec.dependsOn })}
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
