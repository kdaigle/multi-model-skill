/**
 * Model routing policy — single source of truth.
 *
 * MODEL_CANDIDATES is the authoritative runtime data. Everything else—
 * MODEL_FAMILIES, routing-matrix.md tables, and the README Model Coverage
 * section—is derived from or mirrors this object. Update here first, then
 * reflect the change in the human-readable documents.
 *
 * This module is pure (no SDK imports, no side effects) so it can be
 * imported by both extension.mjs and the test suite.
 */

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

export const MODEL_CANDIDATES = {
  economy: [
    { id: "claude-haiku-4.5", reasoningEffort: null },
    { id: "gpt-4.1", reasoningEffort: null },
    { id: "gpt-5-mini", reasoningEffort: "low" },
    { id: "gpt-5.4-mini", reasoningEffort: "low" },
  ],
  builder: [
    // Reasoning-capable models listed first for better implementation quality
    { id: "claude-sonnet-4.6", reasoningEffort: "medium" },
    { id: "gpt-5.2", reasoningEffort: "medium" },
    { id: "gpt-5.3-codex", reasoningEffort: "medium" },
    { id: "gpt-5.1-codex", reasoningEffort: "medium" },
    { id: "gpt-5.1", reasoningEffort: "medium" },
    // Non-reasoning fallbacks
    { id: "claude-sonnet-4", reasoningEffort: null },
    { id: "claude-sonnet-4.5", reasoningEffort: null },
  ],
  reasoning: [
    { id: "gpt-5", reasoningEffort: "high" },
    { id: "gpt-5.4", reasoningEffort: "high" },
    { id: "claude-sonnet-4.6", reasoningEffort: "high" },
    { id: "claude-opus-4.5", reasoningEffort: null },
    { id: "claude-opus-4.6", reasoningEffort: null },
    { id: "claude-opus-4.6-1m", reasoningEffort: null },
    { id: "gpt-5.1-codex-max", reasoningEffort: "high" },
  ],
};

// Derived automatically from MODEL_CANDIDATES so it never drifts.
// When you add or remove a model above, this stays correct for free.
export const MODEL_FAMILIES = (() => {
  const claude = new Set();
  const gpt = new Set();
  for (const tier of Object.values(MODEL_CANDIDATES)) {
    for (const { id } of tier) {
      if (id.startsWith("claude")) claude.add(id);
      else if (id.startsWith("gpt")) gpt.add(id);
    }
  }
  return { claude, gpt };
})();

// ---------------------------------------------------------------------------
// Keyword lists
// ---------------------------------------------------------------------------

export const EXPLICIT_REVIEW_KEYWORDS = [
  "review",
  "code review",
  "review this",
  "review the code",
  "review my code",
  "audit",
  "approval readiness",
  "approval readiness checks",
  "approve this",
  "pr review",
  // Bug finding, regression hunting, and approval-readiness are explicit review asks per SKILL.md
  "find bugs",
  "bug finding",
  "regression hunting",
  "regression hunt",
  "find regressions",
];

export const PLAN_KEYWORDS = [
  "plan",
  "design",
  "architecture",
  "architect",
  "proposal",
  "strategy",
  "approach",
];

export const DEBUG_KEYWORDS = [
  "debug",
  "fix",
  "failure",
  "failing",
  "error",
  "crash",
  "root cause",
  "broken",
  "investigate",
];

export const IMPLEMENT_KEYWORDS = [
  "implement",
  "build",
  "create",
  "write",
  "refactor",
  "add",
  "change",
  "update",
  "edit",
  "enhance",
  "modify",
  "adjust",
  "improve",
  "fix the code",
  "fix the formatting",
  "fix the logic",
];

export const LIGHT_KEYWORDS = [
  "explain",
  "summarize",
  "what is",
  "where is",
  "find",
  "list",
  "show",
  "search",
];

export const TOOL_KEYWORDS = [
  "bash",
  "curl",
  "execute",
  "run",
  "tool",
  "api",
  "function",
  "call",
  "invoke",
  "script",
  "command",
  "shell",
  "http",
  "request",
  "endpoint",
  "agent",
];

// Complex multi-tool orchestration patterns warrant reasoning-tier escalation.
// Only multi-word action phrases are included; bare "orchestrate"/"orchestration" caused
// false positives when tasks merely mentioned these concepts in documentation context.
export const ORCHESTRATION_KEYWORDS = [
  "parallel agents",
  "multiple agents",
  "multi-agent",
  "parallel tools",
  "tool chain",
  "chained tools",
];

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

export function getModelFamily(modelId) {
  if (!modelId) return null;
  if (MODEL_FAMILIES.claude.has(modelId)) return "claude";
  if (MODEL_FAMILIES.gpt.has(modelId)) return "gpt";
  return null;
}

export function normalizePrompt(prompt) {
  return String(prompt || "").toLowerCase();
}

// Word-boundary-aware matching prevents false positives like "prefix"→"fix",
// "exchange"→"change", "callback"→"call". Multi-word phrases use substring matching.
export function matchesPattern(text, pattern) {
  if (/\s/.test(pattern)) {
    return text.includes(pattern);
  }
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

export function includesAny(text, patterns) {
  return patterns.some((pattern) => matchesPattern(text, pattern));
}

export function isExplicitReviewRequest(text) {
  return includesAny(text, EXPLICIT_REVIEW_KEYWORDS);
}

export function isToolHeavy(text) {
  return includesAny(text, TOOL_KEYWORDS);
}

export function isComplexOrchestration(text) {
  return includesAny(text, ORCHESTRATION_KEYWORDS);
}

export function getComplexity(prompt) {
  const lower = normalizePrompt(prompt);
  const words = lower.trim().split(/\s+/).filter(Boolean).length;
  let score = 0;

  if (words > 40) score += 1;
  if (words > 100) score += 1;
  if (
    includesAny(lower, [
      "multi-file",
      "multiple files",
      "end-to-end",
      "carefully",
      "thorough",
      "deep",
      "complex",
      "large",
      "entire codebase",
    ])
  ) {
    score += 2;
  }

  if (includesAny(lower, PLAN_KEYWORDS) || includesAny(lower, DEBUG_KEYWORDS)) {
    score += 1;
  }

  // File path detection (/.github/, /src/, /lib/, etc.) indicates code changes
  if (/\/[\w-]+\/[\w.-]+/.test(lower)) {
    score += 1;
  }

  if (isToolHeavy(lower)) {
    score += 1;
  }

  return score;
}

export function classifyPrompt(prompt) {
  const lower = normalizePrompt(prompt);
  const complexity = getComplexity(lower);

  if (isExplicitReviewRequest(lower)) {
    return { kind: "review", complexity, tier: "reasoning" };
  }

  if (includesAny(lower, PLAN_KEYWORDS)) {
    return {
      kind: "planning",
      complexity,
      tier: complexity >= 3 ? "reasoning" : "builder",
    };
  }

  if (includesAny(lower, DEBUG_KEYWORDS)) {
    return {
      kind: "debugging",
      complexity,
      tier: complexity >= 3 ? "reasoning" : "builder",
    };
  }

  if (includesAny(lower, IMPLEMENT_KEYWORDS)) {
    let tier = "builder"; // default to builder for all implementation

    // Light-keyword + zero complexity stays in economy
    if (includesAny(lower, LIGHT_KEYWORDS) && complexity === 0) {
      tier = "economy";
    }

    // Escalate for genuine complex orchestration
    if (isComplexOrchestration(lower) && complexity >= 2) {
      tier = "reasoning";
    }

    // Escalate when deeply complex overall
    if (complexity >= 4) {
      tier = "reasoning";
    }

    return {
      kind: "implementation",
      complexity,
      tier,
      toolHeavy: isToolHeavy(lower),
    };
  }

  if (includesAny(lower, LIGHT_KEYWORDS) || complexity === 0) {
    return { kind: "lightweight", complexity, tier: "economy" };
  }

  let generalTier = complexity >= 2 ? "builder" : "economy";
  if (isToolHeavy(lower) && complexity >= 1) generalTier = "builder";
  if (isComplexOrchestration(lower) && complexity >= 2) generalTier = "reasoning";
  return { kind: "general", complexity, tier: generalTier };
}

export function getTierCandidates(route) {
  if (route.kind === "review") {
    return [
      ...MODEL_CANDIDATES.reasoning,
      ...MODEL_CANDIDATES.builder,
      ...MODEL_CANDIDATES.economy,
    ];
  }

  if (route.kind === "planning" || route.kind === "debugging") {
    return route.tier === "reasoning"
      ? [...MODEL_CANDIDATES.reasoning, ...MODEL_CANDIDATES.builder]
      : [...MODEL_CANDIDATES.builder, ...MODEL_CANDIDATES.reasoning, ...MODEL_CANDIDATES.economy];
  }

  if (route.kind === "implementation" || route.kind === "general") {
    return route.tier === "builder"
      ? [...MODEL_CANDIDATES.builder, ...MODEL_CANDIDATES.reasoning, ...MODEL_CANDIDATES.economy]
      : [...MODEL_CANDIDATES.economy, ...MODEL_CANDIDATES.builder, ...MODEL_CANDIDATES.reasoning];
  }

  return [...MODEL_CANDIDATES.economy, ...MODEL_CANDIDATES.builder, ...MODEL_CANDIDATES.reasoning];
}

export function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.id}:${candidate.reasoningEffort || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isSameModelFamily(first, second) {
  if (!first || !second) return false;
  const family = (model) => {
    if (model.startsWith("claude-haiku")) return "claude-haiku";
    if (model.startsWith("claude-sonnet")) return "claude-sonnet";
    if (model.startsWith("claude-opus")) return "claude-opus";
    if (model.includes("codex")) return "codex";
    if (model.startsWith("gpt-5")) return "gpt-5";
    if (model.startsWith("gpt-4.1")) return "gpt-4.1";
    return model;
  };
  return family(first) === family(second);
}

/**
 * Re-order candidates for review diversity: models from a different family
 * than lastImplModel float to the front.
 *
 * Accepts lastImplModel as an explicit parameter (rather than reading module
 * state) so the function stays pure and testable.
 */
export function orderCandidates(candidates, route, lastImplModel = null) {
  if (route.kind !== "review" || !lastImplModel) {
    return candidates;
  }
  return [...candidates].sort((left, right) => {
    const leftSame =
      left.id === lastImplModel ? 2 : isSameModelFamily(left.id, lastImplModel) ? 1 : 0;
    const rightSame =
      right.id === lastImplModel ? 2 : isSameModelFamily(right.id, lastImplModel) ? 1 : 0;
    return leftSame - rightSame; // lower "sameness" score → earlier in list
  });
}

/**
 * Build the additionalContext string surfaced to the agent.
 *
 * lastImplModel is passed explicitly so this stays pure and testable.
 */
export function buildAdditionalContext(decision, currentModelId, lastImplModel = null) {
  const lines = [
    "Model routing policy is active.",
    `Current task class: ${decision.kind}.`,
    `Selected model for this turn: ${decision.selectedModelId || currentModelId || "unchanged-current-model"}.`,
  ];

  if (decision.reasoningEffort) {
    lines.push(`Reasoning effort: ${decision.reasoningEffort}.`);
  }

  if (decision.kind === "review" && lastImplModel) {
    lines.push(`Prefer review diversity versus implementation model ${lastImplModel}.`);
    if (decision.selectedModelId === lastImplModel) {
      lines.push(
        "A distinct review model was not available, so the router fell back to the current best option.",
      );
    }
  }

  if (decision.kind === "lightweight") {
    lines.push("Keep the solution lean and avoid premium-model depth unless the task expands.");
  }

  if (
    (decision.kind === "implementation" || decision.kind === "general") &&
    decision.complexity <= 2
  ) {
    lines.push(
      "Inspect only the most relevant file(s). Implement directly without extensive planning.",
    );
  }

  if (decision.kind === "planning" || decision.kind === "debugging") {
    lines.push("Favor strong reasoning and structured analysis before acting.");
  }

  return lines.join(" ");
}
