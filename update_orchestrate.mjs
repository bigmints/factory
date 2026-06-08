import fs from 'fs';
let content = fs.readFileSync('engine/orchestrate.ts', 'utf-8');

if (!content.includes("import './tools/tpm/index.ts';")) {
    content = content.replace("import { tpmToolRegistry } from './tools/registry.ts';", "import { tpmToolRegistry } from './tools/registry.ts';\nimport './tools/tpm/index.ts';");
    fs.writeFileSync('engine/orchestrate.ts', content);
}
