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
const modelMentions = [];
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
  for (const leaf of leaves) {
    for (const modelId of modelIds) {
      if (leaf.value.includes(modelId)) {
        modelMentions.push(modelId);
      }
    }
  }
}

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
console.log(JSON.stringify(summary, null, 2));
