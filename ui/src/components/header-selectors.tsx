'use client';

import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const CLI_OPTIONS = [
  { id: 'pi', label: 'pi' },
  { id: 'gemini', label: 'gemini' },
  { id: 'claude', label: 'claude' },
  { id: 'agy', label: 'agy' },
];

export function HeaderSelectors() {
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

  if (!settings) return null;

  const enabledProviders = settings.providers?.filter((p: any) => p.enabled) || [];
  const availableModels = enabledProviders.flatMap((p: any) => {
    const modelsList = p.models || [];
    if (modelsList.length > 0) {
      return modelsList.map((m: any) => ({
        providerId: p.id,
        providerName: p.name,
        modelId: m.id,
        modelName: m.name || m.id,
      }));
    } else if (p.defaultModel) {
      return [{
        providerId: p.id,
        providerName: p.name,
        modelId: p.defaultModel,
        modelName: p.defaultModel,
      }];
    }
    return [];
  });

  const currentCompoundValue = settings.activeProvider && settings.buildModel
    ? `${settings.activeProvider}:::${settings.buildModel}`
    : '';

  return (
    <div className="flex items-center gap-2 mr-2">
      <Select value={currentCompoundValue} onValueChange={handleModelChange}>
        <SelectTrigger className="h-7 w-[160px] text-[11px] bg-muted border-border font-medium text-left truncate">
          <SelectValue placeholder="Select model..." />
        </SelectTrigger>
        <SelectContent>
          {availableModels.length === 0 ? (
            <SelectItem value="none" disabled className="text-[11px]">
              No models available
            </SelectItem>
          ) : (
            availableModels.map((m: any) => (
              <SelectItem key={`${m.providerId}:::${m.modelId}`} value={`${m.providerId}:::${m.modelId}`} className="text-[11px]">
                {m.modelName} ({m.providerName})
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <Select value={settings.defaultCli || 'pi'} onValueChange={(val) => updateSettings({ defaultCli: val })}>
        <SelectTrigger className="h-7 w-[90px] text-[11px] bg-muted border-border font-medium">
          <SelectValue placeholder="CLI" />
        </SelectTrigger>
        <SelectContent>
          {CLI_OPTIONS.map(opt => (
            <SelectItem key={opt.id} value={opt.id} className="text-[11px]">{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
