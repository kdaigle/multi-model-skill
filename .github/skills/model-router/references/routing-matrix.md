# Model Routing Matrix

This file is the routing reference for the `model-router` skill.

The extension uses runtime heuristics and tries models in priority order. Treat this matrix as the policy source of truth.

## Tool Calling Tier Legend

Models are grouped by their tool-calling capability tier:
- **Economy-Tools**: Good fit for simple, low-cost tool use
- **Standard-Tools**: Better fit for implementation that needs more than lightweight routing
- **Reasoning-Tools**: Use when the classifier has already escalated work into the reasoning tier

## Cost-aware tiers

### Economy tier

Use these first for low-risk, low-complexity work.

| Model | Best use | Tool Calling |
| --- | --- | --- |
| `claude-haiku-4.5` | Fast lightweight classification, short answers, quick summaries, simple repo exploration | Economy-Tools: Good first choice for simple tool use |
| `gpt-4.1` | Low-cost general coding help, concise explanations, small focused edits | Economy-Tools: Suitable for simple tool use |
| `gpt-5-mini` | Small implementation tasks, lightweight reasoning, low-cost follow-up work | Economy-Tools: Suitable for simple tool use |
| `gpt-5.4-mini` | Similar to `gpt-5-mini`; use when available for cheap routing and concise execution | Economy-Tools: Suitable for simple tool use |

### Standard builder tier

Use for normal implementation and medium-complexity work.

| Model | Best use | Tool Calling |
| --- | --- | --- |
| `claude-sonnet-4` | Solid default coding model for moderate implementation and codebase understanding | Standard-Tools: Builder-tier option |
| `claude-sonnet-4.5` | Strong default for implementation, refactors, and balanced coding tasks | Standard-Tools: Builder-tier option |
| `claude-sonnet-4.6` | Strong builder candidate for medium-to-hard implementation; also available later as a reasoning-tier fallback with higher effort | Standard-Tools: Builder-tier option |
| `gpt-5.1` | General implementation, deeper reasoning than economy tier, useful alternate builder | Standard-Tools: Builder-tier option |
| `gpt-5.2` | Similar to `gpt-5.1`, suitable for medium-to-hard implementation | Standard-Tools: Builder-tier option |
| `gpt-5.3-codex` | Code-heavy implementation and targeted code transformation when available | Standard-Tools: Builder-tier option |
| `gpt-5.1-codex` | Alternate code-specialized builder for implementation and refactoring | Standard-Tools: Builder-tier option |

### Reasoning tier

Use when the classifier escalates planning, debugging, or explicit review.

| Model | Best use | Tool Calling |
| --- | --- | --- |
| `gpt-5` | Complex planning, hard debugging, and explicit review | Reasoning-Tools: Reasoning-tier option |
| `gpt-5.4` | Strong high-reasoning generalist for planning and careful review | Reasoning-Tools: Reasoning-tier option |
| `claude-sonnet-4.6` | High-reasoning fallback for planning, debugging, or review; the extension can select it with `high` reasoning effort | Reasoning-Tools: Reasoning-tier option |
| `gpt-5.1-codex-max` | Code-focused review or hard implementation when available | Reasoning-Tools: Reasoning-tier option |
| `claude-opus-4.5` | Deep review, architecture reasoning, and difficult debugging | Reasoning-Tools: Reasoning-tier option |
| `claude-opus-4.6` | Deep reasoning, high-signal review, and difficult planning | Reasoning-Tools: Reasoning-tier option |
| `claude-opus-4.6-1m` | Same general role as `claude-opus-4.6`, especially when large context is useful | Reasoning-Tools: Reasoning-tier option |

## Task routing policy

| Task type | Preferred tier | Fallback |
| --- | --- | --- |
| Quick Q&A, short explanation, simple search | Economy | Standard builder |
| Small single-file edit | Economy | Standard builder |
| Normal implementation | Standard builder | Economy for trivial work, reasoning for tougher work |
| Multi-file implementation | Standard builder | Reasoning |
| Complex orchestration request (parallel agents, chained tools) | Reasoning | Standard builder |
| Complex plan or architecture proposal | Reasoning | Strongest standard builder |
| Debugging with unclear root cause | Reasoning | Strongest standard builder |
| Explicit code review / audit request | Reasoning using a different model than implementation if possible | Best available different standard builder |

## Tool-aware routing

When a task involves tool calls or agentic workflows, follow the current classifier behavior:

**Tool-heavy implementation:**
- Tool keywords add complexity
- Implementation prompts with tool keywords are pushed toward **Standard-Tools**

**Complex orchestration escalation:**
- For prompts classified as **implementation** or **general**, orchestration keywords escalate directly to **Reasoning-Tools**
- This rule is keyword-based, not a generic "3+ tools" threshold
- Current orchestration keywords: `"parallel agents"`, `"multiple agents"`, `"multi-agent"`, `"orchestrate"`, `"orchestration"`, `"parallel tools"`, `"tool chain"`, `"chained tools"`

**Planning, debugging, and explicit review:**
- These can reach **Reasoning-Tools** when the classifier marks them as higher complexity

The extension also considers tool keywords like `"bash"`, `"curl"`, `"execute"`, `"run"`, `"tool"`, `"API"`, `"function"`, and `"agent"` during complexity scoring. That complexity bump mainly moves tool-heavy implementation from economy candidates to builder candidates. The separate orchestration rule above is what promotes implementation or general prompts to the reasoning tier.

## Diversity-of-thought rule

For explicit review requests, prefer a different model than the one most recently used for implementation:

- Different family is best, such as `claude-sonnet-*` for build and `gpt-5*` for review.
- If a different family is unavailable, use a different concrete model in the same family.
- If no alternative is available, reuse the current model and surface that the fallback happened.

## Notes

- Exact billing multipliers are installation-specific and may change. The extension therefore uses a conservative candidate order instead of hardcoded pricing claims.
- If your Copilot CLI install exposes a smaller model set, the router should still work by falling through its candidate list until a switch succeeds.
