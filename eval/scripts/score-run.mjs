#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { promises as fs } from 'node:fs';
import {
  extractJsonObject,
  extractTextLeaves,
  getEffortMultiplier,
  getModelWeight,
  loadModelsConfig,
  loadTask,
  parseJsonLines,
  PROMPTS_DIR,
  resolveTimeoutMs,
  ROOT_DIR,
  runCommand,
  truncateText,
  unique,
  writeJson,
  writeText
} from './lib.mjs';

function deriveObservedUsage(artifactSummary) {
  const rawCandidates = artifactSummary.usageCandidates ?? [];
  const normalized = [];
  for (const candidate of rawCandidates) {
    const value = candidate.value;
    if (!value || typeof value !== 'object') continue;
    const promptTokens = value.promptTokens ?? value.prompt_tokens ?? value.inputTokens ?? value.input_tokens ?? value.input ?? null;
    const completionTokens = value.completionTokens ?? value.completion_tokens ?? value.outputTokens ?? value.output_tokens ?? value.output ?? null;
    const totalTokens = value.totalTokens ?? value.total_tokens ?? value.total ?? null;
    if ([promptTokens, completionTokens, totalTokens].some((entry) => typeof entry === 'number')) {
      normalized.push({
        path: candidate.path,
        promptTokens,
        completionTokens,
        totalTokens: totalTokens ?? [promptTokens, completionTokens].filter((entry) => typeof entry === 'number').reduce((sum, entry) => sum + entry, 0)
      });
    }
  }
  return normalized;
}

function computeRelativeCostIndex({ modelsConfig, artifactSummary, runSummary }) {
  const observedModels = unique([...(artifactSummary.modelMentions ?? []), runSummary.startModel]);
  const effectiveWeight = Math.max(...observedModels.map((modelId) => getModelWeight(modelsConfig, modelId)));
  const routePenalty = 1 + Math.max(0, observedModels.length - 1) * (modelsConfig.relativeCostIndex?.routeSwitchPenalty ?? 0);
  const effortMultiplier = getEffortMultiplier(modelsConfig, runSummary.reasoningEffort);
  const observedUsage = deriveObservedUsage(artifactSummary);

  if (observedUsage.length > 0) {
    const totalTokens = observedUsage.reduce((sum, candidate) => sum + (candidate.totalTokens ?? 0), 0);
    return {
      mode: 'observed_tokens_weighted',
      effectiveWeight,
      routePenalty,
      effortMultiplier,
      observedUsage,
      value: Number((((totalTokens / 1000) || 0.1) * effectiveWeight * routePenalty * effortMultiplier).toFixed(3))
    };
  }

  const visibleUnitBytes = modelsConfig.relativeCostIndex?.visibleUnitBytes ?? 1024;
  const visibleBytes = Math.max(
    artifactSummary.rawStdoutBytes ?? 0,
    (artifactSummary.gitDiffBytes ?? 0) + Buffer.byteLength(artifactSummary.finalResponseSnippet ?? '', 'utf8')
  );

  return {
    mode: 'estimated_visible_artifacts',
    effectiveWeight,
    routePenalty,
    effortMultiplier,
    visibleBytes,
    visibleUnitBytes,
    observedUsage: [],
    value: Number((Math.max(visibleBytes / visibleUnitBytes, 0.1) * effectiveWeight * routePenalty * effortMultiplier).toFixed(3))
  };
}

const { values } = parseArgs({
  options: {
    task: { type: 'string' },
    'run-dir': { type: 'string' },
    'judge-model': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help || !values.task || !values['run-dir'] || !values['judge-model']) {
  console.log(JSON.stringify({ usage: 'node eval/scripts/score-run.mjs --task <task-id|path> --run-dir <dir> --judge-model <id> [--dry-run]' }, null, 2));
  process.exit(values.help ? 0 : 1);
}

const runDir = path.resolve(ROOT_DIR, values['run-dir']);
const task = await loadTask(values.task);
const modelsConfig = await loadModelsConfig();
const runSummary = JSON.parse(await fs.readFile(path.join(runDir, 'run-result.json'), 'utf8'));
const artifactSummary = JSON.parse(await fs.readFile(path.join(runDir, 'artifact-summary.json'), 'utf8'));
const validation = JSON.parse(await fs.readFile(path.join(runDir, 'validation.json'), 'utf8'));
const diffText = await fs.readFile(path.join(runDir, 'git-diff.patch'), 'utf8').catch(() => '');
const judgeTimeoutMs = resolveTimeoutMs('judge', { modelsConfig });
const judgeTemplate = await fs.readFile(path.join(PROMPTS_DIR, 'judge.md'), 'utf8');
const judgePrompt = judgeTemplate
  .replace('{{TASK_JSON}}', JSON.stringify(task, null, 2))
  .replace('{{VALIDATION_JSON}}', JSON.stringify(validation, null, 2))
  .replace('{{RUN_JSON}}', JSON.stringify(runSummary, null, 2))
  .replace('{{ARTIFACT_JSON}}', JSON.stringify(artifactSummary, null, 2))
  .replace('{{CHANGED_FILES_JSON}}', JSON.stringify(artifactSummary.changedFiles ?? [], null, 2))
  .replace('{{GIT_DIFF}}', truncateText(diffText, 20000))
  .replace('{{FINAL_RESPONSE}}', truncateText(artifactSummary.finalResponseSnippet ?? '', 6000));

const cost = computeRelativeCostIndex({ modelsConfig, artifactSummary, runSummary });
const rawPromptPath = path.join(runDir, 'judge-prompt.txt');
await writeText(rawPromptPath, judgePrompt);

if (values['dry-run']) {
  const dryRun = {
    skipped: true,
    reason: 'dry-run',
    judgeModel: values['judge-model'],
    judgeTimedOut: false,
    judgeTimeoutMs,
    status: 'dry-run',
    cost
  };
  await writeJson(path.join(runDir, 'score.json'), dryRun);
  console.log(JSON.stringify(dryRun, null, 2));
  process.exit(0);
}

const judgeArgs = [
  '-p',
  judgePrompt,
  '--model',
  values['judge-model'],
  '--output-format',
  'json',
  '--stream',
  'off',
  '--allow-all',
  '--no-ask-user',
  '--no-custom-instructions'
];

async function invokeJudgeWithRetry(args, options, maxRetries = 2) {
  let lastResult = null;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    console.error(`[Judge] Attempt ${attempt + 1}/${maxRetries + 1}...`);
    try {
      const result = runCommand('copilot', args, options);
      const stdout = result.stdout?.trim() ?? '';
      const hasOutput = stdout.length > 0;
      const isTimeout = result.timedOut || result.signal === 'SIGTERM';

      console.error(`[Judge] Exit code: ${result.status}, Timeout: ${isTimeout}, Output length: ${stdout.length}`);

      if (hasOutput && !isTimeout) {
        return result;
      }

      lastResult = result;
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 3000;
        console.error(`[Judge] Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (err) {
      lastError = err;
      console.error(`[Judge] Error: ${err.message}`);
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 3000;
        console.error(`[Judge] Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  return lastResult ?? { stdout: '', stderr: lastError?.message ?? '', status: null, signal: null, timedOut: false, error: lastError };
}

const judgeResult = await invokeJudgeWithRetry(judgeArgs, {
  cwd: runDir,
  timeout: judgeTimeoutMs
});
await writeText(path.join(runDir, 'judge-output.jsonl'), judgeResult.stdout);
await writeText(path.join(runDir, 'judge-stderr.txt'), judgeResult.stderr);

const outputLength = judgeResult.stdout?.length ?? 0;
const hasOutput = outputLength > 0;
console.error(`[Judge] Output diagnostics: length=${outputLength}, hasOutput=${hasOutput}, status=${judgeResult.status}, timedOut=${judgeResult.timedOut}`);

if (!hasOutput && judgeResult.stderr) {
  console.error(`[Judge] stderr: ${judgeResult.stderr.substring(0, 500)}`);
}

const parsedLines = parseJsonLines(judgeResult.stdout);
const candidateTexts = [];
for (const line of parsedLines) {
  if (!line.value) {
    candidateTexts.push(line.raw);
    continue;
  }
  candidateTexts.push(...extractTextLeaves(line.value).map((entry) => entry.value));
}
candidateTexts.push(judgeResult.stdout);
const extracted = candidateTexts
  .reverse()
  .map((candidate) => extractJsonObject(candidate))
  .find(Boolean)
  ?? null;

const score = {
  judgeModel: values['judge-model'],
  judgeExitCode: judgeResult.status,
  judgeSignal: judgeResult.signal,
  judgeTimedOut: judgeResult.timedOut,
  judgeTimeoutMs,
  judgeErrorCode: judgeResult.error?.code ?? null,
  judgeErrorMessage: judgeResult.error?.message ?? null,
  parsedJudgeResponse: extracted,
  cost,
  validationValid: validation.valid,
  taskId: task.id,
  variantId: runSummary.variantId,
  startModel: runSummary.startModel,
  status: judgeResult.timedOut ? 'timed_out' : (judgeResult.ok ? 'completed' : 'failed')
};

await writeJson(path.join(runDir, 'score.json'), score);
console.log(JSON.stringify(score, null, 2));
