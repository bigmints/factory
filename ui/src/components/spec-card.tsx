'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    <Card
      className={cn(
        "glass-panel rounded-2xl p-0 transition-all duration-300 tap-shrink border-border/40 flex flex-col justify-between overflow-hidden",
        isFeature
          ? "glow-purple hover:border-purple-500/20 shadow-sm hover:shadow-md"
          : "glow-blue hover:border-blue-500/20 shadow-sm hover:shadow-md",
        expanded && "ring-1 ring-primary/10 shadow-lg"
      )}
    >
      {/* Upper Content Area */}
      <div className="p-5 md:p-6 space-y-4">
        {/* Header Block */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0 flex-1">
            <span
              className={cn(
                "text-xl shrink-0 p-3 rounded-2xl select-none shadow-sm flex items-center justify-center",
                isFeature
                  ? "bg-purple-500/10 border border-purple-500/25 text-purple-400"
                  : "bg-blue-500/10 border border-blue-500/25 text-blue-400"
              )}
            >
              {icon}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-sm md:text-base font-bold tracking-tight text-foreground truncate max-w-[200px]">
                  {name}
                </h3>
                <span
                  className={cn(
                    "text-[9px] font-bold px-2 py-0.5 rounded-full border shrink-0",
                    isFeature
                      ? "bg-purple-500/5 border-purple-500/20 text-purple-400"
                      : "bg-blue-500/5 border-blue-500/20 text-blue-400"
                  )}
                >
                  {isFeature ? 'Feature' : 'App'}
                </span>
                {isFeature && spec.phase !== undefined && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-amber-500/5 border-amber-500/25 text-amber-400 shrink-0">
                    P{spec.phase}
                  </span>
                )}
              </div>
              <p className="text-[10px] md:text-xs text-muted-foreground/80 font-mono truncate">
                {slug}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusBadge status={spec.status} />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl hover:bg-muted text-muted-foreground/75 shrink-0"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-4.5 w-4.5" /> : <ChevronDown className="h-4.5 w-4.5" />}
            </Button>
          </div>
        </div>

        {/* Collapsible detailed specifications */}
        {expanded && (
          <div className="space-y-4 pt-4 border-t border-border/20 animate-in fade-in slide-in-from-top-2 duration-200">
            {description && (
              <p className="text-xs text-muted-foreground leading-relaxed bg-muted/20 p-3.5 sm:p-4 rounded-xl border border-border/30">
                {String(description)}
              </p>
            )}

            {/* Grid of stats */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              {/* App Spec Info */}
              {!isFeature && (
                <>
                  {spec.deployment?.port && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/10 p-3 md:p-3.5 rounded-xl border border-border/30">
                      <Server className="h-4 w-4 text-blue-400 shrink-0" />
                      <span className="truncate font-medium">Port {spec.deployment.port}</span>
                    </div>
                  )}
                  {spec.deployment?.region && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/10 p-3 md:p-3.5 rounded-xl border border-border/30">
                      <Globe className="h-4 w-4 text-blue-400 shrink-0" />
                      <span className="truncate font-medium">{spec.deployment.region}</span>
                    </div>
                  )}
                  {spec.database?.collections && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/10 p-3 md:p-3.5 rounded-xl border border-border/30">
                      <Database className="h-4 w-4 text-blue-400 shrink-0" />
                      <span className="font-medium">
                        {(spec.database.collections as unknown[]).length} Collections
                      </span>
                    </div>
                  )}
                  {spec.api?.resources && (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/10 p-3 md:p-3.5 rounded-xl border border-border/30">
                      <Layers className="h-4 w-4 text-blue-400 shrink-0" />
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
                  <div className="flex items-center gap-2 text-muted-foreground bg-muted/10 p-3 md:p-3.5 rounded-xl border border-border/30">
                    <FileCode className="h-4 w-4 text-purple-400 shrink-0" />
                    <span className="font-medium">
                      {spec.pages?.length || 0} Pages
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground bg-muted/10 p-3 md:p-3.5 rounded-xl border border-border/30">
                    <Database className="h-4 w-4 text-purple-400 shrink-0" />
                    <span className="font-medium truncate">
                      {String(spec.model?.collection || 'No Database')}
                    </span>
                  </div>
                </>
              )}

              {/* Dependencies row */}
              {isFeature && spec.dependsOn && spec.dependsOn.length > 0 && (
                <div className="col-span-2 space-y-2 bg-muted/10 p-3.5 sm:p-4 rounded-xl border border-border/30">
                  <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                    <GitBranch className="h-3.5 w-3.5 text-purple-400" />
                    <span>Depends On Specs</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {spec.dependsOn.map((dep) => (
                      <span
                        key={dep}
                        className="text-[10px] font-semibold px-2.5 py-0.5 rounded-md bg-purple-500/5 text-purple-400 border border-purple-500/20"
                      >
                        {dep}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Structured Footer Action Bar */}
      <div className="px-5 md:px-6 py-3.5 md:py-4 bg-muted/30 border-t border-border/40 flex items-center gap-2.5">
        {onView && (
          <Button
            size="icon"
            variant="outline"
            onClick={() => onView(spec.file, name)}
            className="h-9 w-9 p-0 rounded-xl border-border/50 shrink-0 flex items-center justify-center hover:bg-muted/80 hover:text-foreground transition-all duration-200"
            title="View / Edit Spec"
          >
            <Eye className="h-4.5 w-4.5 text-muted-foreground" />
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onValidate(spec.file)}
          disabled={isValidating || isBuilding}
          className="flex-1 min-w-0 h-9 rounded-xl text-xs font-semibold hover:bg-muted/80 hover:text-foreground transition-all duration-200 border-border/50"
        >
          <ShieldCheck className="h-3.5 w-3.5 mr-1.5 text-emerald-400 shrink-0" />
          <span className="truncate">{isValidating ? 'Validating...' : 'Validate'}</span>
        </Button>

        {isSequenced && !queueStatus ? (
          <span className="flex-1 text-[10px] font-semibold text-muted-foreground/80 border border-border/40 px-2 py-2 rounded-xl text-center select-none bg-muted/20 truncate">
            Use Build All
          </span>
        ) : (
          <Button
            size="sm"
            onClick={() => onBuild(spec.file)}
            disabled={isValidating || isBuilding}
            className={cn(
              "flex-1 min-w-0 h-9 rounded-xl text-xs font-bold transition-all duration-200",
              isFeature ? "bg-purple-600 hover:bg-purple-500 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"
            )}
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
            className="h-9 w-9 p-0 rounded-xl border-border/50 shrink-0 flex items-center justify-center hover:bg-muted/80 hover:text-foreground transition-all duration-200"
            title="Add to build queue"
          >
            <ListPlus className="h-4.5 w-4.5 text-muted-foreground" />
          </Button>
        )}
      </div>
    </Card>
  );
}
