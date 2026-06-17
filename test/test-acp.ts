import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { spawn } from 'child_process';
import { Writable, Readable } from 'stream';

async function main() {
    const child = spawn('npx', ['-y', 'pi-acp'], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, PI_ACP_ENABLE_EMBEDDED_CONTEXT: 'true' }
    });
    
    const client = new ClientSideConnection((agent) => ({
        sessionUpdate: async (params: any) => {
            console.log("UPDATE:", JSON.stringify(params));
        }
    }), ndJsonStream(Writable.toWeb(child.stdin) as any, Readable.toWeb(child.stdout) as any));
    
    await client.initialize({ clientInfo: { name: 'test', version: '1.0' }, protocolVersion: 1 });
    const session = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
    
    console.log("Sending prompt...");
    let res = await client.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: "Create a file named hello.txt containing 'hello world' in the current directory." }]
    });
    console.log("Prompt returned:", res.stopReason);
    
    setTimeout(() => {
        child.kill();
        process.exit(0);
    }, 2000);
}
main();
