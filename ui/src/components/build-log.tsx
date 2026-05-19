'use client';

import { ScrollArea } from '@/components/ui/scroll-area';

interface BuildLogProps {
  output: string;
  isRunning?: boolean;
}

export function BuildLog({ output, isRunning }: BuildLogProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 sm:px-4 py-2.5">
        <div className={`h-2 w-2 rounded-full ${isRunning ? 'bg-yellow-500 animate-pulse' : output ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
        <span className="text-xs font-medium text-muted-foreground">
          {isRunning ? 'Building...' : output ? 'Build Output' : 'No output'}
        </span>
      </div>
      <ScrollArea className="h-[240px] sm:h-[320px] lg:h-[400px]">
        <pre className="p-3 sm:p-4 text-[11px] sm:text-xs leading-relaxed font-mono text-foreground/80 whitespace-pre-wrap">
          {output || 'Run a build to see output here...'}
        </pre>
      </ScrollArea>
    </div>
  );
}
