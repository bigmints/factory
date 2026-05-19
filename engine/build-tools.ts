/**
 * Build Tools — OpenAI-format tool definitions and executor for the LLM build engine.
 *
 * The LLM calls tools instead of following a hardcoded pipeline.
 * Each tool returns { content, isError? } — never throws.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { spawn } from 'node:child_process';

// ─── Types ───────────────────────────────────────────────

/** Context passed to every tool call */
export interface BuildToolContext {
    /** Path to the target app directory */
    targetDir: string;
    /** Path to the spec YAML file */
    specFile: string;
    /** Whether a terminal tool (mark_complete/mark_failed) was called */
    terminal: boolean;
    /** Accumulated files generated during this session */
    generatedFiles: Map<string, string>;
    /** Log messages from the LLM session */
    logs: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
}

/** Result from a tool call — never throws, errors in isError */
export interface ToolResult {
    content: string;
    isError?: boolean;
}

// ─── Tool Definitions (OpenAI function-call format) ──────

export const TOOL_DEFINITIONS = [
    {
        name: 'read_file',
        description: 'Read the contents of a file. Returns the file content as text.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path relative to target directory or absolute' },
            },
            required: ['path'],
        },
    },
    {
        name: 'write_file',
        description: 'Write content to a file. Creates parent directories if needed.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path relative to target directory or absolute' },
                content: { type: 'string', description: 'File content' },
            },
            required: ['path', 'content'],
        },
    },
    {
        name: 'list_dir',
        description: 'List files and directories. Returns a newline-separated list of entries.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path relative to target directory or absolute. Default: target root.' },
                recursive: { type: 'boolean', description: 'Whether to list recursively. Default: false.' },
            },
            required: [],
        },
    },
    {
        name: 'run_command',
        description: 'Execute a shell command. Returns stdout/stderr. Timeout: 120s.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Shell command to execute' },
                cwd: { type: 'string', description: 'Working directory (default: target directory)' },
                timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000)' },
            },
            required: ['command'],
        },
    },
    {
        name: 'read_spec',
        description: 'Read the current build spec YAML file. Returns its content.',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'read_context',
        description: 'Read project context (conventions, knowledge files, existing code). Returns context summary.',
        parameters: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['conventions', 'knowledge', 'file_tree', 'package_json', 'tsconfig'], description: 'What context to read' },
            },
            required: ['type'],
        },
    },
    {
        name: 'log_step',
        description: 'Log a step or message during the build. Useful for tracking progress.',
        parameters: {
            type: 'object',
            properties: {
                level: { type: 'string', enum: ['info', 'warn', 'error'], description: 'Log level' },
                message: { type: 'string', description: 'Log message' },
            },
            required: ['message'],
        },
    },
    {
        name: 'mark_complete',
        description: 'Signal that the build is complete and successful. This terminates the tool session.',
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Brief summary of what was built' },
            },
            required: [],
        },
    },
    {
        name: 'mark_failed',
        description: 'Signal that the build has failed. This terminates the tool session.',
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Reason for failure' },
            },
            required: ['reason'],
        },
    },
] as const;

// ─── Tool Executor ───────────────────────────────────────

/**
 * Execute a tool by name with given arguments.
 * Never throws — errors are returned as { content, isError: true }.
 */
export async function executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: BuildToolContext,
): Promise<ToolResult> {
    try {
        switch (name) {
            case 'read_file':
                return execReadFile(args, ctx);
            case 'write_file':
                return execWriteFile(args, ctx);
            case 'list_dir':
                return execListDir(args, ctx);
            case 'run_command':
                return execRunCommand(args, ctx);
            case 'read_spec':
                return execReadSpec(args, ctx);
            case 'read_context':
                return execReadContext(args, ctx);
            case 'log_step':
                return execLogStep(args, ctx);
            case 'mark_complete':
                return execMarkComplete(args, ctx);
            case 'mark_failed':
                return execMarkFailed(args, ctx);
            default:
                return { content: `Unknown tool: ${name}`, isError: true };
        }
    } catch (err) {
        return {
            content: `Tool ${name} error: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
        };
    }
}

// ─── Individual Tool Implementations ────────────────────

function execReadFile(args: Record<string, unknown>, ctx: BuildToolContext): ToolResult {
    const filePath = resolvePath(args.path as string, ctx);
    if (!existsSync(filePath)) {
        return { content: `File not found: ${filePath}`, isError: true };
    }
    return { content: readFileSync(filePath, 'utf-8') };
}

function execWriteFile(args: Record<string, unknown>, ctx: BuildToolContext): ToolResult {
    const filePath = resolvePath(args.path as string, ctx);
    const content = args.content as string;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    ctx.generatedFiles.set(filePath, content);
    return { content: `Written: ${filePath} (${content.length} bytes)` };
}

function execListDir(args: Record<string, unknown>, ctx: BuildToolContext): ToolResult {
    const dirPath = resolvePath(args.path as string || '.', ctx);
    const recursive = args.recursive as boolean || false;

    if (!existsSync(dirPath)) {
        return { content: `Directory not found: ${dirPath}`, isError: true };
    }

    const items = recursive
        ? listDirRecursive(dirPath)
        : readdirSync(dirPath, { withFileTypes: true }).map(e => e.name);
    return { content: items.join('\n') };
}

function listDirRecursive(dir: string, prefix = ''): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.factory') continue;
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            results.push(relPath + '/');
            results.push(...listDirRecursive(join(dir, entry.name), relPath));
        } else {
            results.push(relPath);
        }
    }
    return results;
}

async function execRunCommand(args: Record<string, unknown>, ctx: BuildToolContext): Promise<ToolResult> {
    return new Promise((resolve) => {
        const command = args.command as string;
        const cwd = resolvePath(args.cwd as string || '.', ctx);
        const timeout = (args.timeout as number) || 120_000;

        const child = spawn(command, [], {
            cwd,
            shell: true,
            timeout,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
        child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

        child.on('close', (code) => {
            const output = stdout || stderr;
            if (code === 0) {
                resolve({ content: output || 'Command completed successfully' });
            } else {
                resolve({
                    content: `Command failed (exit ${code}):\n${stderr || stdout}`,
                    isError: true,
                });
            }
        });

        child.on('error', (err) => {
            resolve({
                content: `Command error: ${err instanceof Error ? err.message : String(err)}`,
                isError: true,
            });
        });
    });
}

function execReadSpec(args: Record<string, unknown>, ctx: BuildToolContext): ToolResult {
    if (!ctx.specFile || !existsSync(ctx.specFile)) {
        return { content: 'No spec file available', isError: true };
    }
    return { content: readFileSync(ctx.specFile, 'utf-8') };
}

function execReadContext(args: Record<string, unknown>, ctx: BuildToolContext): ToolResult {
    const type = args.type as string;
    switch (type) {
        case 'package_json': {
            const pkgPath = join(ctx.targetDir, 'package.json');
            if (existsSync(pkgPath)) {
                return { content: readFileSync(pkgPath, 'utf-8') };
            }
            return { content: 'No package.json found' };
        }
        case 'tsconfig': {
            const tsPath = join(ctx.targetDir, 'tsconfig.json');
            if (existsSync(tsPath)) {
                return { content: readFileSync(tsPath, 'utf-8') };
            }
            return { content: 'No tsconfig.json found' };
        }
        case 'file_tree': {
            const items = listDirRecursive(ctx.targetDir);
            return { content: items.join('\n') };
        }
        default:
            return { content: `Unknown context type: ${type}` };
    }
}

function execLogStep(args: Record<string, unknown>, ctx: BuildToolContext): ToolResult {
    const level = (args.level as 'info' | 'warn' | 'error') || 'info';
    const message = args.message as string;
    ctx.logs.push({ level, message });
    return { content: `Logged [${level}]: ${message}` };
}

function execMarkComplete(args: Record<string, unknown>, ctx: BuildToolContext): ToolResult {
    ctx.terminal = true;
    const summary = (args.summary as string) || 'Build completed';
    return { content: `Build marked as complete: ${summary}` };
}

function execMarkFailed(args: Record<string, unknown>, ctx: BuildToolContext): ToolResult {
    ctx.terminal = true;
    const reason = (args.reason as string) || 'Build failed';
    return { content: `Build marked as failed: ${reason}`, isError: true };
}

// ─── Helpers ─────────────────────────────────────────────

/** Resolve a path — relative paths are resolved against targetDir */
function resolvePath(path: string, ctx: BuildToolContext): string {
    if (!path) return ctx.targetDir;
    if (path.startsWith('/')) return path;
    return join(ctx.targetDir, path);
}
