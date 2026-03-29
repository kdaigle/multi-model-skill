#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { promises as fs } from 'node:fs';
import { ROOT_DIR, writeJson, writeText } from './lib.mjs';

const { values } = parseArgs({
  options: {
    'suite-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help || !values['suite-dir']) {
  console.log(JSON.stringify({ usage: 'node eval/scripts/summarize-suite.mjs --suite-dir <dir>' }, null, 2));
  process.exit(values.help ? 0 : 1);
}

const suiteDir = path.resolve(ROOT_DIR, values['suite-dir']);
const resultsDir = path.join(suiteDir, 'results');
const taskIds = (await fs.readdir(resultsDir).catch(() => [])).sort();
const tasks = [];

function deriveVariantStatus(runResult, validation, score) {
  if (runResult.dryRun || score.skipped) {
    return 'dry-run';
  }
  if (runResult.timedOut) {
    return 'run_timed_out';
  }
  if (validation.timedOut) {
    return validation.runTimedOut ? 'run_timed_out' : 'validation_timed_out';
  }
  if (score.judgeTimedOut) {
    return 'judge_timed_out';
  }
  return validation.valid === true && runResult.exitCode === 0 ? 'completed' : 'failed';
}

for (const taskId of taskIds) {
  const taskDir = path.join(resultsDir, taskId);
  const variantIds = (await fs.readdir(taskDir).catch(() => [])).sort();
  const variants = [];
  for (const variantId of variantIds) {
    const runDir = path.join(taskDir, variantId);
    const runResult = JSON.parse(await fs.readFile(path.join(runDir, 'run-result.json'), 'utf8'));
    const validation = JSON.parse(await fs.readFile(path.join(runDir, 'validation.json'), 'utf8'));
    const score = JSON.parse(await fs.readFile(path.join(runDir, 'score.json'), 'utf8'));
    const status = deriveVariantStatus(runResult, validation, score);
    const timedOut = Boolean(runResult.timedOut || validation.timedOut || score.judgeTimedOut);
    const timeoutStages = [
      runResult.timedOut ? 'run' : null,
      validation.timedOut && !validation.runTimedOut ? 'validation' : null,
      score.judgeTimedOut ? 'judge' : null
    ].filter(Boolean);
    variants.push({
      variantId,
      runDir: path.relative(ROOT_DIR, runDir),
      status,
      timedOut,
      timeoutStages,
      exitCode: runResult.exitCode,
      signal: runResult.signal ?? null,
      changedFiles: runResult.changedFiles,
      validationValid: validation.valid,
      validationFailureMode: validation.failureMode ?? null,
      correctnessScore: score.parsedJudgeResponse?.correctnessScore ?? null,
      completenessScore: score.parsedJudgeResponse?.completenessScore ?? null,
      minimalityScore: score.parsedJudgeResponse?.minimalityScore ?? null,
      verdict: score.parsedJudgeResponse?.verdict ?? null,
      relativeCostIndex: score.cost?.value ?? null,
      costMode: score.cost?.mode ?? null,
      judgeModel: score.judgeModel,
      startModel: score.startModel,
      judgeTimedOut: score.judgeTimedOut ?? false
    });
  }

  const router = variants.find((entry) => entry.variantId === 'router');
  const fixed = variants.find((entry) => entry.variantId === 'fixed');
  tasks.push({
    taskId,
    variants,
    comparison: router && fixed ? {
      correctnessDelta: router.correctnessScore !== null && fixed.correctnessScore !== null
        ? router.correctnessScore - fixed.correctnessScore
        : null,
      costDelta: router.relativeCostIndex !== null && fixed.relativeCostIndex !== null
        ? router.relativeCostIndex - fixed.relativeCostIndex
        : null,
      routerVerdict: router.verdict,
      fixedVerdict: fixed.verdict,
      routerStatus: router.status,
      fixedStatus: fixed.status,
      routerTimedOut: router.timedOut,
      fixedTimedOut: fixed.timedOut
    } : null
  });
}

const summary = {
  suiteDir: path.relative(ROOT_DIR, suiteDir),
  generatedAt: new Date().toISOString(),
  taskCount: tasks.length,
  timedOutVariantCount: tasks.reduce((count, task) => count + task.variants.filter((variant) => variant.timedOut).length, 0),
  tasks
};

await writeJson(path.join(suiteDir, 'suite-summary.json'), summary);
const textSummary = [
  `Suite: ${summary.suiteDir}`,
  ...tasks.map((task) => {
    const pieces = task.variants.map((variant) => {
      const timeoutLabel = variant.timeoutStages.length > 0 ? variant.timeoutStages.join('+') : 'none';
      return `${variant.variantId}: status=${variant.status}, timeout=${timeoutLabel}, verdict=${variant.verdict ?? 'n/a'}, correctness=${variant.correctnessScore ?? 'n/a'}, cost=${variant.relativeCostIndex ?? 'n/a'} (${variant.costMode ?? 'n/a'})`;
    });
    return `${task.taskId} -> ${pieces.join(' | ')}`;
  })
].join('\n');
await writeText(path.join(suiteDir, 'suite-summary.txt'), `${textSummary}\n`);
console.log(JSON.stringify(summary, null, 2));
