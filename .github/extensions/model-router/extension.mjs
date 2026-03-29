import { joinSession } from "@github/copilot-sdk/extension";

const MODEL_CANDIDATES = {
  economy: [
    { id: "claude-haiku-4.5" },
    { id: "gpt-4.1" },
    { id: "gpt-5-mini", reasoningEffort: "low" },
    { id: "gpt-5.4-mini", reasoningEffort: "low" },
  ],
  builder: [
    { id: "claude-sonnet-4" },
    { id: "claude-sonnet-4.5" },
    { id: "claude-sonnet-4.6", reasoningEffort: "medium" },
    { id: "gpt-5.1", reasoningEffort: "medium" },
    { id: "gpt-5.2", reasoningEffort: "medium" },
    { id: "gpt-5.3-codex", reasoningEffort: "medium" },
    { id: "gpt-5.1-codex", reasoningEffort: "medium" },
  ],
  reasoning: [
    { id: "gpt-5", reasoningEffort: "high" },
    { id: "gpt-5.4", reasoningEffort: "high" },
    { id: "claude-sonnet-4.6", reasoningEffort: "high" },
    { id: "claude-opus-4.5" },
    { id: "claude-opus-4.6" },
    { id: "claude-opus-4.6-1m" },
    { id: "gpt-5.1-codex-max", reasoningEffort: "high" },
  ],
};

const EXPLICIT_REVIEW_KEYWORDS = [
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

const PLAN_KEYWORDS = [
  "plan",
  "design",
  "architecture",
  "architect",
  "proposal",
  "strategy",
  "approach",
];

const DEBUG_KEYWORDS = [
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

const IMPLEMENT_KEYWORDS = [
  "implement",
  "build",
  "create",
  "write",
  "refactor",
  "add",
  "change",
  "update",
  "edit",
];

const LIGHT_KEYWORDS = [
  "explain",
  "summarize",
  "what is",
  "where is",
  "find",
  "list",
  "show",
  "search",
];

const TOOL_KEYWORDS = [
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

// Complex multi-tool orchestration patterns warrant premium-tier escalation per routing-matrix.md
const ORCHESTRATION_KEYWORDS = [
  "parallel agents",
  "multiple agents",
  "multi-agent",
  "orchestrate",
  "orchestration",
  "parallel tools",
  "tool chain",
  "chained tools",
];

let lastImplementationModel = null;
let lastReviewModel = null;
let lastDecision = null;

function normalizePrompt(prompt) {
  return String(prompt || "").toLowerCase();
}

// Word-boundary-aware matching prevents false positives like "prefix"→"fix",
// "exchange"→"change", "callback"→"call". Multi-word phrases use substring matching.
function matchesPattern(text, pattern) {
  if (/\s/.test(pattern)) {
    return text.includes(pattern);
  }
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => matchesPattern(text, pattern));
}

function isExplicitReviewRequest(text) {
  return includesAny(text, EXPLICIT_REVIEW_KEYWORDS);
}

function isToolHeavy(text) {
  return includesAny(text, TOOL_KEYWORDS);
}

function isComplexOrchestration(text) {
  return includesAny(text, ORCHESTRATION_KEYWORDS);
}

function getComplexity(prompt) {
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

  // Tool-heavy work deserves more robust models
  if (isToolHeavy(lower)) {
    score += 1;
  }

  return score;
}

function classifyPrompt(prompt) {
  const lower = normalizePrompt(prompt);
  const complexity = getComplexity(lower);

  if (isExplicitReviewRequest(lower)) {
    return { kind: "review", complexity, tier: "reasoning" };
  }

  if (includesAny(lower, PLAN_KEYWORDS)) {
    return {
      kind: "planning",
      complexity,
      tier: complexity >= 2 ? "reasoning" : "builder",
    };
  }

  if (includesAny(lower, DEBUG_KEYWORDS)) {
    return {
      kind: "debugging",
      complexity,
      tier: complexity >= 2 ? "reasoning" : "builder",
    };
  }

  if (includesAny(lower, IMPLEMENT_KEYWORDS)) {
    // Tool-heavy implementation should use stronger models for orchestration
    let tier = complexity >= 2 ? "builder" : "economy";
    if (isToolHeavy(lower) && complexity >= 1) {
      tier = "builder";
    }
    // Complex multi-tool orchestration (parallel agents, tool chains, etc.) warrants premium
    if (isComplexOrchestration(lower)) {
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
  if (isComplexOrchestration(lower)) generalTier = "reasoning";
  return { kind: "general", complexity, tier: generalTier };
}

function getTierCandidates(route) {
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

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.id}:${candidate.reasoningEffort || ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isSameModelFamily(first, second) {
  if (!first || !second) {
    return false;
  }

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

function orderCandidates(candidates, route) {
  if (route.kind !== "review" || !lastImplementationModel) {
    return candidates;
  }

  return [...candidates].sort((left, right) => {
    const leftSame = left.id === lastImplementationModel ? 2 : isSameModelFamily(left.id, lastImplementationModel) ? 1 : 0;
    const rightSame = right.id === lastImplementationModel ? 2 : isSameModelFamily(right.id, lastImplementationModel) ? 1 : 0;
    return leftSame - rightSame;
  });
}

function buildAdditionalContext(decision, currentModelId) {
  const lines = [
    "Model routing policy is active.",
    `Current task class: ${decision.kind}.`,
    `Selected model for this turn: ${decision.selectedModelId || currentModelId || "unchanged-current-model"}.`,
  ];

  if (decision.reasoningEffort) {
    lines.push(`Reasoning effort: ${decision.reasoningEffort}.`);
  }

  if (decision.kind === "review" && lastImplementationModel) {
    lines.push(`Prefer review diversity versus implementation model ${lastImplementationModel}.`);
    if (decision.selectedModelId === lastImplementationModel) {
      lines.push("A distinct review model was not available, so the router fell back to the current best option.");
    }
  }

  if (decision.kind === "lightweight") {
    lines.push("Keep the solution lean and avoid premium-model depth unless the task expands.");
  }

  if (decision.kind === "planning" || decision.kind === "debugging") {
    lines.push("Favor strong reasoning and structured analysis before acting.");
  }

  return lines.join(" ");
}

async function trySwitchModel(session, route, currentModelId) {
  let candidates = orderCandidates(dedupeCandidates(getTierCandidates(route)), route);

  // Always exclude the current model when known, regardless of task kind.
  if (currentModelId) {
    candidates = candidates.filter((candidate) => candidate.id !== currentModelId);
  }

  // For review diversity: exclude the last implementation model unconditionally so the
  // filter applies even when getCurrent() fails and currentModelId is undefined.
  if (route.kind === "review" && lastImplementationModel) {
    candidates = candidates.filter((candidate) => candidate.id !== lastImplementationModel);
  }

  let selected = null;

  for (const candidate of candidates) {
    try {
      await session.rpc.model.switchTo({
        modelId: candidate.id,
        reasoningEffort: candidate.reasoningEffort,
      });
      selected = candidate;
      break;
    } catch {
      continue;
    }
  }

  if (!selected) {
    selected = {
      id: currentModelId || null,
      reasoningEffort: null,
    };
  }

  return selected;
}

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      await session.log("model-router loaded", { ephemeral: true });
      return {
        additionalContext:
          "The model-router extension is available. Favor the lowest-cost viable model and prefer a different model for review than implementation when possible.",
      };
    },
    onUserPromptSubmitted: async (input) => {
      const route = classifyPrompt(input.prompt);
      const current = await session.rpc.model.getCurrent().catch(() => ({ modelId: undefined }));
      const chosen = await trySwitchModel(session, route, current.modelId);

      if (route.kind === "implementation" || route.kind === "debugging") {
        lastImplementationModel = chosen.id || current.modelId || lastImplementationModel;
      }

      if (route.kind === "review") {
        lastReviewModel = chosen.id || current.modelId || lastReviewModel;
      }

      lastDecision = {
        kind: route.kind,
        complexity: route.complexity,
        selectedModelId: chosen.id || current.modelId || null,
        reasoningEffort: chosen.reasoningEffort || null,
      };

      await session.log(
        `model-router: ${route.kind} -> ${lastDecision.selectedModelId || "current model"}`,
        { ephemeral: true },
      );

      return {
        additionalContext: buildAdditionalContext(lastDecision, current.modelId),
      };
    },
  },
  tools: [
    {
      name: "model_router_status",
      description: "Show the current model-router decision state for this Copilot CLI session.",
      parameters: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const current = await session.rpc.model.getCurrent().catch(() => ({ modelId: undefined }));
        return JSON.stringify(
          {
            currentModel: current.modelId || null,
            lastImplementationModel,
            lastReviewModel,
            lastDecision,
          },
          null,
          2,
        );
      },
    },
  ],
});
