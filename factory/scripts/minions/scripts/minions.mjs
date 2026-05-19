#!/usr/bin/env node

/**
 * minions — YAML prompt queue runner for the pi (Gemini) CLI
 *
 * Usage:
 *   minions --queue <file> [options]
 *
 * Run `minions --help` for full flag reference.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name, defaultVal = null) {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultVal;
  return args[idx + 1] ?? true;
}

const HELP = args.includes('--help') || args.includes('-h');
const DRY_RUN = args.includes('--dry-run');
const CONTINUE_ON_ERROR = args.includes('--continue-on-error');

const queueFile = flag('--queue');
const workdir = flag('--workdir', process.cwd());
const approvalMode = flag('--approval-mode', 'yolo');
const model = flag('--model', null);
const delay = parseInt(flag('--delay', '2'), 10);
const logDir = flag('--log-dir', './runs');

if (HELP) {
  console.log(`
minions — YAML prompt queue runner for the pi (Gemini) CLI

Usage:
  minions --queue <file> [options]

Options:
  --queue <file>           Path to YAML queue file (required)
  --workdir <dir>          Working directory for prompts (default: cwd)
  --approval-mode <mode>   default | auto_edit | yolo (default: yolo)
  --dry-run                Print prompts without running them
  --continue-on-error      Don't abort queue on a failed prompt
  --model <model>          Override Gemini model for all prompts
  --delay <seconds>        Wait between prompts (default: 2)
  --log-dir <dir>          Directory for run logs (default: ./runs)
  --help                   Show this help

Queue file format (YAML):
  queue:
    - name: "Task label"
      prompt: "Full prompt text"
      workdir: /optional/override   # optional
      model: gemini-2.0-flash       # optional
      approval_mode: auto_edit      # optional
`);
  process.exit(0);
}

// ─── Resolve queue file ────────────────────────────────────────────────────────

function findQueueFile() {
  if (queueFile) return resolve(queueFile);
  const candidates = ['queue.yaml', 'prompts.yaml', 'batch.yaml'];
  for (const c of candidates) {
    if (existsSync(c)) return resolve(c);
  }
  // Check .agents/queue/
  const agentQueue = '.agents/queue';
  if (existsSync(agentQueue)) {
    const files = readdirSync(agentQueue).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    if (files.length > 0) return resolve(join(agentQueue, files[0]));
  }
  return null;
}

// ─── YAML parser (uses js-yaml if available, else basic fallback) ──────────────

async function parseQueue(filePath) {
  const content = readFileSync(filePath, 'utf8');
  try {
    const { load } = await import('js-yaml');
    const parsed = load(content);
    return parsed?.queue ?? [];
  } catch {
    console.error(
      'Error: Could not parse queue file. Make sure js-yaml is installed (npm install).'
    );
    process.exit(1);
  }
}

// ─── Detect the CLI binary ────────────────────────────────────────────────────

function detectCLI() {
  for (const bin of ['pi', 'gemini']) {
    const result = spawnSync('which', [bin], { encoding: 'utf8' });
    if (result.status === 0) return bin;
  }
  console.error(`
Error: No compatible CLI found. Install one of:
  - Gemini CLI: https://github.com/google-gemini/gemini-cli (installs as 'gemini' or 'pi')
`);
  process.exit(1);
}

// ─── Run a single prompt ──────────────────────────────────────────────────────

function runPrompt(cli, task, index, total, runLog) {
  const taskWorkdir = task.workdir ? resolve(task.workdir) : resolve(workdir);
  const taskModel = task.model ?? model;
  const taskMode = task.approval_mode ?? approvalMode;

  const cliArgs = ['-p', task.prompt];
  if (taskModel) cliArgs.push('--model', taskModel);
  if (taskMode !== 'default') cliArgs.push('--approval-mode', taskMode);

  console.log(`\n[${index + 1}/${total}] ${task.name}`);
  console.log(`  workdir: ${taskWorkdir}`);
  console.log(`  mode: ${taskMode}`);
  if (taskModel) console.log(`  model: ${taskModel}`);
  console.log(`  prompt: ${task.prompt.slice(0, 120)}${task.prompt.length > 120 ? '…' : ''}`);

  if (DRY_RUN) {
    console.log('  [DRY-RUN — skipping execution]');
    runLog.push({ name: task.name, status: 'dry-run', skipped: true });
    return true;
  }

  const start = Date.now();
  const result = spawnSync(cli, cliArgs, {
    cwd: taskWorkdir,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const success = result.status === 0;

  runLog.push({
    name: task.name,
    status: success ? 'ok' : 'failed',
    exitCode: result.status,
    elapsed: `${elapsed}s`,
  });

  if (!success) {
    console.error(`\n  ✗ Task failed (exit ${result.status}) after ${elapsed}s`);
  } else {
    console.log(`\n  ✓ Done in ${elapsed}s`);
  }

  return success;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const resolvedQueue = findQueueFile();
  if (!resolvedQueue) {
    console.error(
      'Error: No queue file found. Use --queue <file> or create queue.yaml in the project root.'
    );
    process.exit(1);
  }

  const queue = await parseQueue(resolvedQueue);
  if (!queue.length) {
    console.error('Error: Queue is empty.');
    process.exit(1);
  }

  const cli = detectCLI();
  console.log(`\n▶ minions — ${queue.length} task(s) — CLI: ${cli}${DRY_RUN ? ' [DRY-RUN]' : ''}`);
  console.log(`  Queue: ${resolvedQueue}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  mkdirSync(resolve(logDir), { recursive: true });
  const logPath = join(resolve(logDir), `run-${timestamp}.log`);

  const runLog = [];
  let failed = 0;

  for (let i = 0; i < queue.length; i++) {
    const task = queue[i];
    if (!task.name || !task.prompt) {
      console.error(`  Skipping task ${i + 1}: missing 'name' or 'prompt'.`);
      continue;
    }

    const ok = runPrompt(cli, task, i, queue.length, runLog);
    if (!ok) {
      failed++;
      if (!CONTINUE_ON_ERROR) {
        console.error(
          '\nAborting queue due to failure. Use --continue-on-error to skip failed tasks.'
        );
        break;
      }
    }

    if (i < queue.length - 1 && !DRY_RUN) {
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }

  // Write run log
  const summary = {
    queueFile: resolvedQueue,
    ran: runLog.length,
    failed,
    passed: runLog.filter((e) => e.status === 'ok').length,
    tasks: runLog,
  };
  writeFileSync(logPath, JSON.stringify(summary, null, 2));
  console.log(`\nRun log written to: ${logPath}`);
  console.log(`Summary: ${summary.passed} passed, ${summary.failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
