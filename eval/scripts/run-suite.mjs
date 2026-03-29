#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  cleanupEvalWorktrees,
  cleanupWorktree,
  ensureDir,
  loadAllTasks,
  loadModelsConfig,
  loadVariantsConfig,
  normalizeId,
  parseCommandJsonOutput,
  ROOT_DIR,
  RUNS_DIR,
  runCommand,
  timestampId,
  truncateText,
  writeJson
} from './lib.mjs';

function runNodeScript(scriptName, args) {
  const scriptPath = path.join(ROOT_DIR, 'eval', 'scripts', scriptName);
  const result = runCommand(process.execPath, [scriptPath, ...args], { cwd: ROOT_DIR });
  if (!result.ok) {
    throw new Error(
      [
        `Script failed: ${scriptName}`,
        `exitCode=${result.status ?? 'unknown'} signal=${result.signal ?? 'none'}`,
        `stdout:\n${truncateText(result.stdout || '<empty>', 4000)}`,
        `stderr:\n${truncateText(result.stderr || '<empty>', 4000)}`
      ].join('\n')
    );
  }
  return parseCommandJsonOutput(result, `Script ${scriptName}`);
}

const { values } = parseArgs({
  options: {
    task: { type: 'string', multiple: true },
    variant: { type: 'string', multiple: true },
    'suite-dir': { type: 'string' },
    'base-ref': { type: 'string', default: 'HEAD' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help) {
  console.log(JSON.stringify({
    usage: 'node eval/scripts/run-suite.mjs [--task 001-status-enhancement] [--variant router] [--suite-dir eval/runs/<id>] [--base-ref HEAD] [--dry-run]'
  }, null, 2));
  process.exit(0);
}

const modelsConfig = await loadModelsConfig();
const allTasks = await loadAllTasks();
const variants = await loadVariantsConfig();
const selectedTasks = (values.task?.length
  ? allTasks.filter((task) => values.task.includes(task.id))
  : allTasks);
const selectedVariants = (values.variant?.length
  ? variants.filter((variant) => values.variant.includes(variant.id))
  : variants);

if (selectedTasks.length === 0) {
  throw new Error('No matching tasks found.');
}
if (selectedVariants.length === 0) {
  throw new Error('No matching variants found.');
}

const suiteDir = path.resolve(ROOT_DIR, values['suite-dir'] ?? path.join(RUNS_DIR, timestampId()));
await ensureDir(suiteDir);
await ensureDir(path.join(suiteDir, 'results'));

const judgeSelection = runNodeScript('choose-judge-model.mjs', ['--start-model', modelsConfig.implementationStartModel.id]);
const initialWorktreeCleanup = await cleanupEvalWorktrees({
  excludePaths: [path.join(suiteDir, 'worktrees')]
});
const suiteMetadata = {
  suiteDir: path.relative(ROOT_DIR, suiteDir),
  createdAt: new Date().toISOString(),
  baseRef: values['base-ref'],
  dryRun: values['dry-run'],
  startModel: modelsConfig.implementationStartModel,
  judgeSelection,
  initialWorktreeCleanup,
  tasks: selectedTasks.map((task) => task.id),
  variants: selectedVariants.map((variant) => variant.id)
};
await writeJson(path.join(suiteDir, 'suite.json'), suiteMetadata);

const runIndex = [];
for (const task of selectedTasks) {
  for (const variant of selectedVariants) {
    const runDir = path.join(suiteDir, 'results', normalizeId(task.id), normalizeId(variant.id));
    await ensureDir(runDir);
    let prepared = null;
    let pendingError = null;

    try {
      prepared = runNodeScript('prepare-worktree.mjs', [
        '--task', task.id,
        '--variant', variant.id,
        '--run-dir', path.relative(ROOT_DIR, runDir),
        '--suite-dir', path.relative(ROOT_DIR, suiteDir),
        '--base-ref', values['base-ref']
      ]);

      const runResult = runNodeScript('run-variant.mjs', [
        '--task', task.id,
        '--variant', variant.id,
        '--run-dir', path.relative(ROOT_DIR, runDir),
        '--worktree', prepared.worktreeRelativePath,
        '--base-sha', prepared.baseSha,
        '--start-model', modelsConfig.implementationStartModel.id,
        '--reasoning-effort', modelsConfig.implementationStartModel.reasoningEffort ?? 'medium',
        ...(values['dry-run'] ? ['--dry-run'] : [])
      ]);

      const artifacts = runNodeScript('collect-artifacts.mjs', [
        '--run-dir', path.relative(ROOT_DIR, runDir)
      ]);

      const validation = runNodeScript('validate-run.mjs', [
        '--task', task.id,
        '--run-dir', path.relative(ROOT_DIR, runDir),
        '--worktree', prepared.worktreeRelativePath
      ]);

      const score = runNodeScript('score-run.mjs', [
        '--task', task.id,
        '--run-dir', path.relative(ROOT_DIR, runDir),
        '--judge-model', judgeSelection.judgeModel,
        ...(values['dry-run'] ? ['--dry-run'] : [])
      ]);
      const status = runResult.dryRun
        ? 'dry-run'
        : (runResult.timedOut
        ? 'run_timed_out'
        : (validation.timedOut
            ? 'validation_timed_out'
            : (score.judgeTimedOut ? 'judge_timed_out' : (validation.valid === true ? 'completed' : 'failed'))));

      runIndex.push({
        taskId: task.id,
        variantId: variant.id,
        runDir: path.relative(ROOT_DIR, runDir),
        worktree: prepared.worktreeRelativePath,
        status,
        timedOut: runResult.timedOut || validation.timedOut || score.judgeTimedOut,
        runTimedOut: runResult.timedOut ?? false,
        validationTimedOut: validation.timedOut ?? false,
        judgeTimedOut: score.judgeTimedOut ?? false,
        validationValid: validation.valid,
        exitCode: runResult.exitCode,
        scoreSummary: score.parsedJudgeResponse ?? null,
        cost: score.cost ?? null,
        artifactSummary: artifacts
      });
    } catch (error) {
      pendingError = error;
    } finally {
      if (prepared?.worktreePath) {
        try {
          const cleanup = await cleanupWorktree(prepared.worktreePath, {
            allowedRoot: path.join(suiteDir, 'worktrees')
          });
          await writeJson(path.join(runDir, 'cleanup-worktree.json'), cleanup);
        } catch (cleanupError) {
          const combinedMessage = pendingError
            ? `${pendingError.message}\nCleanup error: ${cleanupError.message}`
            : `Cleanup error: ${cleanupError.message}`;
          pendingError = new Error(combinedMessage);
        }
      }
      if (pendingError) {
        throw pendingError;
      }
    }
  }
}

await writeJson(path.join(suiteDir, 'run-index.json'), runIndex);
const suiteSummary = runNodeScript('summarize-suite.mjs', ['--suite-dir', path.relative(ROOT_DIR, suiteDir)]);
console.log(JSON.stringify({ suite: suiteMetadata, summary: suiteSummary }, null, 2));
