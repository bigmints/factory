'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
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
      <div className="space-y-3 sm:space-y-4">
        {[1, 2, 3].map(i => (
          <Card key={i}><CardContent className="py-6 sm:py-8"><div className="h-24 bg-muted/30 animate-pulse rounded-lg" /></CardContent></Card>
        ))}
      </div>
    );
  }

  const activeProvider = settings.providers.find(p => p.id === settings.activeProvider && p.enabled);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Active model banner */}
      {activeProvider && settings.buildModel ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2">
                {activeProvider.kind === 'builtin' ? PROVIDER_META[activeProvider.id]?.icon || <Bot className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium">Active Build Model</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">
                  {activeProvider.name} → <span className="font-mono">{settings.buildModel}</span>
                </p>
              </div>
            </div>
            <Badge variant="outline" className="gap-1.5 self-start sm:self-auto">
              <Zap className="h-3 w-3" />Ready
            </Badge>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="py-3 sm:py-4 flex items-center gap-2 sm:gap-3">
            <div className="p-2 rounded-lg bg-background border text-amber-500"><Zap className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-xs sm:text-sm font-medium">No Model Configured</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">Enable a provider and set it as default.</p>
            </div>
          </CardContent>
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
          <Card key={provider.id} className={`transition-all ${isActive ? 'ring-2 ring-primary/30' : ''} ${!provider.enabled ? 'opacity-60' : ''}`}>
            <CardHeader className="pb-3 sm:pb-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <div className={`p-2 rounded-lg border ${meta?.color} shrink-0`}>{meta?.icon}</div>
                  <div className="min-w-0">
                    <CardTitle className="text-sm sm:text-base flex items-center gap-2 flex-wrap">
                      <span className="truncate">{provider.name}</span>
                      {isActive && <Badge className="text-[9px] sm:text-[10px] gap-1"><Star className="h-2.5 w-2.5" />Default</Badge>}
                      {isCustom && <Badge variant="secondary" className="text-[9px] sm:text-[10px]">Custom</Badge>}
                    </CardTitle>
                    <CardDescription className="text-[10px] sm:text-xs mt-0.5">{meta?.description || `OpenAI-compatible at ${provider.baseUrl}`}</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isCustom && (
                    <Button size="icon" variant="ghost" onClick={() => removeProvider(provider.id)} className="h-8 w-8 text-muted-foreground hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Switch checked={provider.enabled} onCheckedChange={(checked) => updateProvider(provider.id, { enabled: checked })} />
                </div>
              </div>
            </CardHeader>

            {provider.enabled && (
              <CardContent className="space-y-3 sm:space-y-4 pt-0">
                <Separator />

                {/* API Key */}
                {(provider.kind === 'builtin' ? (provider.id === 'gemini' || provider.id === 'openai') : true) && (
                  <div className="space-y-2">
                    <Label htmlFor={`${provider.id}-key`} className="text-[10px] sm:text-xs font-medium">API Key {isCustom ? '(optional)' : ''}</Label>
                    <div className="relative">
                      <Input id={`${provider.id}-key`} type={showKeys[provider.id] ? 'text' : 'password'} placeholder={isCustom ? 'Optional API key...' : (provider.id === 'gemini' ? 'AIza...' : 'sk-...')} value={provider.apiKey || ''} onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })} className="pr-9 sm:pr-10 font-mono text-[10px] sm:text-xs h-9 sm:h-10" />
                      <button type="button" onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))} className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showKeys[provider.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Base URL */}
                {(provider.kind !== 'builtin' || provider.id === 'ollama') && (
                  <div className="space-y-2">
                    <Label htmlFor={`${provider.id}-url`} className="text-[10px] sm:text-xs font-medium">Base URL</Label>
                    <Input id={`${provider.id}-url`} placeholder={isCustom ? 'http://100.77.38.96:8080/v1' : 'http://localhost:11434'} value={provider.baseUrl || ''} onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })} className="font-mono text-[10px] sm:text-xs h-9 sm:h-10" />
                  </div>
                )}

                {/* Model selector */}
                <div className="space-y-2">
                  <Label className="text-[10px] sm:text-xs font-medium">Model</Label>
                  {provider.models.length > 0 ? (
                    <Select value={provider.defaultModel || ''} onValueChange={(val) => updateProvider(provider.id, { defaultModel: val })}>
                      <SelectTrigger className="font-mono text-[10px] sm:text-xs h-9 sm:h-10"><SelectValue placeholder="Select a model" /></SelectTrigger>
                      <SelectContent>
                        {provider.models.map(model => <SelectItem key={model.id} value={model.id} className="font-mono text-[10px] sm:text-xs">{model.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-[10px] sm:text-xs text-muted-foreground py-2">No models available — test connection to discover.</p>
                  )}
                </div>

                {/* Connection test result */}
                {result && (
                  <div className={`flex items-center gap-2 text-[10px] sm:text-xs p-2 rounded-md border ${result.ok ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600' : 'bg-red-500/5 border-red-500/20 text-red-600'}`}>
                    {result.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                    {result.message}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => testConnection(provider.id)} disabled={isTesting} className="text-[10px] sm:text-xs gap-1.5 h-8 sm:h-9">
                    {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Test & Discover
                  </Button>
                  {provider.defaultModel && !isActive && (
                    <Button size="sm" variant="outline" onClick={() => setActiveProvider(provider.id, provider.defaultModel!)} className="text-[10px] sm:text-xs gap-1.5 h-8 sm:h-9">
                      <Star className="h-3 w-3" />Set as Default
                    </Button>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}

      {/* Add Custom Provider */}
      <Card className="border-dashed">
        <CardContent className="py-3 sm:py-4">
          {!showAddForm ? (
            <Button variant="ghost" className="w-full flex items-center justify-center gap-2 text-muted-foreground h-10 sm:h-12" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4" />Add OpenAI-Compatible Provider
            </Button>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs sm:text-sm font-medium">New Provider</h4>
                <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setNewName(''); setNewBaseUrl(''); setNewApiKey(''); setDiscoveredModels([]); }} className="h-6 w-6"><XCircle className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-name" className="text-[10px] sm:text-xs font-medium">Provider Name</Label>
                <Input id="new-name" placeholder="e.g. My AI Proxy" value={newName} onChange={(e) => setNewName(e.target.value)} className="text-[10px] sm:text-xs h-9 sm:h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-url" className="text-[10px] sm:text-xs font-medium">Base URL</Label>
                <Input id="new-url" placeholder="http://100.77.38.96:8080/v1" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} className="font-mono text-[10px] sm:text-xs h-9 sm:h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-key" className="text-[10px] sm:text-xs font-medium">API Key <span className="text-muted-foreground">(optional)</span></Label>
                <div className="relative">
                  <Input id="new-key" type={newShowKey ? 'text' : 'password'} placeholder="Optional — leave blank if not needed" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} className="pr-9 sm:pr-10 font-mono text-[10px] sm:text-xs h-9 sm:h-10" />
                  <button type="button" onClick={() => setNewShowKey(!newShowKey)} className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {newShowKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={discoverModels} disabled={discovering || !newBaseUrl.trim()} className="text-[10px] sm:text-xs gap-1.5 h-8 sm:h-9">
                    {discovering ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Fetch Models
                  </Button>
                </div>
                {discoveredModels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <span className="text-[10px] sm:text-xs text-muted-foreground mr-1">Discovered:</span>
                    {discoveredModels.slice(0, 8).map(m => <Badge key={m.id} variant="outline" className="text-[9px] sm:text-[10px] font-mono">{m.id}</Badge>)}
                    {discoveredModels.length > 8 && <Badge variant="outline" className="text-[9px] sm:text-[10px]">+{discoveredModels.length - 8} more</Badge>}
                  </div>
                )}
              </div>
              <div className="flex justify-end pt-2">
                <Button size="sm" onClick={addCustomProvider} disabled={!newName.trim() || !newBaseUrl.trim()} className="text-[10px] sm:text-xs gap-1.5 h-8 sm:h-9">
                  <Plus className="h-3 w-3" />Add Provider
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {saving && (
        <div className="flex justify-end sticky bottom-4">
          <Badge variant="outline" className="gap-1.5 bg-background shadow-lg"><Loader2 className="h-3 w-3 animate-spin" />Saving...</Badge>
        </div>
      )}
    </div>
  );
}
