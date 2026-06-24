'use client';

import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';


export function ModelSelector() {
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => setSettings(data))
      .catch(() => {});
  }, []);

  const updateSettings = async (updates: any) => {
    if (!settings) return;
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      toast.success('Settings updated');
    } catch {
      toast.error('Failed to update settings');
    }
  };

  const handleModelChange = (compoundValue: string) => {
    const [providerId, modelId] = compoundValue.split(':::');
    updateSettings({ activeProvider: providerId, buildModel: modelId });
  };
  if (!settings) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-7 w-40 bg-muted/50 rounded-md animate-pulse border border-border/20" />
      </div>
    );
  }
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

  return (
    <div className="flex items-center">
      <Select value={currentCompoundValue || undefined} onValueChange={handleModelChange}>
        <SelectTrigger className="h-7 text-[13px] font-medium bg-transparent border-0 shadow-none focus:ring-0 px-2 text-foreground/80 hover:text-foreground transition-colors max-w-[160px] [&>span]:truncate">
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          {availableModels.length === 0 ? (
            <SelectItem value="none" disabled className="text-xs">
              No models available
            </SelectItem>
          ) : (
            availableModels.map((m: any) => (
              <SelectItem key={`${m.providerId}:::${m.modelId}`} value={`${m.providerId}:::${m.modelId}`} className="text-xs">
                {m.modelName} ({m.providerName})
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
