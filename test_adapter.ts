import { buildSpawnEnv, buildCliInvocation } from './engine/cli-adapter.ts';
import { runCliSession } from './engine/cli-session.ts';

async function run() {
    const cwd = '/Users/pretheesh/experiments/bbrx';
    const invocation = buildCliInvocation('pi', 'say hello from the adapter', {});
    console.log('Invocation:', invocation);
    console.log('Env OPENROUTER_API_KEY:', !!buildSpawnEnv().OPENROUTER_API_KEY);
    
    console.log('Running session...');
    const result = await runCliSession({
        id: 'test-session',
        repoPath: cwd,
        storyFile: 'test.md',
        cliName: 'pi',
        prompt: 'say hello from the adapter',
        invocation,
        onUpdate: (msg) => console.log('Update:', msg.length),
    });
    console.log('Result:', result.status, result.reason);
}

run().catch(console.error);
