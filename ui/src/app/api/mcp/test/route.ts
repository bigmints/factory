import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { loadMcpConfig } from '@engine/config';

// Helper to run connection and capability handshake with an MCP server
async function testMcpServer(config: any): Promise<{
  success: boolean;
  error?: string;
  tools?: any[];
  resources?: any[];
}> {
  return new Promise((resolve) => {
    const { command, args, env, transport, url } = config;

    if (transport === 'sse') {
      // Perform HTTP probe for SSE
      fetch(url)
        .then(async (res) => {
          if (res.ok) {
            resolve({ success: true, tools: [], resources: [] });
          } else {
            resolve({ success: false, error: `SSE server returned status ${res.status}` });
          }
        })
        .catch((err) => {
          resolve({ success: false, error: `Failed to connect to SSE URL: ${err.message}` });
        });
      return;
    }

    // STDIO transport
    try {
      const mergedEnv = { ...process.env, ...(env || {}) };
      // Spawn in shell to automatically resolve command paths (like npx, node, etc.) on Mac
      const child = spawn(command, args || [], {
        env: mergedEnv,
        shell: true,
      });

      let buffer = '';
      let tools: any[] = [];
      let resources: any[] = [];
      let resolved = false;

      const cleanupAndResolve = (result: any) => {
        if (resolved) return;
        resolved = true;
        try {
          child.kill('SIGTERM');
        } catch {}
        resolve(result);
      };

      // 8-second safety timeout to avoid blocking the API thread
      const timer = setTimeout(() => {
        cleanupAndResolve({
          success: false,
          error: 'Connection timed out after 8 seconds. Verify the command/arguments and ensure the server runs on stdio.',
        });
      }, 8000);

      child.on('error', (err) => {
        clearTimeout(timer);
        cleanupAndResolve({
          success: false,
          error: `Failed to spawn process: ${err.message}`,
        });
      });

      child.stderr?.on('data', (data) => {
        console.error(`[MCP TEST STDERR]: ${data.toString()}`);
      });

      child.stdout?.on('data', (chunk) => {
        buffer += chunk.toString();

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) continue;

          try {
            const message = JSON.parse(line);

            // Handle initialize response (id: 1)
            if (message.id === 1) {
              if (message.error) {
                clearTimeout(timer);
                cleanupAndResolve({
                  success: false,
                  error: `Initialize failed: ${JSON.stringify(message.error)}`,
                });
                return;
              }

              // Send initialized notification
              const initializedNotification = {
                jsonrpc: '2.0',
                method: 'notifications/initialized',
              };
              child.stdin?.write(JSON.stringify(initializedNotification) + '\n');

              // Request list of tools
              const listToolsRequest = {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {},
              };
              child.stdin?.write(JSON.stringify(listToolsRequest) + '\n');
            }

            // Handle tools list response (id: 2)
            else if (message.id === 2) {
              if (message.error) {
                clearTimeout(timer);
                cleanupAndResolve({
                  success: false,
                  error: `Fetching tools failed: ${JSON.stringify(message.error)}`,
                });
                return;
              }

              if (message.result && Array.isArray(message.result.tools)) {
                tools = message.result.tools;
              }

              // Request list of resources
              const listResourcesRequest = {
                jsonrpc: '2.0',
                id: 3,
                method: 'resources/list',
                params: {},
              };
              child.stdin?.write(JSON.stringify(listResourcesRequest) + '\n');
            }

            // Handle resources list response (id: 3)
            else if (message.id === 3) {
              if (message.result && Array.isArray(message.result.resources)) {
                resources = message.result.resources;
              }

              clearTimeout(timer);
              cleanupAndResolve({
                success: true,
                tools,
                resources,
              });
            }
          } catch (e) {
            // Ignore JSON parsing issues for partial chunks or debugging logs written to stdout
          }
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (!resolved) {
          cleanupAndResolve({
            success: false,
            error: `Server exited prematurely with exit code ${code}. Check arguments and environment logs.`,
          });
        }
      });

      // Write initial initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'factory-client',
            version: '1.0.0',
          },
        },
      };

      child.stdin?.write(JSON.stringify(initRequest) + '\n');
    } catch (e: any) {
      resolve({ success: false, error: e.message });
    }
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let config = body;

    // Support testing by id
    if (body.id && !body.command && !body.url) {
      const savedConfig = loadMcpConfig();
      if (!savedConfig.mcpServers || !savedConfig.mcpServers[body.id]) {
        return NextResponse.json({ error: `MCP server "${body.id}" not found in configuration.` }, { status: 404 });
      }
      config = savedConfig.mcpServers[body.id];
    }

    if (!config.transport) {
      return NextResponse.json({ error: 'Transport type is required.' }, { status: 400 });
    }

    const testResult = await testMcpServer(config);
    return NextResponse.json(testResult);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
