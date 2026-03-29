# Eval Analysis: 001-status-enhancement

**Run:** `20260329T051426Z` | **Task:** `001-status-enhancement` | **Variant:** `router`

---

## Executive Summary

The router variant's "failure" on this task is **not a model-selection or prompting
problem**. It is an **eval harness bug**: the agent successfully edited both files
and committed the changes, but `run-variant.mjs` checks for uncommitted diffs
(`git diff --name-only`) rather than comparing against the worktree's base commit.
After a `git commit`, the working tree is clean, so the harness sees zero changes.

**The agent did the right thing. The harness measured the wrong thing.**

---

## Section 1: Task Clarity and Instruction Analysis

### Is the task instruction the problem?

**No.** The instruction is well-formed:

> "Enhance the /model_router_status output so it is more actionable for local
> debugging. Keep the change focused: add a concise section that clearly
> distinguishes the active model, the last routed implementation model, and the
> most important confusion or looping counters."

Evidence that the agent understood perfectly:

| Signal | Evidence |
|--------|----------|
| **Identified correct file** | Navigated to `.github/extensions/model-router/extension.mjs` |
| **Read the handler** | Viewed lines around the `model_router_status` handler (lines 698–726) |
| **Made targeted edit** | Added `snapshot` object with `activeModel`, `lastImplementationModel`, and `confusion` sub-object containing `alert`, `isLooping`, `errorCount`, `turnsSinceLastSwitch` |
| **Updated docs** | Edited `SKILL.md` to document the new output contract |
| **Committed cleanly** | `git commit` succeeded: "2 files changed, 33 insertions(+), 5 deletions(-)" |

The instruction **does not need to be more explicit**. It correctly described the
desired outcome and the agent delivered it.

### One minor instruction improvement worth considering

The judge hint "Prefer a small targeted change" is good. But the task
`validation.requiredChangedFiles` only checks `extension.mjs` — it could
optionally accept `SKILL.md` as a bonus changed file without penalizing it. This
is cosmetic; it did not cause the failure.

---

## Section 2: Model Selection Analysis

### Should we use a stronger model?

**No.** Sonnet 4.6 with medium reasoning was the correct choice for this task.

Evidence:

| Criterion | Assessment |
|-----------|------------|
| **Task complexity** | Single-file behavioral edit in a well-structured JS file. Builder-tier work. |
| **Agent behavior** | Methodical: explore → read → reason → edit → verify → commit. No confusion, no wasted turns. |
| **Tool use** | 21 tool calls, all successful. Parallel view calls for exploration. |
| **Turn count** | 16 assistant turns — reasonable for explore + edit + verify + commit. |
| **Reasoning quality** | Three reasoning blocks show clear understanding of the current handler, what to add, and why. |
| **Exit code** | 0 (clean success) |

### Cost comparison if we had escalated

| Model | Relative Weight | Est. Cost Index |
|-------|----------------|-----------------|
| claude-sonnet-4.6 (medium) | 3.5 × 1.15 | ~122.9 (observed) |
| claude-opus-4.6 | 7.0 × 1.0 | ~250+ (estimated) |
| gpt-5.4 (high) | 5.8 × 1.35 | ~200+ (estimated) |

Escalating to Opus would **double the cost** for a task the current model
already completed correctly. This would be pure waste.

### The "fixed" variant also failed — and for different reasons

The fixed variant (same model, no router) timed out at 120s with no changes.
This suggests the non-routed agent struggled more, possibly because it lacked
the extension context or system prompt optimizations. The router variant
actually **outperformed** the fixed baseline on this task — it completed the
work but was penalized by the harness bug.

---

## Section 3: Specific Tuning Recommendations (Ranked by Impact)

### 1. 🔴 CRITICAL — Fix `run-variant.mjs` to detect committed changes

**Impact: Fixes the root cause. All other recommendations are secondary.**

The harness at `run-variant.mjs:123-125` runs:

```javascript
const changedFilesResult = runCommand('git', ['diff', '--name-only'], { cwd: worktreePath });
const diffResult = runCommand('git', ['diff', '--binary'], { cwd: worktreePath });
```

This compares working tree vs index. After `git commit`, both are clean → zero diff.

**Fix:** Compare against the worktree's base SHA (already recorded in
`prepare-worktree.json`):

```javascript
const changedFilesResult = runCommand('git', ['diff', '--name-only', baseSha + '..HEAD'], { cwd: worktreePath });
const diffResult = runCommand('git', ['diff', '--binary', baseSha + '..HEAD'], { cwd: worktreePath });
```

Also union with uncommitted changes to catch both patterns:

```javascript
// Committed changes (agent ran git commit)
const committedFiles = runCommand('git', ['diff', '--name-only', baseSha + '..HEAD'], { cwd: worktreePath });
// Uncommitted changes (agent left them staged or unstaged)
const uncommittedFiles = runCommand('git', ['diff', '--name-only', 'HEAD'], { cwd: worktreePath });
const stagedFiles = runCommand('git', ['diff', '--name-only', '--cached'], { cwd: worktreePath });
// Union all
```

**Requires:** Passing `baseSha` from `prepare-worktree.mjs` output into
`run-variant.mjs` (currently not passed — only `--worktree` path is).

### 2. 🟡 MEDIUM — Pass `baseSha` through the pipeline

`prepare-worktree.mjs` records `baseSha` in its output JSON, but `run-suite.mjs`
does not forward it to `run-variant.mjs`. Add a `--base-sha` argument:

```javascript
// In run-suite.mjs, after prepare-worktree:
const runResult = runNodeScript('run-variant.mjs', [
  ...existingArgs,
  '--base-sha', prepared.baseSha    // NEW
]);
```

Similarly forward to `validate-run.mjs` and `collect-artifacts.mjs`.

### 3. 🟡 MEDIUM — Add committed-diff collection to `collect-artifacts.mjs`

`collect-artifacts.mjs` reads `git-diff.patch` from the run directory. If the
harness fix in (1) writes the committed diff there, this script needs no change.
But consider also storing the base SHA in `artifact-summary.json` for the judge
to reference.

### 4. 🟢 LOW — Extend judge prompt to acknowledge committed-change evidence

Currently the judge sees `gitDiffBytes=0` and `changedFiles=[]`, which causes it
to say "no surviving diff." If the harness fix captures committed changes, the
judge will automatically see them. No judge prompt changes needed beyond the
harness fix.

However, if you want a belt-and-suspenders approach: the judge prompt could note
that the agent's output JSONL shows successful edit tool calls as secondary
evidence of changes, even when the diff capture failed. This would make the judge
more robust to harness-level issues.

### 5. 🟢 LOW — Consider whether "do not commit" should be an eval convention

An alternative to fixing the harness is adding `--no-commit` guidance to the
eval task prompts. This is **not recommended** because:

- Committing is standard Copilot CLI behavior (the system prompt encourages it)
- Constraining agent behavior to match harness expectations is backwards
- The harness should be robust to both committed and uncommitted changes

---

## Section 4: Cost/Correctness Trade-off Discussion

### Is it worth escalating to Opus for implementation tasks?

**No, not for this class of task.**

The data shows:

1. **Sonnet 4.6 (medium) already completed the task correctly.** The failure was
   a measurement error, not a capability gap.

2. **The routing decision was optimal.** The task involves:
   - Single-file edit (builder-tier per routing matrix)
   - Keyword "enhance" matched to IMPLEMENT_KEYWORDS
   - No complex orchestration, no multi-agent workflow
   - The extension correctly classified this as builder-tier work

3. **Cost matters.** At relative weight 3.5, Sonnet 4.6 is half the cost of
   Opus (7.0). For a focused implementation task that the builder tier handles
   correctly, doubling cost yields no correctness improvement.

### When WOULD escalation be warranted?

Escalation to reasoning tier makes sense when:

- The agent loops or shows confusion (confusion detection already handles this)
- Multi-file architecture changes requiring cross-file reasoning
- Debugging with unclear root cause
- Explicit review requests (diversity-of-thought rule)

The router's existing heuristics already cover these cases.

### Should reasoning effort increase from "medium" to "high" for impl tasks?

**No.** The three reasoning blocks in this run show clear, focused thinking. The
agent:
1. Explored the codebase structure
2. Identified the handler and understood the current output shape
3. Designed the `snapshot` addition and implemented it

Medium reasoning was sufficient. High reasoning (1.35× multiplier) would add
cost without improving an already-correct implementation.

### What about tool-aware routing?

The task involves `edit` and `bash` tool calls, which are standard implementation
tools. The router's tool-aware heuristics correctly kept this at builder tier:

- Tool keywords like "edit" add complexity to the score
- But single-file edits with standard tools don't cross the orchestration
  threshold
- This is exactly the intended behavior per the routing matrix

---

## Conclusion

| Question | Answer |
|----------|--------|
| Why did the agent fail to persist changes? | **It didn't fail.** Changes were committed. The harness only checks uncommitted diffs. |
| Is this a prompting problem? | No. The agent understood and executed the task correctly. |
| Is this a model-selection problem? | No. Sonnet 4.6 (medium) was the right choice. |
| Is this an instruction-clarity problem? | No. The instruction was clear enough for the agent to succeed. |
| What single change has the biggest impact? | **Fix `run-variant.mjs` to diff against `baseSha`**, not just the working tree. |
| What's the minimal viable tuning? | Pass `baseSha` through the pipeline and use `git diff baseSha..HEAD` in artifact collection. |

**Priority:** Fix the harness. Everything else is noise.
