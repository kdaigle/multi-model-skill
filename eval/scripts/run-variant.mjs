#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  ensureDir,
  findVariant,
  loadModelsConfig,
  loadTask,
  loadVariantsConfig,
  resolveTimeoutMs,
  ROOT_DIR,
  runCommand,
  truncateText,
  writeJson,
  writeText
} from './lib.mjs';

const { values } = parseArgs({
  options: {
    task: { type: 'string' },
    variant: { type: 'string' },
    'run-dir': { type: 'string' },
    worktree: { type: 'string' },
    'start-model': { type: 'string' },
    'reasoning-effort': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help || !values.task || !values.variant || !values['run-dir'] || !values.worktree) {
  console.log(JSON.stringify({
    usage: 'node eval/scripts/run-variant.mjs --task <task-id|path> --variant <router|fixed> --run-dir <dir> --worktree <dir> [--start-model <id>] [--reasoning-effort medium] [--dry-run]'
  }, null, 2));
  process.exit(values.help ? 0 : 1);
}

const modelsConfig = await loadModelsConfig();
const variants = await loadVariantsConfig();
const variant = findVariant(variants, values.variant);
const task = await loadTask(values.task);
const runDir = path.resolve(ROOT_DIR, values['run-dir']);
const worktreePath = path.resolve(ROOT_DIR, values.worktree);
const startModel = values['start-model'] ?? modelsConfig.implementationStartModel.id;
const reasoningEffort = values['reasoning-effort'] ?? modelsConfig.implementationStartModel.reasoningEffort ?? 'medium';
const timeoutMs = resolveTimeoutMs('copilot', {
  modelsConfig,
  overrideMs: variant.timeoutMs
});

await ensureDir(runDir);

const args = [
  '-p',
  task.prompt,
  '--model',
  startModel,
  '--reasoning-effort',
  reasoningEffort,
  '--output-format',
  'json',
  '--stream',
  'off',
  '--allow-all',
  '--no-ask-user'
];

if (variant.autopilot) {
  args.push('--autopilot');
}
if (variant.experimental) {
  args.push('--experimental');
}
if (variant.includePluginDir) {
  args.push('--plugin-dir', worktreePath);
}

const commandSummary = {
  cwd: worktreePath,
  command: 'copilot',
  args,
  startModel,
  reasoningEffort,
  variantId: variant.id,
  taskId: task.id,
  timeoutMs,
  dryRun: values['dry-run']
};
await writeJson(path.join(runDir, 'run-command.json'), commandSummary);

if (values['dry-run']) {
  const dryRunResult = {
    ...commandSummary,
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorCode: null,
    errorMessage: null,
    stdoutBytes: 0,
    stderrBytes: 0,
    changedFiles: [],
    diffBytes: 0,
    statusPreview: '',
    runStatus: 'dry-run',
    skipped: true,
    reason: 'dry-run',
    dryRun: true
  };
  await writeText(path.join(runDir, 'copilot-output.jsonl'), '');
  await writeText(path.join(runDir, 'copilot-stderr.txt'), '');
  await writeText(path.join(runDir, 'changed-files.txt'), '');
  await writeText(path.join(runDir, 'git-diff.patch'), '');
  await writeText(path.join(runDir, 'git-status.txt'), '');
  await writeJson(path.join(runDir, 'run-result.json'), dryRunResult);
  console.log(JSON.stringify(dryRunResult, null, 2));
  process.exit(0);
}

const runResult = runCommand('copilot', args, { cwd: worktreePath, timeout: timeoutMs });
await writeText(path.join(runDir, 'copilot-output.jsonl'), runResult.stdout);
await writeText(path.join(runDir, 'copilot-stderr.txt'), runResult.stderr);

const changedFilesResult = runCommand('git', ['diff', '--name-only'], { cwd: worktreePath });
const diffResult = runCommand('git', ['diff', '--binary'], { cwd: worktreePath });
const statusResult = runCommand('git', ['status', '--short'], { cwd: worktreePath });

await writeText(path.join(runDir, 'changed-files.txt'), changedFilesResult.stdout);
await writeText(path.join(runDir, 'git-diff.patch'), diffResult.stdout);
await writeText(path.join(runDir, 'git-status.txt'), statusResult.stdout);

const summary = {
  ...commandSummary,
  exitCode: runResult.status,
  signal: runResult.signal,
  timedOut: runResult.timedOut,
  errorCode: runResult.error?.code ?? null,
  errorMessage: runResult.error?.message ?? null,
  stdoutBytes: Buffer.byteLength(runResult.stdout, 'utf8'),
  stderrBytes: Buffer.byteLength(runResult.stderr, 'utf8'),
  changedFiles: changedFilesResult.stdout.split(/\r?\n/).filter(Boolean),
  diffBytes: Buffer.byteLength(diffResult.stdout, 'utf8'),
  statusPreview: truncateText(statusResult.stdout, 1000),
  runStatus: runResult.timedOut ? 'timed_out' : (runResult.ok ? 'completed' : 'failed')
};

await writeJson(path.join(runDir, 'run-result.json'), summary);
console.log(JSON.stringify(summary, null, 2));
