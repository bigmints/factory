'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Plug,
  Plus,
  Trash2,
  Pencil,
  Zap,
  Globe,
  Terminal,
  Activity,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  PlusCircle,
  X,
  Sparkles,
  Info,
  GitBranch,
  MessageSquare,
  CloudLightning,
  Database,
} from 'lucide-react';

interface McpServerConfig {
  transport: 'stdio' | 'sse';
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

interface TestResult {
  success: boolean;
  error?: string;
  tools?: any[];
  resources?: any[];
}

interface FormState {
  id: string;
  transport: 'stdio' | 'sse';
  command: string;
  argsString: string;
  url: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  id: '',
  transport: 'stdio',
  command: '',
  argsString: '',
  url: '',
  enabled: true,
};

export function IntegrationsView() {
  const [activeTab, setActiveTab] = useState('mcp');
  const [loading, setLoading] = useState(true);
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>({});
  
  // Test states
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  // Dialog & Form states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const fetchMcpServers = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp');
      if (res.ok) {
        const data = await res.json();
        setMcpServers(data.mcpServers || {});
      }
    } catch {
      toast.error('Failed to load MCP servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMcpServers();
  }, [fetchMcpServers]);

  const handleTestConnection = async (id: string, config: McpServerConfig) => {
    setTestingId(id);
    toast.info(`Testing connection to "${id}"...`);
    try {
      const res = await fetch('/api/mcp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...config }),
      });
      const data = await res.json();
      
      setTestResults(prev => ({
        ...prev,
        [id]: data,
      }));

      if (data.success) {
        toast.success(`Connected successfully to "${id}"!`, {
          description: `Discovered ${data.tools?.length || 0} tools and ${data.resources?.length || 0} resources.`,
        });
        setExpandedServer(id);
      } else {
        toast.error(`Connection failed for "${id}"`, {
          description: data.error || 'Check server logs.',
        });
      }
    } catch (err: any) {
      toast.error('Failed to query connection testing endpoint');
      setTestResults(prev => ({
        ...prev,
        [id]: { success: false, error: err.message || 'Network request failed' },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleEnabled = async (id: string, currentVal: boolean) => {
    try {
      const targetConfig = mcpServers[id];
      const updatedConfig = { ...targetConfig, enabled: !currentVal };
      
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updatedConfig }),
      });

      if (res.ok) {
        setMcpServers(prev => ({
          ...prev,
          [id]: updatedConfig,
        }));
        toast.success(`Server "${id}" ${!currentVal ? 'enabled' : 'disabled'}`);
      } else {
        toast.error('Failed to update server status');
      }
    } catch {
      toast.error('Failed to update server status');
    }
  };

  const openAddDialog = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setEnvRows([]);
    setDialogOpen(true);
  };

  const openEditDialog = (id: string, config: McpServerConfig) => {
    setEditingId(id);
    setForm({
      id,
      transport: config.transport,
      command: config.command || '',
      argsString: config.args ? config.args.join(' ') : '',
      url: config.url || '',
      enabled: config.enabled,
    });
    
    // Parse environment variables into rows
    if (config.env) {
      setEnvRows(
        Object.entries(config.env).map(([key, value]) => ({ key, value }))
      );
    } else {
      setEnvRows([]);
    }
    
    setDialogOpen(true);
  };

  const handleSaveServer = async () => {
    if (!form.id.trim()) {
      toast.error('Server ID is required');
      return;
    }

    if (form.transport === 'stdio' && !form.command.trim()) {
      toast.error('Command is required for stdio transport');
      return;
    }

    if (form.transport === 'sse' && !form.url.trim()) {
      toast.error('SSE connection URL is required');
      return;
    }

    setSaving(true);

    try {
      // Build env object from rows
      const envObj: Record<string, string> = {};
      envRows.forEach(row => {
        if (row.key.trim()) {
          envObj[row.key.trim()] = row.value;
        }
      });

      // Split args string by spaces (honoring quotes if possible, but basic split works too)
      const argsList = form.argsString
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      const serverPayload = {
        id: form.id.trim(),
        transport: form.transport,
        enabled: form.enabled,
        command: form.transport === 'stdio' ? form.command.trim() : undefined,
        args: form.transport === 'stdio' ? argsList : undefined,
        env: form.transport === 'stdio' && Object.keys(envObj).length > 0 ? envObj : undefined,
        url: form.transport === 'sse' ? form.url.trim() : undefined,
      };

      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverPayload),
      });

      if (res.ok) {
        toast.success(editingId ? 'MCP Server updated' : 'MCP Server added', {
          description: form.id.trim(),
        });
        setDialogOpen(false);
        fetchMcpServers();
      } else {
        const errData = await res.json();
        toast.error('Failed to save configuration', { description: errData.error });
      }
    } catch {
      toast.error('Error saving MCP server configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteServer = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/mcp?id=${encodeURIComponent(deleteTarget)}`, {
        method: 'DELETE',
      });
      
      if (res.ok) {
        toast.success(`Server "${deleteTarget}" deleted successfully`);
        setDeleteTarget(null);
        fetchMcpServers();
      } else {
        toast.error('Failed to delete server configuration');
      }
    } catch {
      toast.error('Failed to delete server configuration');
    }
  };

  const handleAddEnvRow = () => {
    setEnvRows(prev => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveEnvRow = (index: number) => {
    setEnvRows(prev => prev.filter((_, i) => i !== index));
  };

  const handleEnvRowChange = (index: number, field: 'key' | 'value', val: string) => {
    setEnvRows(prev => prev.map((row, i) => {
      if (i === index) {
        return { ...row, [field]: val };
      }
      return row;
    }));
  };

  // Render Stats details
  const totalServers = Object.keys(mcpServers).length;
  const activeServers = Object.values(mcpServers).filter(s => s.enabled).length;
  const totalConnectedTools = Object.values(testResults).reduce((sum, res) => sum + (res.tools?.length || 0), 0);

  return (
    <TooltipProvider>
      <div className="space-y-6 md:space-y-8 flex flex-col">
        
        {/* Stats & Header Actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-card/15 border border-border/40 backdrop-blur-md rounded-xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-4 sm:gap-8 text-xs sm:text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse shrink-0" />
              <span className="font-semibold text-foreground">{totalServers}</span> Configured
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="font-semibold text-foreground">{activeServers}</span> Active
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-500 shrink-0" />
              <span className="font-semibold text-foreground">{totalConnectedTools}</span> Discovered Tools
            </span>
          </div>
          <Button size="sm" onClick={openAddDialog} className="h-8 sm:h-9 text-xs gap-1.5 w-full sm:w-auto shrink-0 shadow-lg shadow-primary/10">
            <Plus className="h-3.5 w-3.5" />
            Add Server
          </Button>
        </div>

        {/* Tabs switcher */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-muted overflow-x-auto w-full justify-start scrollbar-hide">
            <TabsTrigger value="mcp" className="text-xs gap-1.5 px-3">
              <Plug className="h-3.5 w-3.5" />
              Model Context Protocol (MCP)
            </TabsTrigger>
            <TabsTrigger value="external" className="text-xs gap-1.5 px-3">
              <Globe className="h-3.5 w-3.5" />
              Other Integrations
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Tab 1: MCP Integrations */}
        {activeTab === 'mcp' && (
          <div className="space-y-4">
            <div className="text-xs md:text-sm text-muted-foreground max-w-2xl leading-relaxed mb-1">
              Add external developer tools, APIs, or database scripts using the Model Context Protocol. The Factory build engine auto-matches active server tools dynamically to build, test, and polish application scripts.
            </div>

            {loading ? (
              <div className="grid grid-cols-1 gap-4">
                <Skeleton className="h-28 rounded-lg" />
                <Skeleton className="h-28 rounded-lg" />
              </div>
            ) : totalServers === 0 ? (
              <Card className="border-dashed flex flex-col items-center justify-center p-8 sm:p-12 text-center bg-card/5">
                <Plug className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30 animate-pulse" />
                <h3 className="font-semibold text-sm">No MCP integrations connected yet</h3>
                <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">
                  Click &quot;Add Server&quot; to configure your first MCP stdio or SSE server connection and supercharge your code-generation tools.
                </p>
                <Button size="sm" className="mt-4 text-xs gap-1.5" onClick={openAddDialog}>
                  <Plus className="h-3.5 w-3.5" />
                  Connect Your First Server
                </Button>
              </Card>
            ) : (
              <div className="divide-y divide-border border border-border/80 rounded-xl bg-card/5 overflow-hidden">
                {Object.entries(mcpServers).map(([id, config]) => {
                  const isExpanded = expandedServer === id;
                  const isTesting = testingId === id;
                  const result = testResults[id];
                  
                  // Deriving Status Badge Color & Text
                  let statusText = 'Untested';
                  let statusColor = 'bg-muted-foreground/30 text-muted-foreground';
                  let StatusIcon = Activity;

                  if (!config.enabled) {
                    statusText = 'Inactive';
                    statusColor = 'bg-muted/60 border border-border/40 text-muted-foreground';
                  } else if (isTesting) {
                    statusText = 'Testing';
                    statusColor = 'bg-amber-500/10 text-amber-500 border border-amber-500/25';
                    StatusIcon = RefreshCw;
                  } else if (result) {
                    if (result.success) {
                      statusText = 'Connected';
                      statusColor = 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20';
                      StatusIcon = CheckCircle2;
                    } else {
                      statusText = 'Connection Error';
                      statusColor = 'bg-rose-500/10 text-rose-500 border border-rose-500/20';
                      StatusIcon = AlertCircle;
                    }
                  }

                  return (
                    <div
                      key={id}
                      className={cn(
                        "flex flex-col transition-colors duration-150",
                        config.enabled ? 'bg-transparent' : 'opacity-70 bg-muted/5'
                      )}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between p-4 sm:p-5 gap-4">
                        
                        {/* Server Identifier & Config Info */}
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <span className={cn(
                            "h-2 w-2 rounded-full shrink-0 transition-all md:mt-2.5 mt-2",
                            !config.enabled ? "bg-muted-foreground/30" : isTesting ? "bg-amber-400 animate-pulse" : (result?.success) ? "bg-emerald-500" : (result && !result.success) ? "bg-rose-500" : "bg-indigo-400"
                          )} />
                          
                          <div className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground select-none shadow-xs mt-0.5"
                          )}>
                            {config.transport === 'stdio' ? <Terminal className="h-4 w-4 text-violet-400" /> : <Globe className="h-4 w-4 text-sky-400" />}
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-foreground truncate">{id}</span>
                              <Badge
                                variant="outline"
                                className="text-[9px] font-semibold h-4 px-1.5 rounded-full shrink-0 bg-muted/40 uppercase"
                              >
                                {config.transport}
                              </Badge>
                              <Badge variant="outline" className={cn("text-[9px] font-medium h-4 px-2 rounded-full shrink-0 gap-1", statusColor)}>
                                <StatusIcon className={cn("h-2.5 w-2.5 shrink-0", isTesting && "animate-spin")} />
                                {statusText}
                              </Badge>
                            </div>
                            
                            {/* Command Line description */}
                            {config.transport === 'stdio' ? (
                              <div className="text-[11px] font-mono text-muted-foreground truncate bg-muted/20 border border-border/20 px-2 py-0.5 rounded max-w-full">
                                {config.command} {config.args?.join(' ')}
                              </div>
                            ) : (
                              <div className="text-[11px] font-mono text-muted-foreground truncate bg-muted/20 border border-border/20 px-2 py-0.5 rounded max-w-full">
                                {config.url}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions and Enabled switch */}
                        <div className="flex items-center justify-between md:justify-end gap-3.5 shrink-0 select-none border-t border-border/10 pt-3 md:pt-0 md:border-none">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Enabled</span>
                            <Switch
                              checked={config.enabled}
                              onCheckedChange={() => handleToggleEnabled(id, config.enabled)}
                              className="scale-75"
                            />
                          </div>

                          <div className="h-4 w-px bg-border mx-1 hidden md:block" />

                          <div className="flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={!config.enabled || isTesting}
                                  className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                                  onClick={() => handleTestConnection(id, config)}
                                >
                                  <RefreshCw className={cn("h-3.5 w-3.5", isTesting && "animate-spin")} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-[10px]">Test Connection & Query Tools</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={isTesting}
                                  className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                                  onClick={() => openEditDialog(id, config)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-[10px]">Edit Settings</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={isTesting}
                                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-muted"
                                  onClick={() => setDeleteTarget(id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-[10px]">Delete Server</TooltipContent>
                            </Tooltip>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:bg-muted"
                              onClick={() => setExpandedServer(isExpanded ? null : id)}
                            >
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>

                      </div>

                      {/* Expanded Section: Tools / Resources */}
                      {isExpanded && (
                        <div className="px-6 py-4 bg-muted/10 border-t border-border/40 text-xs text-muted-foreground space-y-4 animate-in fade-in duration-150">
                          
                          {/* Connection Error Message */}
                          {result && !result.success && (
                            <div className="rounded-lg bg-rose-500/5 border border-rose-500/15 p-3.5 flex items-start gap-2.5 text-rose-400">
                              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                              <div className="space-y-1">
                                <p className="font-semibold text-xs text-foreground">Connection Error Detail</p>
                                <p className="font-mono text-[10px] whitespace-pre-wrap leading-relaxed">{result.error}</p>
                              </div>
                            </div>
                          )}

                          {/* Stdio Environment Variables */}
                          {config.transport === 'stdio' && config.env && Object.keys(config.env).length > 0 && (
                            <div className="space-y-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Configured Environment</span>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(config.env).map(([key, val]) => (
                                  <span key={key} className="text-[10px] font-mono border px-2 py-0.5 rounded bg-muted/30">
                                    <span className="text-violet-400">{key}</span>: {val ? '••••••' : 'empty'}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* List of Discovered Tools */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <Zap className="h-3.5 w-3.5 text-violet-400" />
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Discovered Tools ({result?.tools?.length || 0})</span>
                            </div>

                            {!result ? (
                              <div className="text-[11px] text-muted-foreground italic pl-5">
                                Connection untested. Click the circular test button above to fetch active server tools.
                              </div>
                            ) : result.tools?.length === 0 ? (
                              <div className="text-[11px] text-muted-foreground italic pl-5">
                                This server connected successfully but did not expose any tools.
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-5">
                                {result.tools?.map((tool: any) => (
                                  <div key={tool.name} className="border border-border/40 rounded-lg p-3 bg-background/50 space-y-2 select-text">
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="font-semibold text-xs text-foreground font-mono">{tool.name}</span>
                                      <Badge variant="secondary" className="text-[8px] font-semibold tracking-wider font-mono h-3.5 uppercase bg-muted/60 text-muted-foreground">Tool</Badge>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground leading-normal">{tool.description || 'No description provided.'}</p>
                                    
                                    {/* Parameters Summary */}
                                    {tool.inputSchema && tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length > 0 && (
                                      <div className="space-y-1">
                                        <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50">Params</div>
                                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[9px] text-muted-foreground/80">
                                          {Object.entries(tool.inputSchema.properties).map(([name, schema]: [string, any]) => (
                                            <div key={name} className="truncate">
                                              <span className="text-foreground/90">{name}</span>: <span className="text-muted-foreground">{schema.type || 'any'}</span>
                                              {tool.inputSchema.required?.includes(name) && <span className="text-rose-400 font-bold ml-0.5">*</span>}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* List of Discovered Resources */}
                          {result && result.resources && result.resources.length > 0 && (
                            <div className="space-y-2 pt-2 border-t border-border/10">
                              <div className="flex items-center gap-1.5">
                                <Database className="h-3.5 w-3.5 text-sky-400" />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Discovered Resources ({result.resources.length})</span>
                              </div>
                              <div className="space-y-2 pl-5">
                                {result.resources.map((resource: any) => (
                                  <div key={resource.uri} className="flex items-center justify-between border border-border/20 rounded-md px-3 py-1.5 bg-background/30 select-text">
                                    <div className="space-y-0.5 min-w-0">
                                      <p className="font-semibold text-xs text-foreground truncate">{resource.name}</p>
                                      <p className="font-mono text-[9px] text-muted-foreground truncate">{resource.uri}</p>
                                    </div>
                                    {resource.mimeType && (
                                      <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground h-4">{resource.mimeType}</Badge>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Other Integrations Placeholders */}
        {activeTab === 'external' && (
          <div className="space-y-5">
            <div className="text-xs md:text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Factory supports extensible connections to core pipeline APIs and messaging channels. Connect active project repositories to receive notifications, run automated test suites, and trigger webhooks.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* GitHub Card */}
              <Card className="bg-card/5 border-border/60 hover:border-border transition-all duration-200">
                <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                        <GitBranch className="h-4 w-4 text-violet-400" />
                      </div>
                      <Badge variant="outline" className="text-[8px] font-bold tracking-wider text-muted-foreground bg-muted/20 uppercase">Coming Soon</Badge>
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-foreground">GitHub Suite</h3>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                        Trigger automated code pushes, open clean pull requests, and let the agent scan files recursively to resolve merge issues.
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" disabled className="w-full text-xs h-8">Connect Repository</Button>
                </CardContent>
              </Card>

              {/* Slack / Discord Card */}
              <Card className="bg-card/5 border-border/60 hover:border-border transition-all duration-200">
                <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                        <MessageSquare className="h-4 w-4 text-emerald-400" />
                      </div>
                      <Badge variant="outline" className="text-[8px] font-bold tracking-wider text-muted-foreground bg-muted/20 uppercase">Coming Soon</Badge>
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-foreground">Notification Channels</h3>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                        Receive real-time Slack/Discord channel alerts summarizing build logs, test-case completion rates, and build queue statistics.
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" disabled className="w-full text-xs h-8">Setup Webhooks</Button>
                </CardContent>
              </Card>

              {/* Cloud Deployment Card */}
              <Card className="bg-card/5 border-border/60 hover:border-border transition-all duration-200">
                <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                        <CloudLightning className="h-4 w-4 text-sky-400" />
                      </div>
                      <Badge variant="outline" className="text-[8px] font-bold tracking-wider text-muted-foreground bg-muted/20 uppercase">Coming Soon</Badge>
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-foreground">Continuous Deployment</h3>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                        Sync live previews and production builds with full host deployments (Vercel, Netlify, Cloud Run) instantly upon successful test validation.
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" disabled className="w-full text-xs h-8">Link Provider</Button>
                </CardContent>
              </Card>

            </div>
          </div>
        )}

        {/* Add / Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto w-[95vw]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
                <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-500 shrink-0" />
                {editingId ? 'Edit MCP Server' : 'Add MCP Server'}
              </DialogTitle>
              <DialogDescription className="text-[10px] sm:text-xs">
                {editingId
                  ? 'Update this Model Context Protocol server configuration. Changes are saved to ~/.factory/mcp.json.'
                  : 'Register a new Model Context Protocol connection. You can use standard local command executions or external web services.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              
              {/* Server ID */}
              <div className="space-y-1.5">
                <Label htmlFor="mcp-id" className="font-semibold">Server ID *</Label>
                <Input
                  id="mcp-id"
                  disabled={!!editingId}
                  placeholder="e.g. weather, git-tools, postgres-mcp"
                  value={form.id}
                  onChange={e => setForm(f => ({ ...f, id: e.target.value.replace(/[^a-zA-Z0-9-_]/g, '') }))}
                  className="h-9 font-semibold text-xs sm:text-sm"
                />
                {!editingId && <span className="text-[10px] text-muted-foreground/60">A unique identifier key containing letters, numbers, hyphens, and underscores.</span>}
              </div>

              {/* Transport Switcher */}
              <div className="space-y-1.5">
                <Label className="font-semibold">Transport Protocol *</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={form.transport === 'stdio' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-8 flex-1"
                    onClick={() => setForm(f => ({ ...f, transport: 'stdio' }))}
                  >
                    <Terminal className="mr-1.5 h-3.5 w-3.5" />
                    STDIO (Local command execution)
                  </Button>
                  <Button
                    type="button"
                    variant={form.transport === 'sse' ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-8 flex-1"
                    onClick={() => setForm(f => ({ ...f, transport: 'sse' }))}
                  >
                    <Globe className="mr-1.5 h-3.5 w-3.5" />
                    SSE (Server-Sent Events URL)
                  </Button>
                </div>
              </div>

              {/* Stdio Specific Configurations */}
              {form.transport === 'stdio' && (
                <div className="space-y-4 border border-border/40 rounded-xl p-3 bg-muted/10 animate-in fade-in duration-200">
                  
                  {/* Command */}
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-command" className="font-semibold">Command *</Label>
                    <Input
                      id="mcp-command"
                      placeholder="e.g. npx, node, python, uvx, docker"
                      value={form.command}
                      onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
                      className="h-9 font-mono text-xs sm:text-sm"
                    />
                    <span className="text-[10px] text-muted-foreground/60">The primary executable path or cli utility command to run.</span>
                  </div>

                  {/* Arguments */}
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-args" className="font-semibold">Arguments (space-separated)</Label>
                    <Input
                      id="mcp-args"
                      placeholder="e.g. -y @modelcontextprotocol/server-weather"
                      value={form.argsString}
                      onChange={e => setForm(f => ({ ...f, argsString: e.target.value }))}
                      className="h-9 font-mono text-xs sm:text-sm"
                    />
                    <span className="text-[10px] text-muted-foreground/60">Execution arguments passed sequentially to the command.</span>
                  </div>

                  {/* Stdio Environment Variables Key Value Editor */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label className="font-semibold">Environment Variables</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleAddEnvRow}
                        className="h-7 text-[10px] gap-1 px-2 border hover:bg-muted shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <PlusCircle className="h-3.5 w-3.5" />
                        Add Variable
                      </Button>
                    </div>

                    {envRows.length === 0 ? (
                      <div className="text-[10px] text-muted-foreground/50 italic border border-dashed rounded-lg py-2.5 text-center bg-background/20">
                        No environment variables configured. Add API tokens or credentials if required by the server.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {envRows.map((row, index) => (
                          <div key={index} className="flex gap-2 items-center">
                            <Input
                              placeholder="KEY (e.g. GITHUB_TOKEN)"
                              value={row.key}
                              onChange={e => handleEnvRowChange(index, 'key', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                              className="h-8 font-mono text-[10px] flex-1"
                            />
                            <Input
                              placeholder="Value (e.g. ghp_xyz)"
                              value={row.value}
                              onChange={e => handleEnvRowChange(index, 'value', e.target.value)}
                              className="h-8 font-mono text-[10px] flex-1"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveEnvRow(index)}
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-muted"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* SSE Specific Configurations */}
              {form.transport === 'sse' && (
                <div className="space-y-3 border border-border/40 rounded-xl p-3 bg-muted/10 animate-in fade-in duration-200">
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-url" className="font-semibold">SSE Connection Endpoint URL *</Label>
                    <Input
                      id="mcp-url"
                      placeholder="e.g. http://localhost:3001/sse or https://api.my-mcp-provider.com/sse"
                      value={form.url}
                      onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                      className="h-9 font-mono text-xs sm:text-sm"
                    />
                    <span className="text-[10px] text-muted-foreground/60">Web URL endpoint that broadcasts Server-Sent Events for JSON-RPC message delivery.</span>
                  </div>
                </div>
              )}

              {/* Enabled Switch */}
              <div className="flex items-center justify-between rounded-xl border border-border/60 p-3 bg-muted/5">
                <div>
                  <p className="font-semibold text-xs sm:text-sm text-foreground">Enabled Status</p>
                  <p className="text-[10px] text-muted-foreground">The build engine actively queries tools only from enabled integrations.</p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={checked => setForm(f => ({ ...f, enabled: checked }))}
                />
              </div>

            </div>

            <DialogFooter className="mt-2.5">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="text-xs h-8 sm:h-9">
                Cancel
              </Button>
              <Button onClick={handleSaveServer} disabled={saving} className="text-xs h-8 sm:h-9 gap-1.5">
                {saving ? (
                  <>Saving...</>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Save Integration
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-md w-[95vw]">
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2 text-sm sm:text-base">
                <Trash2 className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
                Remove Server Connection
              </DialogTitle>
              <DialogDescription className="text-[10px] sm:text-xs leading-relaxed">
                This will permanently delete the server connection definition <strong>&quot;{deleteTarget}&quot;</strong> from your configuration file in <code className="bg-muted px-1 py-0.5 rounded text-[10px]">~/.factory/mcp.json</code>.
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} className="text-xs h-8 sm:h-9">
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteServer} className="text-xs h-8 sm:h-9 gap-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </TooltipProvider>
  );
}
