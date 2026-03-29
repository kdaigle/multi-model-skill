#!/usr/bin/env node

import { mkdir, writeFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

async function main() {
  const testDir = "/home/kydaigle/code/multi-model-skill/tests";
  const testFile = `${testDir}/routing-policy.test.mjs`;

  try {
    // Create directory
    await mkdir(testDir, { recursive: true });
    console.log(`✓ Created directory: ${testDir}`);

    // Write test file
    const testContent = `import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MODEL_CANDIDATES,
  MODEL_FAMILIES,
  getModelFamily,
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

describe("MODEL_CANDIDATES", () => {
  it("has reasoning, builder, economy tiers", () => {
    assert.ok(Array.isArray(MODEL_CANDIDATES.reasoning));
    assert.ok(Array.isArray(MODEL_CANDIDATES.builder));
    assert.ok(Array.isArray(MODEL_CANDIDATES.economy));
  });
  it("every entry has id and reasoningEffort", () => {
    for (const [tier, models] of Object.entries(MODEL_CANDIDATES)) {
      for (const m of models) {
        assert.ok(typeof m.id === "string", \`\${tier} model missing id\`);
        assert.ok(
          m.reasoningEffort === null || typeof m.reasoningEffort === "string",
          \`\${tier}/\${m.id} reasoningEffort must be string or null\`
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
      assert.ok(familyIds.has(id), \`\${id} not found in MODEL_FAMILIES\`);
    }
  });
  it("claude set contains claude models", () => {
    for (const id of MODEL_FAMILIES.claude) {
      assert.ok(id.startsWith("claude-"), \`\${id} in claude set but not claude model\`);
    }
  });
  it("gpt set contains gpt models", () => {
    for (const id of MODEL_FAMILIES.gpt) {
      assert.ok(id.startsWith("gpt-"), \`\${id} in gpt set but not gpt model\`);
    }
  });
});

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

describe("includesAny", () => {
  it("returns true if any pattern matches", () => {
    assert.ok(includesAny("review this PR", ["review", "plan"]));
  });
  it("returns false if no pattern matches", () => {
    assert.ok(!includesAny("what is the weather", ["implement", "debug"]));
  });
});

describe("isExplicitReviewRequest", () => {
  it("detects review keyword", () => {
    assert.ok(isExplicitReviewRequest("please review this code"));
  });
  it("returns false for non-review prompt", () => {
    assert.ok(!isExplicitReviewRequest("implement a new feature"));
  });
});

describe("isToolHeavy", () => {
  it("detects tool keywords", () => {
    assert.ok(isToolHeavy("run bash script"));
    assert.ok(isToolHeavy("execute the command"));
  });
  it("returns false for simple prompts", () => {
    assert.ok(!isToolHeavy("what is the capital of france"));
  });
});

describe("isComplexOrchestration", () => {
  it("detects multi-agent patterns", () => {
    assert.ok(isComplexOrchestration("use multiple agents to solve this"));
  });
  it("returns false for simple tasks", () => {
    assert.ok(!isComplexOrchestration("write a hello world function"));
  });
});

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
    const firstId = candidates[0].id;
    assert.ok(MODEL_CANDIDATES.economy.some((m) => m.id === firstId));
  });
});

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
    const result = orderCandidates(candidates, { kind: "review" }, "claude-sonnet-4.6");
    assert.equal(result[0].id, "gpt-5.1");
  });
});

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
});`;

    await writeFile(testFile, testContent);
    console.log(`✓ Created test file: ${testFile}`);

    // Run tests
    console.log("\n--- Running tests ---\n");
    const { stdout, stderr } = await execPromise(
      `node --test ${testFile} 2>&1 | tail -60`
    );

    if (stdout) {
      console.log(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
