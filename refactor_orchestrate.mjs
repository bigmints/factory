import fs from 'fs';

let content = fs.readFileSync('engine/orchestrate.ts', 'utf-8');

// Add import for tpmToolRegistry
if (!content.includes('tpmToolRegistry')) {
    content = `import { tpmToolRegistry } from './tools/registry.ts';\n` + content;
}

// Replace ORCHESTRATOR_TOOL_DEFINITIONS usage
// First, find the definition of ORCHESTRATOR_TOOL_DEFINITIONS
// and remove export
content = content.replace('export const ORCHESTRATOR_TOOL_DEFINITIONS = [', 'const ORCHESTRATOR_TOOL_DEFINITIONS = [');

// Register tools at the bottom
const registerBlock = `
// ─── Register TPM Tools ──────────────────────────────────────────

const TPM_TOOL_HANDLERS: Record<string, any> = {
    'delegate_to_cli': toolDelegateToCli,
    'intervene': toolIntervene,
    'create_fix_task': toolCreateFixTask,
    'create_qa_task': toolCreateQaTask,
    'update_context': toolUpdateContext,
    'mark_story_done': toolMarkStoryDone,
    'mark_story_failed': toolMarkStoryFailed,
    'update_knowledge': toolUpdateKnowledge
};

for (const def of ORCHESTRATOR_TOOL_DEFINITIONS) {
    const handler = TPM_TOOL_HANDLERS[def.name];
    if (handler) {
        tpmToolRegistry.register({
            name: def.name,
            description: def.description,
            parameters: def.parameters,
            execute: handler
        });
    }
}
`;
if (!content.includes('TPM_TOOL_HANDLERS')) {
    content += registerBlock;
}

// Replace executeOrchestratorTool usage:
// Instead of switch statement, use registry
const newExecuteTool = `async function executeOrchestratorTool(
    name: string,
    args: Record<string, unknown>,
    ctx: OrchestratorContext,
): Promise<ToolResult> {
    return tpmToolRegistry.execute(name, args, ctx);
}`;

// I'll replace the old executeOrchestratorTool using regex
content = content.replace(/async function executeOrchestratorTool\([\s\S]*?\n\}\n/m, newExecuteTool + '\n');

// Then I need to make sure ORCHESTRATOR_TOOL_DEFINITIONS is accessible to the LLM call.
// The LLM call is likely: const tools = ORCHESTRATOR_TOOL_DEFINITIONS;
// Or they pass it directly to callOrchestratorLLM
content = content.replace(/tools: ORCHESTRATOR_TOOL_DEFINITIONS/g, 'tools: tpmToolRegistry.getDefinitions()');

fs.writeFileSync('engine/orchestrate.ts', content);
