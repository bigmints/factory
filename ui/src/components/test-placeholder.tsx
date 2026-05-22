'use client';

import { FlaskConical, CheckCircle2, Cpu, Microscope, Bug, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const upcomingFeatures = [
  { icon: Cpu,          label: 'Unit Tests',        desc: 'Auto-generate and run unit tests per module', tag: 'Engine' },
  { icon: Microscope,   label: 'Integration Tests',  desc: 'Validate API contracts and data flows end-to-end', tag: 'Engine' },
  { icon: CheckCircle2, label: 'Type Checks',        desc: 'tsc --noEmit gating per build iteration', tag: 'Compiler' },
  { icon: Bug,          label: 'Lint & Format',      desc: 'ESLint, Biome, Prettier enforcement on generated code', tag: 'Linter' },
  { icon: Clock,        label: 'Runtime Smoke Test', desc: 'Spawn dev server, wait for port, assert HTTP 200', tag: 'Runtime' },
];

export function TestPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-16 text-center space-y-8 px-4">
      {/* Icon */}
      <div className="relative">
        <div className="h-20 w-20 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto">
          <FlaskConical className="h-9 w-9 text-violet-400" />
        </div>
        <span className="absolute -top-2 -right-2 text-[10px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">
          Soon
        </span>
      </div>

      {/* Heading */}
      <div className="space-y-2 max-w-lg">
        <h1 className="text-2xl font-bold tracking-tight">Test Suite</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Automated testing is built into the engine's iteration loop — type checks, lint gates, integration tests, and live smoke runs happen on every build. A dedicated test dashboard is coming soon.
        </p>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl w-full mt-4">
        {upcomingFeatures.map(({ icon: Icon, label, desc, tag }) => (
          <div
            key={label}
            className="p-4 rounded-xl border border-border/60 bg-muted/20 text-left space-y-2 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="h-8 w-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Icon className="h-4 w-4 text-violet-400" />
              </div>
              <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                {tag}
              </Badge>
            </div>
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
