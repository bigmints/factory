'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Check, Plus, FolderOpen } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

interface ProjectSwitcherProps {
  onAddProject: () => void;
  refreshKey?: number;
}

export function ProjectSwitcher({ onAddProject, refreshKey }: ProjectSwitcherProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadProjects();
  }, [refreshKey]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data.projects || []);
      setActiveId(data.activeId || null);
    } catch {
      // Silently fail
    }
  };

  const switchProject = async (id: string) => {
    setSwitching(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'PATCH' });
      if (res.ok) {
        setActiveId(id);
        setOpen(false);
        window.location.reload();
      }
    } catch {
      // Silently fail
    } finally {
      setSwitching(false);
    }
  };

  const activeProject = projects.find((p) => p.id === activeId);

  if (projects.length === 0) {
    return (
      <button
        onClick={onAddProject}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-muted-foreground/30">
          <Plus className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-medium">Start a project</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          open && 'bg-accent text-accent-foreground'
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary border">
          <FolderOpen className="h-3.5 w-3.5 text-foreground" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="truncate text-xs font-medium">
            {activeProject?.name || 'No project'}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => project.id !== activeId && switchProject(project.id)}
              disabled={switching}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                project.id === activeId
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-medium">{project.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {project.path}
                </p>
              </div>
              {project.id === activeId && (
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
            </button>
          ))}

          <div className="my-1 h-px bg-border" />

          <button
            onClick={() => {
              setOpen(false);
              onAddProject();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Project
          </button>
        </div>
      )}
    </div>
  );
}
