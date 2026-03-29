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
3. Escalate for deep planning, tricky debugging, architecture work, large refactors, and high-signal review.
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
- **Tool-heavy work** (tasks involving bash, curl, API calls, agents, or complex function orchestration)

## Tool-aware routing

When tasks involve tool calls or agentic workflows:

- **Single or light tool calls**: Economy tier is fine (Haiku 4.5 has excellent tool support)
- **Multi-tool chains or complex orchestration**: Escalate to Standard Builder tier (Sonnet 4.6, GPT-5.x)
- **Parallel agent teams or multi-step orchestration**: Use Premium reasoning tier (Opus 4.6, GPT-5.4)

The extension automatically detects tool keywords like "bash", "curl", "API", "execute", "agent" and escalates tool-heavy implementation from Economy to Standard Builder tier when appropriate.

## Review diversity rule

When you have recently used one model for implementation, prefer a different model for these explicit review asks:

- code review
- bug finding
- regression hunting
- approval readiness checks

If only one eligible model is available, fall back gracefully and say so.
