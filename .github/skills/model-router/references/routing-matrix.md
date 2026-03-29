# Model Routing Matrix

This file is the routing reference for the `model-router` skill.

The extension uses runtime heuristics and tries models in priority order. Treat this matrix as the policy source of truth.

## Tool Calling Tier Legend

Models are grouped by their tool-calling capability tier:
- **Economy-Tools**: Great for simple, single tool calls at low cost
- **Standard-Tools**: Balanced tool calling, good for multi-step workflows, cost-conscious
- **Premium-Tools**: Excellent multi-tool orchestration, agentic workflows, complex chaining

## Cost-aware tiers

### Economy tier

Use these first for low-risk, low-complexity work.

| Model | Best use | Tool Calling |
| --- | --- | --- |
| `claude-haiku-4.5` | Fast lightweight classification, short answers, quick summaries, simple repo exploration | Economy-Tools: Strong for single tool calls and lightweight workflows |
| `gpt-4.1` | Cheap general coding help, concise explanations, small focused edits | Economy-Tools: Basic function calling, good for simple integrations |
| `gpt-5-mini` | Small implementation tasks, lightweight reasoning, low-cost follow-up work | Economy-Tools: Good tool calling despite small size |
| `gpt-5.4-mini` | Similar to `gpt-5-mini`; use when available for cheap routing and concise execution | Economy-Tools: Solid tool use within budget constraints |

### Standard builder tier

Use for normal implementation and medium-complexity work.

| Model | Best use | Tool Calling |
| --- | --- | --- |
| `claude-sonnet-4` | Solid default coding model for moderate implementation and codebase understanding | Standard-Tools: Supports tool calling and agentic workflows |
| `claude-sonnet-4.5` | Strong default for implementation, refactors, and balanced coding tasks | Standard-Tools: Good multi-turn tool chains, reliable tool use |
| `claude-sonnet-4.6` | Stronger version for medium-to-hard builds, planning, and debugging when extra reasoning helps | Standard-Tools: Improved tool orchestration, adaptive effort controls for tool workflows |
| `gpt-5.1` | General implementation, deeper reasoning than economy tier, useful alternate builder | Standard-Tools: Strong function calling with agentic support |
| `gpt-5.2` | Similar to `gpt-5.1`, suitable for medium-to-hard implementation | Standard-Tools: Reliable multi-step tool calling |
| `gpt-5.3-codex` | Code-heavy implementation and targeted code transformation when available | Standard-Tools: Excellent for code generation and dynamic tool workflows |
| `gpt-5.1-codex` | Alternate code-specialized builder for implementation and refactoring | Standard-Tools: Good for scripting and code-based tool calls |

### Heavy reasoning and review tier

Use when quality matters more than cost, or when review should differ from build.

| Model | Best use | Tool Calling |
| --- | --- | --- |
| `gpt-5` | Complex planning, hard debugging, code review, and bug-finding | Premium-Tools: Advanced function calling with massive context (1M+), free-form & structured tools |
| `gpt-5.4` | Strong high-reasoning generalist for planning and careful review | Premium-Tools: Best-in-class tool calling, 1M+ context, superior multi-tool orchestration |
| `gpt-5.1-codex-max` | Premium code-focused review or hard implementation when available | Premium-Tools: Excellent for complex code analysis and transformation workflows |
| `claude-opus-4.5` | Deep review, architecture reasoning, and difficult debugging | Premium-Tools: Strong agentic tool calling, good multi-step workflows |
| `claude-opus-4.6` | Premium deep reasoning, high-signal review, and difficult planning | Premium-Tools: State-of-the-art tool calling, parallel agent teams, 1M+ context |
| `claude-opus-4.6-1m` | Same as `claude-opus-4.6`, especially when large context is useful | Premium-Tools: Parallel agents, full agentic support, best for complex tool orchestration |

## Task routing policy

| Task type | Preferred tier | Fallback |
| --- | --- | --- |
| Quick Q&A, short explanation, simple search | Economy | Standard builder |
| Small single-file edit | Economy | Standard builder |
| Normal implementation | Standard builder | Economy for trivial work, heavy reasoning for tough work |
| Multi-file implementation | Standard builder | Heavy reasoning |
| Complex plan or architecture proposal | Heavy reasoning | Strongest standard builder |
| Debugging with unclear root cause | Heavy reasoning | Strongest standard builder |
| Explicit code review / audit request | Heavy reasoning using a different model than implementation if possible | Best available different standard builder |

## Tool-aware routing

When a task involves tool calls or agentic workflows, prefer models known for strong tool-calling reliability and orchestration:

**Tool-Heavy Tasks (single or sequential tools):**
- Use **Economy-Tools** tier first (Haiku 4.5 is excellent value for single tool calls)
- Upgrade to **Standard-Tools** if the task chains multiple tools or requires agentic decision-making

**Complex Multi-Tool Orchestration:**
- Prefer **Standard-Tools** (Sonnet 4.6, GPT-5.x series) for multi-turn tool chains
- Use **Premium-Tools** (Opus 4.6, GPT-5.4) when orchestrating 3+ tools in parallel or requiring deep reasoning between tool calls

**Free-Form Tool Calls (code generation, SQL, DSL output):**
- GPT-5.4 excels here (structured + free-form support)
- Sonnet 4.6 and Opus 4.6 are solid secondaries with fewer schema constraints

**When NOT to use Economy tier for tool calls:**
- Multi-agent scenarios (use Premium-Tools like Opus 4.6 with parallel agent support)
- Workflows requiring intermediate reasoning between tool invocations
- Tasks where tool call failure recovery is critical (use heavier reasoning models)

The extension will consider whether a prompt contains keywords like "bash", "curl", "execute", "run", "tool", "API", "function" and will escalate from Economy → Standard → Premium if tool-heavy semantics are detected.

## Diversity-of-thought rule

For explicit review requests, prefer a different model than the one most recently used for implementation:

- Different family is best, such as `claude-sonnet-*` for build and `gpt-5*` for review.
- If a different family is unavailable, use a different concrete model in the same family.
- If no alternative is available, reuse the current model and surface that the fallback happened.

## Notes

- Exact billing multipliers are installation-specific and may change. The extension therefore uses a conservative preference order rather than assuming stable hardcoded pricing.
- If your Copilot CLI install exposes a smaller model set, the router should still work by falling through its candidate list until a switch succeeds.
