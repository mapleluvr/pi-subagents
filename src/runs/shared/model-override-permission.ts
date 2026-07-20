import { createHash } from "node:crypto";
import type { AgentConfig } from "../../agents/agents.ts";
import type { ChainStep } from "../../shared/settings.ts";
import type { ModelOverridePermission } from "../../shared/types.ts";
import {
  buildModelCandidates,
  resolveEffectiveSubagentModel,
  type AvailableModelInfo,
  type ParentModel,
} from "./model-fallback.ts";
import type { ModelScopeConfig } from "./model-scope.ts";
import { applyThinkingSuffix } from "./pi-args.ts";

export interface ExplicitModelSelector {
  path: string;
  agent: string;
  requestedModel: string;
}

export interface ModelOverrideRequest extends ExplicitModelSelector {
  requestedEffectiveModel: string;
  configuredPrimaryModel?: string;
  configuredFallbackModels: string[];
}

export interface ScheduledModelOverrideApproval {
  version: 1;
  source: "scheduled-user-confirmation";
  digest: string;
}

export interface ModelOverrideLaunchParams {
  agent?: string;
  model?: string;
  tasks?: Array<{ agent: string; model?: string }>;
  chain?: ChainStep[];
}

export interface ResolveModelOverrideRequestsInput {
  selectors: ExplicitModelSelector[];
  agents: AgentConfig[];
  parentModel?: ParentModel;
  availableModels?: AvailableModelInfo[];
  preferredProvider?: string;
  modelScope?: ModelScopeConfig;
}

export function resolveModelOverridePermission(value: unknown): {
  permission: ModelOverridePermission;
  error?: string;
} {
  if (value === undefined) return { permission: "ask" };
  if (value === "ask" || value === "deny" || value === "allow")
    return { permission: value };
  return {
    permission: "deny",
    error: `Invalid modelOverridePermission ${JSON.stringify(value)}; expected "ask", "deny", or "allow". Model overrides are denied until the configuration is corrected.`,
  };
}

function addSelector(
  selectors: ExplicitModelSelector[],
  path: string,
  agent: unknown,
  model: unknown,
): void {
  if (typeof agent !== "string" || typeof model !== "string") return;
  selectors.push({ path, agent, requestedModel: model });
}

export function collectExplicitModelSelectors(
  params: ModelOverrideLaunchParams,
): ExplicitModelSelector[] {
  const selectors: ExplicitModelSelector[] = [];
  if ((params.chain?.length ?? 0) > 0) {
    for (const [stepIndex, step] of params.chain!.entries()) {
      if ("agent" in step) {
        addSelector(
          selectors,
          `chain[${stepIndex}].model`,
          step.agent,
          step.model,
        );
        continue;
      }
      if (Array.isArray(step.parallel)) {
        for (const [itemIndex, item] of step.parallel.entries()) {
          addSelector(
            selectors,
            `chain[${stepIndex}].parallel[${itemIndex}].model`,
            item.agent,
            item.model,
          );
        }
        continue;
      }
      addSelector(
        selectors,
        `chain[${stepIndex}].parallel.model`,
        step.parallel.agent,
        step.parallel.model,
      );
    }
    return selectors;
  }
  if ((params.tasks?.length ?? 0) > 0) {
    for (const [taskIndex, task] of params.tasks!.entries()) {
      addSelector(
        selectors,
        `tasks[${taskIndex}].model`,
        task.agent,
        task.model,
      );
    }
    return selectors;
  }
  addSelector(selectors, "model", params.agent, params.model);
  return selectors;
}

export function resolveModelOverrideRequests(
  input: ResolveModelOverrideRequestsInput,
): ModelOverrideRequest[] {
  const agentsByName = new Map(
    input.agents.map((agent) => [agent.name, agent]),
  );
  const requests: ModelOverrideRequest[] = [];
  const suppressScopeWarning = () => {};
  for (const selector of input.selectors) {
    const agent = agentsByName.get(selector.agent);
    if (!agent)
      throw new Error(
        `Cannot authorize model override for unknown agent '${selector.agent}'.`,
      );
    const configuredPrimaryModel = resolveEffectiveSubagentModel(
      undefined,
      agent.model,
      input.parentModel,
      input.availableModels,
      input.preferredProvider,
      { scope: input.modelScope, onWarn: suppressScopeWarning },
    );
    const requestedResolvedModel = resolveEffectiveSubagentModel(
      selector.requestedModel,
      agent.model,
      input.parentModel,
      input.availableModels,
      input.preferredProvider,
      { scope: input.modelScope, onWarn: suppressScopeWarning },
    );
    const configuredRuntimeModel = applyThinkingSuffix(
      configuredPrimaryModel,
      agent.thinking,
    );
    const requestedEffectiveModel = applyThinkingSuffix(
      requestedResolvedModel,
      agent.thinking,
    );
    if (
      !requestedEffectiveModel ||
      requestedEffectiveModel === configuredRuntimeModel
    )
      continue;
    const configuredRoute = buildModelCandidates(
      configuredPrimaryModel,
      agent.fallbackModels,
      input.availableModels,
      input.preferredProvider,
      { scope: input.modelScope, onWarn: suppressScopeWarning },
    ).map(
      (candidate) =>
        applyThinkingSuffix(candidate, agent.thinking) ?? candidate,
    );
    requests.push({
      ...selector,
      requestedEffectiveModel,
      ...(configuredRuntimeModel
        ? { configuredPrimaryModel: configuredRuntimeModel }
        : {}),
      configuredFallbackModels: configuredRoute.filter(
        (candidate) => candidate !== configuredRuntimeModel,
      ),
    });
  }
  return requests;
}

function canonicalRequestRecords(
  requests: ModelOverrideRequest[],
): Array<Record<string, unknown>> {
  return [...requests]
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.agent.localeCompare(right.agent),
    )
    .map((request) => ({
      path: request.path,
      agent: request.agent,
      requestedEffectiveModel: request.requestedEffectiveModel,
      configuredPrimaryModel: request.configuredPrimaryModel ?? null,
      configuredFallbackModels: [...request.configuredFallbackModels],
    }));
}

export function modelOverrideRequestDigest(
  requests: ModelOverrideRequest[],
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalRequestRecords(requests)))
    .digest("hex");
}

export function createScheduledModelOverrideApproval(
  requests: ModelOverrideRequest[],
): ScheduledModelOverrideApproval {
  return {
    version: 1,
    source: "scheduled-user-confirmation",
    digest: modelOverrideRequestDigest(requests),
  };
}

export function validateScheduledModelOverrideApproval(
  receipt: unknown,
  requests: ModelOverrideRequest[],
): receipt is ScheduledModelOverrideApproval {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
    return false;
  const candidate = receipt as Partial<ScheduledModelOverrideApproval>;
  return (
    candidate.version === 1 &&
    candidate.source === "scheduled-user-confirmation" &&
    /^[a-f0-9]{64}$/.test(candidate.digest ?? "") &&
    candidate.digest === modelOverrideRequestDigest(requests)
  );
}

export function formatModelOverrideConfirmation(
  requests: ModelOverrideRequest[],
): string {
  const lines = [
    "This subagent invocation requests model routing that differs from the configured agent route:",
    "",
  ];
  for (const request of requests) {
    lines.push(`- ${request.path} (${request.agent})`);
    lines.push(
      `  Configured primary: ${request.configuredPrimaryModel ?? "inherit/unresolved"}`,
    );
    lines.push(
      `  Configured fallbacks: ${request.configuredFallbackModels.length > 0 ? request.configuredFallbackModels.join(", ") : "none"}`,
    );
    lines.push(`  Requested override: ${request.requestedEffectiveModel}`);
  }
  lines.push("", "Approve these model overrides for this invocation only?");
  return lines.join("\n");
}

export function formatModelOverrideDenial(
  requests: ModelOverrideRequest[],
  reason:
    | "config-deny"
    | "config-invalid"
    | "no-ui"
    | "user-rejected"
    | "approval-mismatch",
): string {
  const requested = requests
    .map((request) => `${request.path}=${request.requestedEffectiveModel}`)
    .join(", ");
  const reasonText = {
    "config-deny": "Model override permission is configured to deny.",
    "config-invalid":
      "Model override permission configuration is invalid and failed closed.",
    "no-ui":
      "Model override permission requires interactive user approval, but no UI is available.",
    "user-rejected": "The user rejected the requested model override.",
    "approval-mismatch":
      "The stored model override approval does not match the requested models.",
  }[reason];
  return [
    reasonText,
    requested ? `Requested: ${requested}` : undefined,
    "Remove every model field to use the configured route. Do not retry with a different model. Ask the user before requesting an exact per-run model override.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
