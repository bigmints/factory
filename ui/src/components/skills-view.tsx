'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Wand2,
  Plus,
  Search,
  Tag,
  Trash2,
  Pencil,
  Zap,
  Code2,
  Shield,
  Database,
  Layout,
  Palette,
  Plug,
  Layers,
  X,
  FileText,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  trigger: string;
  instructions: string;
  template: string;
  category: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  { id: 'all', label: 'All', icon: Layers },
  { id: 'layout', label: 'Layout', icon: Layout },
  { id: 'auth', label: 'Auth', icon: Shield },
  { id: 'api', label: 'API', icon: Zap },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'ui', label: 'UI', icon: Palette },
  { id: 'integration', label: 'Integration', icon: Plug },
  { id: 'custom', label: 'Custom', icon: Code2 },
  { id: 'general', label: 'General', icon: Wand2 },
];

const CATEGORY_COLORS: Record<string, string> = {
  layout: 'bg-muted text-muted-foreground border-border',
  auth: 'bg-muted text-muted-foreground border-border',
  api: 'bg-muted text-muted-foreground border-border',
  data: 'bg-muted text-muted-foreground border-border',
  ui: 'bg-muted text-muted-foreground border-border',
  integration: 'bg-muted text-muted-foreground border-border',
  custom: 'bg-muted text-muted-foreground border-border',
  general: 'bg-muted text-muted-foreground border-border',
};

const EMPTY_FORM = {
  name: '',
  description: '',
  category: 'general',
  tags: '',
  trigger: '',
  instructions: '',
  template: '',
  enabled: true,
};

export function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (activeCategory !== 'all') params.set('category', activeCategory);
      const res = await fetch(`/api/skills?${params}`);
      const data = await res.json();
      setSkills(data.skills || []);
    } catch {
      console.error('Failed to fetch skills');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, activeCategory]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const openNewDialog = () => {
    setEditingSkill(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (skill: Skill) => {
    setEditingSkill(skill);
    setForm({
      name: skill.name,
      description: skill.description,
      category: skill.category,
      tags: skill.tags.join(', '),
      trigger: skill.trigger,
      instructions: skill.instructions,
      template: skill.template,
      enabled: skill.enabled,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.instructions.trim()) {
      toast.error('Name and instructions are required');
      return;
    }

    setSaving(true);
    try {
      const method = editingSkill ? 'PUT' : 'POST';
      const body = {
        ...(editingSkill ? { id: editingSkill.id, createdAt: editingSkill.createdAt } : {}),
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        trigger: form.trigger.trim(),
        instructions: form.instructions.trim(),
        template: form.template.trim(),
        enabled: form.enabled,
      };

      const res = await fetch('/api/skills', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success(editingSkill ? 'Skill updated' : 'Skill created', {
          description: form.name,
        });
        setDialogOpen(false);
        fetchSkills();
      } else {
        const data = await res.json();
        toast.error('Failed to save', { description: data.error });
      }
    } catch {
      toast.error('Failed to save skill');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/skills?id=${encodeURIComponent(deleteTarget.name)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('Skill deleted', { description: deleteTarget.name });
        setDeleteTarget(null);
        fetchSkills();
      } else {
        toast.error('Failed to delete skill');
      }
    } catch {
      toast.error('Failed to delete skill');
    }
  };

  const handleToggle = async (skill: Skill, enabled: boolean) => {
    try {
      await fetch('/api/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...skill, tags: skill.tags, enabled }),
      });
      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, enabled } : s));
      toast.success(enabled ? 'Skill enabled' : 'Skill disabled', { description: skill.name });
    } catch {
      toast.error('Failed to toggle skill');
    }
  };

  const handleCopyInstructions = (skill: Skill) => {
    navigator.clipboard.writeText(skill.instructions);
    setCopiedId(skill.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredSkills = skills;
  const enabledCount = skills.filter(s => s.enabled).length;

  const categoryIcon = (cat: string) => {
    const found = CATEGORIES.find(c => c.id === cat);
    return found ? found.icon : Wand2;
  };

  return (
    <TooltipProvider>
      <div className="space-y-6 md:space-y-8 flex flex-col">
        {/* Header bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs sm:text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-500 shrink-0" />
              <span className="font-medium text-foreground">{skills.length}</span> Skills
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="font-medium text-foreground">{enabledCount}</span> Active
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search skills..."
                className="h-8 sm:h-9 w-full sm:w-56 pl-8 text-xs sm:text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Button size="sm" onClick={openNewDialog} className="h-8 sm:h-9 text-xs gap-1.5 shrink-0">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New Skill</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        </div>

        <Tabs value={activeCategory} onValueChange={setActiveCategory}>
          <TabsList className="bg-muted overflow-x-auto w-full justify-start sm:justify-start scrollbar-hide">
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const count = cat.id === 'all'
                ? skills.length
                : skills.filter(s => s.category === cat.id).length;
              return (
                <TabsTrigger key={cat.id} value={cat.id} className="text-[10px] sm:text-xs gap-1.5 whitespace-nowrap px-2 sm:px-3">
                  <Icon className="h-3 w-3" />
                  {cat.label}
                  {count > 0 && (
                    <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0 text-[9px] font-medium">
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {/* Skills grid — 1 col mobile, 2 cols desktop */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-44 rounded-lg" />
            ))}
          </div>
        ) : filteredSkills.length === 0 ? (
          <Card className="border-dashed flex flex-col items-center justify-center p-6 sm:p-10 text-center">
            <Wand2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <h3 className="font-semibold text-sm">
              {searchQuery || activeCategory !== 'all' ? 'No skills match your filter' : 'No skills yet'}
            </h3>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">
              {searchQuery || activeCategory !== 'all'
                ? 'Try adjusting your search or category filter'
                : 'Click "New Skill" to create your first reusable recipe'}
            </p>
            {!searchQuery && activeCategory === 'all' && (
              <Button size="sm" className="mt-4 text-xs gap-1.5" onClick={openNewDialog}>
                <Plus className="h-3.5 w-3.5" />
                Create Your First Skill
              </Button>
            )}
          </Card>
        ) : (
          <div className="divide-y divide-border border border-border rounded-xl bg-card/5 overflow-hidden">
            {filteredSkills.map(skill => {
              const isExpanded = expandedSkill === skill.id;
              const CatIcon = categoryIcon(skill.category);

              return (
                <div
                  key={skill.id}
                  className={cn(
                    "flex flex-col transition-colors duration-150",
                    skill.enabled ? 'bg-transparent' : 'opacity-60 bg-muted/5'
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 gap-4">
                    {/* Left side info */}
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                      <span className={cn(
                        "h-2 w-2 rounded-full shrink-0 transition-all sm:mt-0 mt-2",
                        skill.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                      )} />
                      <div className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground select-none shadow-xs sm:mt-0 mt-1"
                      )}>
                        <CatIcon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground truncate">{skill.name}</span>
                          <Badge
                            variant="outline"
                            className="text-[9px] font-semibold h-4 px-2 rounded-full shrink-0 border-border bg-muted/40 uppercase"
                          >
                            {skill.category}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {skill.description || "No description provided."}
                        </p>
                      </div>
                    </div>

                    {/* Right actions and switch */}
                    <div className="flex items-center justify-end gap-2.5 shrink-0 select-none">
                      {skill.trigger && (
                        <span className="text-[10px] font-mono text-muted-foreground/80 bg-muted/60 border px-2 py-0.5 rounded max-w-[120px] truncate">
                          {skill.trigger}
                        </span>
                      )}

                      <Switch
                        checked={skill.enabled}
                        onCheckedChange={(checked) => handleToggle(skill, checked)}
                        className="scale-75"
                      />

                      <div className="h-4 w-px bg-border mx-1 hidden sm:block" />

                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground rounded-md"
                              onClick={() => handleCopyInstructions(skill)}
                            >
                              {copiedId === skill.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-[10px]">Copy instructions</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground rounded-md"
                              onClick={() => openEditDialog(skill)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-[10px]">Edit</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-destructive hover:text-destructive rounded-md"
                              onClick={() => setDeleteTarget(skill)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-[10px]">Delete</TooltipContent>
                        </Tooltip>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-md text-muted-foreground hover:bg-muted"
                          onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-6 py-4 bg-muted/20 border-t border-border/40 text-xs text-muted-foreground space-y-3.5 animate-in fade-in duration-150">
                      {/* Tags */}
                      {skill.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pb-2">
                          {skill.tags.map(tag => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="text-[9px] font-medium py-0 px-2 flex items-center gap-1 bg-muted/60 border border-border/40 text-muted-foreground"
                            >
                              <Tag className="h-2.5 w-2.5" />
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                      
                      <div className="flex flex-col gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Instructions</span>
                        <div className="rounded-md bg-background border p-4 font-mono leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
                          {skill.instructions}
                        </div>
                      </div>

                      {skill.template && (
                        <div className="flex flex-col gap-2 pt-2 border-t border-border/20">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Starter Code Template</span>
                          <pre className="bg-background rounded-md border p-4 overflow-x-auto text-[10px] font-mono leading-relaxed text-foreground/90">
                            {skill.template}
                          </pre>
                        </div>
                      )}

                      {skill.updatedAt && (
                        <div className="text-[9px] font-mono text-muted-foreground/50 pt-2 border-t border-border/10">
                          Last updated: {new Date(skill.updatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* New / Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto w-[95vw]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
                <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-primary shrink-0" />
                {editingSkill ? 'Edit Skill' : 'New Skill'}
              </DialogTitle>
              <DialogDescription className="text-[10px] sm:text-xs">
                {editingSkill
                  ? 'Update this skill recipe. Changes are saved to a markdown file.'
                  : 'Create a reusable skill recipe. The engine will auto-match it to relevant builds.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 sm:space-y-4 py-2">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="skill-name" className="text-xs font-medium">Name *</Label>
                <Input
                  id="skill-name"
                  placeholder="e.g. Scaffold shadcn Layout"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="h-9 text-xs sm:text-sm"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="skill-desc" className="text-xs font-medium">Description</Label>
                <Input
                  id="skill-desc"
                  placeholder="Brief summary of what this skill does"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="h-9 text-xs sm:text-sm"
                />
              </div>

              {/* Category + Tags row — 1 col mobile, 2 cols desktop */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Category</Label>
                  <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger className="h-9 text-xs sm:text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.filter(c => c.id !== 'all').map(cat => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <span className="flex items-center gap-2">
                            <cat.icon className="h-3.5 w-3.5" />
                            {cat.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="skill-tags" className="text-xs font-medium">Tags (comma-separated)</Label>
                  <Input
                    id="skill-tags"
                    placeholder="e.g. shadcn, layout, sidebar"
                    value={form.tags}
                    onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                    className="h-9 text-xs sm:text-sm"
                  />
                </div>
              </div>

              {/* Trigger */}
              <div className="space-y-2">
                <Label htmlFor="skill-trigger" className="text-xs font-medium">
                  Trigger Pattern
                  <span className="text-muted-foreground font-normal ml-1.5">(regex or keywords)</span>
                </Label>
                <Input
                  id="skill-trigger"
                  placeholder="e.g. shadcn|layout|sidebar"
                  value={form.trigger}
                  onChange={e => setForm(f => ({ ...f, trigger: e.target.value }))}
                  className="h-9 text-xs sm:text-sm font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Used for auto-matching. Pipe-separated keywords or a regex pattern.
                </p>
              </div>

              <Separator />

              {/* Instructions */}
              <div className="space-y-2">
                <Label htmlFor="skill-instructions" className="text-xs font-medium">Instructions * (Markdown)</Label>
                <Textarea
                  id="skill-instructions"
                  placeholder="Step-by-step instructions for the LLM to follow when this skill is activated..."
                  value={form.instructions}
                  onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                  className="min-h-[120px] sm:min-h-[160px] text-xs sm:text-sm font-mono leading-relaxed"
                />
              </div>

              {/* Template */}
              <div className="space-y-2">
                <Label htmlFor="skill-template" className="text-xs font-medium">
                  Template Code
                  <span className="text-muted-foreground font-normal ml-1.5">(optional)</span>
                </Label>
                <Textarea
                  id="skill-template"
                  placeholder="Optional starter code template..."
                  value={form.template}
                  onChange={e => setForm(f => ({ ...f, template: e.target.value }))}
                  className="min-h-[80px] sm:min-h-[100px] text-xs sm:text-sm font-mono leading-relaxed"
                />
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between rounded-lg border p-2 sm:p-3">
                <div>
                  <p className="text-xs sm:text-sm font-medium">Enabled</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Active skills are auto-matched during builds</p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={checked => setForm(f => ({ ...f, enabled: checked }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="text-xs gap-1.5">
                {saving ? (
                  <>Saving...</>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    {editingSkill ? 'Save Changes' : 'Create Skill'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-md w-[95vw]">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2 text-sm sm:text-base">
                <Trash2 className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
                Delete Skill
              </DialogTitle>
              <DialogDescription className="text-[10px] sm:text-xs">
                This will permanently delete the skill file <strong>&quot;{deleteTarget?.name}&quot;</strong> from{' '}
                <code className="text-[10px] bg-muted px-1 py-0.5 rounded">~/.factory/skills/</code>.
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} className="text-xs">
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} className="text-xs gap-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
