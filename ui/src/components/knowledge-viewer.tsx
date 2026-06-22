'use client';

import { BookOpen, FileText, Code2, RefreshCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';

interface KnowledgeViewerProps {
  data: any;
}

const PROSE = "prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-pre:my-3 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/50 prose-pre:rounded-xl prose-pre:p-4 prose-code:text-[12px] prose-code:bg-muted/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono prose-a:text-indigo-400 hover:prose-a:text-indigo-300 transition-colors prose-headings:font-semibold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-h4:text-sm prose-strong:font-semibold prose-strong:text-foreground";

export function KnowledgeViewer({ data }: KnowledgeViewerProps) {
  const context = data?.context || {};
  const projectInfo = context?.project || {};
  const [isBuilding, setIsBuilding] = useState(false);
  
  // Try to find tpm-context.md in adrs or workflows
  const adrs = data?.adrs || [];
  const tpmContext = adrs.find((a: any) => a.id === 'tpm-context' || a.filename?.includes('tpm-context')) || data?.workflows?.find((w: any) => w.id === 'tpm-context');
  
  const handleBuildKnowledge = async () => {
    setIsBuilding(true);
    try {
      await fetch('/api/knowledge/build', { method: 'POST' });
      // Don't set isBuilding false immediately; let the user know it's running in background
      setTimeout(() => setIsBuilding(false), 5000);
    } catch (e) {
      console.error(e);
      setIsBuilding(false);
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground border-b border-border/40 pb-4">
        <span className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-indigo-500" />
          <span className="font-semibold text-foreground">TPM Knowledge Base</span>
        </span>
        <button 
          onClick={handleBuildKnowledge}
          disabled={isBuilding}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-md transition-colors text-xs font-medium disabled:opacity-50"
        >
          <RefreshCcw className={`h-3 w-3 ${isBuilding ? 'animate-spin' : ''}`} />
          {isBuilding ? 'Building...' : 'Build Knowledge'}
        </button>
      </div>

      {projectInfo.readme_summary && (
        <div className="border border-border rounded-xl bg-card/5 p-5 md:p-6">
          <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <Code2 className="h-4 w-4 text-indigo-400" />
            Project Summary
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {projectInfo.readme_summary}
          </p>
        </div>
      )}

      {tpmContext ? (
        <div className="border border-border rounded-xl bg-card/5 p-5 md:p-8">
          <div className={PROSE}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {tpmContext.content}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60 border border-dashed border-border rounded-xl bg-card/5">
          <FileText className="h-8 w-8 opacity-30 mb-2" />
          <p className="text-xs font-medium">TPM Context is building in the background...</p>
          <p className="text-[10px] mt-1 text-center max-w-xs">It might take a few minutes for the LLM to analyze the entire codebase. Check back shortly!</p>
        </div>
      )}
    </div>
  );
}
