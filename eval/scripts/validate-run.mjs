#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  loadModelsConfig,
  loadTask,
  matchPathPattern,
  resolveTimeoutMs,
  ROOT_DIR,
  runCommand,
  writeJson
} from './lib.mjs';
import { promises as fs } from 'node:fs';

const { values } = parseArgs({
  options: {
    task: { type: 'string' },
    'run-dir': { type: 'string' },
    worktree: { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help || !values.task || !values['run-dir'] || !values.worktree) {
  console.log(JSON.stringify({ usage: 'node eval/scripts/validate-run.mjs --task <task-id|path> --run-dir <dir> --worktree <dir>' }, null, 2));
  process.exit(values.help ? 0 : 1);
}

const task = await loadTask(values.task);
const modelsConfig = await loadModelsConfig();
const runDir = path.resolve(ROOT_DIR, values['run-dir']);
const worktreePath = path.resolve(ROOT_DIR, values.worktree);
const validation = task.validation ?? {};
const validationTimeoutMs = resolveTimeoutMs('validation', {
  modelsConfig,
  overrideMs: validation.timeoutMs
});
const runSummary = JSON.parse(await fs.readFile(path.join(runDir, 'run-result.json'), 'utf8'));
const artifactSummary = JSON.parse(await fs.readFile(path.join(runDir, 'artifact-summary.json'), 'utf8'));
const changedFiles = artifactSummary.changedFiles ?? [];
const checks = [];

if (runSummary.dryRun) {
  checks.push({
    name: 'dry-run metadata recorded',
    pass: runSummary.skipped === true && runSummary.reason === 'dry-run',
    details: {
      skipped: runSummary.skipped ?? false,
      reason: runSummary.reason ?? null
    }
  });
  checks.push({
    name: 'artifact summary shape',
    pass: Array.isArray(changedFiles) && typeof artifactSummary.gitDiffBytes === 'number',
    details: {
      changedFilesIsArray: Array.isArray(changedFiles),
      gitDiffBytes: artifactSummary.gitDiffBytes ?? null
    }
  });
  const skipped = {
    valid: null,
    skipped: true,
    reason: 'dry-run',
    staticChecksPassed: checks.every((check) => check.pass),
    checks,
    commandResults: [],
    changedFiles,
    worktreePath,
    timedOut: false,
    runTimedOut: false,
    timedOutCommands: [],
    validationTimeoutMs,
    failureMode: null
  };
  await writeJson(path.join(runDir, 'validation.json'), skipped);
  console.log(JSON.stringify(skipped, null, 2));
  process.exit(0);
}

checks.push({
  name: 'copilot command did not time out',
  pass: runSummary.timedOut !== true,
  details: {
    timedOut: runSummary.timedOut ?? false,
    timeoutMs: runSummary.timeoutMs ?? null,
    signal: runSummary.signal ?? null,
    exitCode: runSummary.exitCode ?? null
  }
});

checks.push({
  name: 'copilot exit code',
  pass: runSummary.exitCode === 0,
  details: {
    exitCode: runSummary.exitCode,
    signal: runSummary.signal ?? null,
    timedOut: runSummary.timedOut ?? false
  }
});

if (validation.requireDiff) {
  checks.push({
    name: 'diff exists',
    pass: artifactSummary.gitDiffBytes > 0,
    details: `gitDiffBytes=${artifactSummary.gitDiffBytes}`
  });
}

for (const requiredFile of validation.requiredChangedFiles ?? []) {
  checks.push({
    name: `required changed file ${requiredFile}`,
    pass: changedFiles.includes(requiredFile),
    details: changedFiles
  });
}

for (const prefix of validation.requiredPathPrefixes ?? []) {
  checks.push({
    name: `required changed path prefix ${prefix}`,
    pass: changedFiles.some((filePath) => filePath.startsWith(prefix)),
    details: changedFiles
  });
}

for (const pattern of validation.forbiddenChangedFiles ?? []) {
  checks.push({
    name: `forbidden changed file pattern ${pattern}`,
    pass: !changedFiles.some((filePath) => matchPathPattern(filePath, pattern)),
    details: changedFiles
  });
}

const commandResults = [];
for (const commandSpec of validation.commands ?? []) {
  const commandTimeoutMs = resolveTimeoutMs('validation', {
    modelsConfig,
    overrideMs: commandSpec.timeoutMs ?? validation.timeoutMs
  });
  const commandResult = runCommand(commandSpec.command, commandSpec.args ?? [], {
    cwd: worktreePath,
    shell: commandSpec.shell ?? false,
    timeout: commandTimeoutMs
  });
  commandResults.push({
    name: commandSpec.name ?? `${commandSpec.command} ${(commandSpec.args ?? []).join(' ')}`.trim(),
    pass: commandResult.ok,
    exitCode: commandResult.status,
    signal: commandResult.signal,
    timedOut: commandResult.timedOut,
    timeoutMs: commandTimeoutMs,
    errorCode: commandResult.error?.code ?? null,
    errorMessage: commandResult.error?.message ?? null,
    stdout: commandResult.stdout,
    stderr: commandResult.stderr
  });
  checks.push({
    name: `validation command ${(commandSpec.name ?? commandSpec.command)}`,
    pass: commandResult.ok,
    details: {
      exitCode: commandResult.status,
      signal: commandResult.signal,
      timedOut: commandResult.timedOut,
      timeoutMs: commandTimeoutMs
    }
  });
  checks.push({
    name: `validation command ${(commandSpec.name ?? commandSpec.command)} did not time out`,
    pass: commandResult.timedOut !== true,
    details: {
      timedOut: commandResult.timedOut,
      timeoutMs: commandTimeoutMs,
      signal: commandResult.signal
    }
  });
}

const timedOutCommands = commandResults.filter((result) => result.timedOut).map((result) => result.name);
const runTimedOut = runSummary.timedOut === true;
const result = {
  valid: checks.every((check) => check.pass),
  checks,
  commandResults,
  changedFiles,
  worktreePath,
  timedOut: runTimedOut || timedOutCommands.length > 0,
  runTimedOut,
  timedOutCommands,
  validationTimeoutMs,
  failureMode: runTimedOut
    ? 'run-timed-out'
    : (timedOutCommands.length > 0 ? 'validation-command-timed-out' : null)
};

await writeJson(path.join(runDir, 'validation.json'), result);
console.log(JSON.stringify(result, null, 2));
