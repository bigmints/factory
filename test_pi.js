const { spawnSync } = require('child_process');
const { buildCliInvocation, buildSpawnEnv } = require('./engine/cli-adapter.ts');

// Note: Need to run this with tsx since it imports ts files
async function main() {
  const invocation = buildCliInvocation('pi', 'Create a simple react-based counter app. The objective is to test everything.', {});
  console.log('Invocation:', invocation);
  
  const env = buildSpawnEnv();
  
  console.log('Running pi...');
  const child = spawnSync(invocation.binary, invocation.args, {
    cwd: '/Users/pretheesh/experiments/bbrx',
    env,
    stdio: 'inherit'
  });
  
  console.log('Status:', child.status);
}
main();
