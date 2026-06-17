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
            console.log("UPDATE:", params.update.sessionUpdate, params.update.name || '');
        }
    }), ndJsonStream(Writable.toWeb(child.stdin) as any, Readable.toWeb(child.stdout) as any));
    
    await client.initialize({ clientInfo: { name: 'test', version: '1.0' }, protocolVersion: 1 });
    const session = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
    
    console.log("Sending prompt...");
    let res = await client.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: "Run `echo 'hello loop'` in bash." }]
    });
    console.log("Prompt 1 returned:", res.stopReason);
    if (res.stopReason === 'toolUse') {
        console.log("Waiting to see if it continues autonomously...");
        setTimeout(async () => {
             console.log("Prompting again with empty?");
             let res2 = await client.prompt({
                sessionId: session.sessionId,
                prompt: [] // what to send?
             });
             console.log("Prompt 2 returned:", res2.stopReason);
        }, 2000);
    }
    
}
main();
