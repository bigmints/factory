import fs from 'fs';

let content = fs.readFileSync('engine/tools/fs.ts', 'utf-8');

// Remove call_mcp_tool from handlers
content = content.replace(/,\s*'call_mcp_tool': execMcpTool/, '');

// Fix executeTool to use registry
const newExecuteTool = `export async function executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: BuildToolBlueprint,
): Promise<ToolResult> {
    if (name.startsWith('mcp__')) {
        return await execMcpTool(name, args, ctx);
    }
    return workerToolRegistry.execute(name, args, ctx);
}`;

content = content.replace(/export async function executeTool\([\s\S]*?\n\}\n/m, newExecuteTool + '\n');

fs.writeFileSync('engine/tools/fs.ts', content);
