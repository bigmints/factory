'use client';

import { useState, useEffect } from 'react';
import { Folder, FolderOpen, ChevronRight, ArrowUp, Home, Loader2, GitBranch, Factory } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface FolderEntry {
  name: string;
  path: string;
  hasFactory: boolean;
  hasGit: boolean;
  hidden: boolean;
}

interface BrowseResult {
  path: string;
  name: string;
  parent: string | null;
  entries: FolderEntry[];
  hasFactory: boolean;
  hasGit: boolean;
}

interface FolderBrowserProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  mode: 'new' | 'existing';
  title?: string;
}

export function FolderBrowser({ open, onClose, onSelect, mode, title }: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [data, setData] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pathInput, setPathInput] = useState('');

  useEffect(() => {
    if (open) {
      browse('~/Projects');
    }
  }, [open]);

  const browse = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
      const d = await res.json();
      if (!res.ok) {
        if (path === '~/Projects') {
          browse('~');
          return;
        }
        setError(d.error || 'Failed to browse');
        return;
      }
      setData(d);
      setCurrentPath(d.path);
      setPathInput(d.path);
    } catch {
      setError('Failed to browse directory');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !currentPath) return;
    setCreating(true);
    try {
      const res = await fetch('/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath, name: newFolderName.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error);
        return;
      }
      setNewFolderName('');
      onSelect(d.path);
    } catch {
      setError('Failed to create folder');
    } finally {
      setCreating(false);
    }
  };

  const handlePathSubmit = () => {
    if (pathInput.trim()) {
      browse(pathInput.trim());
    }
  };

  const handleSelectCurrent = () => {
    if (currentPath) {
      onSelect(currentPath);
    }
  };

  const visibleEntries = data?.entries?.filter(e => showHidden || !e.hidden) || [];
  const pathSegments = currentPath.split('/').filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 w-[95vw] max-h-[85vh]">
        <DialogHeader className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
          <DialogTitle className="text-sm sm:text-base">
            {title || (mode === 'new' ? 'Choose Location for New Project' : 'Select Project Folder')}
          </DialogTitle>
        </DialogHeader>

        {/* Path bar */}
        <div className="px-3 sm:px-4 pb-2">
          <div className="flex gap-1.5">
            <Input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePathSubmit()}
              className="font-mono text-[10px] sm:text-xs h-8 sm:h-9"
              placeholder="/path/to/directory"
            />
            <Button variant="outline" size="sm" className="h-8 sm:h-9 shrink-0 text-xs" onClick={handlePathSubmit}>
              Go
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 sm:px-4 pb-2 overflow-x-auto scrollbar-hide">
          <Button
            variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"
            onClick={() => browse('~')}
            title="Home"
          >
            <Home className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"
            onClick={() => data?.parent && browse(data.parent)}
            disabled={!data?.parent}
            title="Up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <div className="h-4 w-px bg-border mx-1 shrink-0" />

          {/* Breadcrumbs */}
          <div className="flex items-center gap-0.5 overflow-x-auto text-[10px] sm:text-xs min-w-0 flex-1 scrollbar-hide">
            <button
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => browse('/')}
            >/</button>
            {pathSegments.slice(-4).map((seg, i) => {
              const fullPath = '/' + pathSegments.slice(0, pathSegments.length - (pathSegments.slice(-4).length - i) + 1).join('/');
              const isLast = i === pathSegments.slice(-4).length - 1;
              return (
                <span key={i} className="flex items-center gap-0.5 shrink-0">
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                  <button
                    className={cn(
                      'hover:text-foreground transition-colors truncate max-w-[80px] sm:max-w-[120px]',
                      isLast ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}
                    onClick={() => !isLast && browse(fullPath)}
                  >
                    {seg}
                  </button>
                </span>
              );
            })}
          </div>

          <div className="h-4 w-px bg-border mx-1 shrink-0" />
          <button
            className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 hidden sm:block"
            onClick={() => setShowHidden(!showHidden)}
          >
            {showHidden ? 'Hide .' : 'Show .'}
          </button>
        </div>

        {/* File list */}
        <ScrollArea className="h-[280px] sm:h-[320px] border-y">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="px-4 sm:px-5 py-4 text-xs sm:text-sm text-destructive">{error}</div>
          ) : visibleEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs sm:text-sm">
              <Folder className="h-8 w-8 mb-2 opacity-30" />
              <p>No subfolders</p>
            </div>
          ) : (
            <div className="py-1">
              {visibleEntries.map((entry) => (
                <button
                  key={entry.path}
                  className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 hover:bg-accent hover:text-accent-foreground transition-colors text-left group min-h-[44px]"
                  onClick={() => browse(entry.path)}
                  onDoubleClick={() => {
                    if (mode === 'existing') {
                      onSelect(entry.path);
                    }
                  }}
                >
                  <FolderOpen className={cn(
                    'h-4 w-4 shrink-0',
                    entry.hasFactory ? 'text-primary' :
                    entry.hasGit ? 'text-orange-400' :
                    entry.hidden ? 'text-muted-foreground/50' : 'text-amber-500'
                  )} />
                  <span className={cn(
                    'text-xs sm:text-sm truncate flex-1',
                    entry.hidden && 'text-muted-foreground'
                  )}>
                    {entry.name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {entry.hasFactory && (
                      <Badge variant="secondary" className="gap-1 rounded-full text-[9px] sm:text-[10px]">
                        <Factory className="h-2.5 w-2.5" />
                        <span className="hidden sm:inline">factory</span>
                      </Badge>
                    )}
                    {entry.hasGit && (
                      <GitBranch className="h-3 w-3 text-muted-foreground/60" />
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Current selection info */}
        {data && (
          <div className="px-3 sm:px-4 py-2 flex items-center gap-2 text-[10px] sm:text-xs flex-wrap">
            <span className="text-muted-foreground">Selected:</span>
            <span className="font-mono text-foreground truncate">{currentPath}</span>
            {data.hasFactory && (
              <Badge variant="secondary" className="gap-1 rounded-full text-[9px] sm:text-[10px] shrink-0">
                <Factory className="h-2.5 w-2.5" />
                .factory exists
              </Badge>
            )}
            {data.hasGit && !data.hasFactory && (
              <Badge variant="outline" className="gap-1 rounded-full text-[9px] sm:text-[10px] shrink-0">
                <GitBranch className="h-2.5 w-2.5" />
                git repo
              </Badge>
            )}
          </div>
        )}

        <DialogFooter className="px-3 sm:px-5 pb-4 sm:pb-5 pt-2">
          {mode === 'new' ? (
            <div className="flex items-center gap-2 w-full">
              <Input
                placeholder="New folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                className="text-xs sm:text-sm h-9"
                disabled={creating}
              />
              <Button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || creating}
                className="shrink-0 text-xs"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create & Connect'}
              </Button>
              <Button variant="outline" onClick={onClose} className="shrink-0 text-xs">
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 w-full justify-end">
              <Button variant="outline" onClick={onClose} className="text-xs">
                Cancel
              </Button>
              <Button onClick={handleSelectCurrent} disabled={!currentPath} className="text-xs">
                Select This Folder
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
