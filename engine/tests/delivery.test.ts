import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { changedProductFiles, claimStoryWorktree, DeliveryError, parseGitHubRemote, reconcileStoryDelivery, submitStoryPullRequest } from '../delivery.ts';
import { loadStory, updateStoryExecution, updateStoryStatus } from '../story.ts';

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'factory-delivery-'));
    const remote = join(root, 'remote.git');
    const repo = join(root, 'repo');
    const worktrees = join(root, 'worktrees');
    mkdirSync(repo);
    git(root, 'init', '--bare', remote);
    git(repo, 'init');
    git(repo, 'config', 'user.email', 'factory@example.test');
    git(repo, 'config', 'user.name', 'Factory Test');
    writeFileSync(join(repo, 'README.md'), '# Fixture\n');
    mkdirSync(join(repo, '.factory', 'stories', 'features'), { recursive: true });
    writeFileSync(join(repo, '.factory', 'stories', 'features', 'story-1.md'), '---\nname: Story 1\nkind: feature\nstatus: queued\n---\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'initial');
    git(repo, 'branch', '-M', 'main');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-u', 'origin', 'main');
    return { root, remote, repo, worktrees, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function installClaimGh(root: string, remote: string): string {
    const bin = join(root, 'claim-bin');
    mkdirSync(bin);
    const gh = join(bin, 'gh');
    writeFileSync(gh, `#!/bin/sh
if [ "$1" = "repo" ]; then echo "main"; exit 0; fi
ref=""; sha=""
for arg in "$@"; do
  case "$arg" in ref=*) ref="\${arg#ref=}" ;; sha=*) sha="\${arg#sha=}" ;; esac
done
if git --git-dir="$FAKE_REMOTE" show-ref --verify --quiet "$ref"; then echo "HTTP 422 Reference already exists" >&2; exit 1; fi
git --git-dir="$FAKE_REMOTE" update-ref "$ref" "$sha"
echo "{}"
`);
    chmodSync(gh, 0o755);
    process.env.FAKE_REMOTE = remote;
    return bin;
}

test('parses supported GitHub remote formats', () => {
    assert.equal(parseGitHubRemote('git@github.com:bigmints/factory.git'), 'bigmints/factory');
    assert.equal(parseGitHubRemote('https://github.com/bigmints/factory.git'), 'bigmints/factory');
    assert.equal(parseGitHubRemote('/tmp/repo.git'), null);
});

test('claims an isolated worktree without moving the base checkout', () => {
    const f = fixture();
    try {
        const base = git(f.repo, 'rev-parse', 'HEAD');
        const claim = claimStoryWorktree({ repoPath: f.repo, storyId: 'story-1', worktreeRoot: f.worktrees, remoteClaim: false });
        assert.equal(claim.branch, 'factory/story-story-1');
        assert.equal(git(f.repo, 'branch', '--show-current'), 'main');
        assert.equal(git(claim.worktree, 'branch', '--show-current'), claim.branch);
        assert.equal(git(f.repo, 'rev-parse', 'HEAD'), base);
    } finally { f.cleanup(); }
});

test('resumes the owned worktree after an infrastructure requeue', () => {
    const f = fixture();
    try {
        const first = claimStoryWorktree({ repoPath: f.repo, storyId: 'story-1', worktreeRoot: f.worktrees, remoteClaim: false });
        writeFileSync(join(first.worktree, 'partial.ts'), 'export const partial = true;\n');
        const resumed = claimStoryWorktree({ repoPath: f.repo, storyId: 'story-1', worktreeRoot: f.worktrees, remoteClaim: false });
        assert.equal(resumed.resumed, true);
        assert.equal(resumed.worktree, first.worktree);
        assert.equal(readFileSync(join(resumed.worktree, 'partial.ts'), 'utf-8'), 'export const partial = true;\n');
    } finally { f.cleanup(); }
});

test('requeues an expired build while preserving its owned worktree', () => {
    const f = fixture();
    const storyPath = join(f.repo, '.factory', 'stories', 'features', 'story-1.md');
    try {
        const claim = claimStoryWorktree({ repoPath: f.repo, storyId: 'story-1', worktreeRoot: f.worktrees, remoteClaim: false });
        writeFileSync(join(claim.worktree, 'partial.ts'), 'export const partial = true;\n');
        updateStoryStatus(storyPath, 'running');
        updateStoryExecution(storyPath, {
            executor: 'pi-sdk', model: 'local-model', provider: 'dgx', endpointHost: '127.0.0.1:8000',
            branch: claim.branch, worktree: claim.worktree, baseBranch: claim.baseBranch,
            claimedAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString(), leaseUntil: new Date(1).toISOString(), state: 'building',
        });
        const result = reconcileStoryDelivery(f.repo, storyPath, Date.now());
        assert.equal(result.action, 'requeued');
        assert.equal(loadStory(storyPath).status, 'queued');
        assert.equal(readFileSync(join(claim.worktree, 'partial.ts'), 'utf-8'), 'export const partial = true;\n');
    } finally { f.cleanup(); }
});

test('marks a human-merged pull request done and archives the story', () => {
    const f = fixture();
    const storyPath = join(f.repo, '.factory', 'stories', 'features', 'story-1.md');
    const originalPath = process.env.PATH;
    try {
        const claim = claimStoryWorktree({ repoPath: f.repo, storyId: 'story-1', worktreeRoot: f.worktrees, remoteClaim: false });
        updateStoryStatus(storyPath, 'review');
        updateStoryExecution(storyPath, {
            executor: 'pi-sdk', model: 'local-model', provider: 'dgx', endpointHost: '127.0.0.1:8000',
            branch: claim.branch, worktree: claim.worktree, baseBranch: claim.baseBranch,
            claimedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), leaseUntil: new Date().toISOString(),
            prNumber: 42, prUrl: 'https://github.com/example/repo/pull/42', state: 'review',
        });
        const bin = join(f.root, 'merge-bin');
        mkdirSync(bin);
        const gh = join(bin, 'gh');
        writeFileSync(gh, '#!/bin/sh\necho \'{"state":"MERGED","mergedAt":"2026-07-17T00:00:00Z","url":"https://github.com/example/repo/pull/42"}\'\n');
        chmodSync(gh, 0o755);
        process.env.PATH = `${bin}:${originalPath}`;
        const result = reconcileStoryDelivery(f.repo, storyPath);
        assert.equal(result.action, 'merged');
        assert.equal(loadStory(join(f.repo, '.factory', 'stories', 'done', 'story-1.md')).status, 'done');
    } finally {
        process.env.PATH = originalPath;
        f.cleanup();
    }
});

test('creates the GitHub claim ref before attaching the local worktree', () => {
    const f = fixture();
    const originalPath = process.env.PATH;
    try {
        git(f.repo, 'remote', 'set-url', 'origin', 'https://github.com/example/repo.git');
        git(f.repo, 'config', `url.file://${f.remote}.insteadOf`, 'https://github.com/example/repo.git');
        process.env.PATH = `${installClaimGh(f.root, f.remote)}:${originalPath}`;
        const claim = claimStoryWorktree({ repoPath: f.repo, storyId: 'remote-story', worktreeRoot: f.worktrees });
        assert.equal(git(f.repo, '--git-dir', f.remote, 'rev-parse', `refs/heads/${claim.branch}`), claim.baseSha);
        assert.equal(git(claim.worktree, 'branch', '--show-current'), claim.branch);
    } finally {
        process.env.PATH = originalPath;
        delete process.env.FAKE_REMOTE;
        f.cleanup();
    }
});

test('refuses a claim when product files are already dirty', () => {
    const f = fixture();
    try {
        writeFileSync(join(f.repo, 'README.md'), '# Dirty\n');
        assert.throws(
            () => claimStoryWorktree({ repoPath: f.repo, storyId: 'story-1', worktreeRoot: f.worktrees, remoteClaim: false }),
            (error) => error instanceof DeliveryError && error.code === 'dirty_product',
        );
    } finally { f.cleanup(); }
});

test('submits only product files from the story branch and leaves main untouched', () => {
    const f = fixture();
    const originalPath = process.env.PATH;
    try {
        const claim = claimStoryWorktree({ repoPath: f.repo, storyId: 'story-1', worktreeRoot: f.worktrees, remoteClaim: false });
        mkdirSync(join(claim.worktree, 'src'), { recursive: true });
        writeFileSync(join(claim.worktree, 'src', 'feature.ts'), 'export const delivered = true;\n');
        writeFileSync(join(claim.worktree, '.factory', 'runtime.log'), 'not product\n');
        assert.deepEqual(changedProductFiles(claim.worktree), ['src/feature.ts']);

        const bin = join(f.root, 'bin');
        mkdirSync(bin);
        const gh = join(bin, 'gh');
        writeFileSync(gh, '#!/bin/sh\nif [ "$2" = "list" ]; then echo "[]"; else echo "https://github.com/example/repo/pull/42"; fi\n');
        chmodSync(gh, 0o755);
        process.env.PATH = `${bin}:${originalPath}`;

        const result = submitStoryPullRequest({
            claim,
            storyName: 'Deliver feature',
            verification: {
                status: 'verified', summary: 'verified', evidence: ['lint passed'], missing: [],
                productFilesChanged: true, userReachable: true,
            },
        });
        assert.equal(result.prNumber, 42);
        assert.equal(readFileSync(join(claim.worktree, 'src', 'feature.ts'), 'utf-8'), 'export const delivered = true;\n');
        assert.equal(git(f.repo, 'show', 'main:README.md'), '# Fixture');
        assert.equal(git(f.repo, 'show', `${claim.branch}:src/feature.ts`), 'export const delivered = true;');
        assert.throws(() => git(f.repo, 'show', `${claim.branch}:.factory/runtime.log`));
        const resumedSubmission = submitStoryPullRequest({
            claim,
            storyName: 'Deliver feature',
            verification: {
                status: 'verified', summary: 'verified', evidence: ['lint passed'], missing: [],
                productFilesChanged: true, userReachable: true,
            },
        });
        assert.equal(resumedSubmission.commit, result.commit);
    } finally {
        process.env.PATH = originalPath;
        f.cleanup();
    }
});

test('refuses a delivery that exceeds the configured changed-file budget', () => {
    const f = fixture();
    try {
        const claim = claimStoryWorktree({ repoPath: f.repo, storyId: 'budget-story', worktreeRoot: f.worktrees, remoteClaim: false });
        writeFileSync(join(claim.worktree, 'one.ts'), 'export const one = 1;\n');
        writeFileSync(join(claim.worktree, 'two.ts'), 'export const two = 2;\n');
        assert.throws(() => submitStoryPullRequest({
            claim,
            storyName: 'Budget story',
            verification: { status: 'verified', summary: 'verified', evidence: [], missing: [], productFilesChanged: true, userReachable: false },
            limits: { maxChangedFiles: 1, maxChangedLines: 100 },
        }), /changes 2 files; limit is 1/);
    } finally { f.cleanup(); }
});
