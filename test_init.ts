import { initBridge } from './engine/init.ts';
import { resolve } from 'path';
initBridge(resolve('./test-repo')).then(console.log).catch(console.error);
