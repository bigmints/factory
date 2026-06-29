import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tpmToolRegistry } from '../registry.ts';
import type { OrchestratorContext } from '../../orchestrate.ts';
import type { ToolResult } from '../types.ts';

async function execRunVerification(args: Record<string, unknown>, ctx: OrchestratorContext): Promise<ToolResult> {
    const command = String(args.command || '');
    if (!command) {
        return { content: 'command is required', isError: true };
    }

    // Only allow safe verification commands
    const allowedPrefixes = ['npm run', 'pnpm run', 'yarn run', 'npx', 'tsc', 'jest', 'vitest'];
    if (!allowedPrefixes.some(p => command.startsWith(p))) {
        return { content: `Command not allowed. Allowed prefixes: ${allowedPrefixes.join(', ')}`, isError: true };
    }

    return new Promise<ToolResult>((resolve) => {
        const child = spawn(command, {
            shell: true,
            cwd: ctx.targetDir,
            env: process.env
        });

        let output = '';
        child.stdout.on('data', d => output += d.toString());
        child.stderr.on('data', d => output += d.toString());

        child.on('close', code => {
            const truncated = output.length > 10000 ? output.slice(-10000) : output;
            resolve({
                content: `Command exited with code ${code}.\n\nOutput:\n${truncated}`,
                isError: code !== 0
            });
        });
        
        child.on('error', err => {
            resolve({ content: `Command failed to start: ${err.message}`, isError: true });
        });
    });
}

function execSpotCheckCode(args: Record<string, unknown>, ctx: OrchestratorContext): ToolResult {
    const filepath = String(args.filepath || '');
    const maxLines = Number(args.maxLines) || 200;
    
    if (!filepath) {
        return { content: 'filepath is required', isError: true };
    }

    const fullPath = join(ctx.targetDir, filepath);
    if (!existsSync(fullPath)) {
        return { content: `File not found: ${filepath}`, isError: true };
    }

    try {
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        if (lines.length > maxLines) {
            return { content: `File is ${lines.length} lines. First ${maxLines} lines:\n\n${lines.slice(0, maxLines).join('\n')}\n... (truncated)`, isError: false };
        }
        return { content: content, isError: false };
    } catch (e) {
        return { content: `Failed to read file: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
}

tpmToolRegistry.register({
    name: 'tpm_run_verification',
    description: 'Run tests or build scripts (e.g. "npm run build", "tsc --noEmit") to independently verify the CLI engineer\'s work before marking a story done.',
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'The verification command to run.' }
        },
        required: ['command']
    },
    execute: execRunVerification
});

tpmToolRegistry.register({
    name: 'tpm_spot_check_code',
    description: 'Read the contents of a specific file in the target directory to verify the CLI met acceptance criteria.',
    parameters: {
        type: 'object',
        properties: {
            filepath: { type: 'string', description: 'Relative path to the file in the target directory.' },
            maxLines: { type: 'number', description: 'Maximum number of lines to return (default 200).' }
        },
        required: ['filepath']
    },
    execute: execSpotCheckCode
});
