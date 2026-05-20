'use client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Sparkles, Bot, Server, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  RefreshCw, Star, Zap, Save, Plus, Trash2, Globe, Key,
} from 'lucide-react';

interface ModelConfig { id: string; name: string; }
interface LLMProvider {
  id: string; name: string; kind: 'builtin' | 'openai-compat'; enabled: boolean;
  apiKey?: string; baseUrl?: string; models: ModelConfig[]; defaultModel?: string;
}
interface FactorySettings { providers: LLMProvider[]; activeProvider: string; buildModel: string; updatedAt?: string; }

const PROVIDER_META: Record<string, { icon: React.ReactNode; color: string; description: string }> = {
  gemini: { icon: <Sparkles className="h-5 w-5" />, color: 'text-blue-500', description: "Google's most capable AI models." },
  openai: { icon: <Bot className="h-5 w-5" />, color: 'text-green-500', description: 'GPT models with strong code generation.' },
  ollama: { icon: <Server className="h-5 w-5" />, color: 'text-orange-500', description: 'Run models locally — fully private.' },
};

function providerMeta(id: string, name: string, kind: string) {
  const known = PROVIDER_META[id];
  if (known) return known;
  return { icon: <Globe className="h-5 w-5" />, color: 'text-purple-500', description: `OpenAI-compatible: ${name}` };
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
    setTestResults(prev => ({ ...prev, [providerId]: { ok: false, message: 'Testing...' } }));
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

  if (loading || !settings) {
    return (
      <div className="space-y-4 md:space-y-6">
        {[1, 2, 3].map(i => (
          <Card key={i} className="p-5 md:p-6">
            <div className="h-24 bg-muted/35 animate-pulse rounded-xl" />
          </Card>
        ))}
      </div>
    );
  }

  const activeProvider = settings.providers.find(p => p.id === settings.activeProvider && p.enabled);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Active model banner */}
      {activeProvider && settings.buildModel ? (
        <Card className="border bg-muted p-4 md:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 md:gap-4 shadow-sm">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="flex items-center gap-2">
              {activeProvider.kind === 'builtin' ? PROVIDER_META[activeProvider.id]?.icon || <Bot className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-xs sm:text-sm font-semibold">Active Build Model</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">
                {activeProvider.name} → <span className="font-mono text-foreground font-bold">{settings.buildModel}</span>
              </p>
            </div>
          </div>
          <Badge variant="outline" className="gap-1.5 self-start sm:self-auto font-semibold">
            <Zap className="h-3 w-3 fill-current" />Ready
          </Badge>
        </Card>
      ) : (
        <Card className="border border-border p-4 md:p-5 flex items-center gap-3 md:gap-4">
          <div className="p-2 rounded-lg bg-muted border border-border text-amber-600 dark:text-amber-500 shadow-xs">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-semibold">No Model Configured</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Enable a provider and set it as default.</p>
          </div>
        </Card>
      )}

      {/* Provider cards */}
      {settings.providers.map(provider => {
        const meta = providerMeta(provider.id, provider.name, provider.kind);
        const result = testResults[provider.id];
        const isActive = settings.activeProvider === provider.id;
        const isTesting = testingProvider === provider.id;
        const isCustom = provider.kind !== 'builtin';

        return (
          <div
            key={provider.id}
            className={cn(
              "rounded-xl border p-0 transition-all duration-300 border-border overflow-hidden hover:shadow-sm bg-card text-card-foreground",
              isActive ? "ring-1 ring-ring" : "",
              !provider.enabled && "opacity-60 border-border"
            )}
          >
            {/* Header section with padding */}
            <div className="p-5 md:p-6 pb-4 sm:pb-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-xs select-none bg-muted border-border"
                  )}>
                    <div className="text-foreground">{meta?.icon}</div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-sm md:text-base font-bold tracking-tight text-foreground truncate">
                        {provider.name}
                      </h3>
                      {isActive && <Badge className="text-[9px] font-bold px-2 py-0.5 gap-1"><Star className="h-2.5 w-2.5 fill-current" />Default</Badge>}
                      {isCustom && <Badge variant="secondary" className="text-[9px] font-bold px-2 py-0.5">Custom</Badge>}
                    </div>
                    <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">{meta?.description || `OpenAI-compatible at ${provider.baseUrl}`}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isCustom && (
                    <Button size="icon" variant="ghost" onClick={() => removeProvider(provider.id)} className="h-8 w-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Switch checked={provider.enabled} onCheckedChange={(checked) => updateProvider(provider.id, { enabled: checked })} className="scale-90" />
                </div>
              </div>
            </div>

            {provider.enabled && (
              <div className="px-5 md:px-6 pb-5 md:pb-6 space-y-4 pt-0">
                <Separator className="border-border" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* API Key */}
                  {(provider.kind === 'builtin' ? (provider.id === 'gemini' || provider.id === 'openai') : true) && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`${provider.id}-key`} className="text-[10px] md:text-xs font-semibold text-muted-foreground">API Key {isCustom ? '(optional)' : ''}</Label>
                      <div className="relative">
                        <Input id={`${provider.id}-key`} type={showKeys[provider.id] ? 'text' : 'password'} placeholder={isCustom ? 'Optional API key...' : (provider.id === 'gemini' ? 'AIza...' : 'sk-...')} value={provider.apiKey || ''} onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })} className="pr-10 font-mono text-xs h-10 rounded-md" />
                        <button type="button" onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showKeys[provider.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Base URL */}
                  {(provider.kind !== 'builtin' || provider.id === 'ollama') && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`${provider.id}-url`} className="text-[10px] md:text-xs font-semibold text-muted-foreground">Base URL</Label>
                      <Input id={`${provider.id}-url`} placeholder={isCustom ? 'http://100.77.38.96:8080/v1' : 'http://localhost:11434'} value={provider.baseUrl || ''} onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })} className="font-mono text-xs h-10 rounded-md" />
                    </div>
                  )}

                  {/* Model selector */}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] md:text-xs font-semibold text-muted-foreground">Model</Label>
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
                        <SelectTrigger className="font-mono text-xs h-10 rounded-md"><SelectValue placeholder="Select a model" /></SelectTrigger>
                        <SelectContent>
                          {provider.models.map(model => <SelectItem key={model.id} value={model.id} className="font-mono text-xs">{model.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-xs text-muted-foreground py-2 pl-1">No models available — test connection to discover.</p>
                    )}
                  </div>
                </div>

                {/* Connection test result */}
                {result && (
                  <div className={cn(
                    "flex items-center gap-2 text-xs p-3 rounded-lg border leading-relaxed",
                    result.ok ? "bg-muted border-emerald-500 text-emerald-600 dark:text-emerald-400" : "bg-muted border-destructive text-destructive"
                  )}>
                    {result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                    {result.message}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => testConnection(provider.id)} disabled={isTesting} className="text-xs gap-1.5 h-9 rounded-md font-semibold">
                    {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Test & Discover
                  </Button>
                  {provider.defaultModel && !isActive && (
                    <Button size="sm" variant="outline" onClick={() => setActiveProvider(provider.id, provider.defaultModel!)} className="text-xs gap-1.5 h-9 rounded-md font-semibold">
                      <Star className="h-3.5 w-3.5" />Set as Default
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add Custom Provider */}
      <Card className="rounded-xl border border-dashed border-border overflow-hidden hover:border-border transition-all duration-300 p-5 md:p-6 shadow-sm">
        {!showAddForm ? (
          <Button
            variant="ghost"
            className="w-full flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground h-12 hover:bg-accent rounded-lg text-xs sm:text-sm font-semibold transition-all"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-4 w-4 text-foreground" />
            Add OpenAI-Compatible Provider
          </Button>
        ) : (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-1">
              <h4 className="text-xs sm:text-sm font-bold tracking-tight uppercase text-muted-foreground">New Provider</h4>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => { setShowAddForm(false); setNewName(''); setNewBaseUrl(''); setNewApiKey(''); setDiscoveredModels([]); }}
                className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-name" className="text-[10px] md:text-xs font-semibold text-muted-foreground">Provider Name</Label>
                <Input id="new-name" placeholder="e.g. My AI Proxy" value={newName} onChange={(e) => setNewName(e.target.value)} className="text-xs h-10 rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-url" className="text-[10px] md:text-xs font-semibold text-muted-foreground">Base URL</Label>
                <Input id="new-url" placeholder="http://100.77.38.96:8080/v1" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} className="font-mono text-xs h-10 rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-key" className="text-[10px] md:text-xs font-semibold text-muted-foreground">API Key <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="relative">
                  <Input id="new-key" type={newShowKey ? 'text' : 'password'} placeholder="Optional — leave blank if not needed" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} className="pr-10 font-mono text-xs h-10 rounded-md" />
                  <button type="button" onClick={() => setNewShowKey(!newShowKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {newShowKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 flex flex-col justify-end">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={discoverModels} disabled={discovering || !newBaseUrl.trim()} className="text-xs gap-1.5 h-10 rounded-md font-semibold">
                    {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Fetch Models
                  </Button>
                </div>
              </div>
            </div>

            {discoveredModels.length > 0 && (
              <div className="space-y-1.5 bg-muted border border-border p-3 rounded-lg">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Discovered Models:</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {discoveredModels.slice(0, 8).map(m => <Badge key={m.id} variant="outline" className="text-[10px] font-mono border-border">{m.id}</Badge>)}
                  {discoveredModels.length > 8 && <Badge variant="outline" className="text-[10px]">+{discoveredModels.length - 8} more</Badge>}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-border">
              <Button size="sm" onClick={addCustomProvider} disabled={!newName.trim() || !newBaseUrl.trim()} className="text-xs gap-1.5 h-9 rounded-md font-bold bg-primary text-primary-foreground">
                <Plus className="h-3.5 w-3.5" />Add Provider
              </Button>
            </div>
          </div>
        )}
      </Card>

      {saving && (
        <div className="flex justify-end sticky bottom-4">
          <Badge variant="outline" className="gap-1.5 bg-background shadow-lg"><Loader2 className="h-3 w-3 animate-spin" />Saving...</Badge>
        </div>
      )}
    </div>
  );
}
