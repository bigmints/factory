'use client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Sparkles, Bot, Server, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  RefreshCw, Star, Zap, Plus, Trash2, Globe, Terminal, AlertTriangle, ShieldCheck
} from 'lucide-react';

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

const PROVIDER_META: Record<string, { icon: React.ReactNode; color: string; bg: string; description: string }> = {
  gemini: { 
    icon: <Sparkles className="h-4.5 w-4.5 text-blue-500" />, 
    color: 'text-blue-500 border-blue-500/20 bg-blue-500/5', 
    bg: 'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20',
    description: "Google Gemini developer models via direct API." 
  },
  openai: { 
    icon: <Bot className="h-4.5 w-4.5 text-emerald-500" />, 
    color: 'text-emerald-500 border-emerald-500/20 bg-emerald-500/5', 
    bg: 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20',
    description: 'Direct integration with OpenAI GPT models.' 
  },
  ollama: { 
    icon: <Server className="h-4.5 w-4.5 text-orange-500" />, 
    color: 'text-orange-500 border-orange-500/20 bg-orange-500/5', 
    bg: 'bg-orange-500/5 dark:bg-orange-500/10 border-orange-500/20',
    description: 'Fully local and private model execution via Ollama.' 
  },
};

function providerMeta(id: string, name: string, _kind: string) {
  const known = PROVIDER_META[id];
  if (known) return known;
  return { 
    icon: <Globe className="h-4.5 w-4.5 text-indigo-500" />, 
    color: 'text-indigo-500 border-indigo-500/20 bg-indigo-500/5', 
    bg: 'bg-indigo-500/5 dark:bg-indigo-500/10 border-indigo-500/20',
    description: `Custom OpenAI-compatible provider: ${name}` 
  };
}

export function SettingsView() {
  const [settings, setSettings] = useState<FactorySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newShowKey, setNewShowKey] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<ModelConfig[]>([]);
  
  // Inner Sub-Tab state
  const [activeSubTab, setActiveSubTab] = useState<'engine' | 'providers'>('engine');

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);
    } catch { toast.error('Failed to load settings'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || !settings) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
        const data = await res.json();
        if (data.ok) { toast.success('Settings saved'); setDirty(false); }
        else { toast.error(data.error || 'Failed to save'); }
      } catch { toast.error('Failed to save settings'); }
      finally { setSaving(false); }
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [dirty, settings]);

  const updateProvider = (id: string, updates: Partial<LLMProvider>) => {
    if (!settings) return;
    setSettings({ ...settings, providers: settings.providers.map(p => p.id === id ? { ...p, ...updates } : p) });
    setDirty(true);
  };

  const removeProvider = (id: string) => {
    if (!settings) return;
    const isActive = settings.activeProvider === id;
    setSettings({ ...settings, activeProvider: isActive ? '' : settings.activeProvider, buildModel: isActive ? '' : settings.buildModel, providers: settings.providers.filter(p => p.id !== id) });
    setDirty(true);
    toast.success('Provider removed');
  };

  const testConnection = async (providerId: string) => {
    if (!settings) return;
    const provider = settings.providers.find(p => p.id === providerId);
    if (!provider) return;
    setTestingProvider(providerId);
    setTestResults(prev => ({ ...prev, [providerId]: { ok: false, message: 'Testing connection...' } }));
    try {
      const res = await fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: provider.id, kind: provider.kind, apiKey: provider.apiKey, baseUrl: provider.baseUrl }) });
      const result = await res.json();
      setTestResults(prev => ({ ...prev, [providerId]: result }));
      if (result.ok) { toast.success(result.message); if (result.models?.length) updateProvider(providerId, { models: result.models }); }
      else { toast.error(result.message); }
    } catch { setTestResults(prev => ({ ...prev, [providerId]: { ok: false, message: 'Connection failed' } })); toast.error('Connection test failed'); }
    finally { setTestingProvider(null); }
  };

  const discoverModels = async () => {
    if (!newBaseUrl) { toast.error('Enter a base URL first'); return; }
    setDiscovering(true);
    setDiscoveredModels([]);
    try {
      const res = await fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'openai-compat', baseUrl: newBaseUrl, apiKey: newApiKey || undefined }) });
      const result = await res.json();
      if (result.ok && result.models?.length) { setDiscoveredModels(result.models); toast.success(`Discovered ${result.models.length} models`); }
      else { toast.error(result.message || 'Discovery failed'); setDiscoveredModels([]); }
    } catch { toast.error('Discovery request failed'); }
    finally { setDiscovering(false); }
  };

  const addCustomProvider = () => {
    if (!settings) return;
    if (!newName.trim() || !newBaseUrl.trim()) { toast.error('Name and Base URL are required'); return; }
    const slug = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const id = `custom-${slug}-${Date.now()}`;
    const newProvider: LLMProvider = { id, name: newName.trim(), kind: 'openai-compat', enabled: true, baseUrl: newBaseUrl.trim(), apiKey: newApiKey || '', models: discoveredModels.length > 0 ? discoveredModels : [], defaultModel: discoveredModels.length > 0 ? discoveredModels[0].id : '' };
    setSettings({ ...settings, providers: [...settings.providers, newProvider] });
    setDirty(true);
    setNewName(''); setNewBaseUrl(''); setNewApiKey(''); setDiscoveredModels([]); setShowAddForm(false);
    toast.success(`Provider "${newName}" added`);
  };

  const setActiveProvider = (providerId: string, modelId: string) => {
    if (!settings) return;
    setSettings({ ...settings, activeProvider: providerId, buildModel: modelId });
    setDirty(true);
  };

  const setDefaultCli = (cli: string) => {
    if (!settings) return;
    setSettings({ ...settings, defaultCli: cli || undefined });
    setDirty(true);
    if (cli) toast.success(`CLI set to: ${cli}`);
    else toast.success('CLI override cleared — using API provider');
  };

  const CLI_OPTIONS = [
    { id: 'gemini', label: 'gemini', description: 'Google Gemini CLI · Uses your Google account authorization.' },
    { id: 'claude', label: 'claude', description: 'Anthropic Claude Code · Uses your Anthropic CLI credentials.' },
    { id: 'agy',    label: 'agy',    description: 'Antigravity CLI · Uses your active agy account.' },
    { id: 'pi',     label: 'pi',     description: 'Pi AI CLI · Uses your local Pi account details.' },
  ];

  if (loading || !settings) {
    return (
      <div className="space-y-4 md:space-y-6">
        {[1, 2, 3].map(i => (
          <Card key={i} className="p-5 md:p-6 border border-border/40">
            <div className="h-24 bg-muted/40 animate-pulse rounded-xl" />
          </Card>
        ))}
      </div>
    );
  }

  const activeProvider = settings.providers.find(p => p.id === settings.activeProvider && p.enabled);

  return (
    <div className="space-y-6">
      
      {/* ─── Active Status Banner Redesigned ─── */}
      {settings.defaultCli ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] dark:bg-emerald-500/[0.05] p-4 flex items-center justify-between gap-4 transition-all">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Terminal className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-600 dark:text-emerald-400">Active Build Route</span>
              <h4 className="text-sm font-semibold text-foreground truncate mt-0.5">
                CLI Mode Enabled · <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">{settings.defaultCli}</span>
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">All build steps are routed through the local CLI natively. No API key required.</p>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 gap-1.5 py-1 px-2.5 font-bold text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 uppercase tracking-wide">
            <ShieldCheck className="h-3 w-3" /> CLI Pipeline
          </Badge>
        </div>
      ) : activeProvider && settings.buildModel ? (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.03] dark:bg-blue-500/[0.05] p-4 flex items-center justify-between gap-4 transition-all">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Zap className="h-5 w-5 fill-current" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold tracking-wider text-blue-600 dark:text-blue-400">Active Build Route</span>
              <h4 className="text-sm font-semibold text-foreground truncate mt-0.5">
                {activeProvider.name} → <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{settings.buildModel}</span>
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">Direct integration via API credential payload keys.</p>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 gap-1.5 py-1 px-2.5 font-bold text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 uppercase tracking-wide">
            <Star className="h-3 w-3 fill-current" /> API Direct
          </Badge>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] dark:bg-amber-500/[0.05] p-4 flex items-center gap-3.5 transition-all">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 dark:text-amber-400">Active Build Route</span>
            <h4 className="text-sm font-semibold text-foreground mt-0.5">No Active Engine Configured</h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">Please choose a local CLI pipeline or activate an API provider to start running builds.</p>
          </div>
        </div>
      )}

      {/* ─── Inner Navigation Sub-Tabs ─── */}
      <div className="flex items-center justify-between border-b border-border/60 pb-px">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveSubTab('engine')}
            className={cn(
              "px-4 py-2.5 text-xs font-semibold border-b-2 transition-all relative",
              activeSubTab === 'engine'
                ? "border-primary text-foreground font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Build Engine
          </button>
          <button
            onClick={() => setActiveSubTab('providers')}
            className={cn(
              "px-4 py-2.5 text-xs font-semibold border-b-2 transition-all relative",
              activeSubTab === 'providers'
                ? "border-primary text-foreground font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            API Credentials & Keys
          </button>
        </div>
        {dirty && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-500 font-medium px-2 py-0.5 bg-amber-500/5 border border-amber-500/10 rounded-md animate-pulse">
            Unsaved Changes
          </div>
        )}
      </div>

      {/* ─── Sub-Tab Content ─── */}
      {activeSubTab === 'engine' ? (
        <div className="space-y-5 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Generation Pipeline</h3>
            <p className="text-xs text-muted-foreground">Select where build operations should be executed. Routing to a local CLI uses your terminal session session auth directly.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* None (API Default) Option */}
            <button
              onClick={() => setDefaultCli('')}
              className={cn(
                'flex items-start gap-4 p-4 rounded-xl border text-left transition-all duration-150 relative bg-card text-card-foreground',
                !settings.defaultCli
                  ? 'border-primary/80 ring-1 ring-primary/45 bg-accent/30'
                  : 'border-border/60 hover:border-border hover:bg-muted/30'
              )}
            >
              <div className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-xs transition-colors', 
                !settings.defaultCli 
                  ? 'bg-primary text-primary-foreground border-primary' 
                  : 'bg-muted border-border/60 text-muted-foreground'
              )}>
                <Globe className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-foreground">Direct API Integrations</p>
                  <div className={cn(
                    'h-3.5 w-3.5 rounded-full border flex items-center justify-center', 
                    !settings.defaultCli ? 'border-primary' : 'border-muted-foreground/30'
                  )}>
                    {!settings.defaultCli && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">Route builds via API provider credentials configured in the keys tab.</p>
              </div>
            </button>

            {/* CLI Options */}
            {CLI_OPTIONS.map(cli => {
              const isActive = settings.defaultCli === cli.id;
              return (
                <button
                  key={cli.id}
                  onClick={() => setDefaultCli(cli.id)}
                  className={cn(
                    'flex items-start gap-4 p-4 rounded-xl border text-left transition-all duration-150 relative bg-card text-card-foreground',
                    isActive
                      ? 'border-primary/80 ring-1 ring-primary/45 bg-accent/30'
                      : 'border-border/60 hover:border-border hover:bg-muted/30'
                  )}
                >
                  <div className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-xs font-mono text-xs font-bold uppercase transition-colors', 
                    isActive 
                      ? 'bg-primary text-primary-foreground border-primary' 
                      : 'bg-muted border-border/60 text-muted-foreground'
                  )}>
                    {cli.label.substring(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold font-mono text-foreground">{cli.label}</p>
                      <div className={cn(
                        'h-3.5 w-3.5 rounded-full border flex items-center justify-center', 
                        isActive ? 'border-primary' : 'border-muted-foreground/30'
                      )}>
                        {isActive && <div className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{cli.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">API Credentials</h3>
            <p className="text-xs text-muted-foreground">Manage API key payloads, endpoints, and select base models for each connected provider.</p>
          </div>

          <div className="space-y-4">
            {settings.providers.map(provider => {
              const meta = providerMeta(provider.id, provider.name, provider.kind);
              const result = testResults[provider.id];
              const isActive = settings.activeProvider === provider.id;
              const isTesting = testingProvider === provider.id;
              const isCustom = provider.kind !== 'builtin';

              return (
                <Card 
                  key={provider.id}
                  className={cn(
                    "rounded-xl border transition-all duration-200 border-border/60 overflow-hidden bg-card text-card-foreground hover:shadow-xs",
                    isActive ? "border-primary/50 bg-muted/[0.02]" : "",
                    !provider.enabled && "opacity-65"
                  )}
                >
                  <div className="p-4 md:p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", 
                          provider.enabled ? meta.bg : "bg-muted border-border/40 text-muted-foreground"
                        )}>
                          {meta.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-foreground truncate">{provider.name}</span>
                            {isActive && <Badge className="text-[8px] font-bold py-0 px-1.5 gap-0.5 bg-primary/15 text-primary border-primary/20 uppercase tracking-wide">Active Default</Badge>}
                            {isCustom && <Badge className="text-[8px] font-bold py-0 px-1.5 bg-secondary text-secondary-foreground border-border uppercase tracking-wide">Custom</Badge>}
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{meta.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3.5 shrink-0">
                        {isCustom && (
                          <Button size="icon" variant="ghost" onClick={() => removeProvider(provider.id)} className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Switch checked={provider.enabled} onCheckedChange={(checked) => updateProvider(provider.id, { enabled: checked })} className="scale-90" />
                      </div>
                    </div>

                    {provider.enabled && (
                      <div className="mt-4 pt-4 border-t border-border/50 space-y-4 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          
                          {/* API Key */}
                          {(provider.kind === 'builtin' ? (provider.id === 'gemini' || provider.id === 'openai') : true) && (
                            <div className="space-y-1.5">
                              <Label htmlFor={`${provider.id}-key`} className="text-[10px] font-semibold text-muted-foreground">API Credential Key</Label>
                              <div className="relative">
                                <Input 
                                  id={`${provider.id}-key`} 
                                  type={showKeys[provider.id] ? 'text' : 'password'} 
                                  placeholder={isCustom ? 'Optional API key...' : (provider.id === 'gemini' ? 'AIzaSy...' : 'sk-...')} 
                                  value={provider.apiKey || ''} 
                                  onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })} 
                                  className="pr-9 font-mono text-xs h-9 rounded-lg border-border/60" 
                                />
                                <button type="button" onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                  {showKeys[provider.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Base URL */}
                          {(provider.kind !== 'builtin' || provider.id === 'ollama') && (
                            <div className="space-y-1.5">
                              <Label htmlFor={`${provider.id}-url`} className="text-[10px] font-semibold text-muted-foreground">Base Endpoint URL</Label>
                              <Input 
                                id={`${provider.id}-url`} 
                                placeholder={isCustom ? 'http://localhost:8080/v1' : 'http://localhost:11434'} 
                                value={provider.baseUrl || ''} 
                                onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })} 
                                className="font-mono text-xs h-9 rounded-lg border-border/60" 
                              />
                            </div>
                          )}

                          {/* Model Select */}
                          <div className="space-y-1.5 col-span-1">
                            <Label className="text-[10px] font-semibold text-muted-foreground">Base Reference Model</Label>
                            {provider.models.length > 0 ? (
                              <Select
                                value={provider.defaultModel || ''}
                                onValueChange={(val) => {
                                  updateProvider(provider.id, { defaultModel: val });
                                  if (settings.activeProvider === provider.id) {
                                    setSettings(prev => prev ? { ...prev, buildModel: val } : null);
                                    setDirty(true);
                                  }
                                }}
                              >
                                <SelectTrigger className="font-mono text-xs h-9 rounded-lg border-border/60"><SelectValue placeholder="Select active model" /></SelectTrigger>
                                <SelectContent>
                                  {provider.models.map(model => <SelectItem key={model.id} value={model.id} className="font-mono text-xs">{model.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="text-[11px] text-muted-foreground/80 py-1.5 px-2.5 rounded-lg border border-dashed border-border/60 bg-muted/20">
                                No models indexed yet. Run connection test to synchronize.
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Connection Test Diagnostics */}
                        {result && (
                          <div className={cn(
                            "flex items-start gap-2.5 text-xs p-3 rounded-lg border leading-relaxed",
                            result.ok 
                              ? "bg-emerald-500/[0.03] border-emerald-500/20 text-emerald-700 dark:text-emerald-400" 
                              : "bg-destructive/[0.03] border-destructive/20 text-destructive"
                          )}>
                            {result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />}
                            <span className="font-medium text-[11px]">{result.message}</span>
                          </div>
                        )}

                        {/* Provider Action Row */}
                        <div className="flex items-center gap-2.5 pt-1">
                          <Button size="sm" variant="outline" onClick={() => testConnection(provider.id)} disabled={isTesting} className="text-xs gap-1.5 h-8.5 rounded-lg font-semibold border-border/60">
                            {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            Test & Sync
                          </Button>
                          {provider.defaultModel && !isActive && (
                            <Button size="sm" variant="outline" onClick={() => setActiveProvider(provider.id, provider.defaultModel!)} className="text-xs gap-1.5 h-8.5 rounded-lg font-semibold border-border/60">
                              <Star className="h-3.5 w-3.5" />Set as Default
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}

            {/* ─── Add Custom Provider Redesigned ─── */}
            <div className="rounded-xl border border-dashed border-border/70 overflow-hidden bg-muted/[0.01]">
              {!showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full py-4 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-all font-semibold text-xs rounded-xl"
                >
                  <Plus className="h-4 w-4" />
                  Connect OpenAI-Compatible Proxy / Endpoint
                </button>
              ) : (
                <div className="p-4 md:p-5 space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">New API Provider Payload</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => { setShowAddForm(false); setNewName(''); setNewBaseUrl(''); setNewApiKey(''); setDiscoveredModels([]); }}
                      className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="new-name" className="text-[10px] font-semibold text-muted-foreground">Provider Identifier</Label>
                      <Input id="new-name" placeholder="e.g. OpenRouter Proxy" value={newName} onChange={(e) => setNewName(e.target.value)} className="text-xs h-9 rounded-lg border-border/60" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-url" className="text-[10px] font-semibold text-muted-foreground">Base URL Endpoint</Label>
                      <Input id="new-url" placeholder="http://127.0.0.1:8080/v1" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} className="font-mono text-xs h-9 rounded-lg border-border/60" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-key" className="text-[10px] font-semibold text-muted-foreground">Authorization Key <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <div className="relative">
                        <Input id="new-key" type={newShowKey ? 'text' : 'password'} placeholder="Authorization token if required" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} className="pr-9 font-mono text-xs h-9 rounded-lg border-border/60" />
                        <button type="button" onClick={() => setNewShowKey(!newShowKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {newShowKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5 flex flex-col justify-end">
                      <Button size="sm" variant="outline" onClick={discoverModels} disabled={discovering || !newBaseUrl.trim()} className="text-xs gap-1.5 h-9 rounded-lg font-semibold border-border/60">
                        {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Fetch Models
                      </Button>
                    </div>
                  </div>

                  {discoveredModels.length > 0 && (
                    <div className="space-y-1.5 bg-muted/40 border border-border/50 p-3 rounded-lg animate-in fade-in duration-200">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Indexed Remote Models ({discoveredModels.length})</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {discoveredModels.slice(0, 8).map(m => <Badge key={m.id} variant="outline" className="text-[9px] font-mono border-border/60 bg-card text-muted-foreground px-1.5 py-0">{m.id}</Badge>)}
                        {discoveredModels.length > 8 && <Badge variant="outline" className="text-[9px] px-1.5 py-0">+{discoveredModels.length - 8} more</Badge>}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end pt-3 border-t border-border/50">
                    <Button size="sm" onClick={addCustomProvider} disabled={!newName.trim() || !newBaseUrl.trim()} className="text-xs gap-1.5 h-8.5 rounded-lg font-bold bg-primary text-primary-foreground">
                      <Plus className="h-3.5 w-3.5" />Register Provider
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Global Saving Overlay / Indicator ─── */}
      {saving && (
        <div className="flex justify-end sticky bottom-4 z-10">
          <Badge variant="outline" className="gap-1.5 bg-background/95 backdrop-blur-md shadow-md border-border/60 px-3 py-1 text-[10px] text-muted-foreground font-semibold">
            <Loader2 className="h-3 w-3 animate-spin text-primary" /> Synchronizing settings...
          </Badge>
        </div>
      )}
    </div>
  );
}
