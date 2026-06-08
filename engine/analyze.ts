import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
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
