import fs from 'fs';
let content = fs.readFileSync('engine/orchestrate.ts', 'utf-8');

content = content.replace('const toolDefs = ORCHESTRATOR_TOOL_DEFINITIONS.map(t => ({', 'const toolDefs = tpmToolRegistry.getDefinitions().map(t => ({');

fs.writeFileSync('engine/orchestrate.ts', content);
