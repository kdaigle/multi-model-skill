import { joinSession } from "@github/copilot-sdk/extension";

const MODEL_CANDIDATES = {
  economy: [
    { id: "claude-haiku-4.5" },
    { id: "gpt-4.1" },
    { id: "gpt-5-mini", reasoningEffort: "low" },
    { id: "gpt-5.4-mini", reasoningEffort: "low" },
  ],
  builder: [
    // Prioritize models with reasoning support for better implementation quality
    { id: "claude-sonnet-4.6", reasoningEffort: "medium" },
    { id: "gpt-5.2", reasoningEffort: "medium" },
    { id: "gpt-5.3-codex", reasoningEffort: "medium" },
    { id: "gpt-5.1-codex", reasoningEffort: "medium" },
    { id: "gpt-5.1", reasoningEffort: "medium" },
    // Non-reasoning models as fallback
    { id: "claude-sonnet-4" },
    { id: "claude-sonnet-4.5" },
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
  "enhance",
  "modify",
  "adjust",
  "improve",
  "fix the code",
  "fix the formatting",
  "fix the logic",
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

// Complex multi-tool orchestration patterns warrant premium-tier escalation per routing-matrix.md.
// Only multi-word action phrases are included; bare "orchestrate"/"orchestration" caused
// false positives when tasks merely mentioned these concepts in documentation context.
const ORCHESTRATION_KEYWORDS = [
  "parallel agents",
  "multiple agents",
  "multi-agent",
  "parallel tools",
  "tool chain",
  "chained tools",
];

let lastImplementationModel = null;
let lastReviewModel = null;
let lastDecision = null;

// Confusion detection: tracks signs agent may be stuck or looping.
// We err on the side of waiting slightly too long to swap rather than switching prematurely,
// especially when the agent is in active thinking (reasoning display enabled).
const confusionMetrics = {
  turnCount: 0,
  recentMessages: [], // Last N agent messages for loop detection
  errorCount: 0,
  repeatedPatternCount: 0,
  lastSwitchTurn: -999, // Turn when we last switched due to confusion
  currentModelFamily: null, // Track which model family is in use
};

const CONFUSION_THRESHOLDS = {
  minTurnsSinceLastSwitch: 5, // Don't switch more than every 5 turns (err on side of patience)
  maxRecentMessagesTracked: 8,
  repeatingPatternThreshold: 3, // Same pattern must appear 3 times to trigger concern
  consecutiveErrorThreshold: 2, // 2 errors in a row may warrant switch
  similarityThreshold: 0.75, // Cosine similarity to detect repeated responses
};

// Model family groupings for diversity-of-thought swaps
const MODEL_FAMILIES = {
  claude: new Set([
    "claude-haiku-4.5",
    "claude-sonnet-4",
    "claude-sonnet-4.5",
    "claude-sonnet-4.6",
    "claude-opus-4.5",
    "claude-opus-4.6",
    "claude-opus-4.6-1m",
  ]),
  gpt: new Set([
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5.4-mini",
    "gpt-5.1",
    "gpt-5.2",
    "gpt-5.3-codex",
    "gpt-5.1-codex",
    "gpt-5",
    "gpt-5.4",
    "gpt-5.1-codex-max",
  ]),
};

function getModelFamily(modelId) {
  if (!modelId) return null;
  if (MODEL_FAMILIES.claude.has(modelId)) return "claude";
  if (MODEL_FAMILIES.gpt.has(modelId)) return "gpt";
  return null;
}

// Simple word-level similarity detection (0-1, where 1 is identical)
function calculateSimilarity(text1, text2) {
  const words1 = new Set(normalizePrompt(text1).split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(normalizePrompt(text2).split(/\s+/).filter(w => w.length > 3));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;
  
  return union > 0 ? intersection / union : 0;
}

// Detect if agent message shows signs of confusion or looping
function detectConfusionSignals(message) {
  const text = normalizePrompt(message);
  const signals = [];
  
  // Signal 1: Agent acknowledging it's confused or stuck
  const confusedPhrases = [
    "i'm not sure",
    "i'm confused",
    "unclear",
    "not clear",
    "i don't",
    "cannot proceed",
    "stuck",
    "unable to",
    "let me try",
    "let me re-attempt",
  ];
  if (includesAny(text, confusedPhrases)) {
    signals.push("agent-confusion-acknowledgment");
  }
  
  // Signal 2: Very short responses (often indicates agent giving up or looping)
  if (text.split(/\s+/).length < 10) {
    signals.push("very-short-response");
  }
  
  // Signal 3: Repetitive question asking (agent asking for clarification repeatedly)
  if (includesAny(text, ["can you", "could you", "would you", "please", "more details", "clarify"])) {
    const askingCount = (text.match(/\?/g) || []).length;
    if (askingCount > 2) {
      signals.push("repetitive-asking");
    }
  }
  
  // Signal 4: Self-contradictory statements
  if (text.includes("but earlier") || text.includes("wait,") || text.includes("i was wrong")) {
    signals.push("self-contradiction");
  }
  
  return signals;
}

// Check if recent messages suggest a loop
function detectLoopingBehavior() {
  if (confusionMetrics.recentMessages.length < 3) return false;
  
  let similarPairs = 0;
  for (let i = confusionMetrics.recentMessages.length - 1; i > 0; i--) {
    const similarity = calculateSimilarity(
      confusionMetrics.recentMessages[i],
      confusionMetrics.recentMessages[i - 1]
    );
    if (similarity > CONFUSION_THRESHOLDS.similarityThreshold) {
      similarPairs++;
    }
  }
  
  return similarPairs >= 2; // Two similar consecutive pairs suggests looping
}

// Select alternate model family at same or better caliber
async function getAlternateModel(session, currentModelId) {
  const currentFamily = getModelFamily(currentModelId);
  const targetFamily = currentFamily === "claude" ? "gpt" : "claude";
  
  // Determine tier of current model
  let currentTier = null;
  for (const [tier, models] of Object.entries(MODEL_CANDIDATES)) {
    if (models.some(m => m.id === currentModelId)) {
      currentTier = tier;
      break;
    }
  }
  
  if (!currentTier) return null;
  
  // Get candidates from same or better tier, different family
  const tierCandidates = MODEL_CANDIDATES[currentTier] || [];
  const candidates = tierCandidates.filter(m => getModelFamily(m.id) === targetFamily);
  
  // If tier is exhausted in alternate family, try next tier up
  if (candidates.length === 0 && currentTier === "economy") {
    const builderCandidates = MODEL_CANDIDATES.builder || [];
    return builderCandidates.find(m => getModelFamily(m.id) === targetFamily) || null;
  }
  
  if (candidates.length === 0 && currentTier === "builder") {
    const reasoningCandidates = MODEL_CANDIDATES.reasoning || [];
    return reasoningCandidates.find(m => getModelFamily(m.id) === targetFamily) || null;
  }
  
  return candidates[0] || null;
}

// Decide whether to switch due to confusion
async function considerConfusionSwap(session, currentModelId) {
  const turnsSinceSwitch = confusionMetrics.turnCount - confusionMetrics.lastSwitchTurn;
  
  // Don't switch too frequently; err on side of patience
  if (turnsSinceSwitch < CONFUSION_THRESHOLDS.minTurnsSinceLastSwitch) {
    return null;
  }
  
  // Check confusion indicators
  const isLooping = detectLoopingBehavior();
  const hasHighErrorRate = confusionMetrics.errorCount >= CONFUSION_THRESHOLDS.consecutiveErrorThreshold;
  
  // Only switch if we have solid evidence of confusion (looping + errors, or very high confidence)
  if (!(isLooping && hasHighErrorRate)) {
    return null;
  }
  
  // Get alternate model
  const alternate = await getAlternateModel(session, currentModelId);
  if (!alternate) {
    return null;
  }
  
  return alternate;
}

async function maybeSwapDueToConfusion(session, currentModelId) {
  const alternate = await considerConfusionSwap(session, currentModelId);
  
  if (!alternate) {
    return null; // No swap needed
  }
  
  try {
    await session.rpc.model.switchTo({
      modelId: alternate.id,
      reasoningEffort: alternate.reasoningEffort,
    });
    
    confusionMetrics.lastSwitchTurn = confusionMetrics.turnCount;
    confusionMetrics.errorCount = 0; // Reset error count after switch
    
    await session.log(
      `model-router: Detected confusion/looping. Swapping from ${currentModelId} to ${alternate.id} (alternate family).`,
      { ephemeral: true }
    );
    
    return alternate;
  } catch {
    return null;
  }
}

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

  // File path detection (/.github/, /src/, /lib/, etc.) indicates code changes
  if (/\/[\w-]+\/[\w.-]+/.test(lower)) {
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
    // Implementation tasks deserve at least builder tier for reliability
    // Only use economy for very simple, lightweight implementations
    let tier = "builder"; // Default to builder for all implementation
    
    // But if it's a light keyword (find, list, show) with very low complexity, stay in economy
    if (includesAny(lower, LIGHT_KEYWORDS) && complexity === 0) {
      tier = "economy";
    }
    
    // Escalate to reasoning for complex orchestration only when genuine complexity supports it
    if (isComplexOrchestration(lower) && complexity >= 2) {
      tier = "reasoning";
    }
    
    // Escalate to reasoning if implementation is deeply complex
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

  // For low-to-moderate complexity implementation/general, prefer minimal narration
  if ((decision.kind === "implementation" || decision.kind === "general") && decision.complexity <= 2) {
    lines.push("Inspect only the most relevant file(s). Implement directly without extensive planning.");
  }

  if (decision.kind === "planning" || decision.kind === "debugging") {
    lines.push("Favor strong reasoning and structured analysis before acting.");
  }

  return lines.join(" ");
}

async function trySwitchModel(session, route, currentModelId) {
  let candidates = orderCandidates(dedupeCandidates(getTierCandidates(route)), route);

  // For moderate-complexity implementation/general builder tasks, try same-model
  // reasoning downgrade first before switching models entirely.
  if (
    (route.kind === "implementation" || route.kind === "general") &&
    route.tier === "builder" &&
    route.complexity <= 2 &&
    currentModelId
  ) {
    try {
      await session.rpc.model.switchTo({
        modelId: currentModelId,
        reasoningEffort: "low",
      });
      return {
        id: currentModelId,
        reasoningEffort: "low",
      };
    } catch {
      // If downgrade fails, continue to model switching logic
    }
  }

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
      confusionMetrics.turnCount = 0;
      confusionMetrics.recentMessages = [];
      confusionMetrics.errorCount = 0;
      confusionMetrics.lastSwitchTurn = -999;
      
      await session.log("model-router loaded", { ephemeral: true });
      return {
        additionalContext:
          "The model-router extension is available. Favor the lowest-cost viable model and prefer a different model for review than implementation when possible.",
      };
    },
    onUserPromptSubmitted: async (input) => {
      confusionMetrics.turnCount++;
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
    onAgentMessage: async (message) => {
      // Track recent messages for loop/confusion detection
      const msgText = String(message.content || "");
      if (msgText.length > 0) {
        confusionMetrics.recentMessages.push(msgText);
        if (confusionMetrics.recentMessages.length > CONFUSION_THRESHOLDS.maxRecentMessagesTracked) {
          confusionMetrics.recentMessages.shift();
        }
      }
      
      // Detect confusion signals
      const signals = detectConfusionSignals(msgText);
      if (signals.length > 0) {
        confusionMetrics.repeatedPatternCount++;
      }
      
      // Check if we should swap due to confusion (with patience for thinking)
      const current = await session.rpc.model.getCurrent().catch(() => ({ modelId: undefined }));
      if (current.modelId) {
        const alternate = await maybeSwapDueToConfusion(session, current.modelId);
        if (alternate) {
          confusionMetrics.currentModelFamily = getModelFamily(alternate.id);
        }
      }
    },
    onError: async (error) => {
      confusionMetrics.errorCount++;
      
      // Check if error rate warrants a swap (but again, err on side of patience)
      if (confusionMetrics.errorCount >= CONFUSION_THRESHOLDS.consecutiveErrorThreshold) {
        const current = await session.rpc.model.getCurrent().catch(() => ({ modelId: undefined }));
        if (current.modelId) {
          await maybeSwapDueToConfusion(session, current.modelId);
        }
      }
    },
  },
  tools: [
    {
      name: "model_router_status",
      description: "Show the current model-router decision state and confusion metrics for this Copilot CLI session.",
      parameters: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const current = await session.rpc.model.getCurrent().catch(() => ({ modelId: undefined }));
        const isLooping = detectLoopingBehavior();
        return JSON.stringify(
          {
            // Quick-glance summary for local debugging: active model, last impl model, key confusion signals.
            debug: {
              activeModel: current.modelId || null,
              lastImplModel: lastImplementationModel,
              looping: isLooping,
              errorCount: confusionMetrics.errorCount,
              repeatedPatternCount: confusionMetrics.repeatedPatternCount,
            },
            currentModel: current.modelId || null,
            lastImplementationModel,
            lastReviewModel,
            lastDecision,
            confusionMetrics: {
              turnCount: confusionMetrics.turnCount,
              recentMessageCount: confusionMetrics.recentMessages.length,
              errorCount: confusionMetrics.errorCount,
              repeatedPatternCount: confusionMetrics.repeatedPatternCount,
              turnsSinceLastConfusionSwitch: confusionMetrics.turnCount - confusionMetrics.lastSwitchTurn,
              isLooping,
            },
          },
          null,
          2,
        );
      },
    },
  ],
});
