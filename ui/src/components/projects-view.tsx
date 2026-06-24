import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFactoryStore } from '@/stores/factory-store';
import { toast } from 'sonner';
import { FolderOpen, Check, RefreshCw, Loader2, ArrowRight, Sparkles, Rocket, Code2, Terminal } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

export function ProjectsView({ onAddProject }: { onAddProject?: () => void }) {
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
    <div className="w-full flex flex-col pb-24 animate-in fade-in duration-700">
      
      {/* Ambient Page Glows */}
      <div className="absolute top-0 left-0 right-0 h-96 overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-32 -left-32 h-[500px] w-[500px] rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute top-0 right-0 h-[400px] w-[400px] rounded-full bg-secondary/10 blur-[100px]" />
      </div>

      {/* Seamless Page Header */}
      <div className="relative pt-16 md:pt-24 pb-8 mb-12 w-full max-w-6xl mx-auto px-4 md:px-6 flex flex-col md:flex-row md:items-end justify-between gap-8">
        
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 mb-6 rounded-md border border-primary/20 bg-primary/5 text-primary font-bold uppercase tracking-wider shadow-sm text-[11px]">
            <Sparkles className="h-3 w-3" />
            <span>Factory Workspace</span>
          </div>
          
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground mb-4 drop-shadow-sm">
            Build incredible apps.
          </h1>
          
          <p className="text-muted-foreground text-base md:text-lg leading-relaxed max-w-xl">
            Select a workspace to resume your work, or initialize a new repository to start your next great idea.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-3 shrink-0 pb-1">
          {onAddProject && (
            <Button 
              onClick={onAddProject} 
              className="shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:shadow-primary/30"
              size="lg"
            >
              <Rocket className="mr-2 h-4.5 w-4.5" /> Start Building
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={loadProjects} 
            disabled={loading} 
            className="transition-colors shadow-sm"
            size="icon"
          >
            <RefreshCw className={`h-4.5 w-4.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="w-full max-w-6xl mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold tracking-tight">Your Workspaces</h2>
          <Badge variant="secondary" className="px-2.5 py-0.5 rounded-md text-xs font-semibold">
            {projects.length} connected
          </Badge>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="h-48 rounded-2xl border-border/40 bg-card/20 animate-pulse" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border/50 rounded-3xl bg-card/10">
            <div className="h-16 w-16 mb-4 rounded-full bg-muted/50 flex items-center justify-center">
              <FolderOpen className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-semibold">No workspaces found</h3>
            <p className="text-muted-foreground max-w-sm mt-2 mb-6">
              You haven&apos;t connected any projects yet. Click &quot;Start Building&quot; above to initialize a new one.
            </p>
            {onAddProject && (
              <Button variant="outline" onClick={onAddProject} className="rounded-xl border-dashed">
                Connect your first project
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {projects.map((project) => {
              const isActive = project.id === activeId;
              const isSwitching = switching === project.id;
              
              return (
                <Card 
                  key={project.id} 
                  className={`group relative overflow-hidden p-6 rounded-2xl border transition-all duration-300 hover:-translate-y-1 hover:shadow-xl flex flex-col justify-between h-56 ${
                    isActive 
                      ? 'border-primary/40 bg-gradient-to-br from-primary/10 to-transparent shadow-primary/10' 
                      : 'border-border/50 bg-card/40 hover:border-primary/30 backdrop-blur-sm shadow-sm'
                  }`}
                >
                  {/* Card Background Glow */}
                  <div className="absolute -inset-0.5 bg-gradient-to-br from-primary to-secondary rounded-2xl opacity-0 group-hover:opacity-10 transition duration-500 pointer-events-none blur-xl" />

                  <div className="relative z-10 space-y-4">
                    <div className="flex items-start justify-between">
                      <div className={`p-3 rounded-xl ${isActive ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30' : 'bg-muted text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors'}`}>
                        {isActive ? <Code2 className="h-6 w-6" /> : <FolderOpen className="h-6 w-6" />}
                      </div>
                      {isActive && (
                        <Badge className="bg-primary/10 text-primary border-primary/20 px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider">
                          Active
                        </Badge>
                      )}
                    </div>
                    
                    <div className="space-y-1">
                      <h3 className="text-lg font-bold text-foreground line-clamp-1" title={project.name}>
                        {project.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                        <Terminal className="h-3 w-3 shrink-0" />
                        <span className="truncate">{project.path}</span>
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 flex items-center justify-between pt-4 border-t border-border/40 mt-4">
                    <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground/60">
                      Connected {new Date(project.addedAt).toLocaleDateString()}
                    </span>
                    
                    {isActive ? (
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                        <Check className="h-4 w-4" /> Ready
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant={isSwitching ? "secondary" : "ghost"}
                        disabled={switching !== null}
                        onClick={() => handleSwitch(project.id)}
                        className={`h-8 px-3 text-xs font-semibold rounded-lg transition-all ${isSwitching ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0'} hover:bg-primary hover:text-primary-foreground`}
                      >
                        {isSwitching ? (
                          <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Switching</>
                        ) : (
                          <>Open <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></>
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
    </div>
  );
}
