#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { promises as fs } from 'node:fs';
import {
  cleanupWorktree,
  ensureDir,
  findVariant,
  loadTask,
  loadVariantsConfig,
  pathExists,
  pruneGitWorktrees,
  ROOT_DIR,
  runCommand,
  writeJson
} from './lib.mjs';

const { values } = parseArgs({
  options: {
    task: { type: 'string' },
    variant: { type: 'string' },
    'run-dir': { type: 'string' },
    'suite-dir': { type: 'string' },
    'base-ref': { type: 'string', default: 'HEAD' },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help || !values.task || !values.variant || !values['run-dir']) {
  console.log(JSON.stringify({
    usage: 'node eval/scripts/prepare-worktree.mjs --task <task-id|path> --variant <router|fixed> --run-dir <dir> [--suite-dir <dir>] [--base-ref HEAD]'
  }, null, 2));
  process.exit(values.help ? 0 : 1);
}

const variants = await loadVariantsConfig();
const variant = findVariant(variants, values.variant);
const task = await loadTask(values.task);
const runDir = path.resolve(ROOT_DIR, values['run-dir']);
const suiteDir = path.resolve(ROOT_DIR, values['suite-dir'] ?? path.join(runDir, '..', '..'));
const worktreePath = path.join(suiteDir, 'worktrees', task.id, variant.id);

await ensureDir(path.dirname(worktreePath));
await ensureDir(runDir);

if (await pathExists(worktreePath)) {
  await cleanupWorktree(worktreePath, {
    allowedRoot: path.join(suiteDir, 'worktrees')
  });
}

const initialPrune = pruneGitWorktrees(ROOT_DIR);

const baseShaResult = runCommand('git', ['rev-parse', values['base-ref']], { cwd: ROOT_DIR });
if (!baseShaResult.ok) {
  throw new Error(baseShaResult.stderr || `Unable to resolve ${values['base-ref']}`);
}
const baseSha = baseShaResult.stdout.trim();

const addResult = runCommand('git', ['worktree', 'add', '--detach', worktreePath, baseSha], { cwd: ROOT_DIR });
if (!addResult.ok) {
  throw new Error(addResult.stderr || `git worktree add failed for ${worktreePath}`);
}

const disabledPaths = [];
if (variant.disableRouterInWorktree) {
  for (const relativeTarget of variant.disablePaths ?? []) {
    const absoluteTarget = path.join(worktreePath, relativeTarget);
    if (!(await pathExists(absoluteTarget))) {
      continue;
    }
    const renamedTarget = `${absoluteTarget}.eval-disabled`;
    await fs.rename(absoluteTarget, renamedTarget);
    disabledPaths.push({ original: relativeTarget, renamedTo: path.relative(worktreePath, renamedTarget) });
  }
}

const metadata = {
  taskId: task.id,
  variantId: variant.id,
  worktreePath,
  worktreeRelativePath: path.relative(ROOT_DIR, worktreePath),
  runDir,
  baseRef: values['base-ref'],
  baseSha,
  disabledPaths,
  initialPrune,
  gitWorktreeAdd: {
    stdout: addResult.stdout.trim(),
    stderr: addResult.stderr.trim()
  }
};

await writeJson(path.join(runDir, 'prepare-worktree.json'), metadata);
console.log(JSON.stringify(metadata, null, 2));
