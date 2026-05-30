'use client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Sparkles, Bot, Server, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  RefreshCw, Star, Plus, Globe, AlertTriangle, ChevronRight
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

const PROVIDER_META: Record<string, { icon: React.ReactNode; bg: string; description: string }> = {
  gemini: { 
    icon: <Sparkles className="h-4.5 w-4.5 text-blue-500" />, 
    bg: 'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20 text-blue-500',
    description: "Google Gemini developer models via direct API." 
  },
  openai: { 
    icon: <Bot className="h-4.5 w-4.5 text-emerald-500" />, 
    bg: 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20 text-emerald-500',
    description: 'Direct integration with OpenAI GPT models.' 
  },
  ollama: { 
    icon: <Server className="h-4.5 w-4.5 text-orange-500" />, 
    bg: 'bg-orange-500/5 dark:bg-orange-500/10 border-orange-500/20 text-orange-500',
    description: 'Fully local and private model execution via Ollama.' 
  },
};

function getProviderMeta(id: string, name: string) {
  const known = PROVIDER_META[id];
  if (known) return known;
  return { 
    icon: <Globe className="h-4.5 w-4.5 text-indigo-500" />, 
    bg: 'bg-indigo-500/5 dark:bg-indigo-500/10 border-indigo-500/20 text-indigo-500',
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
  
  // Inner Sub-Tab state
  const [activeSubTab, setActiveSubTab] = useState<'engine' | 'providers'>('engine');
  
  // Master-Detail selection state
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');

  // Mobile-First Modal flow states
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [selectedTypeToAdd, setSelectedTypeToAdd] = useState<'gemini' | 'openai' | 'ollama' | 'custom' | null>(null);
  const [editingProvider, setEditingProvider] = useState<LLMProvider | null>(null);
  
  // Connection modal temporary states
  const [modalName, setModalName] = useState('');
  const [modalBaseUrl, setModalBaseUrl] = useState('');
  const [modalApiKey, setModalApiKey] = useState('');
  const [modalShowKey, setModalShowKey] = useState(false);
  const [modalTesting, setModalTesting] = useState(false);
  const [modalTestResult, setModalTestResult] = useState<{ ok: boolean; message: string; models?: ModelConfig[] } | null>(null);
  const [modalDefaultModel, setModalDefaultModel] = useState('');
  const [modalModels, setModalModels] = useState<ModelConfig[]>([]);
  const [isAddingManualModel, setIsAddingManualModel] = useState(false);
  const [manualModelInput, setManualModelInput] = useState('');

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);
    } catch { toast.error('Failed to load settings'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Synchronize selection state once settings are loaded
  useEffect(() => {
    if (settings && !selectedProviderId) {
      const activeEnabled = settings.providers.find(p => p.id === settings.activeProvider && p.enabled);
      const firstEnabled = settings.providers.find(p => p.enabled);
      setSelectedProviderId(activeEnabled?.id || firstEnabled?.id || '');
    }
  }, [settings, selectedProviderId]);

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
    const updatedProviders = settings.providers.filter(p => p.id !== id);
    setSettings({ 
      ...settings, 
      activeProvider: isActive ? '' : settings.activeProvider, 
      buildModel: isActive ? '' : settings.buildModel, 
      providers: updatedProviders 
    });
    setDirty(true);
    const remaining = updatedProviders.filter(p => p.enabled);
    setSelectedProviderId(remaining[0]?.id || '');
    toast.success('Provider removed');
  };

  const disconnectProvider = (id: string) => {
    if (!settings) return;
    const isActive = settings.activeProvider === id;
    const updatedProviders = settings.providers.map(p => p.id === id ? { ...p, enabled: false } : p);
    setSettings({ 
      ...settings, 
      activeProvider: isActive ? '' : settings.activeProvider, 
      buildModel: isActive ? '' : settings.buildModel,
      providers: updatedProviders 
    });
    setDirty(true);
    const remaining = updatedProviders.filter(p => p.enabled);
    setSelectedProviderId(remaining[0]?.id || '');
    toast.success('Provider disconnected');
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

  // Connection testing inside the Connection Modal
  const testModalConnection = async () => {
    const type = selectedTypeToAdd || editingProvider?.kind;
    const id = selectedTypeToAdd || editingProvider?.id;
    if (!type || !id) return;
    
    setModalTesting(true);
    setModalTestResult(null);
    
    // Resolve credentials payload
    let testPayload: any = { kind: 'openai-compat' };
    if (id === 'gemini') {
      testPayload = { provider: 'gemini', kind: 'builtin', apiKey: modalApiKey };
    } else if (id === 'openai') {
      testPayload = { provider: 'openai', kind: 'builtin', apiKey: modalApiKey };
    } else if (id === 'ollama') {
      testPayload = { provider: 'ollama', kind: 'builtin', baseUrl: modalBaseUrl || 'http://localhost:11434' };
    } else {
      testPayload = { kind: 'openai-compat', baseUrl: modalBaseUrl, apiKey: modalApiKey || undefined };
    }

    try {
      const res = await fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(testPayload) });
      const result = await res.json();
      setModalTestResult(result);
      if (result.ok) {
        toast.success(result.message);
        if (result.models?.length) {
          setModalModels(result.models);
          const hasCurrentDefault = result.models.some((m: any) => m.id === modalDefaultModel);
          if (!hasCurrentDefault) {
            setModalDefaultModel(result.models[0].id);
          }
        }
      } else {
        toast.error(result.message);
      }
    } catch {
      setModalTestResult({ ok: false, message: 'Connection check request failed.' });
      toast.error('Connection check request failed');
    } finally {
      setModalTesting(false);
    }
  };

  // Perform Connection addition and activate integration
  const handleConnectProvider = () => {
    if (!settings || !selectedTypeToAdd) return;

    if (selectedTypeToAdd === 'custom') {
      if (!modalName.trim() || !modalBaseUrl.trim()) { toast.error('Name and Base URL are required'); return; }
      const slug = modalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const id = `custom-${slug}-${Date.now()}`;
      const newProvider: LLMProvider = { 
        id, 
        name: modalName.trim(), 
        kind: 'openai-compat', 
        enabled: true, 
        baseUrl: modalBaseUrl.trim(), 
        apiKey: modalApiKey || '', 
        models: modalModels, 
        defaultModel: modalDefaultModel || '' 
      };
      setSettings({ 
        ...settings, 
        activeProvider: id, 
        buildModel: modalDefaultModel || '', 
        providers: [...settings.providers, newProvider] 
      });
      setDirty(true);
      setSelectedProviderId(id);
      toast.success(`Provider "${modalName}" connected & activated`);
    } else {
      // Connect Built-in provider (Gemini, OpenAI, Ollama)
      const providerId = selectedTypeToAdd;
      const provider = settings.providers.find(p => p.id === providerId);
      if (!provider) return;

      const updates: Partial<LLMProvider> = {
        enabled: true,
        apiKey: modalApiKey || undefined,
        baseUrl: modalBaseUrl || undefined,
        models: modalModels,
        defaultModel: modalDefaultModel || provider.defaultModel
      };

      setSettings({
        ...settings,
        activeProvider: providerId,
        buildModel: modalDefaultModel || provider.defaultModel || '',
        providers: settings.providers.map(p => p.id === providerId ? { ...p, ...updates } : p)
      });
      setDirty(true);
      setSelectedProviderId(providerId);
      toast.success(`Provider "${provider.name}" connected & activated`);
    }

    // Clear modal states and close
    setIsAddingProvider(false);
    setSelectedTypeToAdd(null);
    setModalName('');
    setModalBaseUrl('');
    setModalApiKey('');
    setModalTestResult(null);
    setModalDefaultModel('');
    setModalModels([]);
    setIsAddingManualModel(false);
    setManualModelInput('');
  };

  // Perform Connection saving after edit
  const handleSaveProvider = () => {
    if (!settings || !editingProvider) return;

    const id = editingProvider.id;
    const updates: Partial<LLMProvider> = {
      apiKey: modalApiKey || undefined,
      baseUrl: modalBaseUrl || undefined,
      models: modalModels,
      defaultModel: modalDefaultModel || editingProvider.defaultModel
    };

    if (editingProvider.kind === 'openai-compat') {
      if (!modalName.trim()) { toast.error('Provider identifier is required'); return; }
      updates.name = modalName.trim();
    }

    setSettings({
      ...settings,
      providers: settings.providers.map(p => p.id === id ? { ...p, ...updates } : p)
    });
    setDirty(true);
    
    // Also if this is the active default, update the build model
    if (settings.activeProvider === id && modalDefaultModel) {
      setSettings(prev => prev ? { ...prev, buildModel: modalDefaultModel } : null);
    }

    // Clear modal states and close
    setEditingProvider(null);
    setModalName('');
    setModalBaseUrl('');
    setModalApiKey('');
    setModalTestResult(null);
    setModalDefaultModel('');
    setModalModels([]);
    setIsAddingManualModel(false);
    setManualModelInput('');
    toast.success(`Provider "${editingProvider.name}" updated`);
  };

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
  const enabledProviders = settings.providers.filter(p => p.enabled);
  const currentProvider = enabledProviders.find(p => p.id === selectedProviderId) || enabledProviders[0];
  const isTesting = currentProvider && testingProvider === currentProvider.id;

  const CLI_OPTIONS = [
    { id: 'gemini', label: 'gemini', description: 'Google Gemini CLI · Uses your Google account authorization.' },
    { id: 'claude', label: 'claude', description: 'Anthropic Claude Code · Uses your Anthropic CLI credentials.' },
    { id: 'agy',    label: 'agy',    description: 'Antigravity CLI · Uses your active agy account.' },
    { id: 'pi',     label: 'pi',     description: 'Pi AI CLI · Uses your local Pi account details.' },
  ];

  return (
    <div className="space-y-6">
      
      {/* ─── Sleek Status Header Indicator (Ultra-Minimalist) ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/40">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Workspace Settings</h2>
          <p className="text-[11px] text-muted-foreground">Configure build generation engines and backend API credential keys.</p>
        </div>
        
        {settings?.defaultCli ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.03] text-xs self-start sm:self-auto transition-all">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              CLI Route: <span className="font-mono font-bold text-foreground">{settings.defaultCli}</span>
            </span>
          </div>
        ) : activeProvider && settings?.buildModel ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-500/20 bg-blue-500/[0.03] text-xs self-start sm:self-auto transition-all">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
            </span>
            <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
              API Route: <span className="font-semibold text-foreground">{activeProvider.name}</span> → <span className="font-mono text-[10px] font-bold text-foreground">{settings.buildModel}</span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/20 bg-amber-500/[0.03] text-xs self-start sm:self-auto transition-all">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Unconfigured</span>
          </div>
        )}
      </div>

      {/* ─── Flat Tab-Like Row Navigation ─── */}
      <div className="flex items-center justify-between border-b border-border/40 pb-px">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveSubTab('engine')}
            className={cn(
              "px-3 py-2 text-xs font-semibold border-b-2 transition-all duration-150 relative -mb-px",
              activeSubTab === 'engine'
                ? "border-primary text-foreground font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Build Engine
          </button>
          <button
            onClick={() => {
              setActiveSubTab('providers');
            }}
            className={cn(
              "px-3 py-2 text-xs font-semibold border-b-2 transition-all duration-150 relative -mb-px",
              activeSubTab === 'providers'
                ? "border-primary text-foreground font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            API Credentials
          </button>
        </div>
        {dirty && (
          <div className="text-[10px] font-semibold text-amber-500 bg-amber-500/5 px-2.5 py-0.5 border border-amber-500/10 rounded-md animate-pulse">
            Unsaved Changes
          </div>
        )}
      </div>

      {/* ─── Sub-Tab Content ─── */}
      {activeSubTab === 'engine' ? (
        <div className="space-y-5 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="space-y-0.5">
            <h3 className="text-xs font-semibold text-foreground">Generation Pipeline</h3>
            <p className="text-[11px] text-muted-foreground">{"Select where code build tasks should be routed. CLI routing operates natively on your terminal's authentication."}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* None (API Default) Option */}
            <button
              onClick={() => setDefaultCli('')}
              className={cn(
                'flex items-start gap-4 p-4 rounded-xl border text-left transition-all duration-150 relative bg-card text-card-foreground',
                !settings?.defaultCli
                  ? 'border-primary/80 ring-1 ring-primary/45 bg-accent/30'
                  : 'border-border/60 hover:border-border hover:bg-muted/30'
              )}
            >
              <div className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-xs transition-colors', 
                !settings?.defaultCli 
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
                    !settings?.defaultCli ? 'border-primary' : 'border-muted-foreground/30'
                  )}>
                    {!settings?.defaultCli && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">Route builds via API provider credentials configured in the keys tab.</p>
              </div>
            </button>

            {/* CLI Options */}
            {CLI_OPTIONS.map(cli => {
              const isActive = settings?.defaultCli === cli.id;
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
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="space-y-0.5">
            <h3 className="text-xs font-semibold text-foreground">API Credentials & Models</h3>
            <p className="text-[11px] text-muted-foreground">Manage configured API integrations, keys, and base reference models.</p>
          </div>

          <div className="w-full max-w-xl mx-auto">
            {enabledProviders.length > 0 ? (
              <div className="space-y-2.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground select-none px-1">Configured Integrations</span>
                <div className="border border-border/50 bg-card rounded-xl overflow-hidden divide-y divide-border/30 shadow-sm">
                  {enabledProviders.map(p => {
                    const meta = getProviderMeta(p.id, p.name);
                    const isActiveDefault = settings?.activeProvider === p.id;
                    
                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          setEditingProvider(p);
                          setModalName(p.name);
                          setModalApiKey(p.apiKey || '');
                          setModalBaseUrl(p.baseUrl || '');
                          setModalDefaultModel(p.defaultModel || '');
                          setModalTestResult(null);
                          setModalModels(p.models || []);
                          setIsAddingManualModel(false);
                          setManualModelInput('');
                        }}
                        className="w-full flex items-center justify-between p-4 hover:bg-muted/15 transition-all duration-150 cursor-pointer group select-none"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                            meta.bg
                          )}>
                            {meta.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">{p.name}</span>
                              {isActiveDefault && (
                                <Badge className="text-[8px] font-bold py-0.2 px-1 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 uppercase tracking-wider">
                                  Active
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground mt-0.5 block truncate max-w-[200px] sm:max-w-md font-mono">
                              Model: {p.defaultModel || 'None Selected'}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2.5 shrink-0">
                          {!isActiveDefault && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1" title="Connected" />
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    );
                  })}

                  {/* Connect API Provider Row inside the same container */}
                  <button
                    onClick={() => {
                      setIsAddingProvider(true);
                      setSelectedTypeToAdd(null);
                      setModalApiKey('');
                      setModalBaseUrl('');
                      setModalName('');
                      setModalTestResult(null);
                      setModalModels([]);
                      setModalDefaultModel('');
                      setIsAddingManualModel(false);
                      setManualModelInput('');
                    }}
                    className="w-full flex items-center justify-between p-4 hover:bg-primary/[0.02] active:bg-primary/[0.04] transition-all duration-150 cursor-pointer group select-none text-primary border-t border-border/30"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-primary/40 bg-primary/5 text-primary group-hover:bg-primary/10 transition-colors">
                        <Plus className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-bold block text-primary group-hover:underline">Connect API Provider</span>
                        <span className="text-[10px] text-primary/70 block mt-0.5">Add direct keys or custom models</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-primary/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </button>
                </div>
              </div>
            ) : (
              /* Elegant Empty State for Provider List */
              <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-border/70 bg-card/50 rounded-xl select-none gap-4 max-w-md mx-auto my-6 animate-in fade-in duration-300">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted border border-border/60 text-muted-foreground/60 shadow-inner">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-semibold text-foreground">No API Integrations Connected</h4>
                  <p className="text-xs text-muted-foreground leading-normal max-w-[260px] mx-auto">
                    Connect an AI service provider (Gemini, OpenAI, Ollama) to start routing workspace builds via API credentials.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsAddingProvider(true);
                    setSelectedTypeToAdd(null);
                    setModalApiKey('');
                    setModalBaseUrl('');
                    setModalName('');
                    setModalTestResult(null);
                    setModalModels([]);
                    setModalDefaultModel('');
                    setIsAddingManualModel(false);
                    setManualModelInput('');
                  }}
                  className="px-5 h-9 flex items-center justify-center gap-2 text-xs font-bold border border-dashed border-border/80 bg-background hover:bg-muted/15 text-foreground hover:border-primary/50 rounded-xl transition-all shadow-sm"
                >
                  <Plus className="h-4 w-4 text-primary" />
                  Connect API Provider
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Debounced Save Badge overlay ─── */}
      {saving && (
        <div className="flex justify-end sticky bottom-4 z-10">
          <Badge variant="outline" className="gap-1.5 bg-background/95 backdrop-blur-md shadow-md border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground font-semibold">
            <Loader2 className="h-3 w-3 animate-spin text-primary" /> Syncing changes...
          </Badge>
        </div>
      )}

      {/* ─── High-Fidelity Connection & Edit Modal Overlay ─── */}
      {(isAddingProvider || editingProvider) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop blur */}
          <div 
            className="absolute inset-0 bg-background/80 backdrop-blur-sm transition-all animate-in fade-in duration-200"
            onClick={() => {
              setIsAddingProvider(false);
              setEditingProvider(null);
            }}
          />
          
          {/* Modal Card */}
          <Card className="w-full max-w-md border border-border/60 bg-card shadow-2xl relative z-10 p-5 md:p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            
            {isAddingProvider && selectedTypeToAdd === null ? (
              /* STEP 1: Select Provider Type (Adding Mode) */
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-1 border-b border-border/40">
                  <div className="space-y-0.5">
                    <h4 className="text-sm font-bold text-foreground">Connect API Integration</h4>
                    <p className="text-[11px] text-muted-foreground">Select a service to connect as a generation backend.</p>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => setIsAddingProvider(false)} 
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/15"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                  {/* Google Gemini */}
                  <button
                    onClick={() => {
                      setSelectedTypeToAdd('gemini');
                      const existing = settings?.providers.find(p => p.id === 'gemini');
                      setModalApiKey(existing?.apiKey || '');
                      setModalBaseUrl('');
                    }}
                    className="w-full flex items-center gap-3.5 p-3 rounded-xl border border-border/60 hover:bg-muted/20 hover:border-border text-left transition-all"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-blue-500/5 text-blue-500 border-blue-500/20">
                      <Sparkles className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold block text-foreground">Google Gemini</span>
                      <span className="text-[10px] text-muted-foreground block mt-0.5">Connect Gemini API using direct developer keys.</span>
                    </div>
                  </button>

                  {/* OpenAI */}
                  <button
                    onClick={() => {
                      setSelectedTypeToAdd('openai');
                      const existing = settings?.providers.find(p => p.id === 'openai');
                      setModalApiKey(existing?.apiKey || '');
                      setModalBaseUrl('');
                    }}
                    className="w-full flex items-center gap-3.5 p-3 rounded-xl border border-border/60 hover:bg-muted/20 hover:border-border text-left transition-all"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-emerald-500/5 text-emerald-500 border-emerald-500/20">
                      <Bot className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold block text-foreground">OpenAI GPT</span>
                      <span className="text-[10px] text-muted-foreground block mt-0.5">Connect GPT-4o models using OpenAI keys.</span>
                    </div>
                  </button>

                  {/* Ollama */}
                  <button
                    onClick={() => {
                      setSelectedTypeToAdd('ollama');
                      const existing = settings?.providers.find(p => p.id === 'ollama');
                      setModalApiKey('');
                      setModalBaseUrl(existing?.baseUrl || 'http://localhost:11434');
                    }}
                    className="w-full flex items-center gap-3.5 p-3 rounded-xl border border-border/60 hover:bg-muted/20 hover:border-border text-left transition-all"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-orange-500/5 text-orange-500 border-orange-500/20">
                      <Server className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold block text-foreground">Ollama (Local)</span>
                      <span className="text-[10px] text-muted-foreground block mt-0.5">Connect fully local models running private servers.</span>
                    </div>
                  </button>

                  {/* Custom Endpoint */}
                  <button
                    onClick={() => {
                      setSelectedTypeToAdd('custom');
                      setModalApiKey('');
                      setModalBaseUrl('');
                      setModalName('');
                    }}
                    className="w-full flex items-center gap-3.5 p-3 rounded-xl border border-border/60 hover:bg-muted/20 hover:border-border text-left transition-all"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-indigo-500/5 text-indigo-500 border-indigo-500/20">
                      <Globe className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold block text-foreground">Custom Integration</span>
                      <span className="text-[10px] text-muted-foreground block mt-0.5">Register custom OpenAI-compatible endpoints or proxies.</span>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              /* STEP 2: Configure & Verify selected provider credentials */
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex items-center justify-between pb-1 border-b border-border/40">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                      {editingProvider 
                        ? `Configure ${editingProvider.name}`
                        : `Configure ${selectedTypeToAdd === 'custom' ? 'Custom Provider' : settings?.providers.find(p => p.id === selectedTypeToAdd)?.name}`
                      }
                    </h4>
                    <p className="text-[10px] text-muted-foreground">Enter parameters and verify connectivity.</p>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => {
                      if (editingProvider) {
                        setEditingProvider(null);
                      } else {
                        setSelectedTypeToAdd(null);
                      }
                    }} 
                    className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/15"
                    title="Go back"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-4">
                  {/* Custom Provider Name Input */}
                  {((isAddingProvider && selectedTypeToAdd === 'custom') || (editingProvider && editingProvider.kind === 'openai-compat')) && (
                    <div className="space-y-1.5">
                      <Label htmlFor="modal-name" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Provider Identifier</Label>
                      <Input 
                        id="modal-name" 
                        placeholder="e.g. DeepSeek Proxy, GX20" 
                        value={modalName} 
                        onChange={(e) => setModalName(e.target.value)} 
                        className="h-9.5 text-xs rounded-lg border-border/60" 
                      />
                    </div>
                  )}

                  {/* API Authorization Key Input */}
                  {((isAddingProvider && selectedTypeToAdd !== 'ollama') || (editingProvider && editingProvider.id !== 'ollama')) && (
                    <div className="space-y-1.5">
                      <Label htmlFor="modal-key" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">API Credential Key</Label>
                      <div className="relative">
                        <Input 
                          id="modal-key" 
                          type={modalShowKey ? 'text' : 'password'} 
                          placeholder={
                            (selectedTypeToAdd || editingProvider?.id) === 'gemini' 
                              ? 'AIzaSy...' 
                              : (selectedTypeToAdd || editingProvider?.id) === 'openai' 
                                ? 'sk-...' 
                                : 'Optional key payload...'
                          } 
                          value={modalApiKey} 
                          onChange={(e) => setModalApiKey(e.target.value)} 
                          className="pr-9 font-mono text-xs h-9.5 rounded-lg border-border/60" 
                        />
                        <button 
                          type="button" 
                          onClick={() => setModalShowKey(!modalShowKey)} 
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {modalShowKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Base Endpoint URL Input */}
                  {((isAddingProvider && (selectedTypeToAdd === 'custom' || selectedTypeToAdd === 'ollama')) || 
                    (editingProvider && (editingProvider.kind === 'openai-compat' || editingProvider.id === 'ollama'))) && (
                    <div className="space-y-1.5">
                      <Label htmlFor="modal-url" className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Base Endpoint URL</Label>
                      <Input 
                        id="modal-url" 
                        placeholder={
                          (selectedTypeToAdd || editingProvider?.id) === 'ollama' 
                            ? 'http://localhost:11434' 
                            : 'https://api.yourprovider.com/v1'
                        } 
                        value={modalBaseUrl} 
                        onChange={(e) => setModalBaseUrl(e.target.value)} 
                        className="font-mono text-xs h-9.5 rounded-lg border-border/60" 
                      />
                    </div>
                  )}

                  {/* Base Model Select Dropdown & Manual Input */}
                  <div className="space-y-2 animate-in fade-in duration-200">
                    <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Base Reference Model</Label>
                    
                    {modalModels.length > 0 ? (
                      <div className="space-y-2">
                        <Select value={modalDefaultModel} onValueChange={setModalDefaultModel}>
                          <SelectTrigger className="font-mono text-xs h-9.5 rounded-lg border-border/60">
                            <SelectValue placeholder="Select active model" />
                          </SelectTrigger>
                          <SelectContent>
                            {modalModels.map(model => (
                              <SelectItem key={model.id} value={model.id} className="font-mono text-xs">
                                {model.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {!isAddingManualModel ? (
                          <button
                            type="button"
                            onClick={() => setIsAddingManualModel(true)}
                            className="text-[10px] font-semibold text-primary hover:underline flex items-center gap-1 mt-1 transition-all"
                          >
                            <Plus className="h-3 w-3" /> Add model name manually
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 mt-1 animate-in slide-in-from-top-1 duration-150">
                            <Input
                              placeholder="e.g. deepseek-coder"
                              value={manualModelInput}
                              onChange={(e) => setManualModelInput(e.target.value)}
                              className="h-8 text-xs font-mono rounded-lg border-border/60 flex-1"
                            />
                            <Button
                              size="sm"
                              type="button"
                              onClick={() => {
                                const trimmed = manualModelInput.trim();
                                if (trimmed) {
                                  if (!modalModels.some(m => m.id === trimmed)) {
                                    setModalModels([...modalModels, { id: trimmed, name: trimmed }]);
                                  }
                                  setModalDefaultModel(trimmed);
                                  setManualModelInput('');
                                  setIsAddingManualModel(false);
                                  toast.success(`Model "${trimmed}" added`);
                                }
                              }}
                              className="h-8 text-xs px-2.5 rounded-lg font-bold bg-primary text-primary-foreground"
                            >
                              Add
                            </Button>
                            <Button
                              size="sm"
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                setIsAddingManualModel(false);
                                setManualModelInput('');
                              }}
                              className="h-8 text-xs px-2 text-muted-foreground"
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* No Models State - Manual Entry Input */
                      <div className="space-y-1.5 p-3 rounded-lg border border-dashed border-border/60 bg-muted/10">
                        <span className="text-[10px] text-muted-foreground block leading-relaxed mb-1">
                          No models discovered. Enter a reference model name manually to continue:
                        </span>
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="e.g. gpt-4o, ollama-model-id"
                            value={manualModelInput}
                            onChange={(e) => setManualModelInput(e.target.value)}
                            className="h-9 text-xs font-mono rounded-lg border-border/60 flex-1 bg-background"
                          />
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => {
                              const trimmed = manualModelInput.trim();
                              if (trimmed) {
                                setModalModels([{ id: trimmed, name: trimmed }]);
                                setModalDefaultModel(trimmed);
                                setManualModelInput('');
                                toast.success(`Model "${trimmed}" registered`);
                              } else {
                                toast.error('Enter a valid model name');
                              }
                            }}
                            className="h-9 text-xs px-3 rounded-lg font-bold bg-primary text-primary-foreground"
                          >
                            Set Model
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Diagnostics Connection Alert Panel */}
                  {modalTestResult && (
                    <div className={cn(
                      "flex items-start gap-2 text-xs p-3 rounded-lg border leading-relaxed",
                      modalTestResult.ok 
                        ? "bg-emerald-500/[0.02] border-emerald-500/20 text-emerald-700 dark:text-emerald-400" 
                        : "bg-destructive/[0.02] border-destructive/20 text-destructive"
                    )}>
                      {modalTestResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />}
                      <span className="font-medium text-[11px]">{modalTestResult.message}</span>
                    </div>
                  )}
                </div>

                {/* Actions Footer inside Modal */}
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-border/40 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={testModalConnection} 
                      disabled={modalTesting || (selectedTypeToAdd === 'custom' && !modalBaseUrl.trim())} 
                      className="text-xs gap-1.5 h-9 rounded-lg font-semibold border-border/60 animate-none shrink-0"
                    >
                      {modalTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Verify
                    </Button>

                    {editingProvider && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => {
                          if (editingProvider.kind === 'builtin') {
                            disconnectProvider(editingProvider.id);
                          } else {
                            removeProvider(editingProvider.id);
                          }
                          setEditingProvider(null);
                        }}
                        className="h-9 rounded-lg border-destructive/25 text-destructive hover:bg-destructive/[0.02] hover:border-destructive/35 px-2.5 text-xs font-semibold shrink-0"
                      >
                        Disconnect
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => {
                        if (editingProvider) {
                          setEditingProvider(null);
                        } else {
                          setSelectedTypeToAdd(null);
                        }
                      }} 
                      className="text-xs h-9 rounded-lg text-muted-foreground hover:text-foreground shrink-0"
                    >
                      {editingProvider ? 'Cancel' : 'Back'}
                    </Button>

                    {editingProvider && settings?.activeProvider !== editingProvider.id && modalDefaultModel && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setActiveProvider(editingProvider.id, modalDefaultModel);
                          toast.success(`Active provider set to: ${editingProvider.name}`);
                          setEditingProvider(null);
                        }}
                        className="text-xs h-9 rounded-lg border-primary/20 text-primary bg-primary/[0.02] hover:bg-primary/[0.05] shrink-0"
                      >
                        Make Active
                      </Button>
                    )}

                    <Button 
                      size="sm" 
                      onClick={editingProvider ? handleSaveProvider : handleConnectProvider} 
                      disabled={editingProvider ? false : !modalTestResult?.ok} 
                      className="text-xs h-9 rounded-lg font-bold bg-primary text-primary-foreground shrink-0"
                    >
                      {editingProvider ? 'Save' : 'Connect'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
