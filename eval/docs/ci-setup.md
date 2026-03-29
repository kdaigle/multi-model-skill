# Eval CI Setup

This document covers the GitHub Actions configuration for running the model-router evaluation harness in CI and the secrets you need to configure.

## Workflow

The workflow lives at [`.github/workflows/eval.yml`](../../.github/workflows/eval.yml).

### Triggers

| Trigger | When | Default inputs |
|---------|------|----------------|
| `workflow_dispatch` | On demand from the Actions tab | Configurable |
| `schedule` | Weekly, Monday 06:00 UTC | `suite=all`, `fixed_model=claude-haiku-4.5` |

### Manual dispatch inputs

| Input | Default | Description |
|-------|---------|-------------|
| `suite` | `all` | Informational label stored in the run environment. The harness runs all tasks in `eval/tasks/`; per-suite task filtering is not yet wired to a CLI flag. |
| `fixed_model` | `claude-haiku-4.5` | Documents the intended baseline model for traceability. The harness reads its start model from `eval/config/models.json`; this input does not override the config. |
| `skip_fixed` | `false` | Set to `true` to skip the fixed-model comparison run (faster smoke check). |

## Jobs

```
router-run ──┐
             ├──► summarize
fixed-run ───┘
```

- **router-run** – runs `eval/scripts/run-suite.mjs --variant router --suite-dir eval/runs/router`; the model-router skill selects models per prompt.
- **fixed-run** – runs `eval/scripts/run-suite.mjs --variant fixed --suite-dir eval/runs/fixed`; router plugin is disabled inside the disposable worktree.
- **summarize** – downloads both artifact sets, diffs `suite-summary.json`, writes a step summary. Runs even if a prior job fails.

## Artifacts

Both run jobs upload their `eval/runs/<mode>/` directories as GitHub Actions artifacts:

- `eval-router-<run_id>` — router-mode outputs
- `eval-fixed-<run_id>` — fixed-model baseline outputs

Artifacts are retained for **30 days**.

The harness is expected to write at minimum:

```
eval/runs/
  router/
    suite-summary.json   # aggregated metrics (passed to step summary)
    suite-summary.txt    # human-readable summary
    results/             # per-case raw output
  fixed/
    suite-summary.json
    suite-summary.txt
    results/
```

See `eval/scripts/run-suite.mjs` for the authoritative output schema.

## Required Secrets

Configure these in **Settings → Secrets and variables → Actions**:

| Secret | Required | Description |
|--------|----------|-------------|
| `COPILOT_CLI_TOKEN` | **Yes** | GitHub PAT with the `copilot` OAuth scope. Used to authenticate the Copilot CLI so it can call the Copilot API non-interactively. |
| `ANTHROPIC_API_KEY` | No | Wired into the workflow environment for future use or custom extensions. The current harness routes all model calls through the `copilot` CLI and does not call Anthropic's API directly. |
| `OPENAI_API_KEY` | No | Same as above — present for forward compatibility, not required by the current harness. |

`GITHUB_TOKEN` is provided automatically by Actions; no extra configuration needed.

### Creating COPILOT_CLI_TOKEN

1. Go to **github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens** (or classic tokens).
2. Grant the `copilot` scope (classic PAT) or the equivalent Copilot permission.
3. Add the token as a repository secret named `COPILOT_CLI_TOKEN`.

## Installing the Copilot CLI in CI

The workflow installs via npm:

```bash
npm install -g @github/copilot-cli
```

If your project uses a different distribution channel, update the "Install Copilot CLI" step:

| Distribution | Install command |
|--------------|-----------------|
| npm (default) | `npm install -g @github/copilot-cli` |
| gh extension | `gh extension install github/gh-copilot` |
| Direct binary | Download from the release page and add to `$PATH` |

After installation the workflow runs:

```bash
copilot auth login --with-token <<< "${COPILOT_CLI_TOKEN}"
```

If this subcommand is unavailable in the CLI version you install, the token is still available as the `COPILOT_CLI_TOKEN` environment variable; the harness can use it directly.

## Caveats

- **Cost accounting**: All model calls go through the Copilot CLI proxy. Token counts in `suite-summary.json` are estimates derived from JSONL artifacts and are not authoritative billing figures. See the "Exact Usage vs Relative Cost Index" section in `eval/README.md`.
- **Model availability**: Model IDs in the router tier lists may change. The harness should handle `model_not_found` gracefully and log which model was actually used.
- **Schedule skips fixed_model input**: Scheduled runs cannot receive dispatch inputs; they always run with the hardcoded defaults (`suite=all`, `fixed_model=claude-haiku-4.5`).
- **Partial results**: The `summarize` job runs with `if: always()` to surface partial comparisons when one leg fails.

## Local validation

Before pushing, validate the workflow YAML locally:

```bash
# Install actionlint (https://github.com/rhysd/actionlint)
brew install actionlint        # macOS
# or: go install github.com/rhysd/actionlint/cmd/actionlint@latest

actionlint .github/workflows/eval.yml
```

Run the harness locally first to confirm `eval/scripts/run-suite.mjs` produces valid output before triggering CI:

```bash
node eval/scripts/run-suite.mjs --variant router --suite-dir eval/runs/router
```
