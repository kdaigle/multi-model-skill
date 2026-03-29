import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const EVAL_DIR = path.join(ROOT_DIR, 'eval');
export const CONFIG_DIR = path.join(EVAL_DIR, 'config');
export const TASKS_DIR = path.join(EVAL_DIR, 'tasks');
export const PROMPTS_DIR = path.join(EVAL_DIR, 'prompts');
export const RUNS_DIR = path.join(EVAL_DIR, 'runs');
const DEFAULT_TIMEOUTS_MS = Object.freeze({
  copilotMs: 15 * 60 * 1000,
  judgeMs: 10 * 60 * 1000,
  validationMs: 2 * 60 * 1000
});
const TIMEOUT_ENV_KEYS = Object.freeze({
  copilot: ['EVAL_COPILOT_TIMEOUT_MS', 'EVAL_TIMEOUT_MS'],
  judge: ['EVAL_JUDGE_TIMEOUT_MS', 'EVAL_TIMEOUT_MS'],
  validation: ['EVAL_VALIDATION_TIMEOUT_MS', 'EVAL_TIMEOUT_MS']
});

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value, 'utf8');
}

export function normalizeTimeoutMs(value, label = 'timeout') {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number of milliseconds.`);
  }
  if (parsed === 0) {
    return null;
  }
  return Math.floor(parsed);
}

export function resolveTimeoutMs(kind, options = {}) {
  const env = options.env ?? process.env;
  for (const envKey of TIMEOUT_ENV_KEYS[kind] ?? []) {
    if (env[envKey] !== undefined) {
      return normalizeTimeoutMs(env[envKey], envKey);
    }
  }

  if (options.overrideMs !== undefined) {
    return normalizeTimeoutMs(options.overrideMs, `${kind} timeout`);
  }

  const configKey = `${kind}Ms`;
  if (options.modelsConfig?.timeouts?.[configKey] !== undefined) {
    return normalizeTimeoutMs(options.modelsConfig.timeouts[configKey], `modelsConfig.timeouts.${configKey}`);
  }

  return DEFAULT_TIMEOUTS_MS[configKey] ?? null;
}

export function runCommand(command, args = [], options = {}) {
  const timeoutMs = normalizeTimeoutMs(options.timeout, `timeout for ${command}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT_DIR,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 100,
    shell: options.shell ?? false,
    timeout: timeoutMs ?? undefined,
    input: options.input ?? undefined
  });
  const error = result.error ? {
    code: result.error.code ?? null,
    errno: result.error.errno ?? null,
    syscall: result.error.syscall ?? null,
    message: result.error.message ?? String(result.error)
  } : null;

  return {
    ok: result.status === 0 && !result.error,
    status: result.status ?? null,
    signal: result.signal ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error,
    timedOut: error?.code === 'ETIMEDOUT',
    timeoutMs,
    command,
    args
  };
}

export function relativePath(targetPath) {
  return path.relative(ROOT_DIR, targetPath) || '.';
}

export function timestampId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export async function loadModelsConfig() {
  return readJson(path.join(CONFIG_DIR, 'models.json'));
}

export async function loadVariantsConfig() {
  return readJson(path.join(CONFIG_DIR, 'variants.json'));
}

export async function loadTask(taskIdOrPath) {
  const resolvedPath = taskIdOrPath.endsWith('.json')
    ? path.resolve(ROOT_DIR, taskIdOrPath)
    : path.join(TASKS_DIR, `${taskIdOrPath}.json`);
  return readJson(resolvedPath);
}

export async function loadAllTasks() {
  const entries = await fs.readdir(TASKS_DIR);
  const taskFiles = entries.filter((name) => name.endsWith('.json')).sort();
  return Promise.all(taskFiles.map((name) => readJson(path.join(TASKS_DIR, name))));
}

export function getModelMeta(modelsConfig, modelId) {
  return modelsConfig.models[modelId] ?? null;
}

export function getModelFamily(modelsConfig, modelId) {
  return getModelMeta(modelsConfig, modelId)?.family ?? 'unknown';
}

export function getModelWeight(modelsConfig, modelId) {
  return getModelMeta(modelsConfig, modelId)?.relativeWeight
    ?? modelsConfig.relativeCostIndex?.fallbackModelWeight
    ?? 1;
}

export function getEffortMultiplier(modelsConfig, effort) {
  if (!effort) return 1;
  return modelsConfig.relativeCostIndex?.effortMultipliers?.[effort] ?? 1;
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function truncateText(value, maxChars) {
  if (!value || value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n... [truncated ${value.length - maxChars} chars]`;
}

export function isSubpath(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function assertSubpath(parentPath, targetPath, label = 'path') {
  if (!isSubpath(parentPath, targetPath)) {
    throw new Error(`Refusing to operate on ${label} outside ${parentPath}: ${targetPath}`);
  }
}

export function normalizeId(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function findVariant(variants, variantId) {
  const match = variants.find((variant) => variant.id === variantId);
  if (!match) {
    throw new Error(`Unknown variant: ${variantId}`);
  }
  return match;
}

export function matchPathPattern(filePath, pattern) {
  if (!pattern.includes('*')) {
    return filePath === pattern;
  }
  if (pattern.endsWith('/**')) {
    return filePath.startsWith(pattern.slice(0, -3));
  }
  if (pattern.startsWith('**/')) {
    return filePath.endsWith(pattern.slice(3));
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(filePath);
}

function walkObject(value, visit, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkObject(entry, visit, [...pathParts, index]));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      walkObject(entry, visit, [...pathParts, key]);
    }
    return;
  }
  visit(value, pathParts);
}

export function extractTextLeaves(value) {
  const leaves = [];
  walkObject(value, (entry, pathParts) => {
    if (typeof entry === 'string' && entry.trim()) {
      leaves.push({ path: pathParts.join('.'), value: entry });
    }
  });
  return leaves;
}

export function extractUsageCandidates(value) {
  const candidates = [];
  function scan(entry, pathParts = []) {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const keys = Object.keys(entry);
    const usageish = keys.some((key) => /usage|token|cost|input|output/i.test(key));
    if (usageish) {
      candidates.push({ path: pathParts.join('.'), value: entry });
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => scan(item, [...pathParts, index]));
      return;
    }
    for (const [key, child] of Object.entries(entry)) {
      scan(child, [...pathParts, key]);
    }
  }
  scan(value, []);
  return candidates;
}

export function extractJsonObject(text) {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

export function parseCommandJsonOutput(result, label) {
  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error(`${label} produced no JSON on stdout.\nstderr:\n${truncateText(result.stderr || '<empty>', 4000)}`);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    const extracted = extractJsonObject(stdout);
    if (extracted !== null) {
      return extracted;
    }
  }

  throw new Error(
    [
      `${label} did not emit valid JSON.`,
      `exitCode=${result.status ?? 'unknown'} signal=${result.signal ?? 'none'}`,
      `stdout:\n${truncateText(stdout, 4000)}`,
      `stderr:\n${truncateText(result.stderr || '<empty>', 4000)}`
    ].join('\n')
  );
}

export function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => line.trim())
    .map(({ line, index }) => {
      try {
        return { index, value: JSON.parse(line), raw: line };
      } catch {
        return { index, value: null, raw: line };
      }
    });
}

export function pruneGitWorktrees(cwd = ROOT_DIR) {
  const result = runCommand('git', ['worktree', 'prune', '--verbose'], { cwd });
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || 'git worktree prune failed');
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

export function listGitWorktrees(cwd = ROOT_DIR) {
  const result = runCommand('git', ['worktree', 'list', '--porcelain'], { cwd });
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || 'git worktree list failed');
  }

  const entries = [];
  let current = null;
  for (const rawLine of result.stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (current) {
        entries.push(current);
      }
      current = { path: path.resolve(cwd, line.slice('worktree '.length).trim()) };
      continue;
    }
    if (!current) {
      continue;
    }
    const firstSpace = line.indexOf(' ');
    if (firstSpace === -1) {
      current[line] = true;
      continue;
    }
    const key = line.slice(0, firstSpace);
    const value = line.slice(firstSpace + 1).trim();
    current[key] = value;
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

export async function cleanupWorktree(worktreePath, options = {}) {
  const absoluteWorktreePath = path.resolve(worktreePath);
  const allowedRoot = path.resolve(options.allowedRoot ?? RUNS_DIR);
  assertSubpath(allowedRoot, absoluteWorktreePath, 'worktree');

  const registered = listGitWorktrees(options.cwd ?? ROOT_DIR)
    .some((entry) => entry.path === absoluteWorktreePath);

  let removedFromGit = false;
  if (registered) {
    const removeResult = runCommand('git', ['worktree', 'remove', '--force', absoluteWorktreePath], {
      cwd: options.cwd ?? ROOT_DIR
    });
    if (!removeResult.ok) {
      throw new Error(removeResult.stderr || removeResult.stdout || `git worktree remove failed for ${absoluteWorktreePath}`);
    }
    removedFromGit = true;
  }

  const existedOnDisk = await pathExists(absoluteWorktreePath);
  if (existedOnDisk) {
    await fs.rm(absoluteWorktreePath, { recursive: true, force: true });
  }

  const pruneResult = options.prune === false
    ? null
    : pruneGitWorktrees(options.cwd ?? ROOT_DIR);

  return {
    worktreePath: absoluteWorktreePath,
    removedFromGit,
    removedFromDisk: existedOnDisk,
    pruned: pruneResult !== null,
    pruneStdout: pruneResult?.stdout ?? '',
    pruneStderr: pruneResult?.stderr ?? ''
  };
}

export async function cleanupEvalWorktrees(options = {}) {
  const cwd = options.cwd ?? ROOT_DIR;
  const allowedRoot = path.resolve(options.allowedRoot ?? RUNS_DIR);
  const excludedPaths = (options.excludePaths ?? []).map((entry) => path.resolve(entry));
  const cleanupResults = [];

  for (const entry of listGitWorktrees(cwd)) {
    if (!isSubpath(allowedRoot, entry.path)) {
      continue;
    }
    if (excludedPaths.some((excludedPath) => isSubpath(excludedPath, entry.path))) {
      continue;
    }
    cleanupResults.push(await cleanupWorktree(entry.path, {
      cwd,
      allowedRoot,
      prune: false
    }));
  }

  const pruneResult = options.prune === false ? null : pruneGitWorktrees(cwd);
  return {
    cleanedWorktrees: cleanupResults,
    pruned: pruneResult !== null,
    pruneStdout: pruneResult?.stdout ?? '',
    pruneStderr: pruneResult?.stderr ?? ''
  };
}
