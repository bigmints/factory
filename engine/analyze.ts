import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getActiveProvider } from './config.ts';
import { callProviderTextOnly, requireActiveProvider } from './generate.ts';
import { detectStack, buildFileTree } from './init.ts';

export async function llmAnalyzeProject(repoPath: string): Promise<{ stack: any; context: any } | null> {
    let provider, model;
    try {
        const active = requireActiveProvider();
        provider = active.provider;
        model = active.model;
    } catch {
        return null;
    }

    const fileTree = buildFileTree(repoPath, 2);

    let readme = '';
    for (const f of ['README.md', 'readme.md', 'README.txt']) {
        const p = join(repoPath, f);
        if (existsSync(p)) {
            readme = readFileSync(p, 'utf-8').slice(0, 3000);
            break;
        }
    }

    let pkg = '';
    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
        pkg = readFileSync(pkgPath, 'utf-8').slice(0, 3000);
    }

    const staticStack = detectStack(repoPath);

    const prompt = `You are an expert software architect analyzing a repository to determine its tech stack and context.

Here is the top-level file structure:
${fileTree.join('\n')}

Here is the package.json (if any):
${pkg}

Here is the README (if any):
${readme}

Our static analysis detected this stack: ${JSON.stringify(staticStack || {})}

Analyze the repository and return a JSON object with EXACTLY this structure:
{
  "stack": {
    "framework": "string (e.g. next.js, remix, react, node, sveltekit, flutter, fastify)",
    "packageManager": "string (e.g. npm, yarn, pnpm, bun, pub)",
    "linter": "string or undefined",
    "testing": "string or undefined"
  },
  "context": {
    "project": {
      "readme_summary": "string (A beautiful, concise 2-3 sentence summary of what the project is)",
      "status": "in-development"
    },
    "key_decisions": [ "string (List any major architectural decisions inferred from deps/files)" ]
  }
}

Respond ONLY with valid JSON, nothing else. No markdown formatting blocks around it.`;

    try {
        const response = await callProviderTextOnly(provider, model, "You are a tech stack analyzer. Output raw JSON.", prompt);
        const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        const cleaned = match ? match[1].trim() : response.trim();
        return JSON.parse(cleaned);
    } catch (err) {
        console.error("LLM Analysis failed:", err);
        return null;
    }
}

export async function buildTpmKnowledge(repoPath: string): Promise<void> {
    let provider, model;
    try {
        const active = requireActiveProvider();
        provider = active.provider;
        model = active.model;
    } catch {
        return;
    }

    const fileTree = buildFileTree(repoPath, 4);

    let readme = '';
    for (const f of ['README.md', 'readme.md', 'README.txt']) {
        const p = join(repoPath, f);
        if (existsSync(p)) {
            readme = readFileSync(p, 'utf-8').slice(0, 5000);
            break;
        }
    }

    let pkg = '';
    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
        pkg = readFileSync(pkgPath, 'utf-8').slice(0, 3000);
    }

    // Load the system skill for TPM Knowledge
    const { getSkill } = await import('./skills.ts');
    const skill = getSkill('tpm-knowledge-builder') || getSkill('TPM Knowledge Builder');
    
    let instructions = `You are an expert Technical Project Manager (TPM). Your goal is to analyze the codebase and produce a comprehensive "TPM Context" document.
This document will be used to understand the project architecture, tech stack, and structure.

Write a comprehensive markdown document that covers:
1. Project Overview (What this project is based on the README and package.json)
2. Tech Stack (Inferred from dependencies)
3. Architecture & Structure (What the main directories/files are for)
4. Potential Focus Areas (What a new developer should look at first)

Format the output strictly as Markdown. Do not wrap the response in a json block.`;

    if (skill) {
        instructions = skill.instructions;
    }

    const prompt = `${instructions}

Here is the file structure (up to depth 4):
${fileTree.join('\n')}

Here is the package.json (if any):
${pkg}

Here is the README (if any):
${readme}
`;

    try {
        const response = await callProviderTextOnly(provider, model, "You are a Technical Project Manager (TPM). Output a comprehensive markdown document.", prompt);
        
        const adrDir = join(repoPath, '.factory', 'knowledge', 'ADRs');
        if (!existsSync(adrDir)) {
            mkdirSync(adrDir, { recursive: true });
        }
        
        // Strip markdown code block wrappers if any
        const match = response.match(/^\s*```(?:markdown)?\s*([\s\S]*?)```\s*$/);
        const cleaned = match ? match[1].trim() : response.trim();
        
        writeFileSync(join(adrDir, '000-tpm-context.md'), cleaned, 'utf-8');
    } catch (err) {
        console.error("TPM Knowledge building failed:", err);
    }
}
