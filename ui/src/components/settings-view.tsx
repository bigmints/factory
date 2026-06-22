'use client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Sparkles, Bot, Server, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  FolderOpen, Terminal, Save, Network, RefreshCw
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ModelConfig { id: string; name: string; }
interface LLMProvider {
  id: string; name: string; kind: 'builtin' | 'openai-compat' | 'cli'; enabled: boolean;
  apiKey?: string; baseUrl?: string; models: ModelConfig[]; defaultModel?: string;
}
interface FactorySettings {
  providers: LLMProvider[];
  activeProvider: string;
  buildModel: string;
  defaultCli?: string;
  updatedAt?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CLI_OPTIONS = [
  { id: 'pi',     label: 'pi',     description: 'Pi AI CLI' },
  { id: 'gemini', label: 'gemini', description: 'Google Gemini CLI' },
  { id: 'claude', label: 'claude', description: 'Anthropic Claude Code' },
  { id: 'agy',    label: 'agy',    description: 'Antigravity CLI' },
] as const;

const PROVIDER_META: Record<string, { icon: React.ReactNode; color: string }> = {
  gemini: { icon: <Sparkles className="h-4 w-4" />, color: 'text-blue-500' },
  openai: { icon: <Bot className="h-4 w-4" />,      color: 'text-emerald-500' },
  ollama: { icon: <Server className="h-4 w-4" />,    color: 'text-orange-500' },
  'openai-compatible': { icon: <Network className="h-4 w-4" />, color: 'text-purple-500' },
};

// ── Component ──────────────────────────────────────────────────────────────────

export function SettingsView() {
  const [settings, setSettings] = useState<FactorySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingCli, setTestingCli] = useState(false);
  const [cliTestResult, setCliTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});

  // ── Fetch settings on mount ──

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);
    } catch { toast.error('Failed to load settings'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // ── Helpers ──

  const updateProvider = (id: string, updates: Partial<LLMProvider>) => {
    if (!settings) return;
    setSettings({
      ...settings,
      providers: settings.providers.map(p => p.id === id ? { ...p, ...updates } : p),
    });
  };

  const setActiveProvider = (providerId: string) => {
    if (!settings) return;
    const provider = settings.providers.find(p => p.id === providerId);
    setSettings({
      ...settings,
      activeProvider: providerId,
      buildModel: provider?.defaultModel || '',
    });
  };

  // ── Save ──

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.ok) toast.success('Settings saved');
      else toast.error(data.error || 'Failed to save');
    } catch { toast.error('Failed to save settings'); }
    finally { setSaving(false); }
  };

  // ── Test CLI ──

  const testCli = async () => {
    if (!settings?.defaultCli) return;
    setTestingCli(true);
    setCliTestResult(null);
    try {
      const res = await fetch('/api/settings/test-cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cli: settings.defaultCli }),
      });
      const result = await res.json();
      setCliTestResult(result);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch {
      setCliTestResult({ ok: false, message: 'Test request failed' });
      toast.error('CLI test failed');
    } finally { setTestingCli(false); }
  };

  // ── Fetch Models ──

  const fetchModels = async (providerId: string) => {
    if (!settings) return;
    const provider = settings.providers.find(p => p.id === providerId);
    if (!provider) return;

    setFetchingModels(prev => ({ ...prev, [providerId]: true }));
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider.id,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          kind: provider.kind,
        }),
      });
      const data = await res.json();
      if (data.ok && data.models) {
        // Update models in settings
        setSettings(prev => {
          if (!prev) return null;
          const updatedProviders = prev.providers.map(p => {
            if (p.id === providerId) {
              return {
                ...p,
                models: data.models,
                defaultModel: p.defaultModel || (data.models[0]?.id || ''),
              };
            }
            return p;
          });
          
          const buildModel = prev.activeProvider === providerId 
            ? (provider.defaultModel || data.models[0]?.id || '')
            : prev.buildModel;

          return {
            ...prev,
            providers: updatedProviders,
            buildModel,
          };
        });
        toast.success(data.message || 'Models fetched successfully');
      } else {
        toast.error(data.message || 'Failed to fetch models');
      }
    } catch {
      toast.error('Failed to fetch models');
    } finally {
      setFetchingModels(prev => ({ ...prev, [providerId]: false }));
    }
  };

  // ── Loading state ──

  if (loading || !settings) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <Card key={i} className="p-6 border border-border/40">
            <div className="h-20 bg-muted/40 animate-pulse rounded-xl" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ─── Header ─── */}
      <div className="flex items-center justify-between pb-4 border-b border-border/40">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Settings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Configure build CLI and API provider credentials.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5 text-xs font-semibold">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>

      {/* ─── Section 1: CLI Selection ─── */}
      <Card className="p-5 border border-border/40 space-y-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-foreground">Default CLI</h3>
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={settings.defaultCli || ''}
            onValueChange={(val) => {
              setSettings({ ...settings, defaultCli: val || undefined });
              setCliTestResult(null);
            }}
          >
            <SelectTrigger className="w-[180px] h-9 text-xs font-mono">
              <SelectValue placeholder="Select CLI…" />
            </SelectTrigger>
            <SelectContent>
              {CLI_OPTIONS.map(cli => (
                <SelectItem key={cli.id} value={cli.id} className="text-xs font-mono">
                  <span className="font-semibold">{cli.label}</span>
                  <span className="text-muted-foreground ml-2">— {cli.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={testCli}
            disabled={!settings.defaultCli || testingCli}
            className="text-xs gap-1.5 h-9"
          >
            {testingCli ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
            Test
          </Button>

          {cliTestResult && (
            <div className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border",
              cliTestResult.ok
                ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border-emerald-500/20"
                : "text-destructive bg-destructive/5 border-destructive/20"
            )}>
              {cliTestResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {cliTestResult.message}
            </div>
          )}
        </div>
      </Card>

      {/* ─── Section 2: Active Project ─── */}
      <Card className="p-5 border border-border/40">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-foreground">Active Project</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-2 font-mono bg-muted/30 rounded-md px-3 py-2 border border-border/30">
          {/* Read from the settings or show a placeholder */}
          {settings.updatedAt ? 'Loaded from workspace' : 'No project loaded'}
        </p>
      </Card>

      {/* ─── Section 3: LLM Provider Cards ─── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-foreground">LLM Providers</h3>
          <span className="text-[10px] text-muted-foreground">(for direct API routing)</span>
        </div>

        {settings.providers.filter(p => p.kind === 'builtin').map(provider => {
          const meta = PROVIDER_META[provider.id] || { icon: <Bot className="h-4 w-4" />, color: 'text-muted-foreground' };
          const isActive = settings.activeProvider === provider.id;
          const showKey = showKeys[provider.id] || false;
          const needsApiKey = provider.id !== 'ollama';
          const needsBaseUrl = provider.id === 'ollama' || provider.id === 'openai-compatible';

          return (
            <Card
              key={provider.id}
              className={cn(
                "p-5 border space-y-4 transition-colors",
                isActive ? "border-primary/40 bg-primary/[0.02]" : "border-border/40"
              )}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className={meta.color}>{meta.icon}</span>
                  <span className="text-sm font-semibold text-foreground">{provider.name}</span>
                  {isActive && (
                    <Badge className="text-[9px] font-bold py-0 px-1.5 bg-primary/10 text-primary border-primary/20">
                      Active
                    </Badge>
                  )}
                </div>
                {!isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveProvider(provider.id)}
                    className="text-[11px] text-muted-foreground hover:text-primary h-7"
                  >
                    Set Active
                  </Button>
                )}
              </div>

              {/* API Key */}
              {needsApiKey && (
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    API Key
                  </Label>
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      placeholder={provider.id === 'gemini' ? 'AIzaSy...' : 'sk-...'}
                      value={provider.apiKey || ''}
                      onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                      className="pr-9 font-mono text-xs h-9 border-border/60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !showKey }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Base URL (Ollama) */}
              {needsBaseUrl && (
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Base URL
                  </Label>
                  <Input
                    placeholder="http://localhost:11434"
                    value={provider.baseUrl || ''}
                    onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
                    className="font-mono text-xs h-9 border-border/60"
                  />
                </div>
              )}

              {/* Default Model */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Default Model
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => fetchModels(provider.id)}
                    disabled={fetchingModels[provider.id]}
                    className="h-5 px-1.5 text-[9px] font-semibold gap-1 text-muted-foreground hover:text-foreground"
                  >
                    {fetchingModels[provider.id] ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-2.5 w-2.5" />
                    )}
                    Fetch Models
                  </Button>
                </div>
                {provider.models.length > 0 ? (
                  <Select
                    value={provider.defaultModel || ''}
                    onValueChange={(val) => {
                      updateProvider(provider.id, { defaultModel: val });
                      if (isActive) setSettings(prev => prev ? { ...prev, buildModel: val } : null);
                    }}
                  >
                    <SelectTrigger className="font-mono text-xs h-9 border-border/60">
                      <SelectValue placeholder="Select model…" />
                    </SelectTrigger>
                    <SelectContent>
                      {provider.models.map(m => (
                        <SelectItem key={m.id} value={m.id} className="font-mono text-xs">
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="e.g. gemini-2.5-pro, gpt-4o"
                    value={provider.defaultModel || ''}
                    onChange={(e) => {
                      updateProvider(provider.id, { defaultModel: e.target.value });
                      if (isActive) setSettings(prev => prev ? { ...prev, buildModel: e.target.value } : null);
                    }}
                    className="font-mono text-xs h-9 border-border/60"
                  />
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
