#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  extractTextLeaves,
  extractUsageCandidates,
  loadModelsConfig,
  parseJsonLines,
  ROOT_DIR,
  unique,
  writeJson
} from './lib.mjs';
import { promises as fs } from 'node:fs';

const { values } = parseArgs({
  options: {
    'run-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help || !values['run-dir']) {
  console.log(JSON.stringify({ usage: 'node eval/scripts/collect-artifacts.mjs --run-dir <dir>' }, null, 2));
  process.exit(values.help ? 0 : 1);
}

const runDir = path.resolve(ROOT_DIR, values['run-dir']);
const modelsConfig = await loadModelsConfig();
const modelIds = Object.keys(modelsConfig.models);
const rawJsonl = await fs.readFile(path.join(runDir, 'copilot-output.jsonl'), 'utf8').catch(() => '');
const rawStderr = await fs.readFile(path.join(runDir, 'copilot-stderr.txt'), 'utf8').catch(() => '');
const rawDiff = await fs.readFile(path.join(runDir, 'git-diff.patch'), 'utf8').catch(() => '');
const runSummary = JSON.parse(await fs.readFile(path.join(runDir, 'run-result.json'), 'utf8'));
const parsedLines = parseJsonLines(rawJsonl);

const textSnippets = [];
const usageCandidates = [];
let parseableLineCount = 0;
let unparseableLineCount = 0;

for (const line of parsedLines) {
  if (!line.value) {
    unparseableLineCount += 1;
    continue;
  }
  parseableLineCount += 1;
  const leaves = extractTextLeaves(line.value);
  textSnippets.push(...leaves.map((leaf) => ({ line: line.index, ...leaf })));
  usageCandidates.push(...extractUsageCandidates(line.value).map((candidate) => ({ line: line.index, ...candidate })));
}

// Track only the actual model that ran, not all mentions in output.
// This prevents inflating route penalties from model ID mentions in code/docs.
const modelMentions = runSummary.startModel ? [runSummary.startModel] : [];

const finalResponseSnippet = textSnippets
  .filter((entry) => /message|content|text|output/i.test(entry.path))
  .slice(-12)
  .map((entry) => entry.value)
  .join('\n')
  .trim();

const summary = {
  parseableLineCount,
  unparseableLineCount,
  rawStdoutBytes: Buffer.byteLength(rawJsonl, 'utf8'),
  rawStderrBytes: Buffer.byteLength(rawStderr, 'utf8'),
  gitDiffBytes: Buffer.byteLength(rawDiff, 'utf8'),
  changedFiles: runSummary.changedFiles ?? [],
  changedFileCount: (runSummary.changedFiles ?? []).length,
  modelMentions: unique(modelMentions),
  usageCandidates,
  textSnippetCount: textSnippets.length,
  finalResponseSnippet,
  rawArtifactFiles: {
    stdoutJsonl: 'copilot-output.jsonl',
    stderr: 'copilot-stderr.txt',
    diff: 'git-diff.patch'
  }
};

await writeJson(path.join(runDir, 'artifact-summary.json'), summary);

// Build and write a partial routing-trace.json covering the stages completed so far
// (prepareWorktree, copilotRun, collectArtifacts).  summarize-suite.mjs will extend
// this with the validate and score stages once all pipeline steps have run.
const prepMetadata = await fs.readFile(path.join(runDir, 'prepare-worktree.json'), 'utf8')
  .then((text) => JSON.parse(text))
  .catch(() => null);

const traceStages = [];

if (prepMetadata) {
  traceStages.push({
    stage: 'prepareWorktree',
    ok: true,
    taskId: prepMetadata.taskId ?? null,
    variantId: prepMetadata.variantId ?? null,
    baseSha: prepMetadata.baseSha ?? null,
    worktreeRelativePath: prepMetadata.worktreeRelativePath ?? null,
    disabledPathCount: (prepMetadata.disabledPaths ?? []).length
  });
}

const runOk = runSummary.dryRun === true
  ? true
  : (runSummary.exitCode === 0 && !runSummary.timedOut);

traceStages.push({
  stage: 'copilotRun',
  ok: runOk,
  dryRun: runSummary.dryRun ?? false,
  exitCode: runSummary.exitCode ?? null,
  timedOut: runSummary.timedOut ?? false,
  runStatus: runSummary.runStatus ?? null,
  startModel: runSummary.startModel ?? null,
  reasoningEffort: runSummary.reasoningEffort ?? null,
  timeoutMs: runSummary.timeoutMs ?? null,
  stdoutBytes: runSummary.stdoutBytes ?? 0,
  stderrBytes: runSummary.stderrBytes ?? 0,
  changedFileCount: (runSummary.changedFiles ?? []).length,
  changedFiles: runSummary.changedFiles ?? []
});

traceStages.push({
  stage: 'collectArtifacts',
  ok: true,
  parseableLineCount: summary.parseableLineCount,
  unparseableLineCount: summary.unparseableLineCount,
  gitDiffBytes: summary.gitDiffBytes,
  modelMentions: summary.modelMentions,
  usageCandidateCount: (summary.usageCandidates ?? []).length
});

const routingTrace = {
  runDir: values['run-dir'],
  generatedAt: new Date().toISOString(),
  complete: false,
  stages: traceStages
};

await writeJson(path.join(runDir, 'routing-trace.json'), routingTrace);
console.log(JSON.stringify(summary, null, 2));
