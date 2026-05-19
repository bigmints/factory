'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Save, Loader2, Check, AlertCircle, Eye, Pencil, FileText, Copy, RotateCcw } from 'lucide-react';

interface SpecEditorProps {
  specFile: string;
  specName: string;
  onClose: () => void;
  onSaved: () => void;
}

export function SpecEditor({ specFile, specName, onClose, onSaved }: SpecEditorProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadSpec(); }, [specFile]);

  const loadSpec = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/specs/${encodeURIComponent(specFile)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to load spec'); return; }
      setContent(data.content);
      setOriginalContent(data.content);
    } catch (err: any) { setError(err.message || 'Failed to load spec'); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/specs/${encodeURIComponent(specFile)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      setOriginalContent(content);
      setSaveSuccess(true);
      onSaved();
      toast.success('Spec saved', { description: specFile });
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) { setError(err.message || 'Save failed'); toast.error('Save failed', { description: err.message }); }
    finally { setSaving(false); }
  };

  const handleReset = () => { setContent(originalContent); setError(''); };
  const handleCopy = () => { navigator.clipboard.writeText(content); };
  const isDirty = content !== originalContent;
  const lineCount = content.split('\n').length;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-lg font-semibold truncate">{specName}</h2>
            <p className="text-[10px] sm:text-xs text-muted-foreground font-mono truncate">{specFile}</p>
          </div>
          {isDirty && (
            <Badge variant="outline" className="text-[9px] sm:text-[10px] text-orange-500 border-orange-500/30 shrink-0">
              Unsaved
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <button onClick={() => setMode('view')} className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] sm:text-xs font-medium transition-colors ${mode === 'view' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <Eye className="h-3 w-3" />View
            </button>
            <button onClick={() => { setMode('edit'); setTimeout(() => textareaRef.current?.focus(), 50); }} className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] sm:text-xs font-medium transition-colors ${mode === 'edit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <Pencil className="h-3 w-3" />Edit
            </button>
          </div>

          <Separator orientation="vertical" className="h-5 sm:h-6" />

          <Button variant="ghost" size="icon" onClick={handleCopy} className="h-8 w-8">
            <Copy className="h-3.5 w-3.5" />
          </Button>

          {isDirty && (
            <Button variant="ghost" size="icon" onClick={handleReset} className="h-8 w-8">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button size="sm" onClick={handleSave} disabled={saving || !isDirty} className="h-8 sm:h-9 text-xs gap-1.5">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saveSuccess ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
            {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 sm:px-4 py-2.5 text-xs sm:text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <Card><CardContent className="flex items-center justify-center py-16 sm:py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 sm:px-4 py-1.5">
            <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-muted-foreground">
              <FileText className="h-3 w-3" />YAML
            </div>
            <span className="text-[10px] sm:text-[11px] text-muted-foreground">{lineCount} lines</span>
          </div>
          <CardContent className="p-0">
            {mode === 'view' ? (
              <div className="relative">
                <pre className="overflow-auto p-3 sm:p-4 text-[11px] sm:text-sm leading-relaxed font-mono text-foreground/90 max-h-[calc(100vh-240px)] sm:max-h-[calc(100vh-280px)]">
                  <code>{content}</code>
                </pre>
              </div>
            ) : (
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  spellCheck={false}
                  className="w-full resize-none border-0 bg-transparent p-3 sm:p-4 text-[11px] sm:text-sm leading-relaxed font-mono text-foreground/90 focus:outline-none max-h-[calc(100vh-240px)] sm:max-h-[calc(100vh-280px)] min-h-[300px] sm:min-h-[400px]"
                  style={{ tabSize: 2 }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (isDirty) handleSave(); }
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const start = e.currentTarget.selectionStart;
                      const end = e.currentTarget.selectionEnd;
                      const newContent = content.substring(0, start) + '  ' + content.substring(end);
                      setContent(newContent);
                      setTimeout(() => { if (textareaRef.current) { textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2; } }, 0);
                    }
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
