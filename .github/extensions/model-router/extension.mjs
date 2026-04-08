import { joinSession } from "@github/copilot-sdk/extension";
import {
  MODEL_CANDIDATES,
  getModelFamily,
  getModelSubfamily,
  normalizePrompt,
  includesAny,
  classifyPrompt,
  getTierCandidates,
  dedupeCandidates,
  orderCandidates,
  buildAdditionalContext,
} from "./policy.mjs";

// ---------------------------------------------------------------------------
// Session-level state
// ---------------------------------------------------------------------------

let lastImplementationModel = null;
let lastReviewModel = null;
let lastDecision = null;

// Confusion detection: tracks signs the agent may be stuck or looping.
// Err on the side of patience — especially when the agent is in active thinking
// (reasoning display enabled) — and only swap after multiple strong signals.
const confusionMetrics = {
  turnCount: 0,
  recentMessages: [], // last N agent messages for loop detection
  errorCount: 0,
  repeatedPatternCount: 0,
  lastSwitchTurn: -999, // turn when we last switched due to confusion
  currentModelFamily: null,
};

const CONFUSION_THRESHOLDS = {
  minTurnsSinceLastSwitch: 5,
  maxRecentMessagesTracked: 8,
  repeatingPatternThreshold: 3,
  consecutiveErrorThreshold: 2,
  similarityThreshold: 0.75,
};

// ---------------------------------------------------------------------------
// Confusion detection helpers (stateful — stay in this file)
// ---------------------------------------------------------------------------

function calculateSimilarity(text1, text2) {
  const words1 = new Set(
    normalizePrompt(text1)
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  const words2 = new Set(
    normalizePrompt(text2)
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  if (words1.size === 0 || words2.size === 0) return 0;
  const intersection = [...words1].filter((w) => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;
  return union > 0 ? intersection / union : 0;
}

function detectConfusionSignals(message) {
  const text = normalizePrompt(message);
  const signals = [];

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
  if (includesAny(text, confusedPhrases)) signals.push("agent-confusion-acknowledgment");

  if (text.split(/\s+/).length < 10) signals.push("very-short-response");

  if (
    includesAny(text, ["can you", "could you", "would you", "please", "more details", "clarify"])
  ) {
    if ((text.match(/\?/g) || []).length > 2) signals.push("repetitive-asking");
  }

  if (text.includes("but earlier") || text.includes("wait,") || text.includes("i was wrong")) {
    signals.push("self-contradiction");
  }

  return signals;
}

function detectLoopingBehavior() {
  if (confusionMetrics.recentMessages.length < 3) return false;
  let similarPairs = 0;
  for (let i = confusionMetrics.recentMessages.length - 1; i > 0; i--) {
    if (
      calculateSimilarity(
        confusionMetrics.recentMessages[i],
        confusionMetrics.recentMessages[i - 1],
      ) > CONFUSION_THRESHOLDS.similarityThreshold
    ) {
      similarPairs++;
    }
  }
  return similarPairs >= 2;
}

async function getAlternateModel(session, currentModelId) {
  const currentSubfamily = getModelSubfamily(currentModelId);

  let currentTier = null;
  for (const [tier, models] of Object.entries(MODEL_CANDIDATES)) {
    if (models.some((m) => m.id === currentModelId)) {
      currentTier = tier;
      break;
    }
  }
  if (!currentTier) return null;

  const tierCandidates = MODEL_CANDIDATES[currentTier] || [];
  const candidates = tierCandidates.filter((m) => getModelSubfamily(m.id) !== currentSubfamily);

  // If tier exhausted in alternate subfamily, try next tier up
  if (candidates.length === 0 && currentTier === "economy") {
    return (
      (MODEL_CANDIDATES.builder || []).find((m) => getModelSubfamily(m.id) !== currentSubfamily) || null
    );
  }
  if (candidates.length === 0 && currentTier === "builder") {
    return (
      (MODEL_CANDIDATES.reasoning || []).find((m) => getModelSubfamily(m.id) !== currentSubfamily) || null
    );
  }

  return candidates[0] || null;
}

async function considerConfusionSwap(session, currentModelId) {
  const turnsSinceSwitch = confusionMetrics.turnCount - confusionMetrics.lastSwitchTurn;
  if (turnsSinceSwitch < CONFUSION_THRESHOLDS.minTurnsSinceLastSwitch) return null;

  const isLooping = detectLoopingBehavior();
  const hasHighErrorRate =
    confusionMetrics.errorCount >= CONFUSION_THRESHOLDS.consecutiveErrorThreshold;

  // Only swap with solid evidence (looping + errors)
  if (!(isLooping && hasHighErrorRate)) return null;

  return getAlternateModel(session, currentModelId);
}

async function maybeSwapDueToConfusion(session, currentModelId) {
  const alternate = await considerConfusionSwap(session, currentModelId);
  if (!alternate) return null;

  try {
    await session.rpc.model.switchTo({
      modelId: alternate.id,
      reasoningEffort: alternate.reasoningEffort,
    });
    confusionMetrics.lastSwitchTurn = confusionMetrics.turnCount;
    confusionMetrics.errorCount = 0;
    await session.log(
      `model-router: Detected confusion/looping. Swapping from ${currentModelId} to ${alternate.id} (alternate family).`,
      { ephemeral: true },
    );
    return alternate;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Model switching
// ---------------------------------------------------------------------------

async function trySwitchModel(session, route, currentModelId) {
  let candidates = orderCandidates(
    dedupeCandidates(getTierCandidates(route)),
    route,
    lastImplementationModel,
  );

  // For moderate-complexity builder tasks, try a same-model reasoning downgrade first
  if (
    (route.kind === "implementation" || route.kind === "general") &&
    route.tier === "builder" &&
    route.complexity <= 2 &&
    currentModelId
  ) {
    try {
      await session.rpc.model.switchTo({ modelId: currentModelId, reasoningEffort: "low" });
      return { id: currentModelId, reasoningEffort: "low" };
    } catch {
      // fall through to full model switching
    }
  }

  if (currentModelId) {
    candidates = candidates.filter((c) => c.id !== currentModelId);
  }

  // Review diversity: exclude last implementation model even when getCurrent() fails
  if (route.kind === "review" && lastImplementationModel) {
    candidates = candidates.filter((c) => c.id !== lastImplementationModel);
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

  return selected || { id: currentModelId || null, reasoningEffort: null };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

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
        additionalContext: buildAdditionalContext(lastDecision, current.modelId, lastImplementationModel),
      };
    },

    onAgentMessage: async (message) => {
      const msgText = String(message.content || "");
      if (msgText.length > 0) {
        confusionMetrics.recentMessages.push(msgText);
        if (
          confusionMetrics.recentMessages.length > CONFUSION_THRESHOLDS.maxRecentMessagesTracked
        ) {
          confusionMetrics.recentMessages.shift();
        }
      }

      const signals = detectConfusionSignals(msgText);
      if (signals.length > 0) confusionMetrics.repeatedPatternCount++;

      const current = await session.rpc.model.getCurrent().catch(() => ({ modelId: undefined }));
      if (current.modelId) {
        const alternate = await maybeSwapDueToConfusion(session, current.modelId);
        if (alternate) confusionMetrics.currentModelFamily = getModelFamily(alternate.id);
      }
    },

    onError: async () => {
      confusionMetrics.errorCount++;
      if (confusionMetrics.errorCount >= CONFUSION_THRESHOLDS.consecutiveErrorThreshold) {
        const current = await session.rpc.model.getCurrent().catch(() => ({ modelId: undefined }));
        if (current.modelId) await maybeSwapDueToConfusion(session, current.modelId);
      }
    },
  },

  tools: [
    {
      name: "model_router_status",
      description:
        "Show the current model-router decision state and confusion metrics for this Copilot CLI session.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const current = await session.rpc.model
          .getCurrent()
          .catch(() => ({ modelId: undefined }));
        const isLooping = detectLoopingBehavior();
        const turnsSinceLastSwitch =
          confusionMetrics.turnCount - confusionMetrics.lastSwitchTurn;
        return JSON.stringify(
          {
            // Quick-glance summary for local debugging
            debug: {
              activeModel: current.modelId || null,
              lastImplModel: lastImplementationModel,
              looping: isLooping,
              errorCount: confusionMetrics.errorCount,
              repeatedPatternCount: confusionMetrics.repeatedPatternCount,
              turnsSinceLastSwitch,
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
              turnsSinceLastConfusionSwitch: turnsSinceLastSwitch,
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