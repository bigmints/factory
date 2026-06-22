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

  const handleProviderChange = (providerId: string) => {
    const provider = settings?.providers?.find((p: any) => p.id === providerId);
    if (provider) {
      updateSettings({ activeProvider: providerId, buildModel: provider.defaultModel || '' });
    }
  };

  if (!settings) return null;

  return (
    <div className="flex items-center gap-2 mr-2">
      <Select value={settings.activeProvider} onValueChange={handleProviderChange}>
        <SelectTrigger className="h-7 w-[120px] text-[11px] bg-muted border-border font-medium">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          {settings.providers?.filter((p: any) => p.enabled).map((p: any) => (
            <SelectItem key={p.id} value={p.id} className="text-[11px]">{p.name}</SelectItem>
          ))}
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
