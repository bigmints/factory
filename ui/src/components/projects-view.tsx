'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFactoryStore } from '@/stores/factory-store';
import { toast } from 'sonner';
import { FolderOpen, Check, RefreshCw, Loader2, ArrowRight } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const fetchAll = useFactoryStore((s) => s.fetchAll);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data.projects || []);
      setActiveId(data.activeId || null);
    } catch {
      toast.error('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleSwitch = async (id: string) => {
    setSwitching(id);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'PATCH' });
      if (res.ok) {
        setActiveId(id);
        toast.success('Workspace project activated');
        fetchAll();
        // Wait 1s and reload to refresh all context
        setTimeout(() => window.location.reload(), 1000);
      } else {
        toast.error('Failed to switch project');
      }
    } catch {
      toast.error('Failed to switch project');
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground border-b border-border/40 pb-4">
        <span className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-indigo-500" />
          <span className="font-semibold text-foreground">Active Projects Workspace</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={loadProjects}
          disabled={loading}
          className="h-8 w-8 p-0 rounded-md hover:bg-muted"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60 border border-dashed border-border rounded-xl bg-card/5">
          <FolderOpen className="h-8 w-8 opacity-30 mb-2" />
          <p className="text-xs font-medium">No projects added yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => {
            const isActive = project.id === activeId;
            const isSwitching = switching === project.id;
            return (
              <Card key={project.id} className={`p-5 border transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xs ${
                isActive ? 'border-indigo-500/50 bg-indigo-500/5 dark:bg-indigo-950/10' : 'border-border/60 bg-card/10'
              }`}>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-xs sm:text-sm font-semibold text-foreground truncate">{project.name}</h3>
                    {isActive && (
                      <Badge className="text-[9px] px-1.5 py-0 rounded font-semibold bg-indigo-500 text-white border-0">
                        Active Workspace
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground truncate">{project.path}</p>
                  <p className="text-[10px] text-muted-foreground/60">Connected: {new Date(project.addedAt).toLocaleDateString()}</p>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {isActive ? (
                    <div className="flex items-center gap-1.5 text-xs text-indigo-500 dark:text-indigo-400 font-semibold px-3 py-1.5">
                      <Check className="h-4 w-4" /> Active
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={switching !== null}
                      onClick={() => handleSwitch(project.id)}
                      className="h-8 text-xs font-semibold px-3 gap-1 hover:border-indigo-500/50 hover:text-indigo-500"
                    >
                      {isSwitching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          Switch <ArrowRight className="h-3.5 w-3.5" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
