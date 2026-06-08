/**
 * Core types for the modular Tool Registry.
 */

export interface ToolResult {
    content: string;
    isError: boolean;
}

export interface AgentTool<TContext = any> {
    /**
     * The name of the tool, matching what the LLM will call.
     */
    name: string;
    
    /**
     * A description of what the tool does, used to guide the LLM.
     */
    description: string;
    
    /**
     * The JSON schema for the tool's parameters.
     */
    parameters: Record<string, unknown>;
    
    /**
     * Executes the tool logic.
     * @param args The arguments provided by the LLM.
     * @param ctx Context injected into the tool (e.g. OrchestratorContext or BuildToolBlueprint)
     */
    execute: (args: Record<string, unknown>, ctx: TContext) => Promise<ToolResult> | ToolResult;
}
