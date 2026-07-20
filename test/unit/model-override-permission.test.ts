import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentConfig } from "../../src/agents/agents.ts";
import {
  collectExplicitModelSelectors,
  createScheduledModelOverrideApproval,
  formatModelOverrideConfirmation,
  formatModelOverrideDenial,
  resolveModelOverridePermission,
  resolveModelOverrideRequests,
  validateScheduledModelOverrideApproval,
} from "../../src/runs/shared/model-override-permission.ts";

const availableModels = [
  {
    provider: "Mapleluv",
    id: "gpt-5.6-sol-pro",
    fullId: "Mapleluv/gpt-5.6-sol-pro",
  },
  {
    provider: "Mapleluv",
    id: "gpt-5.6-terra-pro",
    fullId: "Mapleluv/gpt-5.6-terra-pro",
  },
  {
    provider: "Mapleluv",
    id: "claude-sonnet-4-6",
    fullId: "Mapleluv/claude-sonnet-4-6",
  },
  { provider: "minimax", id: "MiniMax-M2.7", fullId: "minimax/MiniMax-M2.7" },
];

const agents: AgentConfig[] = [
  {
    name: "reviewer",
    description: "Review",
    systemPrompt: "Review",
    source: "user",
    model: "Mapleluv/gpt-5.6-sol-pro",
    fallbackModels: ["Mapleluv/gpt-5.6-terra-pro"],
  },
  {
    name: "delegate",
    description: "Delegate",
    systemPrompt: "Delegate",
    source: "bundled",
    model: false,
  },
];

function resolve(params: Parameters<typeof collectExplicitModelSelectors>[0]) {
  return resolveModelOverrideRequests({
    selectors: collectExplicitModelSelectors(params),
    agents,
    parentModel: { provider: "Mapleluv", id: "gpt-5.6-sol-pro" },
    availableModels,
    preferredProvider: "Mapleluv",
  });
}

describe("model override permission contract", () => {
  it("defaults to ask and fails closed on invalid config", () => {
    assert.deepEqual(resolveModelOverridePermission(undefined), {
      permission: "ask",
    });
    assert.deepEqual(resolveModelOverridePermission("allow"), {
      permission: "allow",
    });
    assert.deepEqual(resolveModelOverridePermission("deny"), {
      permission: "deny",
    });
    assert.deepEqual(resolveModelOverridePermission("ask"), {
      permission: "ask",
    });
    const invalid = resolveModelOverridePermission("sometimes");
    assert.equal(invalid.permission, "deny");
    assert.match(
      invalid.error ?? "",
      /modelOverridePermission.*ask.*deny.*allow/i,
    );
  });

  it("collects every effective public launch selector in stable path order", () => {
    const selectors = [
      ...collectExplicitModelSelectors({
        agent: "reviewer",
        model: "Mapleluv/claude-sonnet-4-6",
      }),
      ...collectExplicitModelSelectors({
        tasks: [
          { agent: "reviewer", task: "task", model: "minimax/MiniMax-M2.7" },
        ],
      }),
      ...collectExplicitModelSelectors({
        chain: [
          { agent: "reviewer", model: "Mapleluv/claude-sonnet-4-6" },
          { parallel: [{ agent: "reviewer", model: "minimax/MiniMax-M2.7" }] },
          {
            parallel: {
              agent: "reviewer",
              model: "Mapleluv/gpt-5.6-terra-pro",
            },
          },
        ],
      }),
    ];
    assert.deepEqual(selectors, [
      {
        path: "model",
        agent: "reviewer",
        requestedModel: "Mapleluv/claude-sonnet-4-6",
      },
      {
        path: "tasks[0].model",
        agent: "reviewer",
        requestedModel: "minimax/MiniMax-M2.7",
      },
      {
        path: "chain[0].model",
        agent: "reviewer",
        requestedModel: "Mapleluv/claude-sonnet-4-6",
      },
      {
        path: "chain[1].parallel[0].model",
        agent: "reviewer",
        requestedModel: "minimax/MiniMax-M2.7",
      },
      {
        path: "chain[2].parallel.model",
        agent: "reviewer",
        requestedModel: "Mapleluv/gpt-5.6-terra-pro",
      },
    ]);

    assert.deepEqual(
      collectExplicitModelSelectors({
        agent: "reviewer",
        model: "Mapleluv/claude-sonnet-4-6",
        tasks: [{ agent: "reviewer", task: "task" }],
      }),
      [],
    );
  });

  it("drops canonical primary no-ops but treats direct fallback selection as an override", () => {
    assert.deepEqual(
      resolve({ agent: "reviewer", model: "gpt_5.6_sol_pro" }),
      [],
    );
    assert.deepEqual(resolve({ agent: "delegate", model: "inherit" }), []);

    const [fallback] = resolve({
      agent: "reviewer",
      model: "gpt-5.6-terra-pro",
    });
    assert.equal(
      fallback?.requestedEffectiveModel,
      "Mapleluv/gpt-5.6-terra-pro",
    );
    assert.equal(fallback?.configuredPrimaryModel, "Mapleluv/gpt-5.6-sol-pro");
    assert.deepEqual(fallback?.configuredFallbackModels, [
      "Mapleluv/gpt-5.6-terra-pro",
    ]);
  });

  it("preserves thinking suffix changes as effective overrides", () => {
    const [request] = resolve({
      agent: "reviewer",
      model: "Mapleluv/gpt-5.6-sol-pro:high",
    });
    assert.equal(
      request?.requestedEffectiveModel,
      "Mapleluv/gpt-5.6-sol-pro:high",
    );
    assert.equal(request?.configuredPrimaryModel, "Mapleluv/gpt-5.6-sol-pro");
  });

  it("compares the effective model plus configured thinking passed to Pi", () => {
    const thinkingAgents = agents.map((agent) =>
      agent.name === "reviewer"
        ? { ...agent, thinking: "high" as const }
        : agent,
    );
    const parentModel = { provider: "Mapleluv", id: "gpt-5.6-sol-pro" };
    const same = resolveModelOverrideRequests({
      selectors: collectExplicitModelSelectors({
        agent: "reviewer",
        model: "Mapleluv/gpt-5.6-sol-pro:high",
      }),
      agents: thinkingAgents,
      parentModel,
      availableModels,
      preferredProvider: "Mapleluv",
    });
    assert.deepEqual(same, []);

    const [changed] = resolveModelOverrideRequests({
      selectors: collectExplicitModelSelectors({
        agent: "reviewer",
        model: "Mapleluv/gpt-5.6-sol-pro:low",
      }),
      agents: thinkingAgents,
      parentModel,
      availableModels,
      preferredProvider: "Mapleluv",
    });
    assert.equal(
      changed?.configuredPrimaryModel,
      "Mapleluv/gpt-5.6-sol-pro:high",
    );
    assert.equal(
      changed?.requestedEffectiveModel,
      "Mapleluv/gpt-5.6-sol-pro:low",
    );
  });

  it("rejects selectors for unknown agents instead of silently authorizing them", () => {
    assert.throws(
      () => resolve({ agent: "missing", model: "Mapleluv/claude-sonnet-4-6" }),
      /unknown agent.*missing/i,
    );
  });

  it("binds scheduled approval to the canonical override request digest", () => {
    const requests = resolve({
      agent: "reviewer",
      model: "Mapleluv/claude-sonnet-4-6",
    });
    const receipt = createScheduledModelOverrideApproval(requests);
    assert.equal(receipt.version, 1);
    assert.equal(receipt.source, "scheduled-user-confirmation");
    assert.equal(
      validateScheduledModelOverrideApproval(receipt, requests),
      true,
    );

    const changed = resolve({
      agent: "reviewer",
      model: "minimax/MiniMax-M2.7",
    });
    assert.equal(
      validateScheduledModelOverrideApproval(receipt, changed),
      false,
    );
    assert.equal(
      validateScheduledModelOverrideApproval(
        { ...receipt, digest: "not-a-digest" },
        requests,
      ),
      false,
    );
  });

  it("formats one actionable confirmation and a non-retry denial", () => {
    const requests = resolve({
      tasks: [
        { agent: "reviewer", task: "a", model: "Mapleluv/claude-sonnet-4-6" },
        { agent: "reviewer", task: "b", model: "minimax/MiniMax-M2.7" },
      ],
    });
    const confirmation = formatModelOverrideConfirmation(requests);
    assert.match(confirmation, /reviewer/);
    assert.match(confirmation, /configured primary.*gpt-5\.6-sol-pro/i);
    assert.match(confirmation, /configured fallback.*gpt-5\.6-terra-pro/i);
    assert.match(confirmation, /claude-sonnet-4-6/);
    assert.match(confirmation, /MiniMax-M2\.7/);

    const denial = formatModelOverrideDenial(requests, "user-rejected");
    assert.match(denial, /remove.*model/i);
    assert.match(denial, /configured route/i);
    assert.match(denial, /do not retry.*different model/i);
    assert.match(denial, /ask the user/i);
  });
});
