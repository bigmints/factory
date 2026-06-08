import { AgentTool, ToolResult } from './types';

/**
 * A central registry for managing tools available to agents.
 */
export class ToolRegistry {
    private tools: Map<string, AgentTool> = new Map();

    /**
     * Register a new tool.
     */
    public register(tool: AgentTool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool already registered: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
    }

    /**
     * Retrieve a specific tool by name.
     */
    public getTool(name: string): AgentTool | undefined {
        return this.tools.get(name);
    }

    /**
     * Get the LLM schema definitions for all registered tools.
     */
    public getDefinitions(): Array<{ name: string; description: string; parameters: any }> {
        return Array.from(this.tools.values()).map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        }));
    }

    /**
     * Execute a tool by name.
     */
    public async execute(name: string, args: Record<string, unknown>, ctx: any): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                content: `Unknown tool: ${name}. Available: ${Array.from(this.tools.keys()).join(', ')}.`,
                isError: true,
            };
        }
        try {
            return await tool.execute(args, ctx);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: `Tool ${name} threw: ${msg}`, isError: true };
        }
    }
}

// Instantiate distinct registries
export const workerToolRegistry = new ToolRegistry();
export const tpmToolRegistry = new ToolRegistry();
