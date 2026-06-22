/**
 * Build Tools — OpenAI-format tool definitions and executor for the LLM build engine.
 *
 * The LLM calls tools instead of following a hardcoded pipeline.
 * Each tool returns { content, isError? } — never throws.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname, relative, resolve, sep, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { loadMcpConfig } from './config.ts';
import type { TaskProfile } from './types.ts';

// ─── Constants ───────────────────────────────────────────

/** Max bytes returned by read_file — prevents context overflow */
const MAX_FILE_READ_BYTES = 100_000;
/** Max bytes returned by run_command — prevents log flooding */
const MAX_COMMAND_OUTPUT_BYTES = 50_000;
/** Max results from search_files */
const MAX_SEARCH_RESULTS = 50;

// ─── Types ───────────────────────────────────────────────

/** Blueprint / Context passed to every tool call */
export interface BuildToolBlueprint {
    /** Path to the target app directory */
    targetDir: string;
    /** Path to the story YAML file */
    storyFile: string;
    /** Whether a terminal tool (mark_complete/mark_failed) was called */
    terminal: boolean;
    /** True if mark_complete was called; false if mark_failed or no terminal call */
    success: boolean;
    /** Accumulated files generated during this session */
    generatedFiles: Map<string, string>;
    /** Log messages from the LLM session */
    logs: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
    /** Pre-loaded blueprint data available via read_blueprint tool */
    contextData?: {
        conventions?: string;
        knowledge?: string;
    };
    /** Current task classification profile (gates capability checks) */
    taskProfile?: TaskProfile;
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
        description: 'Read the contents of a file. Returns file content as text (capped at 100KB).',
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
                content: { type: 'string', description: 'File content to write' },
            },
            required: ['path', 'content'],
        },
    },
    {
        name: 'patch_file',
        description: 'Replace a specific section of a file. Finds old_content exactly and replaces it with new_content. Returns an error if old_content is not found — use read_file first to confirm current content.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path relative to target directory or absolute' },
                old_content: { type: 'string', description: 'Exact string to find in the file' },
                new_content: { type: 'string', description: 'Replacement string' },
            },
            required: ['path', 'old_content', 'new_content'],
        },
    },
    {
        name: 'delete_file',
        description: 'Delete a file from the filesystem.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path relative to target directory or absolute' },
            },
            required: ['path'],
        },
    },
    {
        name: 'list_dir',
        description: 'List files and directories. Returns a newline-separated list of entries.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path relative to target directory or absolute. Default: target root.' },
                recursive: { type: 'boolean', description: 'Whether to list recursively (skips node_modules/.git). Default: false.' },
            },
            required: [],
        },
    },
    {
        name: 'search_files',
        description: 'Search for a text pattern across files in a directory. Returns matching file:line snippets (max 50 results).',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Text pattern to search for' },
                path: { type: 'string', description: 'Directory to search in (default: target directory)' },
                glob: { type: 'string', description: 'File extension filter, e.g. "*.ts" or "*.tsx". Default: all text files.' },
                case_insensitive: { type: 'boolean', description: 'Case-insensitive match. Default: false.' },
            },
            required: ['pattern'],
        },
    },
    {
        name: 'run_command',
        description: 'Execute a shell command in the target directory. Returns stdout/stderr (capped at 50KB). Timeout: 120s.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Shell command to execute' },
                cwd: { type: 'string', description: 'Working directory override (default: target directory)' },
                timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000)' },
            },
            required: ['command'],
        },
    },
    {
        name: 'read_story',
        description: 'Read the current build story YAML file. Returns its content.',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'read_blueprint',
        description: 'Read project blueprint/context. Type must be one of: conventions, knowledge, file_tree, package_json, tsconfig.',
        parameters: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['conventions', 'knowledge', 'file_tree', 'package_json', 'tsconfig'],
                    description: 'What blueprint section to read',
                },
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
        description: 'Signal that the build has failed and cannot proceed. This terminates the tool session.',
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
    ctx: BuildToolBlueprint,
): Promise<ToolResult> {
    try {
        if (name.startsWith('mcp__')) {
            return await execMcpTool(name, args, ctx);
        }
        switch (name) {
            case 'read_file':     return execReadFile(args, ctx);
            case 'write_file':    return execWriteFile(args, ctx);
            case 'patch_file':    return execPatchFile(args, ctx);
            case 'delete_file':   return execDeleteFile(args, ctx);
            case 'list_dir':      return execListDir(args, ctx);
            case 'search_files':  return execSearchFiles(args, ctx);
            case 'run_command':   return execRunCommand(args, ctx);
            case 'read_story':    return execReadStory(args, ctx);
            case 'read_blueprint':
            case 'read_context':  return execReadBlueprint(args, ctx);
            case 'log_step':      return execLogStep(args, ctx);
            case 'mark_complete': return execMarkComplete(args, ctx);
            case 'mark_failed':   return execMarkFailed(args, ctx);
            default:
                return { content: `Unknown tool: "${name}". Valid tools: ${TOOL_DEFINITIONS.map(t => t.name).join(', ')}`, isError: true };
        }
    } catch (err) {
        return {
            content: `Tool "${name}" threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
        };
    }
}

// ─── Individual Tool Implementations ────────────────────

function execReadFile(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    const rawPath = args.path as string;
    if (!rawPath) return { content: '"path" is required for read_file', isError: true };
    const filePath = resolvePath(rawPath, ctx);
    if (!existsSync(filePath)) {
        return { content: `File not found: ${filePath}`, isError: true };
    }
    const content = readFileSync(filePath, 'utf-8');
    if (content.length > MAX_FILE_READ_BYTES) {
        return {
            content: content.slice(0, MAX_FILE_READ_BYTES) +
                `\n\n[... truncated — file is ${content.length} bytes, showing first ${MAX_FILE_READ_BYTES}. Use search_files or read a specific range.]`,
        };
    }
    return { content };
}

function execWriteFile(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    const rawPath = args.path as string;
    if (!rawPath) return { content: '"path" is required for write_file', isError: true };
    const content = args.content as string;
    if (content === undefined || content === null) return { content: '"content" is required for write_file', isError: true };
    const filePath = resolvePath(rawPath, ctx);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    ctx.generatedFiles.set(filePath, content);
    return { content: `Written: ${filePath} (${content.length} bytes)` };
}

function execPatchFile(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    const rawPath = args.path as string;
    if (!rawPath) return { content: '"path" is required for patch_file', isError: true };
    const oldContent = args.old_content as string;
    const newContent = args.new_content as string;
    if (!oldContent) return { content: '"old_content" is required for patch_file', isError: true };
    if (newContent === undefined || newContent === null) return { content: '"new_content" is required for patch_file', isError: true };

    const filePath = resolvePath(rawPath, ctx);
    if (!existsSync(filePath)) {
        return { content: `File not found: ${filePath}`, isError: true };
    }
    const current = readFileSync(filePath, 'utf-8');
    if (!current.includes(oldContent)) {
        return {
            content: `old_content not found in ${filePath}. The file may have changed — call read_file first to see the current content.`,
            isError: true,
        };
    }
    const updated = current.replace(oldContent, newContent);
    writeFileSync(filePath, updated, 'utf-8');
    ctx.generatedFiles.set(filePath, updated);
    return { content: `Patched: ${filePath}` };
}

function execDeleteFile(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    const rawPath = args.path as string;
    if (!rawPath) return { content: '"path" is required for delete_file', isError: true };
    const filePath = resolvePath(rawPath, ctx);
    if (!existsSync(filePath)) {
        return { content: `File not found: ${filePath}`, isError: true };
    }
    unlinkSync(filePath);
    ctx.generatedFiles.delete(filePath);
    return { content: `Deleted: ${filePath}` };
}

function execListDir(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    const dirPath = resolvePath((args.path as string) || '.', ctx);
    const recursive = (args.recursive as boolean) || false;

    if (!existsSync(dirPath)) {
        return { content: `Directory not found: ${dirPath}`, isError: true };
    }

    const items = recursive
        ? listDirRecursive(dirPath)
        : readdirSync(dirPath, { withFileTypes: true }).map(e => e.isDirectory() ? e.name + '/' : e.name);
    return { content: items.length > 0 ? items.join('\n') : '(empty directory)' };
}

function execSearchFiles(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    const pattern = args.pattern as string;
    if (!pattern) return { content: '"pattern" is required for search_files', isError: true };
    const searchDir = resolvePath((args.path as string) || '.', ctx);
    const glob = args.glob as string | undefined;
    const caseInsensitive = (args.case_insensitive as boolean) || false;

    if (!existsSync(searchDir)) {
        return { content: `Directory not found: ${searchDir}`, isError: true };
    }

    const results: string[] = [];

    function matchesGlob(filename: string): boolean {
        if (!glob) return true;
        if (glob.startsWith('*.')) return filename.endsWith(glob.slice(1));
        return filename.includes(glob.replace(/\*/g, ''));
    }

    function walkSearch(dir: string): void {
        if (results.length >= MAX_SEARCH_RESULTS) return;
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (results.length >= MAX_SEARCH_RESULTS) break;
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkSearch(fullPath);
                } else if (matchesGlob(entry.name)) {
                    try {
                        const lines = readFileSync(fullPath, 'utf-8').split('\n');
                        for (let i = 0; i < lines.length && results.length < MAX_SEARCH_RESULTS; i++) {
                            const line = lines[i];
                            const found = caseInsensitive
                                ? line.toLowerCase().includes(pattern.toLowerCase())
                                : line.includes(pattern);
                            if (found) {
                                const rel = relative(ctx.targetDir, fullPath);
                                results.push(`${rel}:${i + 1}: ${line.trim()}`);
                            }
                        }
                    } catch { /* skip binary / unreadable files */ }
                }
            }
        } catch { /* permission errors */ }
    }

    walkSearch(searchDir);

    if (results.length === 0) {
        return { content: `No matches found for pattern: ${pattern}` };
    }
    const truncNote = results.length >= MAX_SEARCH_RESULTS
        ? `\n[results capped at ${MAX_SEARCH_RESULTS} — narrow your search path or glob]`
        : '';
    return { content: results.join('\n') + truncNote };
}

async function execRunCommand(args: Record<string, unknown>, ctx: BuildToolBlueprint): Promise<ToolResult> {
    return new Promise((resolve) => {
        const command = args.command as string;
        if (!command) { resolve({ content: '"command" is required for run_command', isError: true }); return; }

        // 1. Security Check: Validate Command Executables Allowlist
        if (!isCommandSafe(command)) {
            resolve({
                content: `Security Error: Command execution blocked. Command "${command}" uses a non-allowlisted executable. Allowed: npm, npx, node, tsc, eslint, biome, prettier, vitest, jest, git, pnpm, yarn, bun, next, vite`,
                isError: true,
            });
            return;
        }

        // 2. Gate Flag Check: Enforce Task Profile Gates
        if (ctx.taskProfile) {
            const cmdLower = command.toLowerCase();

            // Block dependency installation if disabled
            if (!ctx.taskProfile.needsInstall && (cmdLower.includes('install') || cmdLower.includes('npm i') || cmdLower.includes('npm ci') || cmdLower.includes('pnpm i') || cmdLower.includes('yarn add') || cmdLower.includes('bun add'))) {
                resolve({
                    content: `Security Error: Dependency installation is disabled for the current task profile (${ctx.taskProfile.type}).`,
                    isError: true,
                });
                return;
            }

            // Block TypeScript type check if disabled
            if (!ctx.taskProfile.needsTypeCheck && cmdLower.includes('tsc')) {
                resolve({
                    content: `Security Error: TypeScript type checking is disabled for the current task profile (${ctx.taskProfile.type}).`,
                    isError: true,
                });
                return;
            }

            // Block linting/formatting if disabled
            if (!ctx.taskProfile.needsLint && (cmdLower.includes('lint') || cmdLower.includes('eslint') || cmdLower.includes('biome') || cmdLower.includes('prettier'))) {
                resolve({
                    content: `Security Error: Code linting/formatting is disabled for the current task profile (${ctx.taskProfile.type}).`,
                    isError: true,
                });
                return;
            }

            // Block tests if disabled
            if (!ctx.taskProfile.needsTest && (cmdLower.includes('test') || cmdLower.includes('vitest') || cmdLower.includes('jest'))) {
                resolve({
                    content: `Security Error: Testing is disabled for the current task profile (${ctx.taskProfile.type}).`,
                    isError: true,
                });
                return;
            }
        }

        const cwd = resolvePath((args.cwd as string) || '.', ctx);
        const timeout = (args.timeout as number) || 120_000;

        const cleanEnv = { ...process.env };
        if (cleanEnv.NODE_ENV === 'development') {
            cleanEnv.NODE_ENV = 'production';
        }

        const child = spawn(command, [], {
            cwd,
            shell: true,
            timeout,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: cleanEnv,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
        child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

        child.on('close', (code) => {
            let output = (stdout + (stderr ? '\n' + stderr : '')).trim();
            if (output.length > MAX_COMMAND_OUTPUT_BYTES) {
                output = output.slice(0, MAX_COMMAND_OUTPUT_BYTES) +
                    `\n[... output truncated at ${MAX_COMMAND_OUTPUT_BYTES} bytes]`;
            }
            if (code === 0) {
                resolve({ content: output || 'Command completed successfully (no output)' });
            } else {
                resolve({
                    content: `Command failed (exit ${code}):\n${output}`,
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

function execReadStory(_args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    if (!ctx.storyFile || !existsSync(ctx.storyFile)) {
        return { content: 'No story file configured for this session', isError: true };
    }
    return { content: readFileSync(ctx.storyFile, 'utf-8') };
}

function execReadBlueprint(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    const type = args.type as string;
    switch (type) {
        case 'package_json': {
            const pkgPath = join(ctx.targetDir, 'package.json');
            if (existsSync(pkgPath)) return { content: readFileSync(pkgPath, 'utf-8') };
            return { content: 'No package.json found in target directory' };
        }
        case 'tsconfig': {
            const tsPath = join(ctx.targetDir, 'tsconfig.json');
            if (existsSync(tsPath)) return { content: readFileSync(tsPath, 'utf-8') };
            return { content: 'No tsconfig.json found in target directory' };
        }
        case 'file_tree': {
            const items = listDirRecursive(ctx.targetDir);
            return { content: items.length > 0 ? items.join('\n') : '(target directory is empty)' };
        }
        case 'conventions': {
            const conv = ctx.contextData?.conventions;
            return { content: conv || '(no conventions configured for this project)' };
        }
        case 'knowledge': {
            const kb = ctx.contextData?.knowledge;
            return { content: kb || '(no knowledge base entries available)' };
        }
        default:
            return {
                content: `Unknown blueprint type: "${type}". Valid types: conventions, knowledge, file_tree, package_json, tsconfig`,
                isError: true,
            };
    }
}

function execLogStep(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    const level = (args.level as 'info' | 'warn' | 'error') || 'info';
    const message = args.message as string;
    if (!message) return { content: '"message" is required for log_step', isError: true };
    ctx.logs.push({ level, message });
    return { content: `Logged [${level}]: ${message}` };
}

function execMarkComplete(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    ctx.terminal = true;
    ctx.success = true;
    const summary = (args.summary as string) || 'Build completed';
    ctx.logs.push({ level: 'info', message: `COMPLETE: ${summary}` });
    return { content: `Build marked as complete: ${summary}` };
}

function execMarkFailed(args: Record<string, unknown>, ctx: BuildToolBlueprint): ToolResult {
    ctx.terminal = true;
    ctx.success = false;
    const reason = (args.reason as string) || 'Build failed (no reason given)';
    ctx.logs.push({ level: 'error', message: `FAILED: ${reason}` });
    return { content: `Build marked as failed: ${reason}`, isError: true };
}

// ─── Helpers ─────────────────────────────────────────────

/**
 * Resolve a path — relative paths are resolved against targetDir.
 * An empty string or '.' returns targetDir itself.
 */
/**
 * Verifies that a shell command only runs allowed, safe project executables.
 * Handles sub-command chaining via shell operators (&&, ||, ;, |).
 */
export function isCommandSafe(command: string): boolean {
    const allowedExecutables = [
        'npm', 'npx', 'node', 'tsc', 'eslint', 'biome', 
        'prettier', 'vitest', 'jest', 'git', 'pnpm', 
        'yarn', 'bun', 'next', 'vite'
    ];

    // Split the command into individual statements by shell chaining operators
    const segments = command.split(/&&|\|\||;|\|/);
    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        // Extract the executable (first word of the command segment)
        const firstWord = trimmed.split(/\s+/)[0];
        
        // Remove simple local directory execution prefixes if present (e.g. ./node_modules/.bin/tsc)
        const baseExec = firstWord.replace(/^(\.\/|\.\.\/)+/, '');

        if (!allowedExecutables.some(allowed => baseExec === allowed || baseExec.endsWith('/' + allowed) || baseExec.endsWith('\\' + allowed))) {
            return false;
        }
    }
    return true;
}

/**
 * Resolve a path — relative and absolute paths are strictly resolved and normalized
 * against targetDir to prevent directory traversal and system escapes.
 */
export function resolvePath(path: string, ctx: BuildToolBlueprint): string {
    const targetAbsolute = resolve(ctx.targetDir);
    let resolved: string;

    if (!path || path === '.') {
        resolved = targetAbsolute;
    } else if (path.startsWith('/')) {
        resolved = resolve(path);
    } else {
        resolved = resolve(ctx.targetDir, path);
    }

    // Standardize and normalize to clean up any traversal sequences (e.g. '/../')
    resolved = normalize(resolved);

    // Enforce strict containment within the target directory
    const isContained = resolved === targetAbsolute || resolved.startsWith(targetAbsolute + sep);
    if (!isContained) {
        throw new Error(`Security Error: Access denied. Path "${path}" resolves to "${resolved}", which is outside target directory "${ctx.targetDir}".`);
    }

    return resolved;
}

function listDirRecursive(dir: string, prefix = ''): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === '.factory' ||
            entry.name === '.next' ||
            entry.name === '.vercel' ||
            entry.name === 'dist' ||
            entry.name === 'build' ||
            entry.name === 'out'
        ) {
            continue;
        }
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

// ─── Dynamic MCP Server Tools Discovery & Execution ────────────────

/**
 * Returns OpenAI-format tool definitions for all enabled dynamic MCP tools.
 */
export function getDynamicMcpTools(): any[] {
    const tools: any[] = [];
    try {
        const config = loadMcpConfig();
        if (!config.mcpServers) return tools;
        for (const [serverId, server] of Object.entries<any>(config.mcpServers)) {
            if (server.enabled && Array.isArray(server.tools)) {
                for (const tool of server.tools) {
                    tools.push({
                        name: `mcp__${serverId}__${tool.name}`,
                        description: tool.description || `Dynamic MCP tool from server "${serverId}".`,
                        parameters: tool.inputSchema || {
                            type: 'object',
                            properties: {},
                        },
                    });
                }
            }
        }
    } catch (e) {
        console.error('Failed to get dynamic MCP tools:', e);
    }
    return tools;
}

/**
 * Executes a dynamic MCP tool call over standard I/O transport.
 */
async function execMcpTool(
    name: string,
    args: Record<string, unknown>,
    _ctx: BuildToolBlueprint,
): Promise<ToolResult> {
    const parts = name.split('__');
    if (parts.length < 3) {
        return { content: `Invalid MCP tool name: ${name}`, isError: true };
    }
    const serverId = parts[1];
    const toolName = parts.slice(2).join('__');

    try {
        const config = loadMcpConfig();
        if (!config.mcpServers || !config.mcpServers[serverId]) {
            return { content: `MCP server "${serverId}" not configured.`, isError: true };
        }
        const server = config.mcpServers[serverId];
        if (!server.enabled) {
            return { content: `MCP server "${serverId}" is disabled.`, isError: true };
        }

        const { command, args: serverArgs, env, transport } = server;

        if (transport === 'sse') {
            return { content: 'SSE transport not implemented for direct execution. Please configure standard stdio transport.', isError: true };
        }

        // STDIO execution
        return new Promise((resolve) => {
            try {
                const mergedEnv = { ...process.env, ...(env || {}) };
                const child = spawn(command, serverArgs || [], {
                    env: mergedEnv,
                    shell: true,
                });

                let buffer = '';
                let resolved = false;

                const cleanupAndResolve = (result: ToolResult) => {
                    if (resolved) return;
                    resolved = true;
                    try {
                        child.kill('SIGTERM');
                    } catch {}
                    resolve(result);
                };

                // 15-second safety timeout to avoid blocking LLM pipeline
                const timer = setTimeout(() => {
                    cleanupAndResolve({
                        content: `MCP tool execution timed out after 15 seconds.`,
                        isError: true,
                    });
                }, 15000);

                child.on('error', (err) => {
                    clearTimeout(timer);
                    cleanupAndResolve({
                        content: `Failed to spawn MCP server process: ${err.message}`,
                        isError: true,
                    });
                });

                child.stderr?.on('data', (data) => {
                    console.error(`[MCP ${serverId} STDERR]: ${data.toString()}`);
                });

                child.stdout?.on('data', (chunk) => {
                    buffer += chunk.toString();

                    let newlineIndex;
                    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                        const line = buffer.slice(0, newlineIndex).trim();
                        buffer = buffer.slice(newlineIndex + 1);

                        if (!line) continue;

                        try {
                            const message = JSON.parse(line);

                            // Handle initialize response (id: 1)
                            if (message.id === 1) {
                                if (message.error) {
                                    clearTimeout(timer);
                                    cleanupAndResolve({
                                        content: `Initialize failed: ${JSON.stringify(message.error)}`,
                                        isError: true,
                                    });
                                    return;
                                }

                                // Send initialized notification
                                const initializedNotification = {
                                    jsonrpc: '2.0',
                                    method: 'notifications/initialized',
                                };
                                child.stdin?.write(JSON.stringify(initializedNotification) + '\n');

                                // Send actual tools/call request
                                const callRequest = {
                                    jsonrpc: '2.0',
                                    id: 2,
                                    method: 'tools/call',
                                    params: {
                                        name: toolName,
                                        arguments: args,
                                    },
                                };
                                child.stdin?.write(JSON.stringify(callRequest) + '\n');
                            }

                            // Handle tools/call response (id: 2)
                            else if (message.id === 2) {
                                clearTimeout(timer);
                                if (message.error) {
                                    cleanupAndResolve({
                                        content: `Tool execution failed: ${JSON.stringify(message.error)}`,
                                        isError: true,
                                    });
                                    return;
                                }

                                if (message.result) {
                                    const isError = !!message.result.isError;
                                    let contentText = '';
                                    if (Array.isArray(message.result.content)) {
                                        contentText = message.result.content
                                            .map((c: any) => {
                                                if (c.type === 'text') return c.text;
                                                return JSON.stringify(c);
                                            })
                                            .join('\n');
                                    } else {
                                        contentText = JSON.stringify(message.result);
                                    }
                                    cleanupAndResolve({
                                        content: contentText || 'Tool completed successfully with no output.',
                                        isError: isError || undefined,
                                    });
                                } else {
                                    cleanupAndResolve({
                                        content: `No result returned: ${JSON.stringify(message)}`,
                                        isError: true,
                                    });
                                }
                            }
                        } catch {
                            // Ignore JSON parsing issues for partial chunks
                        }
                    }
                });

                child.on('close', (code) => {
                    clearTimeout(timer);
                    if (!resolved) {
                        cleanupAndResolve({
                            content: `Server exited prematurely with exit code ${code} before response.`,
                            isError: true,
                        });
                    }
                });

                // Write initial initialize request
                const initRequest = {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: {
                            name: 'factory-client',
                            version: '1.0.0',
                        },
                    },
                };

                child.stdin?.write(JSON.stringify(initRequest) + '\n');
            } catch (e: any) {
                resolve({ content: `Failed to execute MCP tool: ${e.message}`, isError: true });
            }
        });
    } catch (err: any) {
        return { content: `Error loading config or executing MCP tool: ${err.message}`, isError: true };
    }
}
