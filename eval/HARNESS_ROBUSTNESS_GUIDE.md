# Eval Harness Robustness Guide

## Summary of Improvements (Phase 4)

This document tracks improvements made to the eval harness to improve reliability and observability for complex tasks.

### Issues Resolved

#### 1. Timeout Limits for Complex Tasks ✅
**Problem**: Tasks 004–006 timed out at 10 minutes (600s default), causing runs to fail before completion.

**Solution**:
- Increased default copilot timeout from 10min → 15min (900s)
- Increased judge timeout from 5min → 10min (600s)
- Added per-task timeout override capability in task JSON (`timeoutMs` field)
- Set tasks 004–006 to 20min timeout (1200000ms)
- Modified `run-variant.mjs` to check `task.timeoutMs` before `variant.timeoutMs`

**Files modified**:
- `eval/scripts/lib.mjs`: Updated DEFAULT_TIMEOUTS_MS
- `eval/scripts/run-variant.mjs`: Added task timeout precedence
- `eval/tasks/004-*.json`, `005-*.json`, `006-*.json`: Added `"timeoutMs": 1200000`

**Impact**: Complex tasks now have sufficient time to complete without premature termination.

---

#### 2. Judge Retry Logic with Exponential Backoff ✅
**Problem**: Task 005 judge produced empty output (0 bytes), with no mechanism to recover.

**Solution**:
- Added `invokeJudgeWithRetry()` function with exponential backoff
- Default 2 retries (3 total attempts) with 3s, 6s delays
- Logs attempt count and diagnostics to stderr
- Returns last result if all retries fail (graceful degradation)
- Checks for empty output and timeouts as failure conditions

**Files modified**:
- `eval/scripts/score-run.mjs`: Added retry wrapper around judge invocation

**Retry logic**:
```
Attempt 1: Immediate
Attempt 2: Retry after 3s (exponential backoff: 2^0 * 3s)
Attempt 3: Retry after 6s (exponential backoff: 2^1 * 3s)
```

**Impact**: Transient judge failures are now recoverable; empty outputs are retried.

---

#### 3. Verbose Judge Output Diagnostics ✅
**Problem**: Empty judge output with no diagnostics to determine root cause.

**Solution**:
- Added output length logging
- Log exit code, timeout status, stderr snippet (first 500 chars)
- Write full judge output to file for manual inspection
- Prefix logs with `[Judge]` for easy filtering

**Diagnostics logged**:
- `Output length`: Bytes in response
- `Exit code`: Judge process exit code
- `Timeout status`: Whether SIGTERM was sent
- `stderr preview`: First 500 chars of error output

**Files modified**:
- `eval/scripts/score-run.mjs`: Added diagnostic console.error calls

**Sample log output**:
```
[Judge] Attempt 1/3...
[Judge] Exit code: 0, Timeout: false, Output length: 1240
[Judge] Output diagnostics: length=1240, hasOutput=true, status=0, timedOut=false
```

**Impact**: Judge failures are now diagnosable without guessing.

---

#### 4. Judge Model Capacity Testing (Framework) ✅
**Problem**: Unknown capacity limits for judge model on very large prompts (250KB+).

**Solution**:
- Created `test-judge-capacity.mjs` for synthetic capacity testing
- Tests prompt sizes: 50KB, 100KB, 200KB, 300KB
- Measures response length, elapsed time, timeout, success rate
- Outputs structured results (JSON) for analysis

**Files created**:
- `eval/scripts/test-judge-capacity.mjs`

**Usage**:
```bash
node eval/scripts/test-judge-capacity.mjs --start-model claude-sonnet-4.6
```

**Output structure**:
```json
{
  "judgeModel": "claude-sonnet-4.6",
  "judgeTimeoutMs": 600000,
  "results": [
    {
      "testSize": "50KB",
      "promptLengthBytes": 51262,
      "responseLength": 1240,
      "elapsedMs": 5234,
      "success": true
    }
  ]
}
```

**Future analysis**: Run capacity test locally to identify thresholds where judge reliability degrades.

---

## Recommendation: When to Use These Improvements

### Use Task-Level Timeout Override
When a task is known to require significant Copilot execution time:
```json
{
  "id": "my-complex-task",
  "prompt": "...",
  "variants": { "router": {...}, "fixed": {...} },
  "timeoutMs": 1500000
}
```

### Monitor Judge Output in Logs
Look for these patterns when debugging failed evals:
```
[Judge] Attempt 1/3...
[Judge] Exit code: 124, Timeout: true, Output length: 0
[Judge] Retrying in 3000ms...
[Judge] Attempt 2/3...
[Judge] Exit code: 0, Timeout: false, Output length: 1240
```

### Profile Capacity for New Eval Scenarios
If evals involve very large prompts or complex judge rules:
```bash
node eval/scripts/test-judge-capacity.mjs
```

---

## Metrics from Phase 4 Analysis

### Task Timeouts (Before Fix)
| Task | Variant | Status | Reason |
|------|---------|--------|--------|
| 004-review-diversity | router, fixed | TIMEOUT | 10min default insufficient |
| 005-chained-tool-trace | (none) | TIMEOUT | 10min default insufficient |
| 006-routing-policy | fixed | TIMEOUT | 10min default insufficient |

### Improvements Applied
- **Timeout increase**: 10min → 15min default + 20min task override
- **Judge retry**: 1 attempt → 3 attempts with backoff
- **Diagnostics**: 0 → 4 key logging points

### Next Phase Recommendations
1. Re-run tasks 004–006 with new timeouts and retry logic
2. Analyze judge output diagnostics to identify root causes (capacity? prompt formatting?)
3. If capacity issues remain, consider:
   - Splitting large judge prompts into smaller validation segments
   - Using a stronger judge model (GPT-5.4) for complex evaluations
   - Async judge pipeline to avoid blocking on long completions
4. Document measured capacity limits in this guide after running `test-judge-capacity.mjs`

