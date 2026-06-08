import { join, dirname } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { stringify as toYaml } from 'yaml';
import { tpmToolRegistry } from '../registry.ts';
import type { OrchestratorContext } from '../../orchestrate.ts';
import type { ToolResult } from '../types.ts';

function execWriteAdr(args: Record<string, unknown>, ctx: OrchestratorContext): ToolResult {
    const title = String(args.title || '');
    const decision = String(args.decision || '');
    const consequences = String(args.consequences || '');
    
    if (!title || !decision) {
        return { content: 'title and decision are required', isError: true };
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '');
    const knowledgeDir = join(ctx.repoPath, '.factory', 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });

    const filePath = join(knowledgeDir, `${slug}.md`);
    const timestamp = new Date().toISOString();
    const fileContent = `# ADR: ${title}\n\n> Written by TPM orchestrator at ${timestamp}\n\n## Decision\n${decision}\n\n## Consequences\n${consequences}\n`;

    writeFileSync(filePath, fileContent);
    return { content: `Architecture Decision Record written to .factory/knowledge/${slug}.md`, isError: false };
}

function execUpdateProjectState(args: Record<string, unknown>, ctx: OrchestratorContext): ToolResult {
    const key = String(args.key || '');
    const value = args.value;
    
    if (!key || value === undefined) {
        return { content: 'key and value are required', isError: true };
    }

    const statePath = join(ctx.repoPath, '.factory', 'logs', 'state.yaml');
    mkdirSync(dirname(statePath), { recursive: true });

    let state: any = {};
    if (existsSync(statePath)) {
        try { state = parseYaml(readFileSync(statePath, 'utf-8')) || {}; } catch { /* fresh */ }
    }

    // Set nested key path (e.g. "architecture.database")
    const parts = key.split('.');
    let current = state;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (typeof current[part] !== 'object' || current[part] === null) {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;

    writeFileSync(statePath, toYaml(state));
    return { content: `State updated at .factory/logs/state.yaml: ${key} = ${JSON.stringify(value)}`, isError: false };
}

tpmToolRegistry.register({
    name: 'write_adr',
    description: 'Create an Architecture Decision Record (ADR) in the knowledge base to document significant technical decisions made during the build.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Title of the ADR' },
            decision: { type: 'string', description: 'Detailed explanation of the technical decision and why it was made' },
            consequences: { type: 'string', description: 'What this decision means for the rest of the project (constraints, next steps)' }
        },
        required: ['title', 'decision']
    },
    execute: execWriteAdr
});

tpmToolRegistry.register({
    name: 'update_project_state',
    description: 'Update the living project state file with new key-value pairs (e.g. recording a completed milestone or installed library).',
    parameters: {
        type: 'object',
        properties: {
            key: { type: 'string', description: 'The property key to set (can use dot-notation for nested paths)' },
            value: { type: 'string', description: 'The value to assign' }
        },
        required: ['key', 'value']
    },
    execute: execUpdateProjectState
});
