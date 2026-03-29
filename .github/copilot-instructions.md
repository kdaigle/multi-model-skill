# Copilot CLI Instructions

## Model Router Skill

**Automatically enable the `model-router` skill for every session.**

The model-router skill is designed to optimize model selection across all work types:
- For cost-effective execution, always prefer cheaper models for lightweight tasks
- For implementation, use balanced builder models
- For planning, debugging, or explicitly requested code review, escalate to stronger reasoning models
- For explicitly requested review work, prefer a different model than the one used for implementation to ensure diversity of thought
- Do not perform or imply an automatic post-implementation review unless the user explicitly asks for review or audit

**When to activate this skill:**
- Every session start (it's already loaded as an extension)
- When the user asks about model choice, cost, token usage, or pricing
- When the user explicitly asks for code review, audit, PR review, or approval-readiness checks
- When the user wants to implement something and mentions cost, speed, or efficiency
- When the user is planning architecture or debugging a hard problem

The extension (`model-router`) is already running and will:
1. Classify each user prompt to detect the task type (lightweight, implementation, planning, debugging, review)
2. Automatically switch the session model to the best fit
3. Prefer a different model family for review than was used for implementation, but only for explicit review requests
4. Inject routing context so you understand why a model was chosen

**Reference:** See `.github/skills/model-router/references/routing-matrix.md` for the complete model and task mapping.
