import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DeliveryVerification, StoryExecution } from './types.ts';
import { archiveStory, listStories, loadStory, updateStoryExecution, updateStoryStatus } from './story.ts';

export type DeliveryErrorCode = 'not_git' | 'dirty_product' | 'unsupported_remote' | 'already_claimed' | 'git_failed' | 'verification_failed' | 'submission_failed';

export class DeliveryError extends Error {
    constructor(public readonly code: DeliveryErrorCode, message: string) {
        super(message);
        this.name = 'DeliveryError';
    }
}

export interface DeliveryClaim {
    repoPath: string;
    worktree: string;
    branch: string;
    baseBranch: string;
    baseSha: string;
    resumed: boolean;
}

export interface SubmitResult {
    branch: string;
    commit: string;
    prNumber: number;
    prUrl: string;
    changedFiles: string[];
}

export interface ReconcileResult {
    storyPath: string;
    action: 'none' | 'review' | 'requeued' | 'merged';
    detail: string;
}

function run(cwd: string, command: string, args: string[]): string {
    try {
        return execFileSync(command, args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 }).trim();
    } catch (error: any) {
        const detail = `${error?.stderr || error?.stdout || error?.message || error}`.trim();
        throw new DeliveryError('git_failed', `${command} ${args.join(' ')} failed: ${detail.slice(-2000)}`);
    }
}

function git(cwd: string, args: string[]): string {
    return run(cwd, 'git', args);
}

export function parseGitHubRemote(remote: string): string | null {
    const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    return match ? `${match[1]}/${match[2]}` : null;
}

export function changedProductFiles(repoPath: string): string[] {
    const lines = git(repoPath, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean);
    return lines.map(line => line.slice(3).trim()).map(path => path.includes(' -> ') ? path.split(' -> ').pop()! : path)
        .filter(path => path !== '.factory' && !path.startsWith('.factory/'));
}

function productFilesSince(repoPath: string, baseSha: string): string[] {
    return git(repoPath, ['diff', '--name-only', `${baseSha}..HEAD`]).split('\n').filter(Boolean)
        .filter(path => path !== '.factory' && !path.startsWith('.factory/'));
}

function changedLineCount(repoPath: string, baseSha: string): number {
    return git(repoPath, ['diff', '--numstat', `${baseSha}..HEAD`]).split('\n').filter(Boolean).reduce((total, line) => {
        const [added, deleted] = line.split('\t');
        return total + (Number(added) || 0) + (Number(deleted) || 0);
    }, 0);
}

function currentBranch(repoPath: string): string {
    return git(repoPath, ['branch', '--show-current']) || 'main';
}

function worktreePath(repoPath: string, storyId: string, root?: string): string {
    const base = root || join(dirname(repoPath), `${basename(repoPath)}-worktrees`);
    return resolve(base, storyId);
}

function syncFactoryContext(repoPath: string, worktree: string, storyPath?: string): void {
    const paths = ['.factory/AGENTS.md', '.factory/factory.yaml', '.factory/knowledge', '.factory/blueprint/chronicle.md'];
    if (storyPath) paths.push(relative(repoPath, resolve(storyPath)));
    for (const rel of paths.filter(path => path && !path.startsWith('..'))) {
        const source = join(repoPath, rel);
        if (!existsSync(source)) continue;
        const destination = join(worktree, rel);
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(source, destination, { recursive: true, force: true });
    }
}

function githubBaseBranch(repoPath: string, repository: string): string {
    try { return run(repoPath, 'gh', ['repo', 'view', repository, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']); }
    catch { return currentBranch(repoPath); }
}

function createRemoteClaim(repoPath: string, repository: string, branch: string, sha: string): void {
    try {
        run(repoPath, 'gh', ['api', '--method', 'POST', `repos/${repository}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${sha}`]);
    } catch (error) {
        if (error instanceof DeliveryError && /422|Reference already exists/i.test(error.message)) {
            throw new DeliveryError('already_claimed', `Remote claim ${branch} already exists.`);
        }
        throw error;
    }
}

function removeRemoteClaim(repoPath: string, repository: string, branch: string): void {
    try { run(repoPath, 'gh', ['api', '--method', 'DELETE', `repos/${repository}/git/refs/heads/${branch}`]); } catch { /* best effort rollback */ }
}

export function claimStoryWorktree(options: {
    repoPath: string;
    storyId: string;
    storyPath?: string;
    worktreeRoot?: string;
    remoteClaim?: boolean;
}): DeliveryClaim {
    const repoPath = resolve(options.repoPath);
    try { git(repoPath, ['rev-parse', '--git-dir']); } catch { throw new DeliveryError('not_git', `${repoPath} is not a git repository.`); }
    const dirty = changedProductFiles(repoPath);
    if (dirty.length > 0) throw new DeliveryError('dirty_product', `Product files are dirty before claim: ${dirty.join(', ')}`);
    const branch = `factory/story-${options.storyId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
    const target = worktreePath(repoPath, options.storyId, options.worktreeRoot);
    if (existsSync(target)) {
        const attachedBranch = git(target, ['branch', '--show-current']);
        if (attachedBranch !== branch) throw new DeliveryError('already_claimed', `Worktree ${target} belongs to ${attachedBranch}, not ${branch}.`);
        const baseBranch = currentBranch(repoPath);
        const baseSha = git(target, ['merge-base', 'HEAD', baseBranch]);
        syncFactoryContext(repoPath, target, options.storyPath);
        return { repoPath, worktree: target, branch, baseBranch, baseSha, resumed: true };
    }

    let baseBranch = currentBranch(repoPath);
    let baseSha = git(repoPath, ['rev-parse', 'HEAD']);
    if (options.remoteClaim !== false) {
        const remote = git(repoPath, ['config', '--get', 'remote.origin.url']);
        const repository = parseGitHubRemote(remote);
        if (!repository) throw new DeliveryError('unsupported_remote', 'PR delivery requires a github.com origin remote.');
        baseBranch = githubBaseBranch(repoPath, repository);
        git(repoPath, ['fetch', 'origin', baseBranch]);
        baseSha = git(repoPath, ['rev-parse', `origin/${baseBranch}`]);
        let newRemoteClaim = true;
        try {
            createRemoteClaim(repoPath, repository, branch, baseSha);
        } catch (error) {
            const execution = options.storyPath ? loadStory(options.storyPath).execution : undefined;
            if (!(error instanceof DeliveryError) || error.code !== 'already_claimed' || execution?.branch !== branch) throw error;
            newRemoteClaim = false;
        }
        try {
            git(repoPath, ['fetch', 'origin', `${branch}:${branch}`]);
            git(repoPath, ['worktree', 'add', target, branch]);
        } catch (error) {
            if (newRemoteClaim) removeRemoteClaim(repoPath, repository, branch);
            throw error;
        }
        syncFactoryContext(repoPath, target, options.storyPath);
        return { repoPath, worktree: target, branch, baseBranch, baseSha, resumed: !newRemoteClaim };
    } else {
        git(repoPath, ['worktree', 'add', '-b', branch, target, baseSha]);
    }
    syncFactoryContext(repoPath, target, options.storyPath);
    return { repoPath, worktree: target, branch, baseBranch, baseSha, resumed: false };
}

function assertVerified(verification?: DeliveryVerification): void {
    if (!verification || verification.status !== 'verified' || !verification.productFilesChanged) {
        throw new DeliveryError('verification_failed', 'Refusing submission without verified product-code changes.');
    }
}

function existingPullRequest(worktree: string, branch: string): { number: number; url: string } | null {
    const raw = run(worktree, 'gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url']);
    const rows = JSON.parse(raw || '[]') as Array<{ number: number; url: string }>;
    return rows[0] || null;
}

export function submitStoryPullRequest(options: {
    claim: DeliveryClaim;
    storyName: string;
    verification?: DeliveryVerification;
    limits?: { maxChangedFiles?: number; maxChangedLines?: number };
}): SubmitResult {
    assertVerified(options.verification);
    const uncommitted = changedProductFiles(options.claim.worktree);
    if (uncommitted.length > 0) {
        git(options.claim.worktree, ['add', '--', ...uncommitted]);
        git(options.claim.worktree, ['commit', '-m', `factory: ${options.storyName}`]);
    }
    const commit = git(options.claim.worktree, ['rev-parse', 'HEAD']);
    const files = productFilesSince(options.claim.worktree, options.claim.baseSha);
    if (files.length === 0) throw new DeliveryError('verification_failed', 'No committed or uncommitted product delivery exists on the story branch.');
    const lines = changedLineCount(options.claim.worktree, options.claim.baseSha);
    if (files.length > (options.limits?.maxChangedFiles || 25)) throw new DeliveryError('verification_failed', `Delivery changes ${files.length} files; limit is ${options.limits?.maxChangedFiles || 25}.`);
    if (lines > (options.limits?.maxChangedLines || 2000)) throw new DeliveryError('verification_failed', `Delivery changes ${lines} lines; limit is ${options.limits?.maxChangedLines || 2000}.`);
    git(options.claim.worktree, ['push', 'origin', options.claim.branch]);
    const body = [
        'Factory Pi SDK delivery.', '',
        `- Executor: Pi SDK`,
        `- Product files changed: ${files.length}`,
        `- Changed lines: ${lines}`,
        `- User reachable: ${options.verification!.userReachable ? 'yes' : 'not required or not detected'}`,
        '', 'Verification evidence:',
        ...options.verification!.evidence.slice(0, 12).map(item => `- ${item}`),
        '', 'Human review and merge are required. Factory does not merge autonomously.',
    ].join('\n');
    let pr = existingPullRequest(options.claim.worktree, options.claim.branch);
    if (!pr) {
        const url = run(options.claim.worktree, 'gh', ['pr', 'create', '--base', options.claim.baseBranch, '--head', options.claim.branch, '--title', options.storyName, '--body', body]);
        const match = url.match(/\/pull\/(\d+)/);
        if (!match) throw new DeliveryError('submission_failed', `Could not parse PR URL: ${url}`);
        pr = { number: Number(match[1]), url };
    }
    return { branch: options.claim.branch, commit, prNumber: pr.number, prUrl: pr.url, changedFiles: files };
}

export function startStoryHeartbeat(storyPath: string, execution: StoryExecution, leaseMinutes = 10, intervalMs = 30_000): () => void {
    const beat = () => {
        const now = new Date();
        execution.heartbeatAt = now.toISOString();
        execution.leaseUntil = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
        updateStoryExecution(storyPath, execution);
    };
    beat();
    const timer = setInterval(beat, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
}

function readPullRequest(worktree: string, prNumber: number): { state: string; mergedAt?: string | null; url?: string } | null {
    try {
        const raw = run(worktree, 'gh', ['pr', 'view', String(prNumber), '--json', 'state,mergedAt,url']);
        return JSON.parse(raw) as { state: string; mergedAt?: string | null; url?: string };
    } catch { return null; }
}

export function reconcileStoryDelivery(repoPath: string, storyPath: string, now = Date.now()): ReconcileResult {
    const story = loadStory(storyPath);
    const execution = story.execution;
    if (!execution) return { storyPath, action: 'none', detail: 'No delivery execution metadata.' };
    execution.lastReconciledAt = new Date(now).toISOString();
    const pr = execution.prNumber ? readPullRequest(existsSync(execution.worktree) ? execution.worktree : repoPath, execution.prNumber) : null;
    if (pr?.mergedAt) {
        execution.state = 'merged';
        execution.lastEvent = `Pull request #${execution.prNumber} merged.`;
        updateStoryExecution(storyPath, execution);
        updateStoryStatus(storyPath, 'done', `${execution.lastEvent}\n\n${execution.prUrl || pr.url || ''}`.trim());
        archiveStory(storyPath, repoPath);
        return { storyPath, action: 'merged', detail: execution.lastEvent };
    }
    if (pr?.state === 'OPEN') {
        execution.state = 'review';
        execution.lastEvent = `Pull request #${execution.prNumber} is open for human review.`;
        updateStoryExecution(storyPath, execution);
        updateStoryStatus(storyPath, 'review', execution.lastEvent);
        return { storyPath, action: 'review', detail: execution.lastEvent };
    }
    if (pr?.state === 'CLOSED') {
        execution.state = 'stale';
        execution.lastEvent = `Pull request #${execution.prNumber} closed without merge; owned worktree preserved.`;
        updateStoryExecution(storyPath, execution);
        updateStoryStatus(storyPath, 'queued');
        return { storyPath, action: 'requeued', detail: execution.lastEvent };
    }
    const expired = Number.isFinite(Date.parse(execution.leaseUntil)) && Date.parse(execution.leaseUntil) < now;
    if (story.status === 'running' && expired) {
        const preserved = existsSync(execution.worktree) ? `worktree preserved at ${execution.worktree}` : 'remote claim metadata preserved';
        execution.state = 'stale';
        execution.lastEvent = `Lease expired; ${preserved}.`;
        updateStoryExecution(storyPath, execution);
        updateStoryStatus(storyPath, 'queued');
        return { storyPath, action: 'requeued', detail: execution.lastEvent };
    }
    updateStoryExecution(storyPath, execution);
    return { storyPath, action: 'none', detail: 'Execution remains current.' };
}

export function reconcileProjectDeliveries(repoPath: string, now = Date.now()): ReconcileResult[] {
    const listed = listStories(repoPath);
    return [...listed.apps, ...listed.features].map(file => {
        const storyPath = join(repoPath, '.factory', 'stories', file);
        return reconcileStoryDelivery(repoPath, storyPath, now);
    });
}
