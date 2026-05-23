'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  IconCopy,
  IconCheck,
  IconExternalLink,
  IconRocket,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';

interface NewProjectGuideProps {
  open: boolean;
  projectName: string;
  projectPath?: string;
  projectStack?: {
    framework?: string;
    packageManager?: string;
    language?: string;
  };
  onClose: () => void;
  onStartCreating: () => void;
}

const SKILL_URL =
  'https://raw.githubusercontent.com/Bigmints-com/factory/main/skills/spec-bootstrap/SKILL.md';

function buildPrompt(
  projectName: string,
  projectPath?: string,
  stack?: { framework?: string; packageManager?: string; language?: string }
): string {
  const lines: string[] = [
    `Read ${SKILL_URL} and follow the instructions to create product specs and stories.`,
    '',
  ];

  lines.push(`Project: ${projectName}`);

  if (projectPath) {
    lines.push(`Path: ${projectPath}`);
  }

  if (stack?.framework || stack?.packageManager || stack?.language) {
    const parts = [
      stack.framework,
      stack.packageManager,
      stack.language,
    ].filter(Boolean);
    if (parts.length) lines.push(`Stack: ${parts.join(' · ')}`);
  }

  lines.push('');
  lines.push(
    'Walk me through creating an app spec, feature specs (epics), and stories for this project.'
  );

  return lines.join('\n');
}

export function NewProjectGuide({
  open,
  projectName,
  projectPath,
  projectStack,
  onClose,
  onStartCreating,
}: NewProjectGuideProps) {
  const prompt = buildPrompt(projectName, projectPath, projectStack);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden gap-0 w-[95vw]">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b bg-gradient-to-br from-primary/8 via-background to-background">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 shrink-0">
                <IconSparkles className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-sm font-bold leading-tight">
                  Project connected!
                </DialogTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Use an AI agent to scaffold your specs
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 hover:bg-muted mt-0.5 shrink-0"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4">
          {/* Explanation */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            Copy the prompt below and paste it into any AI agent — Antigravity,
            Claude, Cursor, or similar. The agent will read the Factory skill
            file and walk you through creating your{' '}
            <span className="font-medium text-foreground">app spec</span>,{' '}
            <span className="font-medium text-foreground">feature specs</span>,
            and{' '}
            <span className="font-medium text-foreground">stories</span> in the
            right format for the build engine.
          </p>

          {/* The prompt block */}
          <div className="relative rounded-xl border border-border bg-muted/30 overflow-hidden">
            {/* "terminal" header bar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/50">
              <span className="text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-wider">
                Prompt
              </span>
              <button
                onClick={handleCopy}
                className={cn(
                  'flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-md transition-all',
                  copied
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background'
                )}
              >
                {copied ? (
                  <>
                    <IconCheck className="h-3 w-3" />
                    Copied!
                  </>
                ) : (
                  <>
                    <IconCopy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </button>
            </div>

            {/* Prompt text */}
            <pre className="p-3.5 text-[11px] font-mono leading-relaxed text-foreground/90 whitespace-pre-wrap select-all">
              {prompt}
            </pre>
          </div>

          {/* Skill URL link */}
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>Skill file:</span>
            <a
              href={SKILL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline flex items-center gap-0.5 font-mono truncate"
            >
              skills/spec-bootstrap/SKILL.md
              <IconExternalLink className="h-2.5 w-2.5 shrink-0" />
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t bg-muted/10">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs text-muted-foreground h-8"
          >
            Skip for now
          </Button>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="text-xs h-8 gap-1.5"
            >
              {copied ? (
                <>
                  <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <IconCopy className="h-3.5 w-3.5" />
                  Copy Prompt
                </>
              )}
            </Button>
            <Button
              size="sm"
              onClick={onStartCreating}
              className="text-xs h-8 gap-1.5 bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 text-white border-0"
            >
              <IconRocket className="h-3.5 w-3.5" />
              Open Plan Board
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
