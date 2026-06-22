import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tpmToolRegistry } from '../registry.ts';
import type { OrchestratorContext } from '../../orchestrate.ts';
import type { ToolResult } from '../types.ts';
import { updateStoryStatus } from '../../story.ts';
import type { StoryStatus } from '../../types.ts';

const __filename = fileURLToPath(import.meta.url);
const engineDir = resolve(dirname(__filename), '../../..');
const cliTsPath = resolve(engineDir, 'cli.ts');

async function execRunFactoryCommand(args: Record<string, unknown>, ctx: OrchestratorContext): Promise<ToolResult> {
    const commandArgs = args.args as string[];
    
    if (!commandArgs || !Array.isArray(commandArgs)) {
        return { content: 'args must be an array of strings', isError: true };
    }

    // Protect against running arbitrary non-factory commands
    // The command array represents arguments passed directly to the factory CLI
    return new Promise<ToolResult>((resolveResult) => {
        const child = spawn('npx', ['tsx', cliTsPath, ...commandArgs], {
            cwd: ctx.repoPath || process.cwd(),
            env: {
                ...process.env,
                FACTORY_PROJECT_ROOT: ctx.repoPath || process.cwd(),
            }
        });

        let output = '';
        child.stdout.on('data', d => output += d.toString());
        child.stderr.on('data', d => output += d.toString());

        child.on('close', code => {
            const truncated = output.length > 10000 ? output.slice(-10000) : output;
            resolveResult({
                content: `Command exited with code ${code}.\n\nOutput:\n${truncated}`,
                isError: code !== 0
            });
        });
        
        child.on('error', err => {
            resolveResult({ content: `Command failed to start: ${err.message}`, isError: true });
        });
    });
}

function execManageStory(args: Record<string, unknown>, ctx: OrchestratorContext): ToolResult {
    const storyPath = String(args.storyPath || '');
    const action = String(args.action || '');
    
    if (!storyPath) {
        return { content: 'storyPath is required', isError: true };
    }

    if (action === 'update_status') {
        const status = String(args.status || '') as StoryStatus;
        if (!status) {
            return { content: 'status is required for update_status action', isError: true };
        }
        
        try {
            const summary = args.summary ? String(args.summary) : undefined;
            updateStoryStatus(storyPath, status, summary);
            return { content: `Successfully updated story status to ${status}`, isError: false };
        } catch (e) {
            return { content: `Failed to update story status: ${e instanceof Error ? e.message : String(e)}`, isError: true };
        }
    }

    return { content: `Unknown action: ${action}`, isError: true };
}

tpmToolRegistry.register({
    name: 'run_factory_command',
    description: 'Execute a Factory CLI command natively (e.g., build, validate, status, queue start, app sync, chronicle). Use this to orchestrate the engine, sync roadmaps, manage queues, or build knowledge. Pass the arguments as an array (e.g., ["app", "sync"]).',
    parameters: {
        type: 'object',
        properties: {
            args: { 
                type: 'array', 
                items: { type: 'string' },
                description: 'The arguments to pass to the factory CLI. Example: ["app", "sync"] or ["queue", "start"]' 
            }
        },
        required: ['args']
    },
    execute: execRunFactoryCommand
});

tpmToolRegistry.register({
    name: 'manage_story',
    description: 'Safely read, scaffold, or update .md / .yaml story status without breaking file structures.',
    parameters: {
        type: 'object',
        properties: {
            storyPath: { type: 'string', description: 'The path or slug of the story.' },
            action: { type: 'string', description: 'The action to perform. Currently supported: "update_status"' },
            status: { type: 'string', description: 'The new status if action is update_status (e.g., "pending", "done", "failed").' },
            summary: { type: 'string', description: 'Optional summary to append to the story when marking it as done.' }
        },
        required: ['storyPath', 'action']
    },
    execute: execManageStory
});
