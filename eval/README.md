# Eval Harness

This directory contains a local-first evaluation harness for comparing router-enabled Copilot CLI runs against a fixed-model baseline on the same task.

## Goals

- Run the same task against two variants:
  - `router`: starts from the pinned strong model and explicitly loads the local model-router plugin so it may switch away.
  - `fixed`: starts from the same pinned strong model but disables the router plugin, skill, and repo instructions inside a disposable worktree.
- Use a different strong model as a judge when possible.
- Preserve raw run artifacts and keep parsing conservative.
- Work locally now and remain easy to reuse in GitHub Actions later.

## Prerequisites

- `copilot` CLI installed and authenticated.
- Node.js 22 or later (uses `node:util` `parseArgs`, ESM top-level await).
- A standard (non-shallow) Git checkout that supports `git worktree add`.

## Entrypoint

```bash
node eval/scripts/run-suite.mjs
```

Useful options:

```bash
# Validate setup without spending API quota
node eval/scripts/run-suite.mjs --dry-run

# Run a single task
node eval/scripts/run-suite.mjs --task 001-status-enhancement

# Run one variant only
node eval/scripts/run-suite.mjs --variant router

# Save output to a named directory instead of a timestamped one
node eval/scripts/run-suite.mjs --suite-dir eval/runs/manual-check

# Combine filters
node eval/scripts/run-suite.mjs --task 001-status-enhancement --variant router --dry-run
```

All flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--task <id>` (repeatable) | all tasks | Run only the named task(s). IDs match the task JSON filename without `.json`. |
| `--variant <id>` (repeatable) | all variants | Run only `router`, `fixed`, or both. |
| `--suite-dir <path>` | `eval/runs/<timestamp>` | Where to write output. Created if it does not exist. |
| `--base-ref <ref>` | `HEAD` | Git ref used for `git worktree add`. |
| `--dry-run` | off | Creates worktrees and writes metadata but skips actual `copilot` invocations and judge calls. |

Override the judge model without editing config:

```bash
EVAL_JUDGE_MODEL=gpt-5 node eval/scripts/run-suite.mjs
```

Override harness timeouts with environment variables:

```bash
# Global override for all timed subprocesses
EVAL_TIMEOUT_MS=900000 node eval/scripts/run-suite.mjs

# Or tune stages independently (0 disables that stage timeout)
EVAL_COPILOT_TIMEOUT_MS=900000 \
EVAL_JUDGE_TIMEOUT_MS=420000 \
EVAL_VALIDATION_TIMEOUT_MS=180000 \
node eval/scripts/run-suite.mjs
```

## Result Layout

A suite run creates a timestamped directory under `eval/runs/` (or the directory you pass to `--suite-dir`).

```text
eval/runs/20260329T010203Z/
  suite.json               # metadata: tasks, variants, judge model chosen
  run-index.json           # flat list of every task×variant result
  suite-summary.json       # machine-readable summary with per-task comparisons
  suite-summary.txt        # plain-text summary for quick scanning
  worktrees/               # git worktrees, one per task×variant
  results/
    001-status-enhancement/
      router/
        prepare-worktree.json    # worktree path and which files were disabled
        run-command.json         # exact copilot invocation args
        run-result.json          # exit code, timeout/error metadata, changed files, stdout/stderr sizes
        copilot-output.jsonl     # raw copilot CLI output (JSONL)
        copilot-stderr.txt
        git-diff.patch           # diff of all changes made in the worktree
        changed-files.txt
        git-status.txt
        artifact-summary.json    # conservative parse: model mentions, usage candidates
        validation.json          # task-level checks (e.g. required files changed)
        judge-prompt.txt         # full prompt sent to the judge model
        judge-output.jsonl       # raw judge response
        judge-stderr.txt
        score.json               # judge verdicts + relative cost index
```

Raw artifacts are always retained. Parsed summaries intentionally avoid assuming a stable Copilot JSONL schema.

## Scripts

| Script | Description |
|--------|-------------|
| `run-suite.mjs` | Orchestrates a full suite. Calls all other scripts in sequence. |
| `prepare-worktree.mjs` | Creates a fresh `git worktree` at a pinned ref; renames router-related files with `.eval-disabled` for the fixed baseline. |
| `run-variant.mjs` | Executes one task×variant: calls `copilot -p <prompt>` in the worktree and captures output. |
| `collect-artifacts.mjs` | Parses raw JSONL conservatively: extracts text leaves, model mentions, and usage-like fields. |
| `validate-run.mjs` | Applies task-level checks such as required changed files. |
| `choose-judge-model.mjs` | Picks a strong judge model, preferring a different family from the implementation start model. Overridable via `EVAL_JUDGE_MODEL`. |
| `score-run.mjs` | Calls `copilot -p <judge-prompt>` with the judge model and attaches a relative cost index. |
| `summarize-suite.mjs` | Builds `suite-summary.json` and `suite-summary.txt` from all per-run `score.json` files. |

## Configuration

### Models (`eval/config/models.json`)

Defines:

- `implementationStartModel` — the model used as the starting point for **both** variants. Change this to re-pin the entire suite.
- `judgeCandidates` — judge model preference order; `choose-judge-model.mjs` picks the first candidate from a different family than the start model.
- `timeouts` — default timeout limits in milliseconds for main Copilot runs, judge runs, and validation commands.
- `models` — per-model metadata: family, tier, and `relativeWeight` used in cost index calculations.
- `relativeCostIndex` — tuning parameters for the cost index: `visibleUnitBytes`, `effortMultipliers`, `routeSwitchPenalty`, `fallbackModelWeight`.

Environment variables take precedence over config defaults and any per-variant/per-command timeout overrides. Use `EVAL_TIMEOUT_MS` to set one global limit, or `EVAL_COPILOT_TIMEOUT_MS`, `EVAL_JUDGE_TIMEOUT_MS`, and `EVAL_VALIDATION_TIMEOUT_MS` to override individual stages. Set a timeout variable to `0` to disable that stage timeout.

### Variants (`eval/config/variants.json`)

Each variant specifies whether to load the plugin dir (`includePluginDir`), enable `--autopilot` and `--experimental`, and which paths to rename inside the worktree when disabling the router. Variants may also set an optional `timeoutMs` override for the main `copilot` run.

### Tasks (`eval/tasks/`)

Each `<id>.json` file contains:

- `prompt` — the exact prompt sent to Copilot.
- `judgeHints` — additional context passed to the judge.
- `validation.requireDiff` — whether a non-empty diff is required for the run to pass.
- `validation.requiredChangedFiles` — file paths or glob patterns that must appear in the diff.

## Exact Usage vs Relative Cost Index

All `copilot` invocations in the harness—both variant runs and judge calls—go through the **Copilot CLI proxy**. The harness never calls Anthropic or OpenAI APIs directly and does not receive direct billing data.

### What the cost index is

`score-run.mjs` computes a **relative cost index** for within-suite comparisons only. It is **not** billing data and **not** a dollar-value estimate.

Two modes are possible depending on what is visible in the JSONL output:

| Mode | When it applies | What it measures |
|------|----------------|------------------|
| `observed_tokens_weighted` | Token-like fields (`promptTokens`, `completionTokens`, etc.) are present in `copilot-output.jsonl` | Observed tokens × model relative weight × route-switch penalty × effort multiplier |
| `estimated_visible_artifacts` | No token fields visible in JSONL | Visible artifact bytes ÷ `visibleUnitBytes` × same multipliers |

The `costMode` field in `score.json` and `suite-summary.json` shows which mode was used for each run.

**Key caveat**: The Copilot CLI routes model calls through a proxy that may not surface per-turn token counts in its JSONL output. In practice you will often see `estimated_visible_artifacts` mode. Do not compare these numbers to official usage dashboards.

### Model weights

Relative weights in `eval/config/models.json` are approximate tier-based multipliers (e.g. economy=1.0, builder≈3–4, reasoning≈5–8). They are not real per-token prices—they exist only to make the cost index directionally meaningful when comparing economy-tier versus reasoning-tier model use.

## Interpreting Results

### Judge scores

The judge model is asked to score each run on a 0–5 scale across three dimensions:

| Field | What it measures |
|-------|------------------|
| `correctnessScore` | Did the run implement the requested behavior correctly, based on the diff and validation evidence? |
| `completenessScore` | How fully did it satisfy the task requirements? |
| `minimalityScore` | Did it stay focused and avoid unnecessary changes? |
| `verdict` | `pass` / `partial` / `fail` — conservative; `pass` requires strong positive evidence |
| `confidence` | `low` / `medium` / `high` — how much evidence the judge had to work with |

Scores and verdicts appear in `score.json` per run and are aggregated in `suite-summary.json`.

### Timeouts

When a subprocess exceeds its timeout, the harness keeps partial artifacts and records the timeout explicitly:

- `run-result.json` includes `timedOut`, `timeoutMs`, `signal`, `errorCode`, `errorMessage`, and `runStatus`.
- `validation.json` includes `timedOut`, `runTimedOut`, `timedOutCommands`, and `failureMode`.
- `score.json` includes `judgeTimedOut`, `judgeTimeoutMs`, and top-level judge status metadata.
- `suite-summary.json` / `suite-summary.txt` list per-variant timeout stages (`run`, `validation`, `judge`) so timeouts are not mistaken for generic failures.

### Comparison delta

`suite-summary.json` includes a `comparison` object for each task when both `router` and `fixed` variants ran:

```json
{
  "correctnessDelta": 0.5,
  "costDelta": -1.2,
  "routerVerdict": "pass",
  "fixedVerdict": "partial"
}
```

`correctnessDelta = router.correctnessScore − fixed.correctnessScore`. A negative `costDelta` means the router variant had a lower cost index.

### Reading the plain-text summary

`suite-summary.txt` is a quick overview:

```text
001-status-enhancement -> router: verdict=pass, correctness=4, cost=5.1 (observed_tokens_weighted) | fixed: verdict=partial, correctness=3, cost=7.8 (observed_tokens_weighted)
```

### Dry-run output

With `--dry-run`, all `copilot` invocations are skipped. Artifacts are written with empty content and `score.json` will contain `"skipped": true`. Useful for verifying worktree setup and suite structure before spending quota.

## GitHub Actions Reuse

The same harness entrypoint is used in CI. See [`eval/docs/ci-setup.md`](docs/ci-setup.md) for the full workflow setup.

The canonical CI commands are:

```bash
# Router variant
node eval/scripts/run-suite.mjs --variant router --suite-dir eval/runs/router

# Fixed baseline
node eval/scripts/run-suite.mjs --variant fixed --suite-dir eval/runs/fixed
```

Recommended workflow steps:

1. Checkout the repo (`actions/checkout@v4`).
2. Set up Node.js 22 (`actions/setup-node@v4`).
3. Install and authenticate `copilot`.
4. Run the suite.
5. Upload `eval/runs/router/` and `eval/runs/fixed/` as GitHub Actions artifacts.

## Notes

- Worktrees are left in place for inspection; each suite gets fresh paths under `<suite-dir>/worktrees/`.
- The router variant explicitly passes `--plugin-dir <worktree>` so the local plugin is loaded even in non-interactive mode.
- The fixed variant renames router-related files with an `.eval-disabled` suffix inside the disposable worktree, leaving the main checkout untouched.
- Run outputs in `eval/runs/` are gitignored except for this README.
