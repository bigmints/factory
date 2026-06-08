const fs = require('fs');

function rewrite() {
  const content = fs.readFileSync('engine/tools/fs.ts', 'utf-8');
  let newContent = content.replace(/export const TOOL_DEFINITIONS = \[([\s\S]*?)\] as const;/g, 'const TOOL_DEFINITIONS = [$1];');
  
  // We want to replace the switch statement in executeTool with registry calls
  newContent = `import { workerToolRegistry } from './registry.ts';
import { AgentTool, ToolResult } from './types.ts';

` + newContent;

  fs.writeFileSync('engine/tools/fs.ts', newContent);
}
rewrite();
