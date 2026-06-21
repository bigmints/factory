'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  CheckCircle2, Loader2, AlertTriangle, Layers, FileCode2, Database,
  Pencil, Trash2, FileText, Save, Copy, Clock, Check, Play, ListTodo, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { YamlViewer } from './yaml-viewer';
import { storyStatusMap } from './constants';
import { getRelatedStories } from './utils';

// ─── Props ───

export interface StoryDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItem: {
    type: 'task' | 'story';
    data: any;
    parentStory?: any;
    parentFeature?: any;
  } | null;
  /** All merged stories — used for dependency resolution & related-stories graph */
  stories: any[];
  /** Feature stories — for dependency resolution */
  featureStories: any[];
  /** Queue items — for queue status lookup */
  queueItems: any[];
  onEnqueue: (file: string, kind: string, opts?: any) => void;
  onBuild: (file: string) => void;
  onValidate: (file: string) => void;
  onUpdateStatus: (file: string, status: string) => void;
  onSaveYaml: (file: string, content: string) => Promise<boolean>;
  onDeleteStory: (file: string) => Promise<void>;
  onUpdateTaskStatus: (featureSlug: string, taskId: string, done: boolean) => void;
  onDeleteTask: (featureSlug: string, taskId: string) => void;
  onOpenEditor: (file: string, name: string) => void;
}

// ─── Helper: resolve title & description from a story item ───

function getStoryTitle(item: any): string {
  if (item.kind === 'FeatureStory' || !!item.feature) {
    return item.name || item.feature?.name || item.dbName || item.file;
  }
  return item.metadata?.name || item.dbName || item.file;
}

function getStoryDesc(item: any): string {
  if (item.kind === 'FeatureStory' || !!item.feature) {
    return item.feature?.description || 'Feature spec story';
  }
  return item.metadata?.description || 'Core system spec story';
}

// ─── Component ───

export function StoryDetailDrawer({
  open,
  onOpenChange,
  selectedItem: selectedItemProp,
  stories: mergedStories,
  featureStories: _featureStories,
  queueItems: _queueItems,
  onEnqueue,
  onBuild: _onBuild,
  onValidate: _onValidate,
  onUpdateStatus,
  onSaveYaml,
  onDeleteStory,
  onUpdateTaskStatus,
  onDeleteTask,
  onOpenEditor,
}: StoryDetailDrawerProps) {
  // ─── Local state ───
  const [yamlContent, setYamlContent] = useState<string | null>(null);
  const [loadingYaml, setLoadingYaml] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedYaml, setEditedYaml] = useState('');
  const [savingYaml, setSavingYaml] = useState(false);
  const [storyTab, setStoryTab] = useState<'spec' | 'raw' | 'tasks'>('spec');
  const [copiedYaml, setCopiedYaml] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Keep a local mutable copy of selectedItem so we can do optimistic UI updates
  const [selectedItem, setSelectedItem] = useState(selectedItemProp);

  // Sync external prop → internal state
  useEffect(() => {
    setSelectedItem(selectedItemProp);
  }, [selectedItemProp]);

  // ─── Fetch YAML when drawer opens with a story ───

  const fetchStoryYaml = useCallback(async (file: string) => {
    setLoadingYaml(true);
    setYamlContent(null);
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(file)}`);
      if (res.ok) {
        const data = await res.json();
        setYamlContent(data.content);
        setEditedYaml(data.content);
      }
    } catch { /* swallow */ }
    finally { setLoadingYaml(false); }
  }, []);

  // Whenever the prop changes (new item selected), reset drawer state
  useEffect(() => {
    if (selectedItemProp) {
      setEditMode(false);
      setDeleteConfirm(false);
      setStoryTab('spec');
      setYamlContent(null);
      if (selectedItemProp.type === 'story' && selectedItemProp.data?.file) {
        fetchStoryYaml(selectedItemProp.data.file);
      }
    }
  }, [selectedItemProp, fetchStoryYaml]);

  // ─── Internal handlers (thin wrappers around props) ───

  const handleSaveYaml = async (file: string) => {
    setSavingYaml(true);
    try {
      const ok = await onSaveYaml(file, editedYaml);
      if (ok) {
        setYamlContent(editedYaml);
        setEditMode(false);
      }
    } catch { /* handled upstream */ }
    finally { setSavingYaml(false); }
  };

  const handleOpenRelated = (story: any) => {
    // Navigate to the related story by updating our own selected item
    setSelectedItem({ type: 'story', data: story, parentStory: undefined, parentFeature: story.epicParent });
    setEditMode(false);
    setDeleteConfirm(false);
    setStoryTab('spec');
    setYamlContent(null);
    if (story.file) fetchStoryYaml(story.file);
  };

  // ─── Render ───

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setEditMode(false); setDeleteConfirm(false); } }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl bg-zinc-950/95 backdrop-blur-md border-l border-border/40 shadow-2xl flex flex-col p-0 h-full overflow-hidden focus:outline-none"
      >
        {selectedItem && (
          <div className="flex flex-col h-full min-h-0 divide-y divide-border/20 text-zinc-300">

            {/* ── UNIFIED COMPACT HEADER ── */}
            <div className="shrink-0 px-5 pt-3.5 pb-0 bg-zinc-900/40 border-b border-border/20 relative flex flex-col gap-2 select-none">
              {/* Row 1: Category, Status, & Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pr-8">
                {/* Category Label */}
                <div className="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  {selectedItem.type === 'story'
                    ? (selectedItem.data.kind === 'FeatureStory' ? 'Feature spec story' : 'App bootstrap story')
                    : 'Story sub-task'}
                </div>

                {/* Controls / Actions */}
                <div className="flex items-center gap-2">
                  {/* Status Dropdown */}
                  {selectedItem.type === 'story' ? (
                    <select
                      value={selectedItem.data.status ?? 'draft'}
                      onChange={e => {
                        onUpdateStatus(selectedItem.data.file, e.target.value);
                        setSelectedItem(prev => prev ? { ...prev, data: { ...prev.data, status: e.target.value } } : null);
                      }}
                      className="h-7 rounded border border-zinc-800 bg-zinc-950 text-[10px] font-medium text-zinc-300 px-2 focus:outline-none focus:ring-1 focus:ring-primary/60 font-sans cursor-pointer hover:bg-zinc-900 hover:text-white transition-all shrink-0"
                    >
                      <option value="draft">Draft</option>
                      <option value="ready-to-build">Ready to Build</option>
                      <option value="review">In Review</option>
                      <option value="done">Done</option>
                    </select>
                  ) : (
                    <select
                      value={selectedItem.data.status ?? 'draft'}
                      onChange={e => {
                        onUpdateTaskStatus(selectedItem.data.fullId, e.target.value, false);
                        setSelectedItem(prev => prev ? { ...prev, data: { ...prev.data, status: e.target.value } } : null);
                      }}
                      className="h-7 rounded border border-zinc-800 bg-zinc-950 text-[10px] font-medium text-zinc-300 px-2 focus:outline-none focus:ring-1 focus:ring-primary/60 font-sans cursor-pointer hover:bg-zinc-900 hover:text-white transition-all shrink-0"
                    >
                      <option value="pending">Pending</option>
                      <option value="running">Running</option>
                      <option value="completed">Completed</option>
                      <option value="failed">Failed</option>
                    </select>
                  )}

                  {/* Build / Edit / Delete Actions */}
                  {selectedItem.type === 'story' ? (
                    <>
                      <Button
                        size="sm"
                        className="h-7 px-2.5 gap-1 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-all flex items-center shrink-0"
                        onClick={() => {
                          onEnqueue(selectedItem.data.file, selectedItem.data.kind);
                          onOpenChange(false);
                        }}
                      >
                        <Play className="h-2.5 w-2.5 fill-current" />
                        <span>Build</span>
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 gap-1 text-[10px] border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-white rounded transition-all shrink-0"
                        onClick={() => {
                          onOpenEditor(selectedItem.data.file, selectedItem.data.name);
                          onOpenChange(false);
                        }}
                      >
                        <Pencil className="h-2.5 w-2.5" />
                        <span>Edit Form</span>
                      </Button>

                      {!deleteConfirm ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-zinc-500 hover:text-rose-450 hover:bg-rose-950/20 rounded transition-all shrink-0"
                          onClick={() => setDeleteConfirm(true)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1 bg-rose-950/30 border border-rose-800/40 rounded p-0.5 shrink-0">
                          <span className="text-[9px] text-rose-400 font-bold px-1.5">Delete?</span>
                          <Button
                            size="sm"
                            className="h-5.5 px-1.5 text-[9px] bg-rose-600 hover:bg-rose-505 text-white font-bold"
                            onClick={() => {
                              onDeleteStory(selectedItem.data.file);
                              onOpenChange(false);
                            }}
                          >
                            Yes
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5.5 px-1.5 text-[9px] text-zinc-400 hover:text-white"
                            onClick={() => setDeleteConfirm(false)}
                          >
                            No
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {!deleteConfirm ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2.5 gap-1 text-[10px] text-zinc-500 hover:text-rose-450 hover:bg-rose-950/20 rounded transition-all shrink-0"
                          onClick={() => setDeleteConfirm(true)}
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Delete</span>
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1 bg-rose-950/30 border border-rose-800/40 rounded p-0.5 shrink-0">
                          <span className="text-[9px] text-rose-400 font-bold px-1.5">Delete?</span>
                          <Button
                            size="sm"
                            className="h-5.5 px-1.5 text-[9px] bg-rose-600 hover:bg-rose-505 text-white font-bold"
                            onClick={() => {
                              onDeleteTask(selectedItem.data.fullId, selectedItem.data.fullId);
                              onOpenChange(false);
                            }}
                          >
                            Yes
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5.5 px-1.5 text-[9px] text-zinc-400 hover:text-white"
                            onClick={() => setDeleteConfirm(false)}
                          >
                            No
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Row 2: Title and Subtitle */}
              <div className="space-y-1">
                <SheetTitle className="text-sm font-bold text-white tracking-tight pr-6 select-all flex items-center gap-2 leading-tight">
                  {selectedItem.type === 'task' ? selectedItem.data.title : getStoryTitle(selectedItem.data)}
                </SheetTitle>

                {selectedItem.type === 'story' && getStoryDesc(selectedItem.data) && (
                  <p className="text-[11px] text-zinc-400 font-sans leading-relaxed select-all line-clamp-2">
                    {getStoryDesc(selectedItem.data)}
                  </p>
                )}

                {selectedItem.type === 'task' && selectedItem.parentStory && (
                  <p className="text-[10px] text-zinc-500 font-sans select-all">
                    Parent Story: <span className="text-zinc-400 font-semibold">{selectedItem.parentStory.name}</span>
                  </p>
                )}
              </div>

              {/* Row 3: Tabs System (Only for Story) */}
              {selectedItem.type === 'story' && (
                <div className="flex items-end gap-1.5 mt-1 border-t border-border/10 pt-1">
                  {([
                    { key: 'spec', label: 'Specification' },
                    { key: 'raw', label: 'YAML Source' },
                    { key: 'tasks', label: 'Sub-tasks' }
                  ] as const).map(({ key, label }) => {
                    const isTasks = key === 'tasks';
                    const taskCount = selectedItem.data.checklistTasks?.length ?? 0;
                    return (
                      <button
                        key={key}
                        onClick={() => setStoryTab(key)}
                        className={cn(
                          'px-3 py-1.5 text-[11px] font-semibold border-b-2 transition-all font-sans relative flex items-center gap-1.5 focus:outline-none cursor-pointer',
                          storyTab === key
                            ? 'border-primary text-white font-bold'
                            : 'border-transparent text-zinc-500 hover:text-zinc-300'
                        )}
                      >
                        {label}
                        {isTasks && taskCount > 0 && (
                          <span className="inline-flex items-center justify-center bg-zinc-800 text-zinc-300 rounded-full px-1 py-0.5 text-[8px] font-mono border border-zinc-700/50">
                            {taskCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── 4. CONTENT BODY ── */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800/80 bg-zinc-950/50">

              {/* ─── STORY: SPECIFICATION TAB ─── */}
              {selectedItem.type === 'story' && storyTab === 'spec' && (
                <div className="p-6 space-y-6">

                  {/* Visual details grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {/* Column 1: Core Details Card */}
                    <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-4 space-y-3.5 shadow-sm">
                      <div className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest font-mono">
                        Story Metadata
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex items-start justify-between py-1.5 border-b border-zinc-900 overflow-hidden gap-4">
                          <span className="text-zinc-500 whitespace-nowrap">File Path</span>
                          <span
                            className="font-mono text-zinc-300 text-right select-all max-w-[240px] break-words whitespace-pre-wrap"
                          >
                            {selectedItem.data.file}
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-1.5 border-b border-zinc-900">
                          <span className="text-zinc-500">Story Kind</span>
                          <span className="font-semibold text-zinc-200">
                            {selectedItem.data.kind === 'FeatureStory' ? 'Feature Specification' : 'App Bootstrap'}
                          </span>
                        </div>
                        {selectedItem.data.phase !== undefined && (
                          <div className="flex items-center justify-between py-1.5 border-b border-zinc-900">
                            <span className="text-zinc-500">Build Phase</span>
                            <span className="font-semibold text-primary">
                              Phase {selectedItem.data.phase}
                            </span>
                          </div>
                        )}
                        {selectedItem.data.target?.app && (
                          <div className="flex items-center justify-between py-1.5">
                            <span className="text-zinc-500">Target Application</span>
                            <span className="font-mono text-cyan-400">
                              {selectedItem.data.target.app}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Column 2: Dependencies and Related Stories */}
                    <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl p-4 space-y-3 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest font-mono mb-2.5">
                          Dependency Chain
                        </div>

                        {/* Must build first / dependsOn */}
                        {selectedItem.data.dependsOn && selectedItem.data.dependsOn.length > 0 ? (
                          <div className="space-y-2">
                            <span className="text-[11px] text-zinc-400 font-semibold block">Must build first:</span>
                            <div className="flex flex-wrap gap-1.5">
                              {selectedItem.data.dependsOn.map((dep: string) => {
                                // Find the dependency story in mergedStories
                                const depStory = mergedStories.find((s: any) => {
                                  const slug = s.file.split('/').pop()?.replace(/\.ya?ml$/i, '') || '';
                                  return slug === dep || s.file === dep;
                                });
                                const depStatus = depStory ? (depStory.status || 'draft') : 'unknown';
                                const isDone = depStatus === 'done' || depStatus === 'completed';

                                return (
                                  <span
                                    key={dep}
                                    onClick={() => depStory && handleOpenRelated(depStory)}
                                    className={cn(
                                      'inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-mono cursor-pointer transition-all hover:scale-[1.02]',
                                      isDone
                                        ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-450'
                                        : 'bg-zinc-900 border-zinc-800 text-zinc-450'
                                    )}
                                  >
                                    {isDone ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5 text-zinc-500" />}
                                    {dep.replace('.yaml', '')}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="text-zinc-500 text-xs italic py-2">
                            No prerequisites. This story can build immediately.
                          </div>
                        )}
                      </div>

                      {/* NPM dependencies */}
                      {selectedItem.data.dependencies && selectedItem.data.dependencies.length > 0 && (
                        <div className="mt-2.5 pt-2.5 border-t border-zinc-900 space-y-1.5">
                          <span className="text-[11px] text-zinc-400 font-semibold block">Required NPM packages:</span>
                          <div className="flex flex-wrap gap-1">
                            {selectedItem.data.dependencies.map((pkg: string) => (
                              <Badge key={pkg} variant="outline" className="bg-zinc-900 border-zinc-800 text-zinc-300 font-mono text-[9px] px-1.5 py-0">
                                {pkg}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                  </div>

                  {/* Model Details Block (Database Schema) */}
                  {selectedItem.data.model && selectedItem.data.model.collection && (
                    <div className="bg-zinc-900/20 border border-zinc-800/40 rounded-xl p-5 space-y-3.5 shadow-sm">
                      <div className="flex items-center gap-2 text-zinc-150">
                        <Database className="h-4 w-4 text-sky-400" />
                        <span className="text-sm font-bold text-white">Database Spec</span>
                        <span className="text-[10px] bg-sky-950/40 text-sky-400 font-mono border border-sky-900/50 px-2 py-0.5 rounded-full">
                          Collection: {selectedItem.data.model.collection}
                        </span>
                      </div>
                      {Array.isArray(selectedItem.data.model.fields) && selectedItem.data.model.fields.length > 0 ? (
                        <div className="border border-zinc-900 rounded-lg overflow-hidden">
                          <Table className="text-xs">
                            <TableHeader className="bg-zinc-900/40">
                              <TableRow className="border-b border-zinc-900/80 hover:bg-transparent">
                                <TableHead className="font-mono text-[10px] text-zinc-400 h-8">Field Name</TableHead>
                                <TableHead className="font-mono text-[10px] text-zinc-400 h-8">Type</TableHead>
                                <TableHead className="font-mono text-[10px] text-zinc-400 h-8">Required</TableHead>
                                <TableHead className="font-mono text-[10px] text-zinc-400 h-8">Default</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {selectedItem.data.model.fields.map((field: any, idx: number) => (
                                <TableRow key={idx} className="border-b border-zinc-900 hover:bg-zinc-900/10">
                                  <TableCell className="font-mono font-semibold text-zinc-200 py-2">{field.name}</TableCell>
                                  <TableCell className="font-mono text-sky-300 py-2">{field.type}</TableCell>
                                  <TableCell className="py-2">
                                    {field.required ? (
                                      <Badge variant="outline" className="bg-rose-950/20 border-rose-900/30 text-rose-400 text-[9px] px-1 py-0 rounded">true</Badge>
                                    ) : (
                                      <span className="text-zinc-650">-</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="font-mono text-zinc-400 py-2">
                                    {field.default !== undefined ? String(field.default) : <span className="text-zinc-700 italic">-</span>}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="text-xs text-zinc-550 italic">No fields defined for this collection.</div>
                      )}
                    </div>
                  )}

                  {/* Pages Details Block */}
                  {Array.isArray(selectedItem.data.pages) && selectedItem.data.pages.length > 0 && (
                    <div className="bg-zinc-900/20 border border-zinc-800/40 rounded-xl p-5 space-y-3 shadow-sm">
                      <div className="flex items-center gap-2 text-zinc-150">
                        <FileText className="h-4 w-4 text-purple-400" />
                        <span className="text-sm font-bold text-white">Pages & Layouts ({selectedItem.data.pages.length})</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {selectedItem.data.pages.map((page: any, idx: number) => (
                          <div key={idx} className="bg-zinc-900/40 border border-zinc-900 p-3 rounded-lg flex flex-col justify-between hover:border-zinc-850 hover:bg-zinc-900/60 transition-all">
                            <div>
                              <span className="text-xs font-bold text-zinc-100 block truncate">{page.title}</span>
                              <span className="font-mono text-[10px] text-zinc-500 select-all block truncate mt-0.5">/{page.slug}</span>
                            </div>
                            <div className="mt-2.5 flex items-center justify-between">
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-mono text-zinc-400 bg-zinc-950 border-zinc-800/80 px-1.5 py-0">
                                {page.type || 'page'}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Related Epics / Feature stories */}
                  {(() => {
                    const { prerequisites, dependents, peers } = getRelatedStories(selectedItem.data, mergedStories);
                    const sections = [
                      { title: 'Requires Build of', items: prerequisites },
                      { title: 'Prerequisite for', items: dependents },
                      { title: 'Same Epic Group', items: peers },
                    ].filter(s => s.items.length > 0);
                    if (!sections.length) return null;
                    return (
                      <div className="bg-zinc-900/10 border border-zinc-800/30 rounded-xl p-5 space-y-4 shadow-sm">
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                          <Layers className="h-4 w-4 text-teal-400" />
                          <span>Planning Relationships</span>
                        </div>
                        <div className="space-y-3">
                          {sections.map(({ title, items }) => (
                            <div key={title} className="space-y-1.5">
                              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest font-mono block">{title}</span>
                              <div className="flex flex-wrap gap-1.5">
                                {items.map((s: any) => {
                                  const st = s.status || 'draft';
                                  const isDone = st === 'done' || st === 'completed';
                                  const slug = s.file.split('/').pop()?.replace(/\.ya?ml$/i, '') || '';
                                  return (
                                    <span
                                      key={s.file}
                                      onClick={() => handleOpenRelated(s)}
                                      className={cn(
                                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-mono cursor-pointer transition-all hover:scale-[1.02]',
                                        isDone
                                          ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-450'
                                          : 'bg-zinc-900 border-zinc-800 text-zinc-450'
                                      )}
                                    >
                                      {isDone ? (
                                        <CheckCircle2 className="h-2.5 w-2.5" />
                                      ) : (
                                        <span className={cn('h-1.5 w-1.5 rounded-full', storyStatusMap[st]?.dot || 'bg-zinc-600')} />
                                      )}
                                      {slug}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              )}

              {/* ─── STORY: YAML SOURCE TAB ─── */}
              {selectedItem.type === 'story' && storyTab === 'raw' && (
                <div className="flex flex-col h-full min-h-[350px]">

                  {/* Code Bar Header */}
                  <div className="shrink-0 flex items-center justify-between px-6 py-2.5 border-b border-border/20 bg-zinc-900/40">
                    <div className="flex items-center gap-2">
                      <FileCode2 className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest font-bold">
                        {editMode ? 'Editing YAML' : selectedItem.data.file}
                      </span>
                    </div>

                    {/* Copy & Edit controls */}
                    <div className="flex items-center gap-2.5">
                      {!editMode ? (
                        <>
                          {yamlContent && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(yamlContent);
                                setCopiedYaml(true);
                                setTimeout(() => setCopiedYaml(false), 1500);
                              }}
                              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors cursor-pointer bg-zinc-900 border border-zinc-800 px-2 py-1 rounded"
                            >
                              <Copy className="h-3 w-3" />
                              <span>{copiedYaml ? 'Copied!' : 'Copy'}</span>
                            </button>
                          )}
                          <button
                            disabled={loadingYaml}
                            onClick={() => {
                              setEditMode(true);
                              setEditedYaml(yamlContent || '');
                            }}
                            className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 font-bold transition-colors cursor-pointer bg-primary/10 border border-primary/20 px-2.5 py-1 rounded"
                          >
                            <Pencil className="h-3 w-3" />
                            <span>Edit YAML</span>
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            disabled={savingYaml}
                            onClick={() => handleSaveYaml(selectedItem.data.file)}
                            className="h-7 px-2.5 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                          >
                            {savingYaml ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            <span>Save</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditMode(false);
                              setEditedYaml(yamlContent || '');
                            }}
                            className="h-7 px-2 text-[10px] text-zinc-400 hover:text-white"
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Loader or Content */}
                  <div className="flex-1 bg-zinc-950 font-mono select-text flex flex-col min-h-[300px]">
                    {loadingYaml ? (
                      <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
                        <Loader2 className="h-6 w-6 text-primary animate-spin" />
                        <span className="text-xs text-zinc-550 italic">Retrieving file specifications...</span>
                      </div>
                    ) : editMode ? (
                      <textarea
                        value={editedYaml}
                        onChange={e => setEditedYaml(e.target.value)}
                        spellCheck={false}
                        className="w-full flex-1 bg-zinc-950 text-zinc-200 font-mono text-[11px] leading-6 p-6 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 border-0 outline-none h-full min-h-[300px] select-text"
                        placeholder="# Write YAML specifications here..."
                      />
                    ) : yamlContent ? (
                      <YamlViewer content={yamlContent} />
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center py-20 gap-2">
                        <AlertTriangle className="h-6 w-6 text-zinc-700" />
                        <p className="text-xs text-zinc-655 italic">Failed to load spec file content</p>
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* ─── STORY: SUB-TASKS TAB ─── */}
              {selectedItem.type === 'story' && storyTab === 'tasks' && (
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider font-sans">
                      Checklist Sub-tasks
                    </span>
                    <span className="text-[10px] text-zinc-550 font-mono">
                      {(selectedItem.data.checklistTasks || []).filter((t: any) => t.status === 'done').length}/{(selectedItem.data.checklistTasks || []).length} completed
                    </span>
                  </div>

                  {selectedItem.data.checklistTasks && selectedItem.data.checklistTasks.length > 0 ? (
                    <div className="space-y-2.5">
                      {selectedItem.data.checklistTasks.map((task: any) => {
                        const isDone = task.status === 'done';
                        return (
                          <div
                            key={task.fullId}
                            className={cn(
                              'flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all group shadow-sm',
                              isDone
                                ? 'border-zinc-900 bg-zinc-900/10'
                                : 'border-zinc-800 bg-zinc-900/35 hover:border-zinc-700'
                            )}
                          >
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <button
                                onClick={() => {
                                  const nextStatus = isDone ? 'ready-to-build' : 'done';
                                  onUpdateTaskStatus(task.fullId, nextStatus, !isDone);
                                  // Update locally immediately for responsiveness
                                  setSelectedItem(prev => {
                                    if (!prev || prev.type !== 'story') return prev;
                                    const updatedTasks = prev.data.checklistTasks.map((t: any) =>
                                      t.fullId === task.fullId ? { ...t, status: nextStatus } : t
                                    );
                                    return { ...prev, data: { ...prev.data, checklistTasks: updatedTasks } };
                                  });
                                }}
                                className={cn(
                                  'h-4.5 w-4.5 rounded border flex items-center justify-center transition-all shrink-0 mt-0.5 cursor-pointer',
                                  isDone
                                    ? 'bg-emerald-500 border-emerald-500 text-white'
                                    : 'border-zinc-700 hover:border-zinc-500 bg-zinc-950'
                                )}
                              >
                                {isDone && <Check className="h-3 w-3 stroke-[3]" />}
                              </button>
                              <span className={cn('text-xs leading-snug font-sans', isDone ? 'text-zinc-550 line-through' : 'text-zinc-200')}>
                                <span className="font-mono text-[9px] text-zinc-550 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-850 mr-2">
                                  {task.id}
                                </span>
                                {task.title}
                              </span>
                            </div>

                            <button
                              onClick={() => {
                                onDeleteTask(task.fullId, task.fullId);
                                // Update locally immediately
                                setSelectedItem(prev => {
                                  if (!prev || prev.type !== 'story') return prev;
                                  const filtered = prev.data.checklistTasks.filter((t: any) => t.fullId !== task.fullId);
                                  return { ...prev, data: { ...prev.data, checklistTasks: filtered } };
                                });
                              }}
                              className="opacity-0 group-hover:opacity-100 hover:text-rose-500 text-zinc-650 p-1 rounded transition-all shrink-0 cursor-pointer"
                              title="Delete task"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 border border-dashed border-border/20 rounded-xl bg-zinc-900/5 text-center">
                      <ListTodo className="h-7 w-7 text-zinc-700 mb-2" />
                      <p className="text-xs text-zinc-555 font-sans italic">No checklist sub-tasks defined.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ─── STORY: TASK/SUB-TASK DETAIL VIEW ─── */}
              {selectedItem.type === 'task' && (
                <div className="p-6 space-y-5">

                  {/* Status card */}
                  <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">
                        Task Details
                      </span>

                      {(() => {
                        const status = selectedItem.data.status || 'draft';
                        const dotColorMap: Record<string, string> = {
                          draft: 'bg-zinc-500',
                          'ready-to-build': 'bg-amber-500',
                          building: 'bg-blue-500 animate-pulse',
                          paused: 'bg-orange-500',
                          done: 'bg-emerald-500',
                          failed: 'bg-rose-500',
                        };
                        return (
                          <Badge variant="outline" className="px-2 py-0.5 text-[9px] uppercase tracking-wider rounded font-mono border-zinc-850">
                            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 mr-1.5", dotColorMap[status])} />
                            {status}
                          </Badge>
                        );
                      })()}
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-start justify-between py-1 border-b border-zinc-900">
                        <span className="text-zinc-500">Task Unique ID</span>
                        <span className="font-mono text-zinc-300 break-all select-all">{selectedItem.data.id}</span>
                      </div>
                      <div className="flex items-start justify-between py-1 border-b border-zinc-900">
                        <span className="text-zinc-500">Full Queue ID</span>
                        <span className="font-mono text-zinc-300 break-all select-all text-right max-w-[200px]">
                          {selectedItem.data.fullId}
                        </span>
                      </div>
                      {selectedItem.parentStory && (
                        <div className="flex items-start justify-between py-1">
                          <span className="text-zinc-500">Target Spec File</span>
                          <span className="font-mono text-cyan-400 text-right select-all max-w-[200px]">
                            {selectedItem.parentStory.file}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Task Actions */}
                  <div className="text-center py-6 text-zinc-555 border border-dashed border-zinc-900 rounded-xl bg-zinc-900/5">
                    <Info className="h-5 w-5 mx-auto text-zinc-700 mb-2" />
                    <p className="text-xs max-w-sm mx-auto font-sans leading-relaxed">
                      This task is part of the build pipeline checklist. Switch status above or trigger the full build pipeline via the main board controls to execute this task.
                    </p>
                  </div>

                </div>
              )}

            </div>

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
