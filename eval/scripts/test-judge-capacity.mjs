#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadModelsConfig, resolveTimeoutMs, runCommand, writeJson } from './lib.mjs';

const { values } = parseArgs({
  options: {
    'start-model': { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help) {
  console.log(JSON.stringify({
    usage: 'node test-judge-capacity.mjs [--start-model claude-sonnet-4.6]'
  }, null, 2));
  process.exit(0);
}

const modelsConfig = await loadModelsConfig();
const judgeModel = values['start-model'] ?? 'claude-sonnet-4.6';
const judgeTimeoutMs = resolveTimeoutMs('judge', { modelsConfig });

const testSizes = [
  { name: '50KB', textLength: 50 * 1024 },
  { name: '100KB', textLength: 100 * 1024 },
  { name: '200KB', textLength: 200 * 1024 },
  { name: '300KB', textLength: 300 * 1024 }
];

const results = [];

for (const testCase of testSizes) {
  const padding = 'x'.repeat(testCase.textLength);
  const prompt = `Analyze this large prompt and respond with {"result": "ok"}.\n\n${padding}`;

  console.error(`[Capacity Test] Testing ${testCase.name} (${prompt.length} bytes)...`);

  const start = Date.now();
  const judgeArgs = [
    '-p',
    prompt,
    '--model',
    judgeModel,
    '--output-format',
    'json',
    '--stream',
    'off',
    '--allow-all',
    '--no-ask-user',
    '--no-custom-instructions'
  ];

  const judgeResult = runCommand('copilot', judgeArgs, {
    cwd: process.cwd(),
    timeout: judgeTimeoutMs
  });

  const elapsed = Date.now() - start;

  const success = !judgeResult.timedOut && judgeResult.status === 0 && (judgeResult.stdout?.length ?? 0) > 0;

  results.push({
    testSize: testCase.name,
    promptLengthBytes: prompt.length,
    responseLength: judgeResult.stdout?.length ?? 0,
    elapsedMs: elapsed,
    timeoutMs: judgeTimeoutMs,
    exitCode: judgeResult.status,
    timedOut: judgeResult.timedOut,
    signal: judgeResult.signal,
    success,
    errorCode: judgeResult.error?.code ?? null,
    errorMessage: judgeResult.error?.message ?? null
  });

  console.error(`[Capacity Test] ${testCase.name}: success=${success}, elapsed=${elapsed}ms, response=${judgeResult.stdout?.length ?? 0} bytes`);
}

console.log(JSON.stringify({
  judgeModel,
  judgeTimeoutMs,
  results
}, null, 2));
