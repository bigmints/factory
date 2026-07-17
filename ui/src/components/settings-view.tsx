'use client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye, EyeOff, Loader2,
  Save, Network, Plus, Trash2, Zap,
  Pencil
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ModelConfig { id: string; name: string; }
interface LLMProvider {
  id: string; name: string; kind: 'builtin' | 'openai-compat' | 'cli' | 'openai' | 'gemini' | 'ollama'; enabled: boolean;
  apiKey?: string; baseUrl?: string; models: ModelConfig[]; defaultModel?: string;
}
interface FactorySettings {
  providers: LLMProvider[];
  activeProvider: string;
  buildModel: string;
  defaultCli?: string;
  updatedAt?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SettingsView() {
  const [settings, setSettings] = useState<FactorySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [modalType, setModalType] = useState('custom');
  const [modalProvider, setModalProvider] = useState<Partial<LLMProvider>>({});
  
  const [showKey, setShowKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);

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

  const deleteProvider = (id: string) => {
    if (!settings) return;
    setSettings({
      ...settings,
      providers: settings.providers.filter(p => p.id !== id),
      activeProvider: settings.activeProvider === id ? '' : settings.activeProvider
    });
  };

  const handleModalTypeChange = (val: string) => {
    setModalType(val);
    let kind: LLMProvider['kind'] = 'openai-compat';
    let name = 'Custom API';
    let baseUrl = 'https://api.example.com/v1';

    if (val === 'openai') { kind = 'openai'; name = 'OpenAI'; baseUrl = 'https://api.openai.com/v1'; }
    else if (val === 'gemini') { kind = 'gemini'; name = 'Google Gemini'; baseUrl = ''; }
    else if (val === 'ollama') { kind = 'ollama'; name = 'Ollama'; baseUrl = 'http://localhost:11434'; }
    else if (val === 'lmstudio') { kind = 'openai-compat'; name = 'LM Studio'; baseUrl = 'http://localhost:1234/v1'; }
    else if (val === 'openrouter') { kind = 'openai-compat'; name = 'OpenRouter'; baseUrl = 'https://openrouter.ai/api/v1'; }

    setModalProvider(prev => ({
      ...prev,
      kind,
      name,
      baseUrl: kind !== 'gemini' ? baseUrl : undefined,
    }));
  };

  const openAddModal = () => {
    setModalMode('add');
    setModalType('custom');
    setModalProvider({
      id: `custom-${Date.now()}`,
      name: 'Custom API',
      kind: 'openai-compat',
      enabled: true,
      models: [],
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
      defaultModel: ''
    });
    setShowKey(false);
    setModalOpen(true);
  };

  const openEditModal = (provider: LLMProvider) => {
    setModalMode('edit');
    // Try to infer the preset type
    let type = 'custom';
    if (provider.kind === 'openai') type = 'openai';
    else if (provider.kind === 'gemini') type = 'gemini';
    else if (provider.kind === 'ollama') type = 'ollama';
    else if (provider.name === 'LM Studio') type = 'lmstudio';
    else if (provider.name === 'OpenRouter') type = 'openrouter';
    
    setModalType(type);
    setModalProvider({ ...provider });
    setShowKey(false);
    setModalOpen(true);
  };

  const handleSaveModal = () => {
    if (!settings) return;
    const provider = modalProvider as LLMProvider;
    const modelId = provider.defaultModel || provider.models?.[0]?.id || '';
    const shouldMakeActive =
      provider.enabled &&
      modelId &&
      (modalMode === 'add' ||
        !settings.activeProvider ||
        settings.activeProvider === provider.id);
    
    if (modalMode === 'add') {
      setSettings({
        ...settings,
        providers: [...settings.providers, provider],
        activeProvider: shouldMakeActive ? provider.id : settings.activeProvider,
        buildModel: shouldMakeActive ? modelId : settings.buildModel,
      });
    } else {
      setSettings({
        ...settings,
        providers: settings.providers.map(p => p.id === provider.id ? provider : p),
        activeProvider: shouldMakeActive ? provider.id : settings.activeProvider,
        buildModel: shouldMakeActive ? modelId : settings.buildModel,
      });
    }
    setModalOpen(false);
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

  // ── Fetch Models ──

  const fetchModels = async () => {
    if (!modalProvider.id) return;
    setFetchingModels(true);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: modalProvider.id,
          apiKey: modalProvider.apiKey,
          baseUrl: modalProvider.baseUrl,
          kind: modalProvider.kind,
        }),
      });
      const data = await res.json();
      if (data.ok && data.models) {
        setModalProvider(prev => ({
          ...prev,
          models: data.models,
          defaultModel: prev.defaultModel || (data.models[0]?.id || ''),
        }));
        toast.success(data.message || 'Models fetched successfully');
      } else {
        toast.error(data.message || 'Failed to fetch models');
      }
    } catch {
      toast.error('Failed to fetch models');
    } finally {
      setFetchingModels(false);
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

  const needsApiKey = modalProvider.kind !== 'ollama';
  const needsBaseUrl = modalProvider.kind === 'ollama' || modalProvider.kind === 'openai-compat' || modalProvider.kind === 'openai';

  const enabledProviders = settings.providers?.filter((p: any) => p.enabled) || [];
  const availableModels = enabledProviders.map((p: any) => {
    const modelId = p.defaultModel || p.kind;
    const modelObj = (p.models || []).find((m: any) => m.id === modelId);
    let modelName = modelObj ? (modelObj.name || modelObj.id) : modelId;
    if (modelName.includes(':')) {
      modelName = modelName.split(':').slice(1).join(':').trim();
    }
    return {
      providerId: p.id,
      providerName: p.name,
      modelId,
      modelName,
    };
  }).filter((m: any) => m.modelId);

  const currentCompoundValue = settings.activeProvider && settings.buildModel
    ? `${settings.activeProvider}:::${settings.buildModel}`
    : '';

  const handleGlobalModelChange = (compoundValue: string) => {
    if (compoundValue === 'none') return;
    const [providerId, modelId] = compoundValue.split(':::');
    setSettings({ ...settings, activeProvider: providerId, buildModel: modelId });
  };

  return (
    <div className="space-y-8 max-w-4xl pb-16">
      
      {/* ─── Header Section ─── */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Pi SDK Execution</h2>
          <p className="text-sm text-muted-foreground mt-1">Configure the provider credentials and default model Factory uses when the Pi SDK executes stories.</p>
        </div>
        <div className="flex flex-wrap gap-3 w-full md:w-auto">
          <Button onClick={openAddModal} variant="outline" className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" />
            Add Provider
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2 shadow-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        </div>
      </div>

      {/* ─── Global Settings ─── */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-foreground">Global Settings</h3>
        <Card className="p-6 border border-border/40 bg-card space-y-4">
          <div className="grid gap-2">
            <Label>Default Pi Execution Model</Label>
            <Select value={currentCompoundValue || undefined} onValueChange={handleGlobalModelChange}>
              <SelectTrigger className="w-[300px] h-9">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No models available
                  </SelectItem>
                ) : (
                  availableModels.map((m: any) => (
                    <SelectItem key={`${m.providerId}:::${m.modelId}`} value={`${m.providerId}:::${m.modelId}`}>
                      {m.modelName} ({m.providerName})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">This is the default model the Pi SDK uses when executing stories. You can still override it per project in Project Settings.</p>
          </div>
        </Card>
      </div>

      {/* ─── Added Models ─── */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-foreground">Configured Providers</h3>
        
        {settings.providers.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border/40 rounded-xl bg-black/10 text-muted-foreground text-sm">
            No providers added yet. Click <span className="font-semibold text-foreground">&ldquo;+ Add Provider&rdquo;</span> to give the Pi SDK a backing model provider.
          </div>
        )}

        <div className="space-y-3">
          {settings.providers.map(provider => {
            return (
              <Card 
                key={provider.id} 
                className="overflow-hidden transition-all duration-200 border border-border/40 bg-card"
              >
                <div className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                        {provider.name} {provider.defaultModel ? `/ ${provider.defaultModel}` : ''}
                        {!provider.enabled && <Badge variant="secondary" className="text-[10px] bg-muted-foreground/20 text-muted-foreground border-0">Disabled</Badge>}
                      </div>
                      <div className="text-[13px] text-muted-foreground mt-0.5 font-mono">
                        {provider.defaultModel || provider.kind} &middot; {provider.baseUrl || 'Default Endpoint'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex gap-2">
                       {/vision|vl|llava|omni|-o|gpt-4o|claude-3-5|pixtral/i.test(provider.defaultModel || provider.kind) && (
                         <Badge variant="outline" className="bg-transparent border-border/40 text-muted-foreground text-[10px] uppercase font-semibold rounded-full px-2.5 py-0.5 h-6">
                           <Eye className="h-3.5 w-3.5 mr-1" /> Vision
                         </Badge>
                       )}
                       {/think|r1|reasoning|o1|o3|qwq/i.test(provider.defaultModel || provider.kind) && (
                         <Badge variant="outline" className="bg-transparent text-blue-400 text-[10px] uppercase font-semibold rounded-full px-2.5 py-0.5 h-6 border-blue-500/20 bg-blue-500/10">
                           <Zap className="h-3.5 w-3.5 mr-1" /> Think
                         </Badge>
                       )}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => openEditModal(provider)} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteProvider(provider.id)} className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ─── Modal ─── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-background border-border/40 text-foreground sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Network className="h-5 w-5 text-blue-500" />
              {modalMode === 'add' ? 'Add Provider' : 'Edit Provider'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 pt-4">
            {modalMode === 'add' && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Provider Preset</Label>
                <Select value={modalType} onValueChange={handleModalTypeChange}>
                  <SelectTrigger className="h-10 bg-background border-border/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="gemini">Google Gemini</SelectItem>
                    <SelectItem value="ollama">Ollama</SelectItem>
                    <SelectItem value="lmstudio">LM Studio</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="custom">Custom API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Enabled</Label>
              <Switch 
                checked={modalProvider.enabled || false} 
                onCheckedChange={(val) => setModalProvider(prev => ({ ...prev, enabled: val }))} 
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Name</Label>
              <Input 
                value={modalProvider.name || ''} 
                onChange={e => setModalProvider(prev => ({ ...prev, name: e.target.value }))} 
                className="h-10" 
              />
            </div>
            
            {needsBaseUrl && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Base URL</Label>
                <Input 
                  value={modalProvider.baseUrl || ''} 
                  onChange={e => setModalProvider(prev => ({ ...prev, baseUrl: e.target.value }))} 
                  className="h-10 font-mono text-sm" 
                  placeholder="https://api.example.com/v1"
                />
              </div>
            )}
            
            {needsApiKey && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">API Key</Label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Input 
                      type={showKey ? 'text' : 'password'}
                      placeholder="Enter your API key..."
                      value={modalProvider.apiKey || ''}
                      onChange={e => setModalProvider(prev => ({ ...prev, apiKey: e.target.value }))}
                      className="font-mono text-sm bg-background border-border/40 pr-10 focus-visible:ring-1 focus-visible:ring-blue-500 h-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button 
                    variant="secondary" 
                    onClick={fetchModels}
                    disabled={fetchingModels}
                  >
                    {fetchingModels ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Load Models
                  </Button>
                </div>
                <p className="text-[12px] text-muted-foreground italic mt-2">Click &ldquo;Load Models&rdquo; to fetch available models from the API.</p>
              </div>
            )}

            {/* Manual Model Entry */}
            <div className="pt-5 border-t border-border/20 space-y-3">
              <Label className="text-sm font-medium">Manual Model Entry</Label>
              <p className="text-[12px] text-muted-foreground mb-3">If the API doesn&apos;t list models, enter the exact model ID here or select from loaded models.</p>
              <div className="flex items-center gap-3">
                {(modalProvider.models || []).length > 0 ? (
                  <div className="flex-1 flex gap-3">
                    <Select
                      value={modalProvider.defaultModel || ''}
                      onValueChange={(val) => {
                        setModalProvider(prev => ({ ...prev, defaultModel: val }));
                      }}
                    >
                      <SelectTrigger className="font-mono text-sm h-10 bg-background border-border/40 flex-1">
                        <SelectValue placeholder="Select model…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(modalProvider.models || []).map(m => (
                          <SelectItem key={m.id} value={m.id} className="font-mono text-sm">
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <Input
                    placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                    value={modalProvider.defaultModel || ''}
                    onChange={(e) => {
                      setModalProvider(prev => ({ ...prev, defaultModel: e.target.value }));
                    }}
                    className="font-mono text-sm h-10 bg-background border-border/40 flex-1"
                  />
                )}
                <Button variant="outline" onClick={() => toast.success("Model ID selected")}>
                  Set Default
                </Button>
              </div>
            </div>

            <Button onClick={handleSaveModal} className="w-full mt-4">
              {modalMode === 'add' ? 'Create Provider' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
    </div>
  );
}
