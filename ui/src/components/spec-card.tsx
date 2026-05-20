'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './status-badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Play, ShieldCheck, Globe, Database, Server, Layers, ListPlus, Eye, ChevronDown, ChevronUp } from 'lucide-react';

interface SpecData {
  file: string;
  valid: boolean;
  status: string;
  metadata: {
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
}

interface SpecCardProps {
  spec: SpecData;
  onValidate: (file: string) => void;
  onBuild: (file: string) => void;
  onEnqueue?: (file: string, kind: string) => void;
  onView?: (file: string, name: string) => void;
  isValidating?: boolean;
  isBuilding?: boolean;
}

export function SpecCard({ spec, onValidate, onBuild, onEnqueue, onView, isValidating, isBuilding }: SpecCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = spec.metadata;

  return (
    <Card className={cn(
      "glass-panel rounded-2xl p-0 transition-all duration-300 tap-shrink border-border/40 glow-blue",
      expanded ? "shadow-xl shadow-blue-500/5 ring-1 ring-blue-500/20" : "hover:shadow-lg hover:shadow-blue-500/5"
    )}>
      <CardHeader className="py-4 px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-xl shrink-0 p-2 bg-blue-500/10 border border-blue-500/20 rounded-xl select-none">{meta?.icon || '📦'}</span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm sm:text-base font-bold tracking-tight truncate text-foreground">{meta?.name || spec.file}</h3>
              <p className="text-[10px] text-muted-foreground font-mono truncate">@factory/{meta?.slug || 'app'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={spec.status} />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl hover:bg-muted text-muted-foreground/75 shrink-0"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Collapsible detailed specifications */}
        {expanded && (
          <div className="px-5 pb-4 pt-0 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <Separator className="opacity-40" />
            {meta?.description && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {String(meta.description)}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 text-[10px] sm:text-xs">
              {spec.deployment?.port && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Server className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span className="truncate">Port {spec.deployment.port}</span>
                </div>
              )}
              {spec.deployment?.region && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Globe className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span className="truncate">{spec.deployment.region}</span>
                </div>
              )}
              {spec.database?.collections && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Database className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span>{(spec.database.collections as unknown[]).length} collection{(spec.database.collections as unknown[]).length !== 1 ? 's' : ''}</span>
                </div>
              )}
              {spec.api?.resources && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Layers className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span>{(spec.api.resources as unknown[]).length} resource{spec.api.resources.length !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action buttons footer */}
        <div className="px-5 pb-4 pt-2 flex items-center gap-2">
          {onView && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onView(spec.file, meta?.name || spec.file)}
              className="h-9 w-9 p-0 rounded-xl border-border/50 shrink-0 flex items-center justify-center hover:bg-muted"
              title="View / Edit spec"
            >
              <Eye className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onValidate(spec.file)}
            disabled={isValidating || isBuilding}
            className="flex-1 min-w-0 h-9 rounded-xl text-xs font-semibold hover:bg-muted"
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5 text-emerald-400 shrink-0" />
            {isValidating ? 'Validating...' : 'Validate'}
          </Button>
          <Button
            size="sm"
            onClick={() => onBuild(spec.file)}
            disabled={isValidating || isBuilding}
            className="flex-1 min-w-0 h-9 rounded-xl text-xs font-bold"
          >
            <Play className="h-3.5 w-3.5 mr-1.5 fill-current shrink-0" />
            {isBuilding ? 'Building...' : 'Build'}
          </Button>
          {onEnqueue && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEnqueue(spec.file, 'AppSpec')}
              disabled={isValidating || isBuilding}
              className="h-9 w-9 p-0 rounded-xl border-border/50 shrink-0 flex items-center justify-center hover:bg-muted"
              title="Add to build queue"
            >
              <ListPlus className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
