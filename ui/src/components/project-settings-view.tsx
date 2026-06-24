'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useFactoryStore, type ProjectItem } from '@/stores/factory-store';
import { toast } from 'sonner';
import { Settings2, Trash2, Loader2, AlertTriangle, Bot, Save } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function PiConfigPanel({ activeProject }: { activeProject: ProjectItem }) {
  const fetchAll = useFactoryStore((s) => s.fetchAll);
  const [config, setConfig] = useState(activeProject.piConfig || {
    thinkingLevel: 'low',
    enableSkills: true,
    enableExtensions: true,
    model: '',
  });
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(data => {
      const enabledProviders = data.providers?.filter((p: any) => p.enabled) || [];
      const configuredModels = enabledProviders.map((p: any) => {
        const modelId = p.defaultModel || p.kind;
        const modelObj = (p.models || []).find((m: any) => m.id === modelId);
        let modelName = modelObj ? (modelObj.name || modelObj.id) : modelId;
        if (modelName.includes(':')) {
          modelName = modelName.split(':').slice(1).join(':').trim();
        }
        return { id: `${p.id}/${modelId}`, name: `${p.name}: ${modelName}` };
      }).filter((m: any) => m.id);
      setModels(configuredModels);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piConfig: config }),
      });
      if (res.ok) {
        toast.success('Pi Configuration saved');
        fetchAll();
      } else {
        toast.error('Failed to save configuration');
      }
    } catch {
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 border border-border/40 bg-card/40 space-y-6 shadow-sm">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-emerald-500" />
          <h3 className="text-base font-semibold text-foreground">Pi Agent Configuration</h3>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2 shadow-sm w-full md:w-auto">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Configuration
        </Button>
      </div>

      <div className="space-y-6">
        <div className="grid gap-2">
          <Label className="text-sm">Pi Execution Model Override</Label>
          <Select value={config.model || 'default'} onValueChange={v => setConfig({ ...config, model: v === 'default' ? '' : v })}>
            <SelectTrigger className="w-[300px] h-9">
              <SelectValue placeholder="Use Global Default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Use Global Default</SelectItem>
              {models.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Overrides the global active provider for Pi agent execution.</p>
        </div>

        <div className="grid gap-2">
          <Label className="text-sm">Thinking Level</Label>
          <Select value={config.thinkingLevel} onValueChange={v => setConfig({ ...config, thinkingLevel: v })}>
            <SelectTrigger className="w-[300px] h-9">
              <SelectValue placeholder="Select level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="minimal">Minimal</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="xhigh">Extra High</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">How much time the agent spends thinking before acting.</p>
        </div>

        <div className="flex items-center justify-between py-2 border-t border-border/20">
          <div>
            <Label className="text-sm">Enable Skills</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Allow Pi to use configured factory skills (context retrieval).</p>
          </div>
          <Switch checked={config.enableSkills} onCheckedChange={v => setConfig({ ...config, enableSkills: v })} />
        </div>

        <div className="flex items-center justify-between py-2 border-t border-border/20">
          <div>
            <Label className="text-sm">Enable Extensions</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Allow Pi to connect to MCP extensions (adds ~30s to spawn time).</p>
          </div>
          <Switch checked={config.enableExtensions} onCheckedChange={v => setConfig({ ...config, enableExtensions: v })} />
        </div>
      </div>
    </Card>
  );
}

export function ProjectSettingsView() {
  const activeProject = useFactoryStore((s) => s.activeProject);
  const fetchAll = useFactoryStore((s) => s.fetchAll);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!activeProject) return;
    if (!confirm(`Are you sure you want to remove the project "${activeProject.name}" from Factory? The files on disk will not be deleted.`)) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Project removed');
        fetchAll();
        setTimeout(() => {
          window.location.hash = 'plan';
          window.location.reload();
        }, 1000);
      } else {
        toast.error('Failed to remove project');
      }
    } catch {
      toast.error('Failed to remove project');
    } finally {
      setDeleting(false);
    }
  };

  if (!activeProject) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60 border border-dashed border-border rounded-xl bg-card/5">
        <Settings2 className="h-8 w-8 opacity-30 mb-2" />
        <p className="text-xs font-medium">No active project</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground border-b border-border/40 pb-4">
        <span className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <span className="font-semibold text-foreground">Project Settings</span>
        </span>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="agent">Agent Configuration</TabsTrigger>
        </TabsList>
        
        <TabsContent value="general" className="space-y-6 max-w-3xl">
          <Card className="p-6 border border-border/60 bg-card/10 space-y-4 shadow-sm">
            <div>
              <h3 className="text-lg font-semibold text-foreground">{activeProject.name}</h3>
              <p className="text-sm font-mono text-muted-foreground mt-1">{activeProject.path}</p>
            </div>
          </Card>

          <Card className="p-6 border border-red-500/20 bg-red-500/5 space-y-4 shadow-sm">
            <div>
              <h3 className="text-lg font-semibold text-red-500 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" /> Danger Zone
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Remove this project from Factory. This will not delete the project files from your hard drive, but it will remove it from the Factory workspace.
              </p>
            </div>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={handleDelete}
              className="gap-2"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Remove Project
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="agent" className="space-y-6 max-w-3xl mt-4">
          <PiConfigPanel activeProject={activeProject} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
