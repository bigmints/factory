import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { spawn } from 'child_process';
import { Writable, Readable } from 'stream';

const child = spawn('npx', ['-y', 'pi-acp'], { stdio: ['pipe', 'pipe', 'inherit'] });

const output = Writable.toWeb(child.stdin);
const input = Readable.toWeb(child.stdout);

const stream = ndJsonStream(output, input);

const client = new ClientSideConnection((agent) => ({
    sessionUpdate: (params) => {
        if (params.update.sessionUpdate === 'agent_message_chunk') {
            process.stdout.write(params.update.content?.text || '');
        } else if (params.update.sessionUpdate === 'tool_call') {
            process.stdout.write(`\n[Tool Call] ${params.update.name}\n`);
        }
    }
}), stream);

console.log("Initializing...");
client.initialize({
    clientInfo: { name: 'factory-tpm', version: '1.0.0' },
    protocolVersion: 1
}).then(async res => {
    console.log("Initialized!");
    
    const sessionResponse = await client.newSession({
        clientState: {},
        cwd: process.cwd(),
        mcpServers: []
    });
    console.log("Session ID:", sessionResponse.sessionId);
    
    console.log("Sending prompt...");
    const promptResponse = await client.prompt({
        sessionId: sessionResponse.sessionId,
        prompt: [{ type: 'text', text: 'say hello' }]
    });
    console.log("\nPrompt Response:", promptResponse);
    process.exit(0);
}).catch(e => {
    console.error("Error", e);
    process.exit(1);
});
