'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
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
  layout: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  auth: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  api: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  data: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  ui: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
  integration: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  custom: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  general: 'bg-muted/50 text-muted-foreground border-muted/30',
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
      <div className="space-responsive">
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

        {/* Category tabs — scrollable on mobile */}
        <Tabs value={activeCategory} onValueChange={setActiveCategory}>
          <TabsList className="bg-muted/50 overflow-x-auto w-full justify-start sm:justify-start scrollbar-hide">
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
          <Card>
            <CardContent className="py-12 sm:py-16 text-center">
              <Wand2 className="h-10 sm:h-12 w-10 sm:w-12 mx-auto mb-3 sm:mb-4 text-muted-foreground/30" />
              <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                {searchQuery || activeCategory !== 'all' ? 'No skills match your filter' : 'No skills yet'}
              </p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
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
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {filteredSkills.map(skill => {
              const isExpanded = expandedSkill === skill.id;
              const CatIcon = categoryIcon(skill.category);

              return (
                <Card
                  key={skill.id}
                  className={`transition-all duration-200 ${
                    skill.enabled
                      ? 'border-border hover:border-primary/30 hover:shadow-md'
                      : 'border-border/50 opacity-60'
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2 sm:gap-3">
                      <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
                        <div className={`flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg ${CATEGORY_COLORS[skill.category] || CATEGORY_COLORS.general}`}>
                          <CatIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <CardTitle className="text-xs sm:text-sm truncate">{skill.name}</CardTitle>
                            <Badge
                              variant="outline"
                              className={`text-[9px] sm:text-[10px] shrink-0 ${CATEGORY_COLORS[skill.category] || CATEGORY_COLORS.general}`}
                            >
                              {skill.category}
                            </Badge>
                          </div>
                          {skill.description && (
                            <CardDescription className="text-[10px] sm:text-xs mt-1 line-clamp-2">
                              {skill.description}
                            </CardDescription>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={skill.enabled}
                          onCheckedChange={(checked) => handleToggle(skill, checked)}
                          className="scale-75"
                        />
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0 space-y-2 sm:space-y-3">
                    {/* Tags */}
                    {skill.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {skill.tags.map(tag => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-muted-foreground"
                          >
                            <Tag className="h-2 w-2 sm:h-2.5 sm:w-2.5" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Trigger pattern */}
                    {skill.trigger && (
                      <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground">
                        <Zap className="h-3 w-3 text-amber-400 shrink-0" />
                        <code className="bg-muted px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-mono">{skill.trigger}</code>
                      </div>
                    )}

                    {/* Expandable instructions preview */}
                    <div>
                      <button
                        onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
                        className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-1"
                      >
                        <FileText className="h-3 w-3 shrink-0" />
                        <span>{isExpanded ? 'Hide instructions' : 'Show instructions'}</span>
                        {isExpanded ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
                      </button>
                      {isExpanded && (
                        <div className="mt-2 rounded-lg bg-muted/50 p-2 sm:p-3 text-[10px] sm:text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                          {skill.instructions}
                          {skill.template && (
                            <>
                              <Separator className="my-2 sm:my-3" />
                              <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">Template</p>
                              <pre className="bg-background rounded p-2 overflow-x-auto text-[10px] font-mono">
                                {skill.template}
                              </pre>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <Separator />

                    {/* Action buttons */}
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] sm:text-[10px] text-muted-foreground">
                        {skill.updatedAt ? `Updated ${new Date(skill.updatedAt).toLocaleDateString()}` : ''}
                      </span>
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleCopyInstructions(skill)}
                            >
                              {copiedId === skill.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Copy instructions</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openEditDialog(skill)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Edit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(skill)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">Delete</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </CardContent>
                </Card>
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
