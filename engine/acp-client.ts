import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { spawn, ChildProcess } from 'child_process';
import { Writable, Readable } from 'stream';
import { resolve } from 'path';
import { createWriteStream } from 'fs';

export class AcpAgentAdapter {
    private client: ClientSideConnection;
    private child: ChildProcess;
    private logStream: ReturnType<typeof createWriteStream> | null = null;
    private outputBuffer = '';

    constructor(
        private cwd: string,
        private logPath?: string
    ) {
        if (this.logPath) {
            this.logStream = createWriteStream(this.logPath, { flags: 'a' });
        }

        this.child = spawn('npx', ['-y', 'pi-acp'], {
            cwd: resolve(this.cwd),
            stdio: ['pipe', 'pipe', 'inherit'],
            env: { ...process.env, PI_ACP_ENABLE_EMBEDDED_CONTEXT: 'true' },
            detached: true
        });

        if (!this.child.stdin || !this.child.stdout) {
            throw new Error('Failed to spawn pi-acp with stdio pipes');
        }

        const output = Writable.toWeb(this.child.stdin) as any;
        const input = Readable.toWeb(this.child.stdout) as any;

        const stream = ndJsonStream(output, input);
        
        this.client = new ClientSideConnection((agent) => ({
            sessionUpdate: async (params: any) => {
                if (params.update.sessionUpdate === 'agent_message_chunk') {
                    const text = params.update.content?.text || '';
                    this.appendLog(text);
                } else if (params.update.sessionUpdate === 'tool_call') {
                    this.appendLog(`\n[Tool Call] ${params.update.name} (${JSON.stringify(params.update.arguments)})\n`);
                } else if (params.update.sessionUpdate === 'tool_call_update') {
                     // stream tool call args if supported, ignoring for now
                } else if (params.update.sessionUpdate === 'tool_call_complete') {
                    this.appendLog(`\n[Tool Call Complete] ${params.update.name}\n`);
                }
            }
        }), stream);
    }

    private appendLog(text: string) {
        this.outputBuffer += text;
        if (this.logStream) {
            if (!this.logStream.writableEnded && !this.logStream.destroyed) this.logStream.write(text);
        }
    }

    public async executeTurn(promptText: string): Promise<string> {
        try {
            await this.client.initialize({
                clientInfo: { name: 'factory-tpm', version: '1.0.0' },
                protocolVersion: 1
            });

            this.appendLog(`\n--- Session Initialized ---\n`);

            const sessionResponse = await this.client.newSession({
                cwd: resolve(this.cwd),
                mcpServers: []
            });

            this.appendLog(`--- Session Started (${sessionResponse.sessionId}) ---\n`);

            const promptResponse = await this.client.prompt({
                sessionId: sessionResponse.sessionId,
                prompt: [{ type: 'text', text: promptText }]
            });

            this.appendLog(`\n--- Prompt Finished: ${promptResponse.stopReason} ---\n`);
            if (promptResponse.stopReason === 'error') throw new Error('pi returned error during prompt execution');
            
            return this.outputBuffer;
        } finally {
            this.cleanup();
        }
    }

    public cleanup() {
        if (this.logStream) {
            try { this.logStream.end(); } catch {}
        }
        if (this.child && !this.child.killed) {
            try { process.kill(-this.child.pid!); } catch {}
        }
    }
}
