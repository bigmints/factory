'use client';

import { useState, useMemo } from 'react';
import { BookOpen, FileText, RefreshCcw, Search, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface KnowledgeViewerProps {
  data: any;
}

interface DocItem {
  id: string;
  title: string;
  type: 'adr' | 'reference';
  content: string;
  file: string;
  date?: string;
  status?: string;
}

const PROSE = [
  'prose prose-sm dark:prose-invert max-w-none',
  'prose-p:my-2 prose-p:leading-relaxed text-muted-foreground',
  'prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground',
  'prose-h1:text-xl prose-h1:mt-6 prose-h1:mb-3',
  'prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-2',
  'prose-h3:text-base prose-h3:mt-4 prose-h3:mb-1.5',
  'prose-ul:my-2 prose-ul:pl-4 prose-ol:my-2 prose-ol:pl-4',
  'prose-li:my-0.5 prose-li:leading-normal',
  'prose-pre:my-3 prose-pre:rounded-xl prose-pre:text-xs prose-pre:leading-relaxed prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border/40 prose-pre:p-4',
  'prose-code:text-xs prose-code:bg-muted/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono prose-code:before:content-none prose-code:after:content-none',
  'prose-blockquote:border-l-2 prose-blockquote:border-primary/50 prose-blockquote:bg-primary/5 prose-blockquote:text-muted-foreground prose-blockquote:pl-3 prose-blockquote:py-0.5 prose-blockquote:my-3 prose-blockquote:rounded-r-md',
  'prose-table:text-xs prose-table:my-4 prose-th:font-medium prose-th:py-2 prose-th:px-3 prose-th:bg-muted/40 prose-td:py-2 prose-td:px-3 prose-td:border-b prose-td:border-border/30',
  'prose-hr:border-border/30 prose-hr:my-4',
  'prose-a:text-primary hover:text-primary/80 prose-a:underline-offset-2 transition-colors',
  'prose-strong:font-semibold prose-strong:text-foreground',
].join(' ');

export function KnowledgeViewer({ data }: KnowledgeViewerProps) {
  const [isBuilding, setIsBuilding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Extract all documents from adrs, workflows, and failures
  const allDocs = useMemo(() => {
    const docs: DocItem[] = [];

    if (data?.adrs) {
      data.adrs.forEach((a: any) => {
        docs.push({
          id: a.id,
          title: a.title,
          type: a.file?.toLowerCase().includes('adr') ? 'adr' : 'reference',
          content: a.content,
          file: a.file,
          date: a.date,
          status: a.status,
        });
      });
    }

    return docs;
  }, [data]);

  // Set default selected document ID (prioritize tpm-context, then fallback to first doc)
  const defaultDocId = useMemo(() => {
    const tpmContext = allDocs.find(
      (d) => d.id === 'tpm-context' || d.id.includes('tpm-context') || d.file?.includes('tpm-context')
    );
    return tpmContext?.id || allDocs[0]?.id || '';
  }, [allDocs]);

  const [selectedDocId, setSelectedDocId] = useState<string>('');

  // Actual selected doc ID resolves to state, fallback to defaultDocId if empty
  const activeDocId = selectedDocId || defaultDocId;

  const selectedDoc = useMemo(() => {
    return allDocs.find((d) => d.id === activeDocId);
  }, [allDocs, activeDocId]);

  // Apply search query filter
  const filteredDocs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allDocs;
    return allDocs.filter(
      (d) => d.title.toLowerCase().includes(query) || d.file.toLowerCase().includes(query)
    );
  }, [allDocs, searchQuery]);

  const handleBuildKnowledge = async () => {
    setIsBuilding(true);
    try {
      await fetch('/api/knowledge/build', { method: 'POST' });
      setTimeout(() => setIsBuilding(false), 5000);
    } catch (e) {
      console.error(e);
      setIsBuilding(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-96 space-y-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground border-b border-border/40 pb-4 shrink-0">
        <span className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="font-semibold text-foreground">TPM Knowledge Base</span>
        </span>
        <button 
          onClick={handleBuildKnowledge}
          disabled={isBuilding}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition-colors text-xs font-medium disabled:opacity-50 cursor-pointer"
        >
          <RefreshCcw className={cn("h-3 w-3", isBuilding && "animate-spin")} />
          {isBuilding ? 'Building...' : 'Build Knowledge'}
        </button>
      </div>

      {/* Main Split Layout */}
      <div className="flex flex-1 gap-6 min-h-0">
        
        {/* Left Document List */}
        <div className="w-80 flex flex-col gap-3 shrink-0 h-full">
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search knowledge..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg border border-border bg-card/40 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-2 scrollbar-thin">
            {filteredDocs.length === 0 ? (
              <div className="text-center py-12 text-xs text-muted-foreground opacity-60">
                No documents found.
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isSelected = doc.id === activeDocId;
                return (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all flex items-start gap-2.5 cursor-pointer",
                      isSelected 
                        ? "bg-primary/10 border-primary/30 text-primary shadow-sm"
                        : "border-transparent hover:bg-muted/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <FileText className={cn("h-4 w-4 shrink-0 mt-0.5", isSelected ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{doc.title}</p>
                      <p className="text-xs text-muted-foreground/60 truncate mt-0.5 font-mono">{doc.file}</p>
                    </div>
                    {isSelected && <ChevronRight className="h-3 w-3 shrink-0 text-primary mt-1" />}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Reader */}
        <div className="flex-1 min-w-0 overflow-y-auto border border-border/60 rounded-xl bg-card/10 p-6 md:p-8 scrollbar-thin h-full">
          {selectedDoc ? (
            <div className="space-y-6">
              {/* Document Header */}
              <div className="border-b border-border/40 pb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs font-mono capitalize px-2 py-0">
                    {selectedDoc.type}
                  </Badge>
                  {selectedDoc.status && (
                    <Badge className="text-xs bg-primary/10 text-primary border-primary/20 px-2 py-0">
                      {selectedDoc.status}
                    </Badge>
                  )}
                  {selectedDoc.date && (
                    <span className="text-xs text-muted-foreground/60 ml-auto font-medium">
                      {selectedDoc.date}
                    </span>
                  )}
                </div>
                <h1 className="text-lg md:text-xl font-bold text-foreground mt-3 tracking-tight">{selectedDoc.title}</h1>
                <p className="text-xs text-muted-foreground/50 mt-1 font-mono break-all">{selectedDoc.file}</p>
              </div>

              {/* Document Content */}
              <div className={PROSE}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {selectedDoc.content}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 py-20">
              <FileText className="h-10 w-10 opacity-20 mb-3" />
              <p className="text-xs font-medium">Select a document to read</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
