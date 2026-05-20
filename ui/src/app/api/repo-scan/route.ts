import { homedir } from 'node:os';
/**
 * GET /api/repo-scan — Scan the active project's repo for context
 *
 * Returns: stack info, dependencies, file tree, existing specs, tsconfig highlights.
 * Used by the Spec Generator to produce specs that align with the actual codebase.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FACTORY_ROOT = resolve(homedir(), '.factory');

interface RepoScanResult {
  projectName: string;
  projectPath: string;
  stack: {
    framework: string;
    packageManager: string;
    language: string;
    linter?: string;
    testing?: string;
    database?: string;
    cloud?: string;
  };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  tsconfig: Record<string, unknown> | null;
  fileTree: string[];
  existingSpecs: {
    apps: { name: string; yaml: string }[];
    features: { name: string; yaml: string }[];
  };
  agentInstructions: string | null;
  conventions: string[];
  knowledgeFiles: string[];
}

/** Directories to skip during file tree walk */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.factory',
  '.turbo', '.vercel', '.cache', 'coverage', '__pycache__',
]);

/** Walk a directory and collect file paths (max entries) */
function walkDir(dir: string, baseDir: string, max: number): string[] {
  const files: string[] = [];

  function walk(current: string) {
    if (files.length >= max) return;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= max) break;
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          files.push(relative(baseDir, fullPath));
        }
      }
    } catch { /* permission errors */ }
  }

  walk(dir);
  return files.sort();
}

/** Detect stack from package.json dependencies */
function detectStack(deps: Record<string, string>, devDeps: Record<string, string>, projectPath: string) {
  const allDeps = { ...deps, ...devDeps };

  return {
    framework: allDeps['next'] ? 'next.js'
      : allDeps['express'] ? 'express'
      : allDeps['react'] ? 'react'
      : allDeps['vue'] ? 'vue'
      : allDeps['svelte'] ? 'svelte'
      : allDeps['nuxt'] ? 'nuxt'
      : allDeps['fastify'] ? 'fastify'
      : 'unknown',
    packageManager: existsSync(join(projectPath, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(join(projectPath, 'yarn.lock')) ? 'yarn'
      : existsSync(join(projectPath, 'bun.lockb')) ? 'bun'
      : 'npm',
    language: allDeps['typescript'] ? 'typescript' : 'javascript',
    linter: allDeps['eslint'] ? 'eslint'
      : allDeps['biome'] ? 'biome'
      : undefined,
    testing: allDeps['vitest'] ? 'vitest'
      : allDeps['jest'] ? 'jest'
      : allDeps['mocha'] ? 'mocha'
      : undefined,
    database: allDeps['drizzle-orm'] ? 'drizzle'
      : allDeps['prisma'] || allDeps['@prisma/client'] ? 'prisma'
      : allDeps['better-sqlite3'] ? 'sqlite'
      : allDeps['mongoose'] ? 'mongodb'
      : allDeps['pg'] ? 'postgres'
      : allDeps['firebase'] || allDeps['firebase-admin'] ? 'firebase'
      : undefined,
    cloud: allDeps['firebase'] || allDeps['firebase-admin'] ? 'firebase'
      : allDeps['@google-cloud/storage'] ? 'gcp'
      : allDeps['@aws-sdk/client-s3'] ? 'aws'
      : undefined,
  };
}

/** List existing stories in .factory/stories/ or .factory/specs/ — returns name + full YAML content */
function listExistingStories(projectPath: string): { apps: { name: string; yaml: string }[]; features: { name: string; yaml: string }[] } {
  const result = { apps: [] as { name: string; yaml: string }[], features: [] as { name: string; yaml: string }[] };

  let storiesDir = join(projectPath, '.factory', 'stories');
  if (!existsSync(storiesDir)) {
    storiesDir = join(projectPath, '.factory', 'specs');
  }
  if (!existsSync(storiesDir)) return result;

  // App stories
  const appsDir = join(storiesDir, 'apps');
  if (existsSync(appsDir)) {
    result.apps = readdirSync(appsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map(f => {
        try {
          const yaml = readFileSync(join(appsDir, f), 'utf-8');
          const story = parseYaml(yaml);
          return { name: story?.appName || story?.metadata?.name || f.replace(/\.ya?ml$/, ''), yaml };
        } catch {
          return { name: f.replace(/\.ya?ml$/, ''), yaml: '' };
        }
      });
  }

  // Feature stories
  const featuresDir = join(storiesDir, 'features');
  if (existsSync(featuresDir)) {
    result.features = readdirSync(featuresDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map(f => {
        try {
          const yaml = readFileSync(join(featuresDir, f), 'utf-8');
          const story = parseYaml(yaml);
          return { name: story?.feature?.name || story?.metadata?.name || f.replace(/\.ya?ml$/, ''), yaml };
        } catch {
          return { name: f.replace(/\.ya?ml$/, ''), yaml: '' };
        }
      });
  }

  return result;
}

/** Read agents.md from the project — checks root, .factory, and immediate subfolders */
function readAgentInstructions(projectPath: string): string | null {
  const AGENT_FILES = ['AGENTS.md', 'agents.md'];

  // 1. Check root and .factory
  const directCandidates = [
    ...AGENT_FILES.map(f => join(projectPath, f)),
    ...AGENT_FILES.map(f => join(projectPath, '.factory', f)),
  ];
  for (const path of directCandidates) {
    if (existsSync(path)) {
      try { return readFileSync(path, 'utf-8'); } catch { /* ignore */ }
    }
  }

  // 2. Check immediate subdirectories (e.g. ubot-core/AGENTS.md, apps/booking/agents.md)
  try {
    const entries = readdirSync(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      for (const agentFile of AGENT_FILES) {
        const candidate = join(projectPath, entry.name, agentFile);
        if (existsSync(candidate)) {
          try { return readFileSync(candidate, 'utf-8'); } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }

  return null;
}

/** Read conventions and knowledge file content from factory.yaml config */
function readConventionsAndKnowledge(projectPath: string, bridge: any): { conventions: string[]; knowledgeFiles: string[] } {
  const conventions: string[] = [];
  const knowledgeFiles: string[] = [];

  // Conventions from factory.yaml
  if (bridge?.conventions?.agents) {
    const agentsPath = join(projectPath, bridge.conventions.agents);
    if (existsSync(agentsPath)) {
      conventions.push(readFileSync(agentsPath, 'utf-8'));
    }
  }
  if (bridge?.conventions?.rules) {
    const rulesDir = join(projectPath, bridge.conventions.rules);
    if (existsSync(rulesDir)) {
      try {
        const ruleFiles = readdirSync(rulesDir).filter(f => f.endsWith('.md')).sort();
        for (const file of ruleFiles) {
          conventions.push(`--- ${file} ---\n` + readFileSync(join(rulesDir, file), 'utf-8'));
        }
      } catch { /* ignore */ }
    }
  }

  // Knowledge files from factory.yaml skills
  if (bridge?.skills?.files) {
    for (const filePath of bridge.skills.files) {
      const absPath = join(projectPath, filePath);
      if (existsSync(absPath)) {
        knowledgeFiles.push(`--- ${filePath} ---\n` + readFileSync(absPath, 'utf-8'));
      }
    }
  }

  // Build knowledge summaries
  const knowledgeBuildsDir = join(projectPath, '.factory', 'knowledge', 'builds');
  if (existsSync(knowledgeBuildsDir)) {
    try {
      const buildFiles = readdirSync(knowledgeBuildsDir).filter(f => f.endsWith('.md')).sort();
      for (const file of buildFiles) {
        knowledgeFiles.push(`--- builds/${file} ---\n` + readFileSync(join(knowledgeBuildsDir, file), 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  return { conventions, knowledgeFiles };
}

export async function GET() {
  try {
    // Read active project
    const projectsPath = join(FACTORY_ROOT, 'projects.json');
    if (!existsSync(projectsPath)) {
      return Response.json({ error: 'No projects configured' }, { status: 400 });
    }

    const config = JSON.parse(readFileSync(projectsPath, 'utf-8'));
    if (!config.activeProject) {
      return Response.json({ error: 'No active project' }, { status: 400 });
    }

    const project = config.projects?.find((p: any) => p.id === config.activeProject);
    if (!project) {
      return Response.json({ error: 'Active project not found' }, { status: 400 });
    }

    const projectPath = project.path;

    // Read package.json
    let dependencies: Record<string, string> = {};
    let devDependencies: Record<string, string> = {};
    let scripts: Record<string, string> = {};

    const pkgPath = join(projectPath, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        dependencies = pkg.dependencies || {};
        devDependencies = pkg.devDependencies || {};
        scripts = pkg.scripts || {};
      } catch { /* ignore */ }
    }

    // Detect stack
    const stack = detectStack(dependencies, devDependencies, projectPath);

    // Merge with factory.yaml stack if available
    const factoryYaml = join(projectPath, '.factory', 'factory.yaml');
    if (existsSync(factoryYaml)) {
      try {
        const bridge = parseYaml(readFileSync(factoryYaml, 'utf-8'));
        if (bridge?.stack) {
          // factory.yaml takes precedence for explicitly set values
          if (bridge.stack.framework) stack.framework = bridge.stack.framework;
          if (bridge.stack.database) stack.database = bridge.stack.database;
          if (bridge.stack.cloud) stack.cloud = bridge.stack.cloud;
          if (bridge.stack.packageManager) stack.packageManager = bridge.stack.packageManager;
        }
      } catch { /* ignore */ }
    }

    // Read tsconfig.json highlights
    let tsconfig: Record<string, unknown> | null = null;
    const tscPath = join(projectPath, 'tsconfig.json');
    if (existsSync(tscPath)) {
      try {
        const raw = readFileSync(tscPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // Only include the relevant compiler options
        tsconfig = {
          compilerOptions: {
            target: parsed.compilerOptions?.target,
            module: parsed.compilerOptions?.module,
            moduleResolution: parsed.compilerOptions?.moduleResolution,
            jsx: parsed.compilerOptions?.jsx,
            paths: parsed.compilerOptions?.paths,
            baseUrl: parsed.compilerOptions?.baseUrl,
            strict: parsed.compilerOptions?.strict,
          },
        };
      } catch { /* ignore */ }
    }

    // Walk file tree (max 200)
    const fileTree = walkDir(projectPath, projectPath, 200);

    // List existing stories (with full content)
    const existingStories = listExistingStories(projectPath);
    const existingSpecs = existingStories;

    // Read agents.md (mandatory project instructions)
    const agentInstructions = readAgentInstructions(projectPath);

    // Read conventions and knowledge files from factory.yaml
    let bridge: any = null;
    const factoryYamlPath = join(projectPath, '.factory', 'factory.yaml');
    if (existsSync(factoryYamlPath)) {
      try { bridge = parseYaml(readFileSync(factoryYamlPath, 'utf-8')); } catch { /* ignore */ }
    }
    const { conventions, knowledgeFiles } = readConventionsAndKnowledge(projectPath, bridge);

    const result: any = {
      projectName: project.name,
      projectPath,
      stack,
      dependencies,
      devDependencies,
      scripts,
      tsconfig,
      fileTree,
      existingStories,
      existingSpecs,
      agentInstructions,
      conventions,
      knowledgeFiles,
    };

    return Response.json(result);
  } catch (err: any) {
    return Response.json(
      { error: err.message || 'Repo scan failed' },
      { status: 500 }
    );
  }
}
