# CI/CD Configuration for Eval Suite

This document describes how the eval suite is configured to run reliably in GitHub Actions and locally.

## Timeout Configuration

### System Defaults (lib.mjs)

All timeouts are configured in `eval/scripts/lib.mjs`:

- **Copilot run timeout:** 15 minutes (900,000 ms)
- **Judge timeout:** 10 minutes (600,000 ms)
- **Validation timeout:** 2 minutes (120,000 ms)

These are the default values used when a task does not override them.

### Task-Specific Overrides

Complex tasks can override timeouts in their task JSON definition. Timeouts are applied with this precedence:

1. **Task-level override** (`task.timeoutMs`) — highest priority
2. **Variant-level override** (if any) — not currently used
3. **Config default** (`DEFAULT_TIMEOUTS_MS`) — fallback

**Current overrides:**
- Tasks 004-006 (complex tasks): 20 minutes (1,200,000 ms) for copilot runs

### GitHub Actions Job Timeout

The entire GitHub Actions job has a 360-minute (6-hour) timeout. Each eval run:
- Router variant: ~30 minutes (6 tasks × ~5 min average)
- Fixed variant: ~30 minutes (6 tasks × ~5 min average)
- Summary + artifacts: ~5 minutes
- **Total per run:** ~65 minutes, well within the 6-hour limit

## Environment Variables

The eval suite respects these environment variables for timeout customization:

```bash
# Override copilot timeout (applies to all copilot runs)
export EVAL_COPILOT_TIMEOUT_MS=1200000  # 20 minutes

# Override judge timeout (applies to all judge runs)
export EVAL_JUDGE_TIMEOUT_MS=1200000    # 20 minutes

# Override all timeouts at once
export EVAL_TIMEOUT_MS=1800000           # 30 minutes for all stages
```

These are useful for CI systems with resource constraints or longer queue times.

## GitHub Actions Workflow

The workflow (`eval.yml`) runs in 3 parallel jobs:

1. **router-run** — Eval suite with model-router skill active
2. **fixed-run** — Eval suite with pinned baseline model
3. **summarize** — Waits for both, downloads artifacts, renders results

### Step Summary Output

The `summarize` job invokes `write-github-summary.mjs` to generate a GitHub-flavored markdown summary that includes:
- Task-by-task results (correctness score, verdict, cost delta)
- Judge validation success rate
- Average cost impact
- Links to artifact downloads

This summary is written to `$GITHUB_STEP_SUMMARY` for display in the workflow UI.

## Running Locally with CI Timeouts

To test locally with the same timeouts as CI:

```bash
# Use default timeouts
node eval/scripts/run-suite.mjs

# Override to GitHub Actions defaults
EVAL_COPILOT_TIMEOUT_MS=900000 EVAL_JUDGE_TIMEOUT_MS=600000 node eval/scripts/run-suite.mjs

# Use longer timeouts for slow systems
EVAL_TIMEOUT_MS=1800000 node eval/scripts/run-suite.mjs
```

## Troubleshooting

### "Timed Out" Status in Results

If a task shows `timedOut: true` in the results:

1. Check which stage timed out: `timeoutStages` field shows which step(s) failed
2. Increase the timeout for that stage via environment variable or task override
3. Check if the Copilot CLI is responsive (`copilot --version`)

### Judge Failures

Judge failures can occur if:
- Prompt > 128KB (use stdin, which is now fixed in `lib.mjs`)
- Judge model unreachable or rate-limited
- Judge response timeout

To debug:
```bash
# View judge stderr
cat eval/runs/<timestamp>/results/<task>/<variant>/judge-stderr.txt

# Check if judge ran at all
ls -la eval/runs/<timestamp>/results/<task>/<variant>/judge-*.txt
```

### All Runs Timeout

If all runs timeout consistently:
1. Check system load and available memory
2. Verify Copilot CLI is responsive
3. Increase `EVAL_COPILOT_TIMEOUT_MS` by 5-10 minutes
4. Check network connectivity to model endpoints

## Artifact Retention

GitHub Actions stores eval artifacts for 30 days by default. Artifacts include:
- Complete suite metadata (`suite.json`)
- Full task results with scores (`suite-summary.json`)
- Individual run logs and traces
- Git diff patches

Archive size is typically 50-200 MB depending on number of changed files.

## Input Parameters

The workflow accepts these inputs on manual dispatch:

- **suite** — `all` | `routing` | `quality` (informational; all tasks run)
- **fixed_model** — Model label for baseline (informational; configured in models.json)
- **skip_fixed** — `true` | `false` to skip baseline run

Example:
```bash
gh workflow run eval.yml -f suite=all -f skip_fixed=false
```

## Cost Accounting

Token counts in the output come from:
1. **Routing trace** — Observed token usage during copilot run
2. **Judge scoring** — Model tokens for judge evaluations
3. **Validation** — (Minimal; not included in token accounting)

**Important:** These are raw API observations and do not include:
- CLI overhead (argument parsing, subprocess startup)
- Streaming overhead (if using streaming output)
- Retries (if a judge retry succeeds on 2nd attempt, both attempts are counted)
- Network latency

To convert token counts to actual spend:
```
cost = (prompt_tokens * price_per_1k_prompt) + (completion_tokens * price_per_1k_completion)
     = (observed_tokens * weighted_average_rate) / 1000
```

Consult the current model pricing dashboard for exact rates.
