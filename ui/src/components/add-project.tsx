'use client';

import { useState, useEffect } from 'react';
import { 
  IconFolder, 
  IconSettings, 
  IconRocket, 
  IconCircleCheckFilled, 
  IconCircleDashed,
  IconChevronRight,
  IconLoader2,
  IconDots,
  IconArchive,
  IconFolderPlus,
  IconFolderOpen,
  IconTrash,
  IconRadio,
  IconCheck,
  IconPlus
} from "@tabler/icons-react";
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FolderBrowser } from '@/components/folder-browser';
import { toast } from 'sonner';
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BridgeSummary {
  name: string | null;
  description: string | null;
  stack: {
    framework: string;
    packageManager: string;
    linter?: string;
    testing?: string;
    database?: string;
    cloud?: string;
  } | null;
  stats: {
    apps: number;
    packages: number;
    conventions: number;
    scripts: number;
  };
  hasSkills: boolean;
}

interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  bridge?: BridgeSummary | null;
}

interface AddProjectProps {
  onProjectAdded: () => void;
}

function CircularProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const progress = total > 0 ? ((completed) / total) * 100 : 0;
  const strokeDashoffset = 100 - progress;

  return (
    <svg
      className="-rotate-90 scale-y-[-1]"
      height="14"
      width="14"
      viewBox="0 0 14 14"
    >
      <circle
        className="stroke-muted"
        cx="7"
        cy="7"
        fill="none"
        r="6"
        strokeWidth="2"
        pathLength="100"
      />
      <circle
        className="stroke-primary"
        cx="7"
        cy="7"
        fill="none"
        r="6"
        strokeWidth="2"
        pathLength="100"
        strokeDasharray="100"
        strokeLinecap="round"
        style={{ strokeDashoffset }}
      />
    </svg>
  );
}

function StepIndicator({ completed }: { completed: boolean }) {
  if (completed) {
    return (
      <IconCircleCheckFilled
        className="mt-1 size-4 shrink-0 sm:size-4.5 text-primary"
        aria-hidden="true"
      />
    );
  }
  return (
    <IconCircleDashed
      className="mt-1 size-4 sm:size-5 shrink-0 stroke-muted-foreground/40"
      strokeWidth={2}
      aria-hidden="true"
    />
  );
}

export function AddProject({ onProjectAdded }: AddProjectProps) {
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Onboarding logic state
  const [openStepId, setOpenStepId] = useState<string | null>("location");
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({
    location: false,
    config: false,
    build: false
  });

  const [browseMode, setBrowseMode] = useState<'new' | 'existing' | null>(null);

  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [config, setConfig] = useState({
    framework: 'next.js',
    packageManager: 'npm',
    linter: 'EsLint + Prettier',
    testing: 'jest',
  });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data.projects || []);
      setActiveId(data.activeId || null);
    } catch {
      // silently fail
    } finally {
      setLoadingProjects(false);
    }
  };

  const resetOnboarding = () => {
    setOpenStepId("location");
    setCompletedSteps({ location: false, config: false, build: false });
    setPendingPath(null);
    setShowModal(false);
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
      setCompletedSteps(prev => ({ ...prev, build: true }));
      toast.success(`${data.project?.name || 'Project'} connected!`, {
        description: data.project?.path,
      });
      await loadProjects();
      onProjectAdded();
      
      setTimeout(() => {
        resetOnboarding();
      }, 1000);
    } catch (err: any) {
      toast.error('Connection failed', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSwitch = async (id: string) => {
    setSwitching(id);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'PATCH' });
      if (res.ok) {
        setActiveId(id);
        onProjectAdded();
        toast.success('Project activated');
      }
    } catch {
      toast.error('Failed to switch project');
    } finally {
      setSwitching(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Project removed');
        await loadProjects();
      } else {
        const data = await res.json();
        toast.error('Failed to remove project', { description: data.details || data.error });
      }
    } catch (err: any) {
      toast.error('Failed to remove project', { description: err.message });
    } finally {
      setDeleting(null);
    }
  };

  const [isScanning, setIsScanning] = useState(false);

  const handleFolderSelected = async (path: string) => {
    setPendingPath(path);
    setBrowseMode(null);
    setCompletedSteps(prev => ({ ...prev, location: true }));
    setOpenStepId("config");
    setIsScanning(true);

    try {
      const res = await fetch('/api/projects/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.stack) {
           setConfig(prev => ({
             ...prev,
             framework: data.stack.framework !== 'node' ? data.stack.framework : prev.framework,
             packageManager: data.stack.packageManager !== 'npm' ? data.stack.packageManager : prev.packageManager,
             linter: data.stack.linter !== 'None' ? data.stack.linter : prev.linter,
             testing: data.stack.testing !== 'None' ? data.stack.testing : prev.testing,
           }));
        }
      }
    } catch {
      // silently fail discovery
    } finally {
      setIsScanning(false);
    }
  };

  const completedCount = Object.values(completedSteps).filter(Boolean).length;
  const totalSteps = 3;

  const steps = [
    {
      id: "location",
      title: "Project Location",
      description: "Select an existing project folder or create a new one to initialize the factory bridge.",
      icon: <IconFolder className="size-3 sm:size-4" />,
      content: (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 mt-3 sm:mt-4">
            <div
               className="cursor-pointer glass-panel rounded-2xl border border-border/40 p-4 sm:p-6 flex flex-col items-center gap-2 text-center hover:border-primary/40 hover:bg-primary/[0.02] active:scale-[0.98] transition-all duration-300 group glow-blue"
               onClick={() => setBrowseMode('new')}
             >
               <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                 <IconFolderPlus className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
               </div>
               <div>
                 <p className="text-[10px] sm:text-xs font-semibold">New Project</p>
                 <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">
                   Create & initialize
                 </p>
               </div>
            </div>

            <div
               className="cursor-pointer glass-panel rounded-2xl border border-border/40 p-4 sm:p-6 flex flex-col items-center gap-2 text-center hover:border-primary/40 hover:bg-primary/[0.02] active:scale-[0.98] transition-all duration-300 group glow-blue"
               onClick={() => setBrowseMode('existing')}
             >
               <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-orange-500/10 group-hover:bg-orange-500/20 transition-colors">
                 <IconFolderOpen className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500" />
               </div>
               <div>
                 <p className="text-[10px] sm:text-xs font-semibold">Existing Project</p>
                 <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">
                   Connect local path
                 </p>
               </div>
            </div>
        </div>
      ),
      summary: pendingPath ? (
        <div className="mt-2 flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground font-mono bg-muted/50 p-1.5 sm:p-2 rounded">
          <IconFolder className="size-2.5 sm:size-3" /> {pendingPath}
        </div>
      ) : null
    },
    {
      id: "config",
      title: "Technical Stack",
      description: "Configure the project framework, package manager, and tools. We'll attempt to auto-discover these if they exist.",
      icon: <IconSettings className="size-3 sm:size-4" />,
      content: (
        <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
          {isScanning && (
            <div className="flex items-center gap-2 text-[10px] sm:text-xs text-primary bg-primary/10 p-2 rounded-md">
              <IconLoader2 className="h-3 w-3 animate-spin" />
              Scanning repository for stack configuration...
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <div className="space-y-1 sm:space-y-1.5">
              <label className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Framework</label>
              <select 
                className="w-full bg-background border rounded-md px-2 py-1.5 text-[10px] sm:text-xs h-8 sm:h-9"
                value={config.framework}
                onChange={(e) => setConfig({ ...config, framework: e.target.value })}
              >
                <option value="next.js">Next.js</option>
                <option value="react">React (Vite)</option>
                <option value="remix">Remix</option>
                <option value="node">Node.js</option>
                <option value="flutter">Flutter</option>
              </select>
            </div>

            <div className="space-y-1 sm:space-y-1.5">
              <label className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Package Manager</label>
              <select 
                className="w-full bg-background border rounded-md px-2 py-1.5 text-[10px] sm:text-xs h-8 sm:h-9"
                value={config.packageManager}
                onChange={(e) => setConfig({ ...config, packageManager: e.target.value })}
              >
                <option value="npm">npm</option>
                <option value="yarn">yarn</option>
                <option value="pnpm">pnpm</option>
                <option value="bun">bun</option>
                <option value="pub">pub</option>
              </select>
            </div>

            <div className="space-y-1 sm:space-y-1.5">
              <label className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Linter / Formatter</label>
              <select 
                className="w-full bg-background border rounded-md px-2 py-1.5 text-[10px] sm:text-xs h-8 sm:h-9"
                value={config.linter}
                onChange={(e) => setConfig({ ...config, linter: e.target.value })}
              >
                <option value="EsLint + Prettier">EsLint + Prettier</option>
                <option value="Biome">Biome</option>
                <option value="None">None</option>
              </select>
            </div>

            <div className="space-y-1 sm:space-y-1.5">
              <label className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Testing Tool</label>
              <select 
                className="w-full bg-background border rounded-md px-2 py-1.5 text-[10px] sm:text-xs h-8 sm:h-9"
                value={config.testing}
                onChange={(e) => setConfig({ ...config, testing: e.target.value })}
              >
                <option value="jest">Jest</option>
                <option value="vitest">Vitest</option>
                <option value="playwright">Playwright</option>
                <option value="flutter_test">Flutter test</option>
                <option value="None">None</option>
              </select>
            </div>
          </div>
          <Button 
            size="sm" 
            className="w-full h-8 text-[10px] sm:text-xs" 
            onClick={() => {
              setCompletedSteps(prev => ({ ...prev, config: true }));
              setOpenStepId("build");
            }}
          >
            Confirm Configuration
          </Button>
        </div>
      ),
      summary: completedSteps.config ? (
        <div className="mt-2 flex flex-wrap gap-1 sm:gap-2">
          {Object.entries(config).map(([key, val]) => (
            <span key={key} className="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {val}
            </span>
          ))}
        </div>
      ) : null
    },
    {
      id: "build",
      title: "Initialize & Connect",
      description: "Initialize the .factory bridge and perform initial sync. This will connect the project to the factory.",
      icon: <IconRocket className="size-3 sm:size-4" />,
      content: (
        <div className="mt-3 sm:mt-4">
          <Button 
            className="w-full text-xs" 
            disabled={loading || !completedSteps.config}
            onClick={handleConnect}
          >
            {loading ? (
              <>
                <IconLoader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Initializing bridge...
              </>
            ) : completedSteps.build ? (
                <>
                    <IconCircleCheckFilled className="mr-2 h-3.5 w-3.5" />
                    Success!
                </>
            ) : (
              <>
                <IconRocket className="mr-2 h-3.5 w-3.5" />
                Connect Project
              </>
            )}
          </Button>
          <p className="text-[9px] sm:text-[10px] text-center text-muted-foreground mt-2 sm:mt-3 italic">
            A .factory folder will be created in the target repository.
          </p>
        </div>
      )
    }
  ];

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight">Projects</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Manage your connected repositories
            </p>
        </div>
        <Button size="sm" onClick={() => setShowModal(true)} className="text-xs">
            <IconPlus className="h-3.5 w-3.5 mr-2" />
            Add Project
        </Button>
      </div>

      <div className="space-y-2 sm:space-y-3">
          <h2 className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-widest pl-1">
            Connected Repositories
          </h2>
          
          {loadingProjects ? (
              <div className="space-y-2">
                  {[1, 2].map(i => (
                      <div key={i} className="h-14 sm:h-16 rounded-xl bg-muted/40 animate-pulse" />
                  ))}
              </div>
          ) : projects.length === 0 ? (
              <div className="glass-panel rounded-2xl border border-dashed border-border/60 bg-background/20 p-6 sm:p-10 flex flex-col items-center text-center gap-3 sm:gap-4 glow-purple">
                  <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-muted">
                    <IconFolder className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground/50" />
                  </div>
                  <div className="space-y-1">
                      <p className="text-xs sm:text-sm font-semibold">No projects connected</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground max-w-[200px] sm:max-w-[240px]">
                          Connect your first repository to start using Factory.
                      </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowModal(true)} className="text-xs">
                      <IconPlus className="h-3.5 w-3.5 mr-2" />
                      Connect First Project
                  </Button>
              </div>
          ) : (
              <div className="grid grid-cols-1 gap-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className={cn(
                      'glass-panel rounded-2xl border border-border/40 p-4 sm:p-5 space-y-3 transition-all duration-300 hover:shadow-md',
                      project.id === activeId ? 'border-primary/30 bg-primary/[0.02] glow-blue' : 'hover:border-border/60 hover:bg-muted/10'
                    )}
                  >
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg bg-background border">
                          <IconFolder className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <p className="text-[10px] sm:text-xs font-semibold truncate">{project.name}</p>
                            {project.id === activeId && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-medium text-primary">
                                <IconRadio className="h-1.5 w-1.5 sm:h-2 sm:w-2" />
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-[9px] sm:text-[10px] text-muted-foreground truncate font-mono mt-0.5">
                            {project.path}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {project.id !== activeId && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 sm:h-7 text-[9px] sm:text-[10px] px-1.5 sm:px-2"
                              onClick={() => handleSwitch(project.id)}
                              disabled={!!switching}
                            >
                              {switching === project.id ? (
                                <IconLoader2 className="h-2.5 w-2.5 sm:h-3 sm:w-3 animate-spin" />
                              ) : (
                                <span className="hidden sm:inline">Activate</span>
                              )}
                              {switching !== project.id && <span className="sm:hidden">✓</span>}
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7">
                                <IconDots className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                               <DropdownMenuItem 
                                className="text-destructive focus:text-destructive"
                                onClick={() => handleDelete(project.id)}
                                disabled={!!deleting}
                              >
                                <IconTrash className="mr-2 h-3.5 w-3.5" />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {/* Bridge Summary */}
                      {project.bridge && (
                        <div className="pl-9 sm:pl-11 space-y-2">
                          {/* Stack Badges */}
                          {project.bridge.stack && (
                            <div className="flex flex-wrap gap-1.5">
                              {project.bridge.stack.framework && (
                                <span className="inline-flex items-center rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-blue-400 ring-1 ring-inset ring-blue-500/20">
                                  {project.bridge.stack.framework}
                                </span>
                              )}
                              {project.bridge.stack.packageManager && (
                                <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                                  {project.bridge.stack.packageManager}
                                </span>
                              )}
                              {project.bridge.stack.database && (
                                <span className="inline-flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">
                                  {project.bridge.stack.database}
                                </span>
                              )}
                              {project.bridge.stack.cloud && (
                                <span className="inline-flex items-center rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-purple-400 ring-1 ring-inset ring-purple-500/20">
                                  {project.bridge.stack.cloud}
                                </span>
                              )}
                              {project.bridge.stack.testing && (
                                <span className="inline-flex items-center rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-rose-400 ring-1 ring-inset ring-rose-500/20">
                                  {project.bridge.stack.testing}
                                </span>
                              )}
                              {project.bridge.stack.linter && (
                                <span className="inline-flex items-center rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-cyan-400 ring-1 ring-inset ring-cyan-500/20">
                                  {project.bridge.stack.linter}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Stats Row */}
                          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-[9px] sm:text-[10px] text-muted-foreground">
                            {project.bridge.stats.apps > 0 && (
                              <span className="flex items-center gap-1">
                                <IconRocket className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                <span className="font-medium text-foreground">{project.bridge.stats.apps}</span> apps
                              </span>
                            )}
                            {project.bridge.stats.packages > 0 && (
                              <span className="flex items-center gap-1">
                                <IconArchive className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                <span className="font-medium text-foreground">{project.bridge.stats.packages}</span> packages
                              </span>
                            )}
                            {project.bridge.stats.scripts > 0 && (
                              <span className="flex items-center gap-1">
                                <IconSettings className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                <span className="font-medium text-foreground">{project.bridge.stats.scripts}</span> scripts
                              </span>
                            )}
                            {project.bridge.hasSkills && (
                              <span className="flex items-center gap-1">
                                <IconCheck className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-emerald-400" />
                                skills
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                ))}
              </div>
          )}
      </div>

      {/* Onboarding Modal */}
      <Dialog open={showModal} onOpenChange={(v) => !v && resetOnboarding()}>
        <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden gap-0 w-[95vw] max-h-[90vh]">
          <DialogHeader className="px-4 sm:px-6 py-3 sm:py-4 border-b flex flex-row items-center justify-between bg-muted/30">
            <DialogTitle className="text-xs sm:text-sm font-semibold">Connect New Project</DialogTitle>
            <div className="flex items-center gap-2 sm:gap-3">
              <CircularProgress completed={completedCount} total={totalSteps} />
              <div className="text-[9px] sm:text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground">{totalSteps - completedCount}</span> steps left
              </div>
            </div>
          </DialogHeader>

          <div className="p-0 max-h-[70vh] sm:max-h-[80vh] overflow-y-auto">
            {steps.map((step, index) => {
              const isOpen = openStepId === step.id;
              const isCompleted = completedSteps[step.id];
              const isFirst = index === 0;
              const prevStep = steps[index - 1];
              const isPrevOpen = prevStep && openStepId === prevStep.id;
              const showBorderTop = !isFirst && !isOpen && !isPrevOpen;

              return (
                <div
                  key={step.id}
                  className={cn(
                    "group transition-all duration-300",
                    isOpen && "bg-muted/10",
                    showBorderTop && "border-t"
                  )}
                >
                  <div className="px-4 sm:px-6 py-3 sm:py-4">
                    <div className="flex gap-3 sm:gap-4">
                      <div className="shrink-0 mt-0.5 sm:mt-1">
                        <StepIndicator completed={isCompleted} />
                      </div>
                      <div className="grow min-w-0">
                        <div 
                          role="button"
                          tabIndex={0}
                          className="flex items-center justify-between cursor-pointer focus-visible:outline-none min-h-[44px]"
                          onClick={() => {
                              const canOpen = index === 0 || completedSteps[steps[index-1].id];
                              if (canOpen) setOpenStepId(isOpen ? null : step.id);
                          }}
                        >
                          <h4 className={cn(
                            "text-[10px] sm:text-xs font-semibold transition-colors uppercase tracking-wider",
                            isCompleted ? "text-primary" : "text-foreground"
                          )}>
                            {step.title}
                          </h4>
                          <div className="flex items-center gap-2">
                            {!isOpen && !isCompleted && (
                              <IconChevronRight className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-muted-foreground/30" />
                            )}
                            {isCompleted && !isOpen && (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-4 sm:h-5 text-[8px] sm:text-[9px] px-1 sm:px-1.5 text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenStepId(step.id);
                                }}
                              >
                                Edit
                              </Button>
                            )}
                          </div>
                        </div>
                        
                        <div className="mt-1">
                          {!isOpen && step.summary && step.summary}
                        </div>

                        <Collapsible open={isOpen}>
                          <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in duration-300">
                            <p className="mt-2 text-[10px] sm:text-[11px] text-muted-foreground leading-relaxed">
                              {step.description}
                            </p>
                            {step.content}
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Folder browser dialog */}
      <FolderBrowser
        open={browseMode !== null}
        onClose={() => setBrowseMode(null)}
        onSelect={handleFolderSelected}
        mode={browseMode || 'existing'}
        title={browseMode === 'new'
          ? 'Create Project'
          : 'Select Folder'
        }
      />
    </div>
  );
}
