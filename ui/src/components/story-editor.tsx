'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Save,
  Loader2,
  Check,
  AlertCircle,
  Eye,
  Pencil,
  FileText,
  Copy,
  RotateCcw,
  Cpu,
  Database,
  Network,
  Wrench,
  Layers,
  Sparkles,
  Code2,
} from 'lucide-react';

interface StoryEditorProps {
  storyFile: string;
  storyName: string;
  onClose: () => void;
  onSaved: () => void;
}

// Simple robust regex-based parser/updater to preserve YAML comments/formatting
const parseYamlFields = (yaml: string) => {
  const isFeature = yaml.includes('feature:') || yaml.includes('target:');
  
  // App Fields
  const appNameMatch = yaml.match(/^appName:\s*["']?([^"'\n]+)["']?/m);
  const descMatch = yaml.match(/^description:\s*["']?([^"'\n]+)["']?/m);
  
  // Feature Fields
  const featNameMatch = yaml.match(/^\s*name:\s*["']?([^"'\n]+)["']?/m);
  const targetAppMatch = yaml.match(/^\s*app:\s*["']?([^"'\n]+)["']?/m);
  const phaseMatch = yaml.match(/^phase:\s*(\d+)/m);
  const dependsOnMatch = yaml.match(/^dependsOn:\s*\[([^\]]*)\]/m);
  
  // Stack Config
  const frameworkMatch = yaml.match(/^\s*framework:\s*["']?([^"'\n]+)["']?/m);
  const dbMatch = yaml.match(/^\s*database:\s*["']?([^"'\n]+)["']?/m);
  const portMatch = yaml.match(/^\s*port:\s*(\d+)/m);

  return {
    isFeature,
    appName: appNameMatch ? appNameMatch[1] : '',
    featureName: featNameMatch ? featNameMatch[1] : '',
    description: descMatch ? descMatch[1] : '',
    targetApp: targetAppMatch ? targetAppMatch[1] : '',
    phase: phaseMatch ? parseInt(phaseMatch[1]) : 1,
    dependsOn: dependsOnMatch ? dependsOnMatch[1].trim() : '',
    framework: frameworkMatch ? frameworkMatch[1] : 'Next.js',
    database: dbMatch ? dbMatch[1] : '',
    port: portMatch ? parseInt(portMatch[1]) : 3000,
  };
};

const updateYamlField = (yaml: string, field: string, value: any): string => {
  let updated = yaml;
  
  if (field === 'appName') {
    if (yaml.match(/^appName:/m)) {
      updated = yaml.replace(/^appName:\s*.*$/m, `appName: "${value}"`);
    } else {
      updated = `appName: "${value}"\n` + yaml;
    }
  } else if (field === 'featureName') {
    if (yaml.match(/^\s*name:\s*.*$/m)) {
      updated = yaml.replace(/^\s*name:\s*.*$/m, `  name: "${value}"`);
    }
  } else if (field === 'description') {
    if (yaml.match(/^description:/m)) {
      updated = yaml.replace(/^description:\s*.*$/m, `description: "${value}"`);
    } else {
      updated = yaml + `\ndescription: "${value}"`;
    }
  } else if (field === 'port') {
    if (yaml.match(/^\s*port:\s*.*$/m)) {
      updated = yaml.replace(/^\s*port:\s*.*$/m, `    port: ${value}`);
    }
  } else if (field === 'phase') {
    if (yaml.match(/^phase:/m)) {
      updated = yaml.replace(/^phase:\s*.*$/m, `phase: ${value}`);
    } else {
      updated = yaml + `\nphase: ${value}`;
    }
  } else if (field === 'dependsOn') {
    const listStr = value ? `[${value}]` : '[]';
    if (yaml.match(/^dependsOn:/m)) {
      updated = yaml.replace(/^dependsOn:\s*.*$/m, `dependsOn: ${listStr}`);
    } else {
      updated = yaml + `\ndependsOn: ${listStr}`;
    }
  } else if (field === 'framework') {
    if (yaml.match(/^\s*framework:\s*.*$/m)) {
      updated = yaml.replace(/^\s*framework:\s*.*$/m, `    framework: "${value}"`);
    }
  } else if (field === 'database') {
    if (yaml.match(/^\s*database:\s*.*$/m)) {
      updated = yaml.replace(/^\s*database:\s*.*$/m, `    database: "${value}"`);
    }
  }
  
  return updated;
};

export function StoryEditor({ storyFile, storyName, onClose, onSaved }: StoryEditorProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [editorTab, setEditorTab] = useState<'form' | 'code'>('form');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadStory(); }, [storyFile]);

  const loadStory = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(storyFile)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to load story'); return; }
      setContent(data.content);
      setOriginalContent(data.content);
    } catch (err: any) { setError(err.message || 'Failed to load story'); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(storyFile)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      setOriginalContent(content);
      setSaveSuccess(true);
      onSaved();
      toast.success('Story saved', { description: storyFile });
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Save failed');
      toast.error('Save failed', { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setContent(originalContent);
    setError('');
    toast.info('Story restored to original state');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    toast.success('Story copied to clipboard');
  };

  const parsedFields = useMemo(() => parseYamlFields(content), [content]);

  const updateField = (field: string, val: any) => {
    const updatedYaml = updateYamlField(content, field, val);
    setContent(updatedYaml);
  };

  const handleInsertTab = () => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const newContent = content.substring(0, start) + '  ' + content.substring(end);
    setContent(newContent);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
      }
    }, 0);
  };

  const handleInsertComment = () => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const newContent = content.substring(0, start) + '# ' + content.substring(end);
    setContent(newContent);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
      }
    }, 0);
  };

  const isDirty = content !== originalContent;
  const lineCount = content.split('\n').length;

  return (
    <div className="space-y-4 pb-20 sm:pb-8">
      {/* Header Controls */}
      <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Button variant="outline" size="icon" onClick={onClose} className="h-9 w-9 rounded-md shrink-0 border border-border bg-background">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {parsedFields.isFeature ? (
                  <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <h2 className="text-sm sm:text-base font-bold truncate text-foreground">{storyName}</h2>
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground font-mono truncate mt-0.5">{storyFile}</p>
            </div>
            {isDirty && (
              <Badge variant="outline" className="text-[9px] font-semibold px-2 h-5 rounded-full shrink-0">
                Unsaved
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Sliding segment tabs */}
            <div className="rounded-lg bg-muted p-1 flex items-center border border-border">
              <button
                onClick={() => setEditorTab('form')}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] sm:text-xs font-bold transition-all min-h-[34px] tap-shrink ${
                  editorTab === 'form' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                Form
              </button>
              <button
                onClick={() => {
                  setEditorTab('code');
                  setTimeout(() => textareaRef.current?.focus(), 80);
                }}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] sm:text-xs font-bold transition-all min-h-[34px] tap-shrink ${
                  editorTab === 'code' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                Code
              </button>
            </div>

            <Separator orientation="vertical" className="h-6 hidden sm:block bg-border" />

            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon" onClick={handleCopy} className="h-9 w-9 rounded-md shrink-0 bg-background">
                <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </Button>

              {isDirty && (
                <Button variant="outline" size="icon" onClick={handleReset} className="h-9 w-9 rounded-md shrink-0 text-destructive bg-background hover:bg-accent hover:text-destructive">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}

              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="h-9 rounded-md px-4 text-xs gap-1.5 font-semibold shrink-0"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saveSuccess ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Story'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive bg-muted px-4 py-3 text-xs sm:text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {loading ? (
        <Card className="rounded-lg border border-border bg-card">
          <CardContent className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {/* Status Header */}
          <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2.5">
            <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              {editorTab === 'form' ? <Wrench className="h-3.5 w-3.5 text-muted-foreground" /> : <Code2 className="h-3.5 w-3.5 text-muted-foreground" />}
              {editorTab === 'form' ? 'Interactive Form Builder' : 'Raw Story YAML'}
            </div>
            <span className="text-[10px] sm:text-[11px] font-mono text-muted-foreground/60">{lineCount} lines</span>
          </div>

          <CardContent className="p-0">
            {editorTab === 'form' ? (
              <div className="p-4 sm:p-6 md:p-8 space-y-6">
                
                {/* Categorized Forms */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Category 1: General Metadata */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 border-b border-border/20 pb-2">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      <h4 className="text-xs sm:text-sm font-semibold tracking-wide text-foreground/90">General Metadata</h4>
                    </div>

                    {!parsedFields.isFeature ? (
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Application Name</label>
                        <input
                          type="text"
                          value={parsedFields.appName}
                          onChange={(e) => updateField('appName', e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring text-foreground transition-all"
                          placeholder="e.g. feedback-app"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Feature Name</label>
                        <input
                          type="text"
                          value={parsedFields.featureName}
                          onChange={(e) => updateField('featureName', e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring text-foreground transition-all"
                          placeholder="e.g. Admin Authentication"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Goal & Description</label>
                      <textarea
                        value={parsedFields.description}
                        onChange={(e) => updateField('description', e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring text-foreground transition-all min-h-[80px] resize-none"
                        placeholder="Detail what this story builds..."
                      />
                    </div>
                  </div>

                  {/* Category 2: Stack & Target Configurations */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 border-b border-border/20 pb-2">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <h4 className="text-xs sm:text-sm font-semibold tracking-wide text-foreground/90">Stack Configuration</h4>
                    </div>

                    {!parsedFields.isFeature ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Framework</label>
                          <input
                            type="text"
                            value={parsedFields.framework}
                            onChange={(e) => updateField('framework', e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring text-foreground transition-all"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Database Model</label>
                          <input
                            type="text"
                            value={parsedFields.database}
                            onChange={(e) => updateField('database', e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring text-foreground transition-all"
                            placeholder="e.g. SQLite"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Target Connected App Slug</label>
                        <div className="w-full rounded-md border border-border bg-muted/50 px-3 py-2 text-xs sm:text-sm text-muted-foreground">
                          {parsedFields.targetApp || 'Default Active Story'}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Local Server Port</label>
                      <input
                        type="number"
                        value={parsedFields.port}
                        onChange={(e) => updateField('port', parseInt(e.target.value) || 3000)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring text-foreground transition-all"
                        placeholder="3000"
                      />
                    </div>
                  </div>
                </div>

                {/* Category 3: Feature Ordering & Constraints */}
                {parsedFields.isFeature && (
                  <div className="border-t border-border/20 pt-5 space-y-4">
                    <div className="flex items-center gap-2 border-b border-border/20 pb-2">
                      <Network className="h-4 w-4 text-muted-foreground" />
                      <h4 className="text-xs sm:text-sm font-semibold tracking-wide text-foreground/90">Feature Ordering & Pipeline Priority</h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 block">Build Execution Phase</label>
                        <div className="flex gap-2">
                          {[1, 2, 3].map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => updateField('phase', p)}
                              className={`flex-1 py-2 rounded-md border text-xs font-bold transition-all tap-shrink ${
                                parsedFields.phase === p
                                  ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                                  : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                              }`}
                            >
                              Phase {p}
                              <span className="block text-[8px] font-semibold opacity-70 mt-0.5">
                                {p === 1 ? 'Foundation Layer' : p === 2 ? 'Core Mechanics' : 'Polishing/CSS'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Depends On (Feature Slugs)</label>
                        <input
                          type="text"
                          value={parsedFields.dependsOn}
                          onChange={(e) => updateField('dependsOn', e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm outline-none focus:ring-1 focus:ring-ring focus:border-ring text-foreground transition-all"
                          placeholder="e.g. database-schemas, auth-system"
                        />
                        <span className="text-[9px] text-muted-foreground/70 block mt-1">Provide comma-separated slugs. Dequeues only when dependencies are fully completed.</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  spellCheck={false}
                  className="w-full resize-none border-0 bg-transparent p-4 sm:p-5 text-[11px] sm:text-sm leading-relaxed font-mono text-foreground focus:outline-none max-h-[calc(100vh-280px)] sm:max-h-[calc(100vh-320px)] min-h-[350px] sm:min-h-[450px]"
                  style={{ tabSize: 2 }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                      e.preventDefault();
                      if (isDirty) handleSave();
                    }
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      handleInsertTab();
                    }
                  }}
                />

                {/* Mobile keyboard helper accessory bar */}
                <div className="sticky bottom-0 left-0 right-0 h-10 border-t border-border bg-muted flex items-center px-3 gap-1 overflow-x-auto scrollbar-none z-30 select-none">
                  <span className="text-[8px] font-bold font-mono text-muted-foreground/60 mr-2 uppercase tracking-wide">Accessories:</span>
                  <button
                    onClick={handleInsertTab}
                    className="h-7 px-2.5 rounded-md bg-background border border-border text-[10px] font-semibold font-mono hover:bg-muted shrink-0 select-none text-foreground transition-colors"
                  >
                    TAB (2s)
                  </button>
                  <button
                    onClick={handleInsertComment}
                    className="h-7 px-2.5 rounded-md bg-background border border-border text-[10px] font-semibold font-mono hover:bg-muted shrink-0 select-none text-foreground transition-colors"
                  >
                    # Comment
                  </button>
                  <button
                    onClick={() => {
                      if (textareaRef.current) {
                        const start = textareaRef.current.selectionStart;
                        const end = textareaRef.current.selectionEnd;
                        textareaRef.current.focus();
                        textareaRef.current.setSelectionRange(start, end);
                        toast.info('Toolbar selection active');
                      }
                    }}
                    className="h-7 px-2.5 rounded-md bg-background border border-border text-[10px] font-semibold hover:bg-muted shrink-0 select-none text-foreground transition-colors"
                  >
                    Select Text
                  </button>
                  <button
                    onClick={handleReset}
                    className="h-7 px-2.5 rounded-md bg-background border border-border text-[10px] font-semibold text-destructive hover:bg-muted shrink-0 ml-auto select-none transition-colors"
                  >
                    Restore
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
