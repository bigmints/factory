import { tpmToolRegistry } from '../registry.ts';
import type { OrchestratorContext } from '../../orchestrate.ts';
import type { ToolResult } from '../types.ts';

function execAskDeveloper(args: Record<string, unknown>, ctx: OrchestratorContext): ToolResult {
    const question = String(args.question || '');
    if (!question) {
        return { content: 'question is required', isError: true };
    }

    // In a real implementation this might write to an "issues.yaml" or suspend the queue.
    // For now, we will mark it as terminal intervention so it stops the loop.
    ctx.terminal = true;
    ctx.success = false;

    const msg = `HUMAN ESCALATION REQUESTED: ${question}`;
    ctx.logs.push({ level: 'error', message: msg });

    return { 
        content: `Escalation successful. The build loop has been suspended and the developer will be notified.\nQuestion asked: ${question}`, 
        isError: false 
    };
}

tpmToolRegistry.register({
    name: 'ask_developer',
    description: 'Suspend the build process and ask the human developer for clarification on an ambiguous business requirement.',
    parameters: {
        type: 'object',
        properties: {
            question: { type: 'string', description: 'The specific question for the developer.' }
        },
        required: ['question']
    },
    execute: execAskDeveloper
});
