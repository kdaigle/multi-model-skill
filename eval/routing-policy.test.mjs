import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MODEL_CANDIDATES,
  MODEL_FAMILIES,
  getModelFamily,
  getModelSubfamily,
  normalizePrompt,
  matchesPattern,
  includesAny,
  isExplicitReviewRequest,
  isToolHeavy,
  isComplexOrchestration,
  getComplexity,
  classifyPrompt,
  getTierCandidates,
  dedupeCandidates,
  isSameModelFamily,
  orderCandidates,
  buildAdditionalContext,
} from "../.github/extensions/model-router/policy.mjs";

// ---------------------------------------------------------------------------
// MODEL_CANDIDATES shape
// ---------------------------------------------------------------------------
describe("MODEL_CANDIDATES", () => {
  it("has reasoning, builder, economy tiers", () => {
    assert.ok(Array.isArray(MODEL_CANDIDATES.reasoning));
    assert.ok(Array.isArray(MODEL_CANDIDATES.builder));
    assert.ok(Array.isArray(MODEL_CANDIDATES.economy));
  });

  it("every entry has id and reasoningEffort", () => {
    for (const [tier, models] of Object.entries(MODEL_CANDIDATES)) {
      for (const m of models) {
        assert.ok(typeof m.id === "string", `${tier} model missing id`);
        assert.ok(
          m.reasoningEffort === null || typeof m.reasoningEffort === "string",
          `${tier}/${m.id} reasoningEffort must be string or null`
        );
      }
    }
  });

  it("reasoning tier has at least one entry", () => {
    assert.ok(MODEL_CANDIDATES.reasoning.length > 0);
  });

  it("builder tier has at least one entry", () => {
    assert.ok(MODEL_CANDIDATES.builder.length > 0);
  });

  it("economy tier has at least one entry", () => {
    assert.ok(MODEL_CANDIDATES.economy.length > 0);
  });
});

// ---------------------------------------------------------------------------
// MODEL_FAMILIES — derived from MODEL_CANDIDATES
// ---------------------------------------------------------------------------
describe("MODEL_FAMILIES", () => {
  it("has claude and gpt sets", () => {
    assert.ok(MODEL_FAMILIES.claude instanceof Set);
    assert.ok(MODEL_FAMILIES.gpt instanceof Set);
  });

  it("contains all MODEL_CANDIDATES ids", () => {
    const allIds = new Set([
      ...MODEL_CANDIDATES.reasoning.map((m) => m.id),
      ...MODEL_CANDIDATES.builder.map((m) => m.id),
      ...MODEL_CANDIDATES.economy.map((m) => m.id),
    ]);
    const familyIds = new Set([...MODEL_FAMILIES.claude, ...MODEL_FAMILIES.gpt]);
    for (const id of allIds) {
      assert.ok(familyIds.has(id), `${id} not found in MODEL_FAMILIES`);
    }
  });

  it("claude set contains claude models", () => {
    for (const id of MODEL_FAMILIES.claude) {
      assert.ok(id.startsWith("claude-"), `${id} in claude set but not claude model`);
    }
  });

  it("gpt set contains gpt models", () => {
    for (const id of MODEL_FAMILIES.gpt) {
      assert.ok(id.startsWith("gpt-"), `${id} in gpt set but not gpt model`);
    }
  });
});

// ---------------------------------------------------------------------------
// getModelFamily
// ---------------------------------------------------------------------------
describe("getModelFamily", () => {
  it("returns claude for claude models", () => {
    assert.equal(getModelFamily("claude-sonnet-4.6"), "claude");
    assert.equal(getModelFamily("claude-haiku-4.5"), "claude");
    assert.equal(getModelFamily("claude-opus-4.6"), "claude");
  });

  it("returns gpt for gpt models", () => {
    assert.equal(getModelFamily("gpt-5.1"), "gpt");
    assert.equal(getModelFamily("gpt-4.1"), "gpt");
  });

  it("returns null for unknown model", () => {
    assert.equal(getModelFamily("unknown-model"), null);
  });

  it("returns null for null input", () => {
    assert.equal(getModelFamily(null), null);
  });
});

// ---------------------------------------------------------------------------
// getModelSubfamily
// ---------------------------------------------------------------------------
describe("getModelSubfamily", () => {
  it("distinguishes claude sub-families", () => {
    assert.equal(getModelSubfamily("claude-haiku-4.5"), "claude-haiku");
    assert.equal(getModelSubfamily("claude-sonnet-4.6"), "claude-sonnet");
    assert.equal(getModelSubfamily("claude-sonnet-4"), "claude-sonnet");
    assert.equal(getModelSubfamily("claude-opus-4.5"), "claude-opus");
    assert.equal(getModelSubfamily("claude-opus-4.6"), "claude-opus");
    assert.equal(getModelSubfamily("claude-opus-4.6-1m"), "claude-opus");
  });

  it("distinguishes gpt sub-families", () => {
    assert.equal(getModelSubfamily("gpt-5.1"), "gpt-5");
    assert.equal(getModelSubfamily("gpt-5.4"), "gpt-5");
    assert.equal(getModelSubfamily("gpt-5-mini"), "gpt-5");
    assert.equal(getModelSubfamily("gpt-4.1"), "gpt-4.1");
  });

  it("classifies codex models into codex sub-family", () => {
    assert.equal(getModelSubfamily("gpt-5.3-codex"), "codex");
    assert.equal(getModelSubfamily("gpt-5.1-codex"), "codex");
    assert.equal(getModelSubfamily("gpt-5.1-codex-max"), "codex");
  });

  it("returns null for null input", () => {
    assert.equal(getModelSubfamily(null), null);
  });

  it("returns the model ID itself for unknown models", () => {
    assert.equal(getModelSubfamily("unknown-model"), "unknown-model");
  });
});

// ---------------------------------------------------------------------------
// getModelSubfamily / isSameModelFamily consistency
// ---------------------------------------------------------------------------
describe("getModelSubfamily and isSameModelFamily consistency", () => {
  it("isSameModelFamily agrees with getModelSubfamily for same sub-family", () => {
    assert.ok(isSameModelFamily("claude-sonnet-4", "claude-sonnet-4.5"));
    assert.equal(getModelSubfamily("claude-sonnet-4"), getModelSubfamily("claude-sonnet-4.5"));
  });

  it("isSameModelFamily agrees with getModelSubfamily for different sub-families", () => {
    assert.ok(!isSameModelFamily("claude-sonnet-4.6", "claude-opus-4.6"));
    assert.notEqual(getModelSubfamily("claude-sonnet-4.6"), getModelSubfamily("claude-opus-4.6"));
  });

  it("cross-vendor models are different in both getModelFamily and getModelSubfamily", () => {
    assert.notEqual(getModelFamily("claude-sonnet-4.6"), getModelFamily("gpt-5.1"));
    assert.notEqual(getModelSubfamily("claude-sonnet-4.6"), getModelSubfamily("gpt-5.1"));
    assert.ok(!isSameModelFamily("claude-sonnet-4.6", "gpt-5.1"));
  });
});

// ---------------------------------------------------------------------------
// normalizePrompt
// ---------------------------------------------------------------------------
describe("normalizePrompt", () => {
  it("lowercases input", () => {
    assert.equal(normalizePrompt("HELLO WORLD"), "hello world");
  });

  it("handles null gracefully", () => {
    assert.equal(normalizePrompt(null), "");
  });

  it("handles undefined gracefully", () => {
    assert.equal(normalizePrompt(undefined), "");
  });
});

// ---------------------------------------------------------------------------
// matchesPattern
// ---------------------------------------------------------------------------
describe("matchesPattern", () => {
  it("matches whole words", () => {
    assert.ok(matchesPattern("fix the bug", "fix"));
  });

  it("does not match substrings (prefix)", () => {
    assert.ok(!matchesPattern("prefix the problem", "fix"));
  });

  it("does not match substrings (suffix)", () => {
    assert.ok(!matchesPattern("exchange rates", "change"));
  });

  it("matches multi-word phrases via substring", () => {
    assert.ok(matchesPattern("please fix the code now", "fix the code"));
  });
});

// ---------------------------------------------------------------------------
// includesAny
// ---------------------------------------------------------------------------
describe("includesAny", () => {
  it("returns true if any pattern matches", () => {
    assert.ok(includesAny("review this PR", ["review", "plan"]));
  });

  it("returns false if no pattern matches", () => {
    assert.ok(!includesAny("what is the weather", ["implement", "debug"]));
  });
});

// ---------------------------------------------------------------------------
// isExplicitReviewRequest
// ---------------------------------------------------------------------------
describe("isExplicitReviewRequest", () => {
  it("detects review keyword", () => {
    assert.ok(isExplicitReviewRequest("please review this code"));
  });

  it("returns false for non-review prompt", () => {
    assert.ok(!isExplicitReviewRequest("implement a new feature"));
  });
});

// ---------------------------------------------------------------------------
// isToolHeavy
// ---------------------------------------------------------------------------
describe("isToolHeavy", () => {
  it("detects tool keywords", () => {
    assert.ok(isToolHeavy("run bash script"));
    assert.ok(isToolHeavy("execute the command"));
  });

  it("returns false for simple prompts", () => {
    assert.ok(!isToolHeavy("what is the capital of france"));
  });
});

// ---------------------------------------------------------------------------
// isComplexOrchestration
// ---------------------------------------------------------------------------
describe("isComplexOrchestration", () => {
  it("detects multi-agent patterns", () => {
    assert.ok(isComplexOrchestration("use multiple agents to solve this"));
  });

  it("returns false for simple tasks", () => {
    assert.ok(!isComplexOrchestration("write a hello world function"));
  });
});

// ---------------------------------------------------------------------------
// getComplexity
// ---------------------------------------------------------------------------
describe("getComplexity", () => {
  it("returns 0 for a short simple prompt", () => {
    assert.equal(getComplexity("what is the capital of france"), 0);
  });

  it("returns higher score for multi-file mentions", () => {
    const score = getComplexity("refactor multiple files across the entire codebase carefully");
    assert.ok(score >= 2);
  });

  it("returns higher score for long prompts", () => {
    const longPrompt = "word ".repeat(50);
    assert.ok(getComplexity(longPrompt) >= 1);
  });
});

// ---------------------------------------------------------------------------
// classifyPrompt
// ---------------------------------------------------------------------------
describe("classifyPrompt", () => {
  it("classifies review request", () => {
    const result = classifyPrompt("please review this pull request");
    assert.equal(result.kind, "review");
    assert.equal(result.tier, "reasoning");
  });

  it("classifies planning request", () => {
    const result = classifyPrompt("design an architecture for the new API");
    assert.equal(result.kind, "planning");
    assert.ok(["builder", "reasoning"].includes(result.tier));
  });

  it("classifies debugging request", () => {
    const result = classifyPrompt("debug this crash in the auth module");
    assert.equal(result.kind, "debugging");
  });

  it("classifies implementation request", () => {
    const result = classifyPrompt("implement a login page");
    assert.equal(result.kind, "implementation");
  });

  it("classifies lightweight request as economy", () => {
    const result = classifyPrompt("what is the capital of france");
    assert.equal(result.tier, "economy");
  });

  it("escalates complex implementation to reasoning", () => {
    const result = classifyPrompt(
      "implement a multi-agent orchestration system with parallel tools and multiple files across the entire codebase carefully and thoroughly"
    );
    assert.equal(result.tier, "reasoning");
  });
});

// ---------------------------------------------------------------------------
// getTierCandidates
// ---------------------------------------------------------------------------
describe("getTierCandidates", () => {
  it("review includes reasoning + builder + economy", () => {
    const route = { kind: "review", tier: "reasoning" };
    const candidates = getTierCandidates(route);
    const hasReasoning = candidates.some((c) =>
      MODEL_CANDIDATES.reasoning.some((m) => m.id === c.id && m.reasoningEffort === c.reasoningEffort)
    );
    assert.ok(hasReasoning);
  });

  it("economy lightweight returns economy-first order", () => {
    const route = { kind: "lightweight", tier: "economy" };
    const candidates = getTierCandidates(route);
    assert.ok(candidates.length > 0);
    // Economy candidates appear first
    const firstId = candidates[0].id;
    assert.ok(MODEL_CANDIDATES.economy.some((m) => m.id === firstId));
  });
});

// ---------------------------------------------------------------------------
// dedupeCandidates
// ---------------------------------------------------------------------------
describe("dedupeCandidates", () => {
  it("removes exact duplicates", () => {
    const input = [
      { id: "model-a", reasoningEffort: "medium" },
      { id: "model-a", reasoningEffort: "medium" },
      { id: "model-b", reasoningEffort: null },
    ];
    const result = dedupeCandidates(input);
    assert.equal(result.length, 2);
  });

  it("keeps different reasoningEffort as distinct entries", () => {
    const input = [
      { id: "model-a", reasoningEffort: "medium" },
      { id: "model-a", reasoningEffort: "high" },
    ];
    const result = dedupeCandidates(input);
    assert.equal(result.length, 2);
  });
});

// ---------------------------------------------------------------------------
// isSameModelFamily
// ---------------------------------------------------------------------------
describe("isSameModelFamily", () => {
  it("returns true for two claude-sonnet variants", () => {
    assert.ok(isSameModelFamily("claude-sonnet-4", "claude-sonnet-4.5"));
  });

  it("returns false for different families", () => {
    assert.ok(!isSameModelFamily("claude-haiku-4.5", "gpt-5.1"));
  });

  it("returns false for null first arg", () => {
    assert.ok(!isSameModelFamily(null, "gpt-5.1"));
  });
});

// ---------------------------------------------------------------------------
// orderCandidates
// ---------------------------------------------------------------------------
describe("orderCandidates", () => {
  it("returns unchanged list for non-review route", () => {
    const candidates = [
      { id: "model-a", reasoningEffort: null },
      { id: "model-b", reasoningEffort: null },
    ];
    const result = orderCandidates(candidates, { kind: "implementation" }, null);
    assert.deepEqual(result, candidates);
  });

  it("prefers same-family last for review when lastImplModel given", () => {
    const candidates = [
      { id: "claude-sonnet-4.6", reasoningEffort: "high" },
      { id: "gpt-5.1", reasoningEffort: null },
      { id: "claude-haiku-4.5", reasoningEffort: null },
    ];
    // If last impl was claude-sonnet-4.6, the sorted order should put gpt first
    const result = orderCandidates(candidates, { kind: "review" }, "claude-sonnet-4.6");
    assert.equal(result[0].id, "gpt-5.1");
  });
});

// ---------------------------------------------------------------------------
// buildAdditionalContext
// ---------------------------------------------------------------------------
describe("buildAdditionalContext", () => {
  it("includes routing policy header", () => {
    const decision = { kind: "implementation", complexity: 1, selectedModelId: "gpt-5.1", reasoningEffort: null };
    const ctx = buildAdditionalContext(decision, "gpt-5.1", null);
    assert.ok(ctx.includes("Model routing policy is active."));
  });

  it("includes review diversity note when lastImplModel differs", () => {
    const decision = { kind: "review", complexity: 1, selectedModelId: "gpt-5.1", reasoningEffort: null };
    const ctx = buildAdditionalContext(decision, "gpt-5.1", "claude-sonnet-4.6");
    assert.ok(ctx.includes("Prefer review diversity"));
  });

  it("does not include review diversity note for non-review", () => {
    const decision = { kind: "implementation", complexity: 1, selectedModelId: "gpt-5.1", reasoningEffort: null };
    const ctx = buildAdditionalContext(decision, "gpt-5.1", "claude-sonnet-4.6");
    assert.ok(!ctx.includes("Prefer review diversity"));
  });

  it("includes lightweight note for lightweight tasks", () => {
    const decision = { kind: "lightweight", complexity: 0, selectedModelId: "gpt-5-mini", reasoningEffort: null };
    const ctx = buildAdditionalContext(decision, "gpt-5-mini", null);
    assert.ok(ctx.includes("lean"));
  });

  it("includes planning/debugging analysis note", () => {
    const decision = { kind: "planning", complexity: 2, selectedModelId: "claude-sonnet-4.6", reasoningEffort: "high" };
    const ctx = buildAdditionalContext(decision, "claude-sonnet-4.6", null);
    assert.ok(ctx.includes("reasoning"));
  });

  // Regression: fallback note must fire when review lands on the EXACT impl model
  it("surfaces fallback note when review reuses exact implementation model", () => {
    const decision = { kind: "review", complexity: 1, selectedModelId: "claude-sonnet-4.6", reasoningEffort: null };
    const ctx = buildAdditionalContext(decision, "claude-sonnet-4.6", "claude-sonnet-4.6");
    assert.ok(ctx.includes("fell back"), `expected fallback note; got: ${ctx}`);
  });

  // Regression: fallback note must ALSO fire when review lands on a same-family
  // model (e.g. claude-sonnet-4.5 when impl was claude-sonnet-4.6) — the
  // diversity goal was still not met even though the model id differs.
  it("surfaces fallback note when review falls back to same-family model", () => {
    const decision = { kind: "review", complexity: 1, selectedModelId: "claude-sonnet-4.5", reasoningEffort: null };
    const ctx = buildAdditionalContext(decision, "claude-sonnet-4.5", "claude-sonnet-4.6");
    assert.ok(ctx.includes("fell back"), `expected fallback note; got: ${ctx}`);
  });

  // Verify diversity IS silently achieved when review uses a different family
  it("does not surface fallback note when review uses a distinct family", () => {
    const decision = { kind: "review", complexity: 1, selectedModelId: "gpt-5.4", reasoningEffort: "high" };
    const ctx = buildAdditionalContext(decision, "gpt-5.4", "claude-sonnet-4.6");
    assert.ok(!ctx.includes("fell back"), `unexpected fallback note; got: ${ctx}`);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION: Explicit review detection — keyword coverage and word boundaries
// ---------------------------------------------------------------------------

describe("isExplicitReviewRequest — regression coverage", () => {
  // Every entry in EXPLICIT_REVIEW_KEYWORDS must fire.
  const positiveCases = [
    ["bare 'review'", "review"],
    ["code review phrase", "code review for the auth changes"],
    ["review this phrase", "review this module"],
    ["review the code phrase", "review the code in this file"],
    ["review my code phrase", "review my code for the feature"],
    ["audit keyword", "audit this function for security issues"],
    ["approval readiness", "check approval readiness for this PR"],
    ["approval readiness checks", "run approval readiness checks on the diff"],
    ["approve this", "approve this pull request"],
    ["pr review", "do a pr review on this branch"],
    ["find bugs multi-word", "find bugs in the payment service"],
    ["bug finding", "bug finding pass on the new service"],
    ["regression hunting", "regression hunting before release"],
    ["regression hunt", "do a regression hunt across the diff"],
    ["find regressions", "find regressions introduced in this change"],
  ];
  for (const [label, prompt] of positiveCases) {
    it(`detects: ${label}`, () => {
      assert.ok(
        isExplicitReviewRequest(normalizePrompt(prompt)),
        `expected true for: "${prompt}"`,
      );
    });
  }

  // Word-boundary and false-positive guards.
  const negativeCases = [
    // "preview" contains "review" as a substring but not at a word boundary
    ["preview is not review", "preview the dashboard layout"],
    // "reviewed" is a different word token
    ["reviewed is not review", "I reviewed the changes already"],
    // pure implementation requests should not route to review
    ["implement has no review keyword", "implement a new login page"],
  ];
  for (const [label, prompt] of negativeCases) {
    it(`does not trigger: ${label}`, () => {
      assert.ok(
        !isExplicitReviewRequest(normalizePrompt(prompt)),
        `expected false for: "${prompt}"`,
      );
    });
  }
});

describe("classifyPrompt — explicit review routing regression", () => {
  it("routes 'audit' prompt to review/reasoning", () => {
    const r = classifyPrompt("audit this authentication module");
    assert.equal(r.kind, "review");
    assert.equal(r.tier, "reasoning");
  });

  it("routes 'find bugs' to review/reasoning", () => {
    const r = classifyPrompt("find bugs in the payment service");
    assert.equal(r.kind, "review");
    assert.equal(r.tier, "reasoning");
  });

  it("routes 'regression hunt' to review/reasoning", () => {
    const r = classifyPrompt("do a regression hunt across the diff");
    assert.equal(r.kind, "review");
    assert.equal(r.tier, "reasoning");
  });

  it("review always gets reasoning tier regardless of prompt brevity", () => {
    const r = classifyPrompt("review");
    assert.equal(r.kind, "review");
    assert.equal(r.tier, "reasoning");
  });

  it("review takes priority over implementation keywords in same prompt", () => {
    // A prompt that mentions both 'review' and 'implement' must still route as review.
    const r = classifyPrompt("review and implement the proposed changes");
    assert.equal(r.kind, "review");
  });
});

// ---------------------------------------------------------------------------
// REGRESSION: Tool-heavy implementation routing
// ---------------------------------------------------------------------------

describe("isToolHeavy — regression coverage", () => {
  const toolCases = [
    ["api", "call the api endpoint"],
    ["curl", "fetch data with curl"],
    ["shell", "run a shell command to reset the db"],
    ["invoke", "invoke the lambda function"],
    ["http", "make an http request to the service"],
    ["endpoint", "hit the endpoint and parse the response"],
    ["request", "send a request to the backend"],
    ["function + call", "call the function with these params"],
    ["command", "execute the command to migrate the schema"],
    ["agent", "spin up an agent to handle this"],
    ["script", "write a script to automate the build"],
  ];
  for (const [label, prompt] of toolCases) {
    it(`detects tool keyword: ${label}`, () => {
      assert.ok(isToolHeavy(normalizePrompt(prompt)), `expected true for: "${prompt}"`);
    });
  }

  it("does not trigger on a plain explanation request", () => {
    assert.ok(!isToolHeavy("explain how the auth middleware works"));
  });
});

describe("classifyPrompt — tool-heavy implementation routing regression", () => {
  it("sets toolHeavy: true when implementation prompt contains tool keywords", () => {
    const r = classifyPrompt("implement a function that calls the api endpoint");
    assert.equal(r.kind, "implementation");
    assert.equal(r.toolHeavy, true);
  });

  it("sets toolHeavy: false for a pure-logic implementation with no tool keywords", () => {
    const r = classifyPrompt("implement a sorting algorithm");
    assert.equal(r.kind, "implementation");
    assert.equal(r.toolHeavy, false);
  });

  it("tool-heavy implementation defaults to builder tier, not economy", () => {
    const r = classifyPrompt("implement a script to run the bash command");
    assert.equal(r.kind, "implementation");
    assert.equal(r.tier, "builder");
  });

  it("tool-heavy general prompt with complexity >= 1 elevates to builder tier", () => {
    // No implement/debug/plan keywords → general path.
    // Tool keywords (http, request, endpoint) fire isToolHeavy → score += 1 → complexity = 1.
    // General rule: isToolHeavy && complexity >= 1 → builder.
    const r = classifyPrompt("send an http request to the endpoint and check the response");
    assert.equal(r.tier, "builder");
  });
});

// ---------------------------------------------------------------------------
// REGRESSION: Orchestration escalation
// ---------------------------------------------------------------------------

describe("isComplexOrchestration — regression coverage", () => {
  const orchestrationCases = [
    ["parallel agents", "coordinate parallel agents to complete this task"],
    ["multiple agents", "use multiple agents to crawl the data"],
    ["multi-agent", "build a multi-agent pipeline"],
    ["parallel tools", "execute parallel tools for this pipeline"],
    ["tool chain", "design a tool chain for the workflow"],
    ["chained tools", "implement chained tools to process data"],
  ];
  for (const [label, prompt] of orchestrationCases) {
    it(`detects orchestration phrase: ${label}`, () => {
      assert.ok(
        isComplexOrchestration(normalizePrompt(prompt)),
        `expected true for: "${prompt}"`,
      );
    });
  }

  // Bare concept words must NOT trigger — see comment in policy.mjs explaining
  // why only multi-word action phrases are included.
  it("bare 'orchestrate' does not trigger (false-positive guard)", () => {
    assert.ok(!isComplexOrchestration("orchestrate the deployment pipeline"));
  });

  it("bare 'orchestration' does not trigger (false-positive guard)", () => {
    assert.ok(!isComplexOrchestration("explain how orchestration works in kubernetes"));
  });
});

describe("classifyPrompt — orchestration escalation regression", () => {
  it("escalates implementation to reasoning when multi-agent phrase and complexity >= 2", () => {
    // 'refactor' → implementation; 'multiple agents' → orchestration;
    // 'entire codebase' → complexity += 2; 'agent' tool keyword → complexity += 1 → total >= 2.
    const r = classifyPrompt("use multiple agents to refactor the entire codebase");
    assert.equal(r.kind, "implementation");
    assert.equal(r.tier, "reasoning");
  });

  it("does NOT escalate to reasoning when orchestration phrase appears but complexity < 2", () => {
    // Short prompt: 'implement parallel agents' → complexity = 1 (only tool keyword 'agent').
    // isComplexOrchestration = true but condition is complexity >= 2 → stays builder.
    const r = classifyPrompt("implement parallel agents");
    assert.equal(r.kind, "implementation");
    assert.equal(r.tier, "builder");
  });

  it("escalates general route to reasoning with orchestration phrase + complexity >= 2", () => {
    // No implement/plan/debug keywords → general path.
    // 'multiple agents' → orchestration; 'multiple files' + 'carefully' → complexity += 4.
    const r = classifyPrompt(
      "coordinate multiple agents across multiple files to carefully handle the pipeline",
    );
    assert.equal(r.tier, "reasoning");
  });

  it("tool chain phrase escalates implementation to reasoning when complexity >= 2", () => {
    // 'implement' → implementation; 'tool chain' → orchestration;
    // 'multiple files' + 'carefully' → complexity += 4 → >= 2.
    const r = classifyPrompt(
      "implement a tool chain with multiple files for carefully orchestrated processing",
    );
    assert.equal(r.kind, "implementation");
    assert.equal(r.tier, "reasoning");
  });
});
