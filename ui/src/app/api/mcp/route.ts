import { NextResponse } from 'next/server';
import { loadMcpConfig, saveMcpConfig } from '@engine/config';

export async function GET() {
  try {
    const config = loadMcpConfig();
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, command, args, env, url, transport, enabled } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Server ID is required and must be a string' }, { status: 400 });
    }

    if (transport !== 'stdio' && transport !== 'sse') {
      return NextResponse.json({ error: 'Transport must be "stdio" or "sse"' }, { status: 400 });
    }

    if (transport === 'stdio' && !command) {
      return NextResponse.json({ error: 'Command is required for stdio transport' }, { status: 400 });
    }

    if (transport === 'sse' && !url) {
      return NextResponse.json({ error: 'URL is required for sse transport' }, { status: 400 });
    }

    const config = loadMcpConfig();
    
    // Ensure mcpServers exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Build the server config entry
    const serverEntry: any = {
      transport,
      enabled: enabled !== false, // default to true
    };

    if (transport === 'stdio') {
      serverEntry.command = command;
      serverEntry.args = Array.isArray(args) ? args : [];
      if (env && typeof env === 'object') {
        serverEntry.env = env;
      }
    } else {
      serverEntry.url = url;
    }

    // Write to configuration
    config.mcpServers[id] = serverEntry;
    saveMcpConfig(config);

    return NextResponse.json({ ok: true, mcpServers: config.mcpServers });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
    }

    const config = loadMcpConfig();
    if (config.mcpServers && config.mcpServers[id]) {
      delete config.mcpServers[id];
      saveMcpConfig(config);
      return NextResponse.json({ ok: true, mcpServers: config.mcpServers });
    }

    return NextResponse.json({ error: `Server "${id}" not found` }, { status: 404 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
