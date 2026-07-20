import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MockPi } from "../support/helpers.ts";
import {
  createEventBus,
  createMockPi,
  createTempDir,
  makeAgent,
  makeMinimalCtx,
  removeTempDir,
  tryImport,
} from "../support/helpers.ts";
import {
  ASYNC_DIR,
  RESULTS_DIR,
  type ExtensionConfig,
} from "../../src/shared/types.ts";
import { countPendingChainAppendRequests } from "../../src/runs/background/chain-append.ts";
import { registerSlashSubagentBridge } from "../../src/slash/slash-bridge.ts";
import { registerPromptTemplateDelegationBridge } from "../../src/slash/prompt-template-bridge.ts";
import {
  collectExplicitModelSelectors,
  createScheduledModelOverrideApproval,
  resolveModelOverrideRequests,
} from "../../src/runs/shared/model-override-permission.ts";

const executorMod = await tryImport<any>(
  "./src/runs/foreground/subagent-executor.ts",
);
const createSubagentExecutor = executorMod?.createSubagentExecutor;

function callCount(mockPi: MockPi): number {
  return fs.readdirSync(mockPi.dir).filter((name) => name.startsWith("call-"))
    .length;
}

describe(
  "model override permission",
  { skip: !createSubagentExecutor ? "executor not importable" : undefined },
  () => {
    let tempDir: string;
    let mockPi: MockPi;

    before(() => {
      mockPi = createMockPi();
      mockPi.install();
    });

    after(() => {
      mockPi.uninstall();
    });

    beforeEach(() => {
      tempDir = createTempDir();
      mockPi.reset();
    });

    afterEach(() => {
      removeTempDir(tempDir);
    });

    function configuredAgents() {
      return [
        makeAgent("reviewer", {
          model: "Mapleluv/gpt-5.6-sol-pro",
          fallbackModels: ["Mapleluv/gpt-5.6-terra-pro"],
        }),
      ];
    }

    function createExecutor(
      config: ExtensionConfig = {},
      overrides: Record<string, unknown> = {},
    ) {
      const agents = configuredAgents();
      return createSubagentExecutor({
        pi: { events: createEventBus(), getSessionName: () => undefined },
        state: {
          baseCwd: tempDir,
          currentSessionId: null,
          asyncJobs: new Map(),
          foregroundControls: new Map(),
          lastForegroundControlId: null,
        },
        config,
        asyncByDefault: false,
        tempArtifactsDir: tempDir,
        getSubagentSessionRoot: () => tempDir,
        expandTilde: (value: string) => value,
        discoverAgents: () => ({ agents }),
        ...overrides,
      });
    }

    function availableModels() {
      return [
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
      ];
    }

    function makeCtx(overrides: Record<string, unknown> = {}) {
      return {
        ...makeMinimalCtx(tempDir),
        model: { provider: "Mapleluv", id: "gpt-5.6-sol-pro" },
        modelRegistry: {
          getAvailable: () =>
            availableModels().map(({ fullId: _fullId, ...model }) => model),
        },
        ...overrides,
      };
    }

    function scheduledApproval(model: string) {
      const requests = resolveModelOverrideRequests({
        selectors: collectExplicitModelSelectors({ agent: "reviewer", model }),
        agents: configuredAgents(),
        parentModel: { provider: "Mapleluv", id: "gpt-5.6-sol-pro" },
        availableModels: availableModels(),
        preferredProvider: "Mapleluv",
      });
      return createScheduledModelOverrideApproval(requests);
    }

    async function execute(
      params: Record<string, unknown>,
      options: {
        config?: ExtensionConfig;
        ctx?: Record<string, unknown>;
        id?: string;
      } = {},
    ) {
      return createExecutor(options.config).execute(
        options.id ?? "model-override-test",
        params,
        new AbortController().signal,
        undefined,
        options.ctx ?? makeCtx(),
      );
    }

    it("fails closed before spawning when the default ask policy has no UI", async () => {
      mockPi.onCall({ output: "should not run" });
      const result = await execute({
        agent: "reviewer",
        task: "Review without changing the configured model route.",
        model: "Mapleluv/claude-sonnet-4-6",
        async: false,
      });

      assert.equal(result.isError, true);
      assert.match(
        result.content[0]?.text ?? "",
        /no UI.*model override|model override.*no UI/i,
      );
      assert.match(
        result.content[0]?.text ?? "",
        /do not retry.*different model/i,
      );
      assert.equal(result.details?.results?.length, 0);
      assert.equal(callCount(mockPi), 0);
    });

    it("lets user-owned allow config preserve legacy explicit override behavior", async () => {
      mockPi.onCall({ output: "allowed override" });
      const result = await execute(
        {
          agent: "reviewer",
          task: "Review",
          model: "Mapleluv/claude-sonnet-4-6",
          async: false,
        },
        { config: { modelOverridePermission: "allow" } },
      );
      assert.equal(result.isError, undefined);
      assert.match(result.content[0]?.text ?? "", /allowed override/);
      assert.equal(callCount(mockPi), 1);
    });

    it("deny rejects without asking even when UI is available", async () => {
      let confirmCalls = 0;
      const result = await execute(
        {
          agent: "reviewer",
          task: "Review",
          model: "Mapleluv/claude-sonnet-4-6",
          async: false,
        },
        {
          config: { modelOverridePermission: "deny" },
          ctx: makeCtx({
            hasUI: true,
            ui: {
              confirm: async () => {
                confirmCalls += 1;
                return true;
              },
            },
          }),
        },
      );
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /configured to deny/i);
      assert.equal(confirmCalls, 0);
      assert.equal(callCount(mockPi), 0);
    });

    it("invalid permission config fails closed even without an explicit model", async () => {
      const result = await execute(
        { agent: "reviewer", task: "Review", async: false },
        { config: { modelOverridePermission: "sometimes" } as never },
      );
      assert.equal(result.isError, true);
      assert.match(
        result.content[0]?.text ?? "",
        /invalid modelOverridePermission/i,
      );
      assert.equal(callCount(mockPi), 0);
    });

    it("asks once and launches only after interactive approval", async () => {
      mockPi.onCall({ output: "approved override" });
      const prompts: string[] = [];
      const result = await execute(
        {
          agent: "reviewer",
          task: "Review",
          model: "Mapleluv/claude-sonnet-4-6",
          async: false,
        },
        {
          ctx: makeCtx({
            hasUI: true,
            ui: {
              confirm: async (_title: string, message: string) => {
                prompts.push(message);
                return true;
              },
            },
          }),
        },
      );
      assert.equal(result.isError, undefined);
      assert.equal(prompts.length, 1);
      assert.match(prompts[0] ?? "", /configured primary.*gpt-5\.6-sol-pro/i);
      assert.match(prompts[0] ?? "", /claude-sonnet-4-6/);
      assert.equal(callCount(mockPi), 1);
    });

    it("returns a non-retry denial when the user rejects", async () => {
      const result = await execute(
        {
          agent: "reviewer",
          task: "Review",
          model: "Mapleluv/claude-sonnet-4-6",
          async: false,
        },
        {
          ctx: makeCtx({
            hasUI: true,
            ui: { confirm: async () => false },
          }),
        },
      );
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /user rejected/i);
      assert.match(
        result.content[0]?.text ?? "",
        /do not retry.*different model/i,
      );
      assert.equal(callCount(mockPi), 0);
    });

    it("does not prompt for a canonical configured-primary no-op", async () => {
      mockPi.onCall({ output: "configured primary" });
      let confirmCalls = 0;
      const result = await execute(
        {
          agent: "reviewer",
          task: "Review",
          model: "gpt_5.6_sol_pro",
          async: false,
        },
        {
          ctx: makeCtx({
            hasUI: true,
            ui: {
              confirm: async () => {
                confirmCalls += 1;
                return false;
              },
            },
          }),
        },
      );
      assert.equal(result.isError, undefined);
      assert.equal(confirmCalls, 0);
      assert.equal(callCount(mockPi), 1);
    });

    it("requires approval when a configured fallback is selected directly", async () => {
      let prompt = "";
      const result = await execute(
        {
          agent: "reviewer",
          task: "Review",
          model: "Mapleluv/gpt-5.6-terra-pro",
          async: false,
        },
        {
          ctx: makeCtx({
            hasUI: true,
            ui: {
              confirm: async (_title: string, message: string) => {
                prompt = message;
                return false;
              },
            },
          }),
        },
      );
      assert.equal(result.isError, true);
      assert.match(prompt, /configured fallback.*gpt-5\.6-terra-pro/i);
      assert.match(prompt, /requested override.*gpt-5\.6-terra-pro/i);
      assert.equal(callCount(mockPi), 0);
    });

    it("aggregates task overrides into one confirmation", async () => {
      let confirmCalls = 0;
      let prompt = "";
      const result = await execute(
        {
          tasks: [
            {
              agent: "reviewer",
              task: "A",
              model: "Mapleluv/claude-sonnet-4-6",
            },
            {
              agent: "reviewer",
              task: "B",
              model: "Mapleluv/gpt-5.6-terra-pro",
            },
          ],
          async: true,
        },
        {
          ctx: makeCtx({
            hasUI: true,
            ui: {
              confirm: async (_title: string, message: string) => {
                confirmCalls += 1;
                prompt = message;
                return false;
              },
            },
          }),
        },
      );
      assert.equal(result.isError, true);
      assert.equal(confirmCalls, 1);
      assert.match(prompt, /tasks\[0\]\.model/);
      assert.match(prompt, /tasks\[1\]\.model/);
      assert.equal(callCount(mockPi), 0);
    });

    it("aggregates sequential, static-parallel, and dynamic-template chain overrides", async () => {
      let prompt = "";
      const result = await execute(
        {
          chain: [
            {
              agent: "reviewer",
              task: "seed",
              model: "Mapleluv/claude-sonnet-4-6",
              output: "seed",
            },
            {
              parallel: [
                {
                  agent: "reviewer",
                  task: "static",
                  model: "Mapleluv/gpt-5.6-terra-pro",
                },
              ],
            },
            {
              expand: { from: { output: "seed", path: "items" } },
              parallel: {
                agent: "reviewer",
                task: "dynamic",
                model: "Mapleluv/claude-sonnet-4-6",
              },
              collect: { as: "dynamic-results" },
            },
          ],
          async: true,
        },
        {
          ctx: makeCtx({
            hasUI: true,
            ui: {
              confirm: async (_title: string, message: string) => {
                prompt = message;
                return false;
              },
            },
          }),
        },
      );
      assert.equal(result.isError, true);
      assert.match(prompt, /chain\[0\]\.model/);
      assert.match(prompt, /chain\[1\]\.parallel\[0\]\.model/);
      assert.match(prompt, /chain\[2\]\.parallel\.model/);
      assert.equal(callCount(mockPi), 0);
    });

    it("serializes concurrent async confirmation dialogs", async () => {
      const releases: Array<(approved: boolean) => void> = [];
      let active = 0;
      let maxActive = 0;
      const ctx = makeCtx({
        hasUI: true,
        ui: {
          confirm: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            const approved = await new Promise<boolean>((resolve) =>
              releases.push(resolve),
            );
            active -= 1;
            return approved;
          },
        },
      });
      const executor = createExecutor();
      const run = (id: string, model: string) =>
        executor.execute(
          id,
          { agent: "reviewer", task: id, model, async: true },
          new AbortController().signal,
          undefined,
          ctx,
        );
      const first = run("first", "Mapleluv/claude-sonnet-4-6");
      const second = run("second", "Mapleluv/gpt-5.6-terra-pro");
      for (let index = 0; index < 20 && releases.length < 1; index++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(releases.length, 1);
      releases[0]!(false);
      for (let index = 0; index < 20 && releases.length < 2; index++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(releases.length, 2);
      releases[1]!(false);
      const results = await Promise.all([first, second]);
      assert.ok(results.every((result: any) => result.isError === true));
      assert.equal(maxActive, 1);
      assert.equal(callCount(mockPi), 0);
    });

    it("uses the user-confirmed clarify editor as authorization before run side effects", async () => {
      mockPi.onCall({ output: "clarified run" });
      const sessionRoot = path.join(tempDir, "clarify-session-root");
      const events: string[] = [];
      const executor = createExecutor({}, {
        getSubagentSessionRoot: () => sessionRoot,
      });
      const result = await executor.execute(
        "clarify-authorized",
        {
          chain: [
            {
              agent: "reviewer",
              task: "Review",
              model: "Mapleluv/claude-sonnet-4-6",
            },
          ],
          clarify: true,
          async: false,
        },
        new AbortController().signal,
        undefined,
        makeCtx({
          hasUI: true,
          ui: {
            confirm: async () => {
              events.push("permission");
              assert.equal(fs.existsSync(sessionRoot), false);
              return true;
            },
            custom: async (factory: any) => {
              events.push("clarify");
              assert.equal(fs.existsSync(sessionRoot), false);
              const component = factory(
                { requestRender() {} },
                { fg(_key: string, text: string) { return text; } },
                undefined,
                () => {},
              );
              assert.equal(
                component.getEffectiveModel(0),
                "Mapleluv/claude-sonnet-4-6",
              );
              return {
                confirmed: true,
                templates: ["Review"],
                behaviorOverrides: [{ model: "Mapleluv/claude-sonnet-4-6" }],
              };
            },
          },
        }),
      );
      assert.equal(result.isError, undefined);
      assert.deepEqual(events, ["clarify"]);
      assert.equal(callCount(mockPi), 1);
    });

    it("rejects a scheduled override before the scheduling handler in headless ask mode", async () => {
      let handlerCalls = 0;
      const executor = createExecutor(
        {},
        {
          handleScheduledRunAction: async () => {
            handlerCalls += 1;
            return {
              content: [{ type: "text", text: "scheduled" }],
              details: { mode: "management", results: [] },
            };
          },
        },
      );
      const result = await executor.execute(
        "schedule-denied",
        {
          action: "schedule",
          agent: "reviewer",
          task: "Review later",
          model: "Mapleluv/claude-sonnet-4-6",
          schedule: "+10m",
        },
        new AbortController().signal,
        undefined,
        makeCtx(),
      );
      assert.equal(result.isError, true);
      assert.match(
        result.content[0]?.text ?? "",
        /no UI.*model override|model override.*no UI/i,
      );
      assert.equal(handlerCalls, 0);
    });

    it("binds an approved scheduled override receipt before persistence", async () => {
      let captured: Record<string, unknown> | undefined;
      const executor = createExecutor(
        {},
        {
          handleScheduledRunAction: async (params: Record<string, unknown>) => {
            captured = params;
            return {
              content: [{ type: "text", text: "scheduled" }],
              details: { mode: "management", results: [] },
            };
          },
        },
      );
      const result = await executor.execute(
        "schedule-approved",
        {
          action: "schedule",
          agent: "reviewer",
          task: "Review later",
          model: "Mapleluv/claude-sonnet-4-6",
          schedule: "+10m",
        },
        new AbortController().signal,
        undefined,
        makeCtx({ hasUI: true, ui: { confirm: async () => true } }),
      );
      assert.equal(result.isError, undefined);
      assert.equal(captured?.modelOverrideApproval, undefined);
      assert.deepEqual(
        Object.keys(captured ?? {}).includes("modelOverrideApproval"),
        false,
      );
    });

    it("rejects a caller-forged scheduled receipt on an ordinary launch", async () => {
      const forgedApproval = scheduledApproval("Mapleluv/claude-sonnet-4-6");
      const result = await execute({
        agent: "reviewer",
        task: "Ordinary review",
        model: "Mapleluv/claude-sonnet-4-6",
        modelOverrideApproval: forgedApproval,
        async: false,
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /no UI/i);
      assert.equal(callCount(mockPi), 0);
    });

    it("rejects an appended model override before writing the append inbox", async () => {
      const runId = `perm-append-${Date.now().toString(36)}`;
      const asyncDir = path.join(ASYNC_DIR, runId);
      fs.mkdirSync(asyncDir, { recursive: true });
      fs.writeFileSync(
        path.join(asyncDir, "status.json"),
        JSON.stringify({
          runId,
          sessionId: "session-123",
          mode: "chain",
          state: "running",
          startedAt: Date.now(),
          lastUpdate: Date.now(),
          cwd: tempDir,
          chainStepCount: 1,
          steps: [{ agent: "reviewer", status: "running" }],
        }),
        "utf-8",
      );
      try {
        const filesBefore = fs.readdirSync(asyncDir, { recursive: true });
        const result = await execute({
          action: "append-step",
          id: runId,
          chain: [
            {
              agent: "reviewer",
              task: "Continue review",
              model: "Mapleluv/claude-sonnet-4-6",
              progress: true,
              outputSchema: {
                type: "object",
                properties: { answer: { type: "string" } },
                required: ["answer"],
              },
            },
          ],
        });
        assert.equal(result.isError, true);
        assert.match(
          result.content[0]?.text ?? "",
          /no UI.*model override|model override.*no UI/i,
        );
        assert.equal(countPendingChainAppendRequests(asyncDir), 0);
        assert.deepEqual(fs.readdirSync(asyncDir, { recursive: true }), filesBefore);
      } finally {
        fs.rmSync(asyncDir, { recursive: true, force: true });
      }
    });

    it("rejects an off-route override through the slash bridge without launching", async () => {
      const events = createEventBus();
      const executor = createExecutor();
      const ctx = makeCtx();
      const bridge = registerSlashSubagentBridge({
        events,
        getContext: () => ctx,
        execute: executor.execute,
      });
      try {
        const response = new Promise<any>((resolve) =>
          events.on("subagent:slash:response", resolve),
        );
        events.emit("subagent:slash:request", {
          requestId: "slash-model-denied",
          params: {
            agent: "reviewer",
            task: "Review",
            model: "Mapleluv/claude-sonnet-4-6",
            modelOverrideApproval: createScheduledModelOverrideApproval(
              resolveModelOverrideRequests({
                selectors: collectExplicitModelSelectors({
                  agent: "reviewer",
                  model: "Mapleluv/claude-sonnet-4-6",
                }),
                agents: configuredAgents(),
                availableModels: makeCtx().modelRegistry.getAvailable(),
                preferredProvider: "Mapleluv",
              }),
            ),
          },
          ctx,
        });
        const terminal = await response;
        assert.equal(terminal.requestId, "slash-model-denied");
        assert.equal(terminal.isError, true);
        assert.match(terminal.errorText ?? "", /no UI.*model override|model override.*no UI/i);
        assert.equal(callCount(mockPi), 0);
      } finally {
        bridge.dispose();
      }
    });

    it("returns a correlated permission failure through typed delegation", async () => {
      const events = createEventBus();
      const executor = createExecutor();
      const ctx = makeCtx();
      const bridge = registerPromptTemplateDelegationBridge({
        events,
        getContext: () => ctx,
        execute: (requestId, params, signal, requestCtx, onUpdate) =>
          executor.execute(requestId, params, signal, onUpdate, requestCtx),
      });
      try {
        const response = new Promise<any>((resolve) =>
          events.on("prompt-template:subagent:response", resolve),
        );
        events.emit("prompt-template:subagent:request", {
          version: 1,
          requestId: "delegation-model-denied",
          agent: "reviewer",
          task: "Review",
          context: "fresh",
          cwd: tempDir,
          model: "Mapleluv/claude-sonnet-4-6",
        });
        const terminal = await response;
        assert.equal(terminal.requestId, "delegation-model-denied");
        assert.equal(terminal.status, "failed");
        assert.match(terminal.error ?? "", /no UI.*model override|model override.*no UI/i);
        assert.equal(callCount(mockPi), 0);
      } finally {
        bridge.dispose();
      }
    });

    it("rejects an explicit resume model before creating a revived async run", async () => {
      const sourceRunId = `perm-resume-${Date.now().toString(36)}`;
      const sourceDir = path.join(ASYNC_DIR, sourceRunId);
      const sessionFile = path.join(sourceDir, "run-0", "session.jsonl");
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      fs.writeFileSync(sessionFile, "", "utf-8");
      fs.writeFileSync(
        path.join(sourceDir, "status.json"),
        JSON.stringify({
          runId: sourceRunId,
          sessionId: "session-123",
          mode: "single",
          state: "complete",
          startedAt: Date.now() - 100,
          endedAt: Date.now(),
          lastUpdate: Date.now(),
          cwd: tempDir,
          sessionFile,
          steps: [
            {
              agent: "reviewer",
              status: "complete",
              sessionFile,
              model: "Mapleluv/gpt-5.6-sol-pro",
            },
          ],
        }),
        "utf-8",
      );
      const executor = createExecutor();
      let result: any;
      try {
        result = await executor.execute(
          "resume-denied",
          {
            action: "resume",
            id: sourceRunId,
            message: "Continue",
            model: "Mapleluv/claude-sonnet-4-6",
          },
          new AbortController().signal,
          undefined,
          makeCtx(),
        );
        assert.equal(result.isError, true);
        assert.match(
          result.content[0]?.text ?? "",
          /no UI.*model override|model override.*no UI/i,
        );
        assert.equal(result.details?.asyncId, undefined);
      } finally {
        if (result?.details?.asyncId) {
          await executor.execute(
            "resume-cleanup",
            { action: "stop", id: result.details.asyncId },
            new AbortController().signal,
            undefined,
            makeCtx(),
          );
        }
        fs.rmSync(sourceDir, { recursive: true, force: true });
        if (result?.details?.asyncDir)
          fs.rmSync(result.details.asyncDir, { recursive: true, force: true });
      }
    });
  },
);
