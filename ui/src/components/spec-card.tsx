'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './status-badge';
import { Separator } from '@/components/ui/separator';
import { Play, ShieldCheck, Globe, Database, Server, Layers, ListPlus, Eye } from 'lucide-react';

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
  const meta = spec.metadata;
  const accentColor = meta?.color === 'emerald' ? '#10B981' : meta?.color || '#6366f1';

  return (
    <Card className="group relative overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 border-border/60">
      {/* Color accent bar */}
      <div
        className="absolute left-0 top-0 h-full w-1 rounded-l-lg transition-all duration-200 group-hover:w-1.5"
        
      />

      <CardHeader className="pb-3 px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl sm:text-2xl shrink-0">{meta?.icon || '📦'}</span>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-semibold tracking-tight truncate">{meta?.name || spec.file}</h3>
              <p className="text-[10px] sm:text-xs text-muted-foreground font-mono truncate">@factory/{meta?.slug}</p>
            </div>
          </div>
          <StatusBadge status={spec.status} />
        </div>
      </CardHeader>

      <CardContent className="px-5 space-y-3">
        {meta?.description && (
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed line-clamp-2">{String(meta.description)}</p>
        )}

        <Separator />

        {/* Quick info grid — 1 col mobile, 2 cols desktop */}
        <div className="grid grid-cols-2 gap-2 text-[10px] sm:text-xs">
          {spec.deployment?.port && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Server className="h-3 w-3 shrink-0" />
              <span className="truncate">Port {spec.deployment.port}</span>
            </div>
          )}
          {spec.deployment?.region && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Globe className="h-3 w-3 shrink-0" />
              <span className="truncate">{spec.deployment.region}</span>
            </div>
          )}
          {spec.database?.collections && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Database className="h-3 w-3 shrink-0" />
              <span>{(spec.database.collections as unknown[]).length} collection{(spec.database.collections as unknown[]).length !== 1 ? 's' : ''}</span>
            </div>
          )}
          {spec.api?.resources && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Layers className="h-3 w-3 shrink-0" />
              <span>{(spec.api.resources as unknown[]).length} resource{(spec.api.resources as unknown[]).length !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Actions — stack on mobile, row on desktop */}
        <div className="flex flex-wrap gap-2 pt-1">
          {onView && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onView(spec.file, meta?.name || spec.file)}
              className="h-9 px-2.5 text-xs"
              title="View / Edit spec"
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onValidate(spec.file)}
            disabled={isValidating || isBuilding}
            className="flex-1 min-w-0 h-9 text-xs"
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            {isValidating ? 'Validating...' : 'Validate'}
          </Button>
          <Button
            size="sm"
            onClick={() => onBuild(spec.file)}
            disabled={isValidating || isBuilding}
            className="flex-1 min-w-0 h-9 text-xs"
          >
            <Play className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            {isBuilding ? 'Building...' : 'Build'}
          </Button>
          {onEnqueue && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEnqueue(spec.file, 'AppSpec')}
              disabled={isValidating || isBuilding}
              className="h-9 px-2.5 text-xs"
              title="Add to build queue"
            >
              <ListPlus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
