'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Plug, RefreshCw, Trash2 } from 'lucide-react';

interface McpServer {
  id: string;
  transport: 'stdio' | 'sse';
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export function IntegrationsView() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mcp');
      const data = await res.json();
      // data is an object with { mcpServers: { [id]: ServerConfig } }
      const list: McpServer[] = [];
      if (data.mcpServers) {
        Object.entries(data.mcpServers).forEach(([id, config]: [string, any]) => {
          list.push({
            id,
            ...config,
          });
        });
      }
      setServers(list);
    } catch {
      toast.error('Failed to load MCP integrations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
  }, []);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/mcp?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(`Removed MCP server "${id}"`);
        loadIntegrations();
      } else {
        toast.error('Failed to remove server');
      }
    } catch {
      toast.error('Failed to remove server');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground border-b border-border/40 pb-4">
        <span className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-indigo-500" />
          <span className="font-semibold text-foreground">Model Context Protocol (MCP) Integrations</span>
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={loadIntegrations}
            disabled={loading}
            className="h-8 w-8 p-0 rounded-md hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      ) : servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60 border border-dashed border-border rounded-xl bg-card/5">
          <Plug className="h-8 w-8 opacity-30 mb-2" />
          <p className="text-xs font-medium">No MCP servers integrated</p>
          <p className="text-[10px] mt-1 text-center max-w-xs">Integrate external developer toolboxes (e.g. databases, file systems) into the TPM LLM agent context.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {servers.map((server) => (
            <Card key={server.id} className="p-5 border border-border/60 bg-card/10 flex flex-col justify-between gap-3 shadow-xs">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-xs sm:text-sm font-semibold text-foreground truncate">{server.id}</h3>
                    <Badge variant={server.enabled ? 'default' : 'secondary'} className="text-[9px] px-1.5 py-0 rounded font-semibold uppercase tracking-wider">
                      {server.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 rounded font-semibold uppercase tracking-wider">
                      {server.transport}
                    </Badge>
                  </div>

                  {server.transport === 'stdio' ? (
                    <div className="space-y-1">
                      <p className="text-xs font-mono text-muted-foreground/90 break-all">
                        <span className="font-semibold text-foreground mr-1.5">Command:</span>{server.command}
                      </p>
                      {server.args && server.args.length > 0 && (
                        <p className="text-[11px] font-mono text-muted-foreground/80 break-all">
                          <span className="font-semibold text-foreground mr-1.5">Args:</span>{server.args.join(' ')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs font-mono text-muted-foreground/90 break-all">
                      <span className="font-semibold text-foreground mr-1.5">SSE URL:</span>{server.url}
                    </p>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deleting === server.id}
                  onClick={() => handleDelete(server.id)}
                  className="h-8 w-8 p-0 rounded-md hover:bg-rose-500/10 hover:text-rose-500 text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
