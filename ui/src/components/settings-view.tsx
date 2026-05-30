'use client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
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
  
  // Single Provider Form selection state
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');

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
      setSelectedProviderId(settings.activeProvider || settings.providers[0]?.id || 'gemini');
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
    setSelectedProviderId(id);
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
  const currentProvider = settings.providers.find(p => p.id === selectedProviderId) || settings.providers[0];
  const isTesting = currentProvider && testingProvider === currentProvider.id;

  return (
    <div className="space-y-6">
      
      {/* ─── Sleek Status Header Indicator (Ultra-Minimalist) ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/40">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Workspace Settings</h2>
          <p className="text-[11px] text-muted-foreground">Configure build generation engines and backend API credential keys.</p>
        </div>
        
        {settings.defaultCli ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.03] text-xs self-start sm:self-auto transition-all">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              CLI Route: <span className="font-mono font-bold text-foreground">{settings.defaultCli}</span>
            </span>
          </div>
        ) : activeProvider && settings.buildModel ? (
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
              setShowAddForm(false);
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
            <p className="text-[11px] text-muted-foreground">Select where code build tasks should be routed. CLI routing operates natively on your terminal's authentication.</p>
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
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="space-y-0.5">
            <h3 className="text-xs font-semibold text-foreground">API Credentials & Models</h3>
            <p className="text-[11px] text-muted-foreground">Select, enable, and configure endpoints, active reference models, and authorization credentials.</p>
          </div>

          {/* ─── Consolidated Unified Card Form ─── */}
          <Card className="border border-border/50 bg-card rounded-xl overflow-hidden p-5">
            <div className="space-y-5">
              
              {/* Row 1: Dropdown selector, active switches, and quick additions */}
              <div className="flex items-end justify-between gap-4 flex-wrap pb-1">
                <div className="space-y-1.5 flex-1 min-w-[200px]">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Select API Provider</Label>
                  <Select
                    value={selectedProviderId}
                    onValueChange={(val) => {
                      setSelectedProviderId(val);
                      setShowAddForm(false);
                      // If the chosen provider is already enabled and has a default model, set it as active build route
                      const provider = settings.providers.find(p => p.id === val);
                      if (provider && provider.enabled && provider.defaultModel) {
                        setSettings(prev => prev ? { ...prev, activeProvider: val, buildModel: provider.defaultModel || '' } : null);
                        setDirty(true);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9.5 rounded-lg border-border/60">
                      <SelectValue placeholder="Choose provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {settings.providers.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex items-center gap-1.5 font-medium text-xs">
                            {p.name} {p.id === settings.activeProvider && <span className="text-[10px] text-primary">(Active)</span>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2.5">
                  {/* Enable provider directly */}
                  {currentProvider && (
                    <div className="flex items-center gap-2 border border-border/60 rounded-lg px-3 py-1.5 h-9.5 bg-muted/[0.04]">
                      <Label htmlFor="provider-enable" className="text-xs text-muted-foreground font-semibold">Enabled</Label>
                      <Switch
                        id="provider-enable"
                        checked={currentProvider.enabled}
                        onCheckedChange={(checked) => {
                          updateProvider(currentProvider.id, { enabled: checked });
                          // Clear active route if disabled
                          if (!checked && settings.activeProvider === currentProvider.id) {
                            setSettings(prev => prev ? { ...prev, activeProvider: '', buildModel: '' } : null);
                            setDirty(true);
                          } else if (checked && !settings.activeProvider && currentProvider.defaultModel) {
                            setSettings(prev => prev ? { ...prev, activeProvider: currentProvider.id, buildModel: currentProvider.defaultModel || '' } : null);
                            setDirty(true);
                          }
                        }}
                        className="scale-90"
                      />
                    </div>
                  )}

                  {/* Remove Custom Provider */}
                  {currentProvider && currentProvider.kind !== 'builtin' && (
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        removeProvider(currentProvider.id);
                        setSelectedProviderId('gemini');
                      }}
                      className="h-9.5 rounded-lg border-destructive/25 text-destructive hover:bg-destructive/[0.03] hover:border-destructive/35 px-3"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                    </Button>
                  )}

                  {/* Toggle Custom Addition Form Inline */}
                  <Button
                    variant="outline"
                    onClick={() => setShowAddForm(!showAddForm)}
                    className={cn(
                      "h-9.5 rounded-lg border-border/60 text-xs font-semibold px-3 gap-1.5",
                      showAddForm && "bg-accent border-accent"
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Custom
                  </Button>
                </div>
              </div>

              {/* Row 2: Dynamic Form Fields */}
              {showAddForm ? (
                /* Add Custom Provider Form (Inline) */
                <div className="space-y-4 pt-4 border-t border-border/50 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Register Custom OpenAI-Compatible Provider</span>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => { setShowAddForm(false); setNewName(''); setNewBaseUrl(''); setNewApiKey(''); setDiscoveredModels([]); }} 
                      className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="new-name" className="text-[10px] font-semibold text-muted-foreground">Provider Name</Label>
                      <Input id="new-name" placeholder="e.g. DeepSeek Proxy, GX10" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9.5 text-xs rounded-lg border-border/60" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-url" className="text-[10px] font-semibold text-muted-foreground">Base Endpoint URL</Label>
                      <Input id="new-url" placeholder="http://100.77.38.96:8080/v1" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} className="font-mono text-xs h-9.5 rounded-lg border-border/60" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-key" className="text-[10px] font-semibold text-muted-foreground">API Authorization Key (optional)</Label>
                      <div className="relative">
                        <Input id="new-key" type={newShowKey ? 'text' : 'password'} placeholder="Optional API authorization key" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} className="pr-9 font-mono text-xs h-9.5 rounded-lg border-border/60" />
                        <button type="button" onClick={() => setNewShowKey(!newShowKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {newShowKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5 flex flex-col justify-end">
                      <Button size="sm" variant="outline" onClick={discoverModels} disabled={discovering || !newBaseUrl.trim()} className="text-xs gap-1.5 h-9.5 rounded-lg font-semibold border-border/60">
                        {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Fetch & Discover Models
                      </Button>
                    </div>
                  </div>

                  {discoveredModels.length > 0 && (
                    <div className="space-y-1.5 bg-muted/[0.04] border border-border/50 p-3 rounded-lg">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Discovered Remote Models ({discoveredModels.length})</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {discoveredModels.slice(0, 8).map(m => <Badge key={m.id} variant="outline" className="text-[9px] font-mono border-border/60 bg-card px-1.5 py-0 text-muted-foreground">{m.id}</Badge>)}
                        {discoveredModels.length > 8 && <Badge variant="outline" className="text-[9px] px-1.5 py-0">+{discoveredModels.length - 8} more</Badge>}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2.5 pt-3 border-t border-border/50">
                    <Button 
                      size="sm" 
                      onClick={addCustomProvider} 
                      disabled={!newName.trim() || !newBaseUrl.trim()} 
                      className="text-xs gap-1.5 h-8.5 rounded-lg font-bold bg-primary text-primary-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" /> Register Custom Provider
                    </Button>
                  </div>
                </div>
              ) : (
                /* Config settings for the selected provider */
                currentProvider && (
                  <div className="space-y-4 pt-4 border-t border-border/50 animate-in fade-in duration-200">
                    
                    {!currentProvider.enabled ? (
                      <div className="text-[11px] text-muted-foreground bg-muted/[0.02] border border-border/40 p-4 rounded-xl flex items-center gap-2 leading-relaxed">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                        <span>This provider is currently disabled. Toggle the <strong>Enabled</strong> switch at the top to configure its fields.</span>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          
                          {/* API Credential Key Input */}
                          {(currentProvider.kind === 'builtin' ? (currentProvider.id === 'gemini' || currentProvider.id === 'openai') : true) && (
                            <div className="space-y-1.5">
                              <Label htmlFor={`${currentProvider.id}-key`} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">API Credential Key</Label>
                              <div className="relative">
                                <Input 
                                  id={`${currentProvider.id}-key`} 
                                  type={showKeys[currentProvider.id] ? 'text' : 'password'} 
                                  placeholder={currentProvider.kind !== 'builtin' ? 'Optional key payload...' : (currentProvider.id === 'gemini' ? 'AIzaSy...' : 'sk-...')} 
                                  value={currentProvider.apiKey || ''} 
                                  onChange={(e) => updateProvider(currentProvider.id, { apiKey: e.target.value })} 
                                  className="pr-9 font-mono text-xs h-9.5 rounded-lg border-border/60" 
                                />
                                <button type="button" onClick={() => setShowKeys(prev => ({ ...prev, [currentProvider.id]: !prev[currentProvider.id] }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                  {showKeys[currentProvider.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Base URL Endpoint URL Input */}
                          {(currentProvider.kind !== 'builtin' || currentProvider.id === 'ollama') && (
                            <div className="space-y-1.5">
                              <Label htmlFor={`${currentProvider.id}-url`} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Base Endpoint URL</Label>
                              <Input 
                                id={`${currentProvider.id}-url`} 
                                placeholder={currentProvider.kind !== 'builtin' ? 'http://localhost:8080/v1' : 'http://localhost:11434'} 
                                value={currentProvider.baseUrl || ''} 
                                onChange={(e) => updateProvider(currentProvider.id, { baseUrl: e.target.value })} 
                                className="font-mono text-xs h-9.5 rounded-lg border-border/60" 
                              />
                            </div>
                          )}

                          {/* Base Reference Model Dropdown */}
                          <div className="space-y-1.5 col-span-1">
                            <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Base Reference Model</Label>
                            {currentProvider.models.length > 0 ? (
                              <Select
                                value={currentProvider.defaultModel || ''}
                                onValueChange={(val) => {
                                  updateProvider(currentProvider.id, { defaultModel: val });
                                  if (settings.activeProvider === currentProvider.id) {
                                    setSettings(prev => prev ? { ...prev, buildModel: val } : null);
                                    setDirty(true);
                                  }
                                }}
                              >
                                <SelectTrigger className="font-mono text-xs h-9.5 rounded-lg border-border/60"><SelectValue placeholder="Select active model" /></SelectTrigger>
                                <SelectContent>
                                  {currentProvider.models.map(model => <SelectItem key={model.id} value={model.id} className="font-mono text-xs">{model.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="text-[11px] text-muted-foreground/80 py-2 px-3 rounded-lg border border-dashed border-border/60 bg-muted/20">
                                No models indexed. Run Sync to synchronize models.
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Diagnostic Test Diagnostic Results */}
                        {testResults[currentProvider.id] && (
                          <div className={cn(
                            "flex items-start gap-2.5 text-xs p-3 rounded-lg border leading-relaxed",
                            testResults[currentProvider.id].ok 
                              ? "bg-emerald-500/[0.02] border-emerald-500/20 text-emerald-700 dark:text-emerald-400" 
                              : "bg-destructive/[0.02] border-destructive/20 text-destructive"
                          )}>
                            {testResults[currentProvider.id].ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />}
                            <span className="font-medium text-[11px]">{testResults[currentProvider.id].message}</span>
                          </div>
                        )}

                        {/* Action Row */}
                        <div className="flex items-center gap-2 pt-1">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => testConnection(currentProvider.id)} 
                            disabled={isTesting} 
                            className="text-xs gap-1.5 h-8.5 rounded-lg font-semibold border-border/60"
                          >
                            {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            Test & Sync
                          </Button>
                          
                          {currentProvider.defaultModel && settings.activeProvider !== currentProvider.id && (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              onClick={() => {
                                setActiveProvider(currentProvider.id, currentProvider.defaultModel!);
                                toast.success(`Active provider set to: ${currentProvider.name}`);
                              }} 
                              className="text-xs gap-1.5 h-8.5 rounded-lg font-semibold border-border/60"
                            >
                              <Star className="h-3.5 w-3.5" /> Use as Active Provider
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          </Card>
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
    </div>
  );
}
