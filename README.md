# multi-model-skill

A Copilot CLI skill, with an optional repo-local extension, for cost-aware model routing.

## What It Does

Routes Copilot CLI work to the lowest-cost viable model based on task type and complexity. The current extension also bumps tool-heavy implementation work from economy candidates to builder candidates.

- **Economy tier** → Quick Q&A, simple edits, lightweight exploration
- **Standard builder tier** → Normal implementation, multi-file work, tool-heavy implementation
- **Reasoning tier** → Complex planning, difficult debugging, explicit code review

## Key Features

- ✅ **Optional automatic model switching** - The repo-local extension can switch models before each turn
- ✅ **Tool-aware implementation routing** - Tool keywords can move implementation work from economy to builder candidates
- ✅ **Cost-optimized** - Prefers cheaper models for lightweight work and escalates only when the classifier does
- ✅ **Explicit review only** - No forced post-implementation review; review mode only starts on explicit review phrases
- ✅ **Review diversity** - For explicit review, prefers a different model than the last implementation model when available
- ✅ **Graceful fallback** - If preferred model unavailable, tries next candidate in tier  

## Installation

### Option 1: Plugin Installation (Easiest)

Install the model-router as a Copilot CLI plugin:

```bash
copilot plugin install kdaigle/multi-model-skill
```

This installs the plugin for your current project. To list installed plugins:

```bash
copilot /plugin list
```

### Option 2: Git Clone (Project-specific)

Install the skill for a single repository:

```bash
# Clone the repository temporarily
git clone https://github.com/kdaigle/multi-model-skill.git /tmp/multi-model-skill

# Copy the skill to your project
mkdir -p .github/skills
cp -r /tmp/multi-model-skill/.github/skills/model-router .github/skills/
cp /tmp/multi-model-skill/.github/copilot-instructions.md .github/

# Optional: Copy the extension for automatic model switching
mkdir -p .github/extensions  
cp -r /tmp/multi-model-skill/.github/extensions/model-router .github/extensions/

# Clean up
rm -rf /tmp/multi-model-skill
```

### Option 3: Personal Installation

Install the skill globally for all your projects:

```bash
# Clone the repository temporarily
git clone https://github.com/kdaigle/multi-model-skill.git /tmp/multi-model-skill

# Copy to your personal skills directory
mkdir -p ~/.copilot/skills
cp -r /tmp/multi-model-skill/.github/skills/model-router ~/.copilot/skills/

# Clean up
rm -rf /tmp/multi-model-skill
```

### After Installation

If Copilot CLI is already running, reload skills:

```bash
/skills reload
```

Verify installation:

```bash
/skills list
/skills info model-router
```

### What Gets Installed

This repository contains:
- **Skill** (`.github/skills/model-router/`) — Routing guidance that Copilot can load when relevant, or when you invoke `/model-router`
- **Instructions** (`.github/copilot-instructions.md`) — Repo guidance for using the skill consistently
- **Optional extension** (`.github/extensions/model-router/`) — Repo-local hook that can switch models before each prompt

After copying the skill:
- Copilot can load it when the prompt matches the skill description
- You can invoke it explicitly with `/model-router`
- If you added the extension too, the extension can apply automatic model switching for this repository

## How It Works

### Skill (`SKILL.md`)
- Provides routing policy documentation and heuristics
- May be selected by Copilot when relevant to the prompt
- Can also be invoked explicitly with `/model-router`

### Policy module (`policy.mjs`)
- Single source-of-truth for all routing constants and pure functions
- Exports `MODEL_CANDIDATES` (tiers + reasoning efforts), `MODEL_FAMILIES` (auto-derived), keyword arrays, and all classification helpers
- Edit this file to change model lists, keywords, or routing logic

### Optional extension (`extension.mjs`)
- Imports all routing logic from `policy.mjs`
- Runs as a subprocess communicating with Copilot CLI over JSON-RPC
- Runs the `onUserPromptSubmitted` hook before each message
- Selects and switches models before sending to agent
- Tracks last implementation model to prefer different model for review

### Routing Matrix (`references/routing-matrix.md`)
- Detailed task-to-model mapping
- Cost tier organization (Economy, Standard Builder, Reasoning)
- Tool-calling capability breakdown
- Diversity-of-thought rule for review

## Tool-Aware Routing

The extension detects tool keywords and adds complexity for implementation prompts:

**Keywords detected:**
- Execution: `bash`, `curl`, `execute`, `run`, `script`, `command`, `shell`
- Integration: `api`, `http`, `endpoint`, `request`, `function`
- Orchestration: `tool`, `call`, `invoke`, `agent`

**Current routing behavior:**
- **Lightweight or non-implementation work** → usually stays in economy unless other complexity signals apply
- **Tool-heavy implementation** → moves to builder candidates
- **Planning, debugging, and explicit review** → may escalate to reasoning candidates based on the classifier

## Model Coverage

### Economy Tier
- `claude-haiku-4.5` (strong tool calling, best value)
- `gpt-4.1`
- `gpt-5-mini`, `gpt-5.4-mini`

### Standard Builder Tier
- `claude-sonnet-4`, `claude-sonnet-4.5`
- `claude-sonnet-4.6` (builder-tier candidate with medium reasoning effort)
- `gpt-5.1`, `gpt-5.2`, `gpt-5.3-codex`, `gpt-5.1-codex`

### Reasoning Tier
- `gpt-5`, `gpt-5.4`
- `claude-sonnet-4.6` (high-reasoning fallback for hard planning, debugging, or review)
- `claude-opus-4.5`, `claude-opus-4.6`, `claude-opus-4.6-1m`
- `gpt-5.1-codex-max`

> **Source of truth:** Model lists and reasoning efforts are defined in
> `.github/extensions/model-router/policy.mjs`. Edit that file to add or
> remove models — the extension and docs should stay in sync automatically.

## Usage Examples

### Simple Classification
```
User: "What does this function do?"
→ Economy tier (Haiku 4.5) — quick explanation
```

### Tool-Heavy Implementation
```
User: "Write a bash script that fetches data from an API and processes it with curl"
→ Routes to builder candidates because the implementation prompt is tool-heavy
```

### Explicit Code Review
```
User: "Review my PR for bugs and security issues"
→ Reasoning candidates first
→ Uses different model than last implementation if available
```

## Evaluation

The `eval/` directory contains a local-first harness for comparing router-enabled runs against a fixed-model baseline on the same task. See [`eval/README.md`](eval/README.md) for local usage, result interpretation, and cost metrics. CI setup is documented in [`eval/docs/ci-setup.md`](eval/docs/ci-setup.md).

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
│       ├── policy.mjs                        # Source-of-truth: model lists, keywords, pure functions
│       └── extension.mjs                     # Runtime extension (imports from policy.mjs)
└── copilot-instructions.md                   # Instructions for skill activation
tests/
└── routing-policy.test.mjs                   # Regression tests for shared routing helpers
```

## How Routing Decisions Are Made

1. **Classify the prompt**: Detect task type (implementation, planning, debugging, review, lightweight)
2. **Score complexity**: Based on word count, keywords, and tool usage
3. **Determine candidate tier**: Economy, builder, or reasoning based on task type + complexity
4. **Select candidate model**: Choose from tier's model list in order of preference
5. **Apply diversity rule**: For review, prefer different model than last implementation
6. **Switch model**: Call `session.rpc.model.switchTo()` before the agent sees the prompt
7. **Log decision**: Surface the choice via `session.log()` for transparency

## Diversity-of-Thought Rule

When you explicitly ask for a code review:
- Prefers a different **model family** when possible (for example, Claude-based for build and GPT-based for review)
- Falls back to different concrete model in same family if needed
- Gracefully reuses current model if no alternative available

This aims to improve review quality by using different reasoning patterns when an alternative is available.

## Complexity Scoring

Factors that increase complexity score:
- Prompt length (>40 words +1, >100 words +1)
- Keywords: multi-file, end-to-end, carefully, thorough, complex, large, entire codebase (+2)
- Task type: planning, debugging (+1)
- Tool keywords: bash, curl, api, execute (+1)

Higher scores escalate from economy → builder → reasoning tiers.

## Explicit Review Only

**Important:** This router does NOT automatically review code after implementation.

Review mode triggers only on explicit phrases such as:
- "review", "code review", "review this", "review my code", "audit", "approval readiness", "approve this", "PR review"

Generic mentions of "bug" or "security" do not trigger review mode by themselves.

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

All routing constants and pure functions live in a single file — edit it to change behaviour:

```
.github/extensions/model-router/policy.mjs
```

1. **Model candidates**: Modify `MODEL_CANDIDATES` (tiers + reasoning efforts). `MODEL_FAMILIES` is derived automatically.
2. **Task keywords**: Modify `PLAN_KEYWORDS`, `DEBUG_KEYWORDS`, `IMPLEMENT_KEYWORDS`, `LIGHT_KEYWORDS`
3. **Tool keywords**: Modify `TOOL_KEYWORDS` and `ORCHESTRATION_KEYWORDS`
4. **Complexity scoring**: Adjust `getComplexity()` in `policy.mjs`
5. **Routing policy**: Update `references/routing-matrix.md` to reflect any changes

After changing the skill during a live CLI session, reload skills:
```bash
/skills reload
```

If you changed the extension, restart the relevant Copilot CLI session so the repo-local extension is reloaded.

## Technical Details

- **Extension framework**: GitHub Copilot SDK for Node.js
- **Communication**: JSON-RPC over stdio (no console.log; use `session.log()`)
- **Hook**: `onUserPromptSubmitted` fires before each user message
- **Model switching**: `session.rpc.model.switchTo({ modelId, reasoningEffort })`
- **Reasoning effort**: The extension requests `low`, `medium`, or `high` where supported

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
