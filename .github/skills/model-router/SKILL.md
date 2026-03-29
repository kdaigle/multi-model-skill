---
name: model-router
description: Automatically route Copilot CLI work to the lowest-cost viable model and prefer a different model for review than implementation. Use for cost optimization, model selection, building with cheaper models, planning with stronger models, debugging, code review, minimizing token usage, or when you want Copilot to choose the best model for the task.
---

# Model Router

Use this skill when the user wants Copilot CLI to optimize model choice for cost and task fit.

It does **not** force a code review after implementation. Review behavior should activate only when the user explicitly asks for a review or audit.

## Goals

- Route simple work to the cheapest viable model.
- Escalate to stronger models only when the task needs deeper reasoning, broader context, or stronger review quality.
- Prefer a different model for review than the one used for implementation, but only when the user explicitly asks for review.

## How to use this skill

1. Read `references/routing-matrix.md` when you need the task-to-model mapping.
2. Prefer cheaper models for quick answers, repo exploration, and narrowly scoped edits.
3. Escalate for deep planning, tricky debugging, architecture work, large refactors, and explicit high-signal review.
4. Only enter review mode when the user explicitly asks for a review or audit.
5. When review mode is explicitly requested, prefer a different model than the last implementation model when one is available.
6. If the extension is installed and running, let it switch the session model automatically. If it is not available, follow the routing matrix manually and tell the user when a model switch would help.

## Routing heuristics

Treat these as signs that a cheap model is sufficient:

- Short factual questions
- Small single-file edits
- Basic code explanations
- File finding and lightweight repo exploration

Treat these as signs to escalate:

- Multi-file implementation
- Architecture or implementation planning
- Debugging failures with unclear root cause
- Explicit requests to review or audit code
- Large prompts with multiple constraints
- **Tool-heavy implementation work** (tasks involving bash, curl, API calls, agents, or complex function orchestration)

## Tool-aware routing

When tasks involve tool calls or agentic workflows:

- **Single or light tool calls**: Economy tier is fine (Haiku 4.5 has excellent tool support)
- **Tool-heavy implementation**: Escalate to Standard Builder tier
- **Planning, debugging, or explicit review with additional complexity**: Reasoning tier may be appropriate

The current extension detects tool keywords like "bash", "curl", "API", "execute", and "agent" and uses them as one input to complexity scoring. In practice, this mainly moves tool-heavy implementation from economy candidates to builder candidates.

## Review diversity rule

When you have recently used one model for implementation, prefer a different model for explicit review asks such as:

- code review
- audit
- approval readiness

If only one eligible model is available, fall back gracefully and say so.

## Confusion detection and recovery

If the extension detects signs that the agent may be looping or stuck (e.g., repeated similar responses, self-contradictions, accumulated errors), it may automatically swap to an alternate model family at the same or better caliber. This helps avoid wasting tokens on a confused agent.

**Important:** The extension errs on the side of patience, especially when the agent is in active thinking (reasoning display enabled). It will only swap after seeing multiple strong signals of confusion over several turns, not on the first error or unclear response.

**Signals that may trigger a swap:**
- Multiple similar consecutive responses (looping)
- Two or more consecutive errors
- Agent acknowledging confusion ("I'm not sure", "I'm confused", etc.)

**Example:** If a Claude-based model is looping, the extension may switch to a GPT-based model at the same reasoning tier, giving the problem a different perspective.

Check confusion metrics with:

```
/model_router_status
```

This shows turn count, error count, recent message tracking, and whether looping was detected.
