import fs from 'fs';

let content = fs.readFileSync('engine/tools/fs.ts', 'utf-8');

// Replace exports
content = content.replace('export const TOOL_DEFINITIONS', 'const TOOL_DEFINITIONS');

// Import AgentTool
content = `import { workerToolRegistry } from './registry.ts';
import type { AgentTool } from './types.ts';

` + content;

// At the end, add registration loop
content += `
// ─── Register Tools ──────────────────────────────────────────

const TOOL_HANDLERS: Record<string, (args: any, ctx: any) => any> = {
    'read_file': execReadFile,
    'write_file': execWriteFile,
    'patch_file': execPatchFile,
    'delete_file': execDeleteFile,
    'list_dir': execListDir,
    'search_files': execSearchFiles,
    'run_command': execRunCommand,
    'read_story': execReadStory,
    'read_blueprint': execReadBlueprint,
    'log_step': execLogStep,
    'mark_complete': execMarkComplete,
    'mark_failed': execMarkFailed,
    'call_mcp_tool': execCallMcpTool
};

for (const def of TOOL_DEFINITIONS) {
    const handler = TOOL_HANDLERS[def.name];
    if (handler) {
        workerToolRegistry.register({
            name: def.name,
            description: def.description,
            parameters: def.parameters,
            execute: handler
        });
    }
}
`;

fs.writeFileSync('engine/tools/fs.ts', content);
