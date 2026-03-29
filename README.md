# multi-model-skill

A Copilot CLI skill + extension for automatic cost-optimized model routing with tool-aware capabilities.

## What It Does

Routes Copilot CLI work to the lowest-cost viable model based on task complexity and type, with automatic escalation to stronger models when needed. Includes tool-aware routing to match models to their tool-calling strengths.

- **Economy tier** → Quick Q&A, simple edits, lightweight exploration
- **Standard builder tier** → Normal implementation, multi-file work, tool-heavy tasks
- **Premium reasoning tier** → Complex planning, difficult debugging, explicit code review

## Key Features

✅ **Automatic model switching** - Extension runs in background and routes tasks  
✅ **Tool-aware routing** - Detects tool keywords (bash, curl, API, etc.) and escalates appropriately  
✅ **Cost-optimized** - Prefers cheap models for simple tasks, saves expensive models for when they matter  
✅ **Explicit review only** - No forced post-implementation review; review triggers only on explicit request  
✅ **Review diversity** - When reviewing code, prefers a different model than implementation if available  
✅ **Graceful fallback** - If preferred model unavailable, tries next candidate in tier  

## Installation

This is a project-local Copilot CLI skill + extension. To use:

1. Clone this repo into your project:
   ```bash
   git clone https://github.com/kdaigle/multi-model-skill.git
   # or copy the `.github/` directory to your project
   ```

2. The extension is in `.github/extensions/model-router/` — it will auto-load when you use Copilot CLI in this directory.

3. The skill is in `.github/skills/model-router/` — it auto-triggers when your request mentions cost, model, review, or optimization.

## How It Works

### Skill (`SKILL.md`)
- Provides routing policy documentation and heuristics
- Triggered automatically by AI intent matching on keywords
- Referenced when detailed routing context is needed

### Extension (`extension.mjs`)
- Runs as a subprocess communicating with Copilot CLI over JSON-RPC
- Runs the `onUserPromptSubmitted` hook before each message
- Classifies the prompt to determine task type and complexity
- Selects and switches models before sending to agent
- Tracks last implementation model to prefer different model for review

### Routing Matrix (`references/routing-matrix.md`)
- Detailed task-to-model mapping
- Cost tier organization (Economy, Standard Builder, Premium Reasoning)
- Tool-calling capability breakdown
- Diversity-of-thought rule for review

## Tool-Aware Routing

The router automatically detects tool keywords and escalates complexity:

**Keywords detected:**
- Execution: `bash`, `curl`, `execute`, `run`, `script`, `command`, `shell`
- Integration: `api`, `http`, `endpoint`, `request`, `function`
- Orchestration: `tool`, `call`, `invoke`, `agent`

**Escalation logic:**
- **Single/light tool calls** → Economy tier works great (Haiku 4.5 has strong tool support)
- **Multi-tool chains** → Standard Builder tier for better orchestration
- **Complex parallel orchestration** → Premium tier (Opus 4.6, GPT-5.4) with agent support

## Model Coverage

### Economy Tier
- `claude-haiku-4.5` (strong tool calling, best value)
- `gpt-4.1`
- `gpt-5-mini`, `gpt-5.4-mini`

### Standard Builder Tier
- `claude-sonnet-4`, `claude-sonnet-4.5`
- `claude-sonnet-4.6` (improved tool orchestration)
- `gpt-5.1`, `gpt-5.2`, `gpt-5.3-codex`, `gpt-5.1-codex`

### Premium Reasoning Tier
- `gpt-5`, `gpt-5.4` (best-in-class tool calling, free-form support)
- `claude-opus-4.5`, `claude-opus-4.6`, `claude-opus-4.6-1m` (parallel agents)
- `gpt-5.1-codex-max`

## Usage Examples

### Simple Classification
```
User: "What does this function do?"
→ Economy tier (Haiku 4.5) — quick explanation
```

### Tool-Heavy Implementation
```
User: "Write a bash script that fetches data from an API and processes it with curl"
→ Automatically escalates to Standard Builder (Sonnet 4.6 or GPT-5.1) 
   due to bash/curl/api keywords
```

### Explicit Code Review
```
User: "Review my PR for bugs and security issues"
→ Premium tier (GPT-5.4 or Opus 4.6)
→ Uses different model than last implementation if available
```

## Files

```
.github/
├── skills/
│   └── model-router/
│       ├── SKILL.md                          # Skill definition & routing heuristics
│       └── references/
│           └── routing-matrix.md             # Detailed model tier & task mapping
├── extensions/
│   └── model-router/
│       └── extension.mjs                     # Runtime extension for auto-switching
└── copilot-instructions.md                   # Instructions for skill activation
```

## How Routing Decisions Are Made

1. **Classify the prompt**: Detect task type (implementation, planning, debugging, review, lightweight)
2. **Score complexity**: Based on word count, keywords, and tool usage
3. **Determine tier**: Lightweight/economy → builder → reasoning based on task type + complexity
4. **Select candidate model**: Choose from tier's model list in order of preference
5. **Apply diversity rule**: For review, prefer different model than last implementation
6. **Switch model**: Call `session.rpc.model.switchTo()` before the agent sees the prompt
7. **Log decision**: Surface the choice via `session.log()` for transparency

## Diversity-of-Thought Rule

When you explicitly ask for a code review:
- Prefers a different **model family** (e.g., Claude-based for build, GPT-based for review)
- Falls back to different concrete model in same family if needed
- Gracefully reuses current model if no alternative available

This improves review quality by using different reasoning patterns.

## Complexity Scoring

Factors that increase complexity score:
- Prompt length (>40 words +1, >100 words +1)
- Keywords: multi-file, end-to-end, carefully, thorough, complex, large, entire codebase (+2)
- Task type: planning, debugging (+1)
- Tool keywords: bash, curl, api, execute (+1)

Higher scores escalate from economy → builder → reasoning tiers.

## Explicit Review Only

**Important:** This router does NOT automatically review code after implementation.

Review mode triggers ONLY when you explicitly ask:
- "review", "code review", "audit", "approval readiness", "review this", "review my code", "approve this", "PR review"

Generic mentions of "bug" or "security" do NOT trigger review mode—only explicit review keywords do.

## Extension Status

Check the extension status with the `/model_router_status` tool:

```
/model_router_status
```

Returns:
- Current model
- Last decision (task type, complexity, selected tier & model)
- Last implementation model (used for review diversity tracking)
- Last review model

## Customization

To modify routing decisions, edit:

1. **Task keywords**: Modify `PLAN_KEYWORDS`, `DEBUG_KEYWORDS`, `IMPLEMENT_KEYWORDS` in `extension.mjs`
2. **Tool keywords**: Modify `TOOL_KEYWORDS` in `extension.mjs`
3. **Model candidates**: Modify `MODEL_CANDIDATES` object in `extension.mjs`
4. **Complexity scoring**: Adjust `getComplexity()` function in `extension.mjs`
5. **Routing policy**: Update `references/routing-matrix.md` with new task-to-model mappings

## Technical Details

- **Extension framework**: GitHub Copilot SDK for Node.js
- **Communication**: JSON-RPC over stdio (no console.log; use `session.log()`)
- **Hook**: `onUserPromptSubmitted` fires before each user message
- **Model switching**: `session.rpc.model.switchTo({ modelId, reasoningEffort })`
- **Reasoning effort**: Supported by GPT models and Claude Sonnet/Opus (values: low/medium/high)

## License

MIT

## Contributing

Improvements welcome! Consider:
- Adding more task type detection
- Tuning complexity scoring
- Expanding tool keyword detection
- Testing against real-world prompts

---

**Repository:** https://github.com/kdaigle/multi-model-skill  
**Skill auto-triggers on:** "cost", "model", "review", "optimize", "cheap", "expensive", etc.
