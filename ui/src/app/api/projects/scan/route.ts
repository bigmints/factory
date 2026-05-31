import { NextResponse } from 'next/server';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

function detectStack(deps: Record<string, string>, devDeps: Record<string, string>, projectPath: string) {
  const allDeps = { ...deps, ...devDeps };

  if (existsSync(join(projectPath, 'pubspec.yaml'))) {
    return {
      framework: 'flutter',
      packageManager: 'pub',
      linter: 'None',
      testing: 'flutter_test',
    };
  }

  return {
    framework: allDeps['next'] ? 'next.js'
      : allDeps['@remix-run/react'] ? 'remix'
      : (allDeps['react'] || allDeps['react-dom'] || existsSync(join(projectPath, 'vite.config.ts')) || existsSync(join(projectPath, 'vite.config.js'))) ? 'react'
      : 'node',
    packageManager: existsSync(join(projectPath, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(join(projectPath, 'yarn.lock')) ? 'yarn'
      : existsSync(join(projectPath, 'bun.lockb')) ? 'bun'
      : 'npm',
    linter: allDeps['eslint'] ? 'EsLint + Prettier'
      : allDeps['@biomejs/biome'] ? 'Biome'
      : 'None',
    testing: allDeps['vitest'] ? 'vitest'
      : allDeps['jest'] ? 'jest'
      : allDeps['@playwright/test'] ? 'playwright'
      : 'None',
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const repoPath = body.path;

    if (!repoPath || typeof repoPath !== 'string') {
      return NextResponse.json({ error: 'Missing required field: path' }, { status: 400 });
    }

    const isUrl = repoPath.startsWith('http://') || repoPath.startsWith('https://') || repoPath.startsWith('git@');
    if (isUrl) {
      return NextResponse.json({ stack: null });
    }

    const absPath = resolve(repoPath);
    if (!existsSync(absPath)) {
      return NextResponse.json({ error: 'Path does not exist' }, { status: 400 });
    }

    let dependencies: Record<string, string> = {};
    let devDependencies: Record<string, string> = {};

    const pkgPath = join(absPath, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        dependencies = pkg.dependencies || {};
        devDependencies = pkg.devDependencies || {};
      } catch { /* ignore */ }
    } else if (!existsSync(join(absPath, 'pubspec.yaml'))) {
      // If neither package.json nor pubspec.yaml exists, we can't detect a known stack
      return NextResponse.json({ stack: null });
    }

    const stack = detectStack(dependencies, devDependencies, absPath);
    
    return NextResponse.json({ stack });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
