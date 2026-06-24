'use client';

import { useState } from 'react';
import { 
  IconFolder, 
  IconRocket, 
  IconChevronRight,
  IconChevronLeft,
  IconLoader2,
  IconFolderPlus,
  IconFolderOpen
} from "@tabler/icons-react";
import { Button } from '@/components/ui/button';
import { FolderBrowser } from '@/components/folder-browser';
import { toast } from 'sonner';
import { NewProjectGuide } from '@/components/new-project-guide';
// removed DropdownMenu imports
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";



interface AddProjectProps {
  onProjectAdded: () => void;
  onNavigateToPlan?: () => void;
}



export function AddProject({ onProjectAdded, onNavigateToPlan }: AddProjectProps) {
  const [loading, setLoading] = useState(false);

  // New-project guide state
  const [showGuide, setShowGuide] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [newProjectStack, setNewProjectStack] = useState<{ framework?: string; packageManager?: string; language?: string }>({});

  const [browseMode, setBrowseMode] = useState<'new' | 'existing' | 'clone' | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const [config] = useState({
    framework: 'next.js',
    packageManager: 'npm',
    linter: 'EsLint + Prettier',
    testing: 'jest',
  });

  const resetOnboarding = () => {
    setPendingPath(null);
  };

  const handleConnect = async () => {
    if (!pendingPath) return;
    setLoading(true);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          path: pendingPath,
          stack: config
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error('Failed to connect project', { description: data.details || data.error });
        return;
      }
      const projName = data.project?.name || 'Project';
      toast.success(`${projName} connected!`, {
        description: data.project?.path,
      });
      onProjectAdded();
      
      // Show the getting-started guide after a brief delay
      setTimeout(() => {
        resetOnboarding();
        setNewProjectName(projName);
        setNewProjectPath(data.project?.path || pendingPath || '');
        setNewProjectStack({
          framework: config.framework,
          packageManager: config.packageManager,
        });
        setShowGuide(true);
      }, 600);
    } catch (err: any) {
      toast.error('Connection failed', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleFolderSelected = async (path: string) => {
    setPendingPath(path);
    setBrowseMode(null);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 sm:space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {onNavigateToPlan && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 mr-1"
                onClick={onNavigateToPlan}
                title="Back to Stories Board"
              >
                <IconChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <h1 className="text-xl font-semibold tracking-tight">Connect Project</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {!pendingPath 
              ? "Select how you want to add a new project to the factory." 
              : "Review the location and initialize the project bridge."}
          </p>
        </div>
      </div>

      <Card className="p-6">
        {!pendingPath ? (
          <div className="grid gap-3">
            <button
               className="flex items-center gap-4 rounded-xl border p-4 text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
               onClick={() => setBrowseMode('new')}
             >
               <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                 <IconFolderPlus className="h-5 w-5" />
               </div>
               <div className="flex-1 min-w-0">
                 <h3 className="font-medium text-sm">Create New Project</h3>
                 <p className="text-sm text-muted-foreground truncate">Initialize a fresh repository</p>
               </div>
               <IconChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </button>

            <button
               className="flex items-center gap-4 rounded-xl border p-4 text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
               onClick={() => setBrowseMode('existing')}
             >
               <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                 <IconFolderOpen className="h-5 w-5" />
               </div>
               <div className="flex-1 min-w-0">
                 <h3 className="font-medium text-sm">Existing Folder</h3>
                 <p className="text-sm text-muted-foreground truncate">Connect a local path</p>
               </div>
               <IconChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </button>

            <button
               className="flex items-center gap-4 rounded-xl border p-4 text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
               onClick={() => setBrowseMode('clone')}
             >
               <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500">
                 <IconRocket className="h-5 w-5" />
               </div>
               <div className="flex-1 min-w-0">
                 <h3 className="font-medium text-sm">Clone Repository</h3>
                 <p className="text-sm text-muted-foreground truncate">From a Git URL</p>
               </div>
               <IconChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border p-4 bg-muted/30">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background border shadow-sm">
                    <IconFolder className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Selected Location</p>
                    <p className="text-xs text-muted-foreground font-mono truncate" title={pendingPath}>{pendingPath}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setPendingPath(null); setBrowseMode(null); }} className="shrink-0 h-8 text-xs">
                  Change
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <Button 
                className="w-full h-11" 
                disabled={loading}
                onClick={handleConnect}
              >
                {loading ? (
                  <>
                    <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                    Initializing bridge...
                  </>
                ) : (
                  <>
                    <IconRocket className="mr-2 h-4 w-4" />
                    Initialize & Connect
                  </>
                )}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                A .factory folder will be created in this location to enable bridge features.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Folder browser dialog */}
      <FolderBrowser
        open={browseMode === 'new' || browseMode === 'existing'}
        onClose={() => setBrowseMode(null)}
        onSelect={handleFolderSelected}
        mode={browseMode === 'new' ? 'new' : 'existing'}
        title={browseMode === 'new'
          ? 'Create Project'
          : 'Select Folder'
        }
      />

      {/* Clone Repo Dialog */}
      <Dialog open={browseMode === 'clone'} onOpenChange={(v) => !v && setBrowseMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clone Repository</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-xs font-medium mb-2 block text-muted-foreground">Git Repository URL</label>
            <input 
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="https://github.com/user/repo.git" 
              value={newProjectPath}
              onChange={(e) => setNewProjectPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newProjectPath.trim()) {
                  handleFolderSelected(newProjectPath.trim());
                }
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBrowseMode(null)} className="text-xs">Cancel</Button>
            <Button disabled={!newProjectPath.trim()} onClick={() => handleFolderSelected(newProjectPath.trim())} className="text-xs">Continue</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Getting-started prompt guide */}
      <NewProjectGuide
        open={showGuide}
        projectName={newProjectName}
        projectPath={newProjectPath}
        projectStack={newProjectStack}
        onClose={() => setShowGuide(false)}
        onStartCreating={() => {
          setShowGuide(false);
          onNavigateToPlan?.();
        }}
      />
    </div>
  );
}
