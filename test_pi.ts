import { spawnSync } from 'child_process';
import { buildCliInvocation, buildSpawnEnv } from './engine/cli-adapter.ts';

async function main() {
  const invocation = buildCliInvocation('pi', 'say hello. testing pi adapter again.', {});
  console.log('Invocation:', invocation);
  
  const env = buildSpawnEnv();
  
  console.log('Running pi...');
  const child = spawnSync(invocation.binary, invocation.args, {
    cwd: '/Users/pretheesh/experiments/bbrx',
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    input: '',
    encoding: 'utf8'
  });
  
  console.log('STDOUT:', child.stdout);
  console.log('STDERR:', child.stderr);
  console.log('Status:', child.status);
}
main();
