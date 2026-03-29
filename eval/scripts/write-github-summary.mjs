#!/usr/bin/env node
/**
 * Generate GitHub Actions step summary from eval suite results.
 * 
 * Usage:
 *   node eval/scripts/write-github-summary.mjs <router-suite-dir> <fixed-suite-dir>
 * 
 * Environment:
 *   GITHUB_STEP_SUMMARY  – Path where summary should be written
 *   GITHUB_RUN_ID        – Run ID for artifact links
 *   GITHUB_SHA           – Commit SHA
 *   GITHUB_REPOSITORY    – Owner/repo
 *   GITHUB_SERVER_URL    – GitHub server URL (github.com or GHE)
 *   EVAL_SUITE           – Suite name for label
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const [routerDir, fixedDir] = process.argv.slice(2);

if (!routerDir || !fixedDir) {
  console.error('Usage: write-github-summary.mjs <router-dir> <fixed-dir>');
  process.exit(1);
}

const STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;
if (!STEP_SUMMARY) {
  console.error('ERROR: GITHUB_STEP_SUMMARY not set');
  process.exit(1);
}

const runId  = process.env.GITHUB_RUN_ID  || 'unknown';
const ref    = process.env.GITHUB_SHA     || 'unknown';
const repo   = process.env.GITHUB_REPOSITORY || 'unknown';
const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
const suite  = process.env.EVAL_SUITE || 'all';

const artifactBase = `${server}/${repo}/actions/runs/${runId}`;
const lines = [];

const push = (s = '') => lines.push(s);

function loadSummary(dir) {
  const summaryPath = path.join(dir, 'suite-summary.json');
  try {
    if (!fs.existsSync(summaryPath)) return null;
    return JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch (err) {
    console.error(`Failed to load summary from ${dir}:`, err.message);
    return null;
  }
}

const routerSummary = loadSummary(routerDir);
const fixedSummary = loadSummary(fixedDir);

// Header
push('# Eval Harness Results');
push();
push(`**Run:** [${runId}](${artifactBase})`);
push(`**Commit:** \`${ref.slice(0, 8)}\``);
push(`**Suite:** \`${suite}\``);
push();

if (!routerSummary && !fixedSummary) {
  push('> ⚠️  No suite-summary.json found in either run directory.');
  push('> Check the individual job logs for errors.');
} else {
  // Task-by-task results
  if (routerSummary?.tasks && routerSummary.tasks.length > 0) {
    push('## Task Results');
    push();
    push('| Task | Router | Fixed | Verdict | Cost Δ |');
    push('|------|--------|-------|---------|--------|');
    
    for (const task of routerSummary.tasks) {
      const router = task.variants.find((v) => v.variantId === 'router');
      const fixed = task.variants.find((v) => v.variantId === 'fixed');
      
      const routerScore = router?.correctnessScore ?? '—';
      const fixedScore = fixed?.correctnessScore ?? '—';
      const verdict = router?.verdict ?? 'unknown';
      
      let costDelta = '—';
      if (task.comparison?.costDelta !== null && task.comparison?.costDelta !== undefined) {
        const delta = task.comparison.costDelta;
        const sign = delta >= 0 ? '+' : '';
        costDelta = `${sign}${delta.toFixed(1)}%`;
      }
      
      const taskId = task.taskId.replace(/-/g, ' ');
      push(`| ${taskId} | ${routerScore} | ${fixedScore} | ${verdict} | ${costDelta} |`);
    }
    push();
  }
  
  // Summary metrics
  push('## Summary');
  push();
  
  const metrics = [];
  
  if (routerSummary?.timedOutVariantCount !== undefined) {
    const routerTimeouts = routerSummary.timedOutVariantCount;
    const fixedTimeouts = fixedSummary?.timedOutVariantCount ?? 0;
    metrics.push(`- **Timeouts:** Router ${routerTimeouts}, Fixed ${fixedTimeouts}`);
  }
  
  // Judge validation status
  if (routerSummary?.tasks && routerSummary.tasks.length > 0) {
    const allJudges = routerSummary.tasks.flatMap((t) => t.variants);
    const judgesWorking = allJudges.filter((v) => v.judgeModel && v.correctnessScore !== null).length;
    const totalJudges = allJudges.length;
    const successRate = totalJudges > 0 ? ((judgesWorking / totalJudges) * 100).toFixed(0) : '0';
    metrics.push(`- **Judge Validation:** ${judgesWorking}/${totalJudges} (${successRate}%)`);
  }
  
  if (metrics.length > 0) {
    push(metrics.join('\n'));
    push();
  }
  
  // Cost summary if available
  if (routerSummary?.tasks && fixedSummary?.tasks) {
    const routerTasks = routerSummary.tasks.filter((t) => t.comparison?.costDelta !== null);
    if (routerTasks.length > 0) {
      const avgCostDelta = routerTasks.reduce((sum, t) => sum + (t.comparison?.costDelta ?? 0), 0) / routerTasks.length;
      const sign = avgCostDelta >= 0 ? '+' : '';
      push(`📊 **Average Cost Impact:** ${sign}${avgCostDelta.toFixed(1)}%`);
      push();
    }
  }
}

// Artifacts section
push('## Artifacts');
push();
push(`Full eval results are available as artifacts on [this workflow run](${artifactBase}#artifacts):`);
push();
push(`- \`eval-router-${runId}.zip\` — router mode (model-router skill active)`);
push(`- \`eval-fixed-${runId}.zip\` — fixed model baseline`);
push();
push('Each archive contains:');
push('- \`suite-summary.json\` — Full task results, scores, and metrics');
push('- \`suite-summary.txt\` — Human-readable summary');
push('- \`results/*/\` — Individual task runs with logs and validation');
push();
push('**Retention:** 30 days');
push();

// Notes
push('## Notes');
push();
push('- **Token counts** are from model API observations; they exclude CLI overhead, retries, and streaming overhead.');
push('- **Cost index** is relative; convert to actual spend using current model pricing.');
push('- **Judge success rate** = number of judges that completed with valid output / total judges.');
push('- **Cost Δ** = (Router cost - Fixed cost); negative = router saves tokens, positive = fixed saves tokens.');
push();

// Write file
fs.writeFileSync(STEP_SUMMARY, lines.join('\n') + '\n');
console.log(`✅ Step summary written to ${STEP_SUMMARY}`);
