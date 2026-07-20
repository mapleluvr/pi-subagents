# Model Override Permission Design

**Status:** Approved

**Date:** 2026-07-20

## Problem

`pi-subagents` has two distinct model-selection paths:

1. An agent's configured primary model and ordered `fallbackModels` route.
2. Caller-supplied `model` fields on single, parallel, chain, append, resume, scheduled, slash, and typed-delegation launches.

The configured route is user-owned configuration. Provider/network failures may move through that route. A caller-supplied model currently wins over the route without an authorization check, so an orchestrator can replace a configured high-capability model with an unrelated model after a transient failure.

Persisted sessions confirm both behaviors. Configured fallbacks stayed within the configured route, while Sonnet/Opus substitutions came from explicit per-call `model` arguments. Upstream issues address inherited-model contamination and fallback classification, but no current issue requires user authorization for per-call model overrides.

A related failure mode is distinct: a child can make an invalid tool call and then finish without a non-empty final answer. Current runtime reports that child as failed. Upstream fixes prevent child tool errors from triggering model fallback and clear recovered errors after a later clean final answer. This design does not relabel an incomplete child as successful. It prevents Main from responding to that failure by silently selecting another model.

## Goals

- Treat the configured primary plus ordered `fallbackModels` as a pre-authorized route.
- Require real user authorization before an effective per-call model override changes that route.
- Enforce authorization in runtime, not only in prompt guidance.
- Cover direct single, top-level tasks, chain steps, dynamic fanout templates, append, resume, scheduled launches, slash bridges, typed delegation, and child-safe fanout.
- Aggregate all overrides in one invocation into one authorization decision.
- Fail closed without an interactive UI.
- Preserve current provider-failure fallback and child-tool-failure classification behavior.
- Teach Main to recover/status/resume the same child after a tool failure rather than silently relaunching under a different model.

## Non-Goals

- Redesigning fallback eligibility, provider retry counts, or fallback ordering.
- Redesigning the child `failed` state after a tool error followed by an empty final answer.
- Adding automatic same-model recovery continuation.
- Gating agent-management files, watchdog model configuration, or arbitrary filesystem edits in this slice.
- Inferring authorization from natural-language conversation text.
- Persisting broad session-wide approvals.

## Terms

**Configured route:** The effective configured primary model for an agent, followed by that agent's configured `fallbackModels` in order. The primary may inherit the current parent model when the agent deliberately uses inheritance.

**Explicit override:** A caller-supplied `model` value whose canonical effective model differs from the configured primary. Selecting a configured fallback directly is still an override because it changes route order and bypasses primary failure eligibility.

**No-op selector:** A caller-supplied model that canonicalizes to the configured primary. It changes no effective behavior and requires no prompt.

**Authorization:** One of an interactive per-invocation user confirmation, a user-owned `allow` configuration, a confirmed clarify UI result, or a bound scheduled-run approval receipt.

## Permission Contract

Add this extension setting:

```json
{
  "modelOverridePermission": "ask"
}
```

Allowed values:

- `ask` (default): show one user confirmation before launch. If no UI exists, reject.
- `deny`: reject every effective explicit override without prompting.
- `allow`: preserve legacy unrestricted per-call override behavior. Setting it is persistent user pre-authorization.

Invalid values fail closed and return a configuration error before launch.

The local user configuration will explicitly set `modelOverridePermission` to `ask`, even though it is the default, so the intended policy is visible and reviewable.

## Authorization Boundary

The runtime collects explicit effective overrides after agent discovery and execution-shape validation, but before creating session directories, worktrees, async-run records, spawn reservations, or child processes.

For each model selector it records:

- parameter path;
- agent name;
- configured effective primary;
- configured fallbacks for display;
- requested canonical effective model.

Canonical comparison reuses existing model resolution, including provider qualification, fuzzy registry matching, inheritance, model scope, and thinking suffixes. The permission layer does not implement a second model resolver.

If no effective override exists, execution proceeds without UI. Configured fallback transitions inside child execution also proceed without UI because they are not caller overrides.

If one or more effective overrides exist:

1. `allow` proceeds.
2. `deny` returns a permission error.
3. `ask` with no UI returns a permission error.
4. `ask` with UI displays one aggregated confirmation and proceeds only on approval.

Concurrent async calls serialize confirmation dialogs. Approval is scoped to one invocation and is not cached for later calls.

The denial result is an execution-mode-shaped tool error with zero children and no run id. Its text says to remove `model` fields to use the configured route, not to try another model, and to ask the user before requesting an override.

## Covered Surfaces

The collector covers model fields on:

- direct single launch;
- each top-level `tasks[]` item;
- sequential chain steps;
- static parallel children;
- dynamic parallel templates;
- `append-step` chain payloads;
- explicit `model` on `resume`;
- scheduled single/tasks/chain payloads;
- legacy slash/prompt-template delegation after conversion;
- typed delegation after conversion;
- child-safe nested fanout.

A top-level `model` supplied alongside tasks or chain is currently non-effective and is not treated as authorization for child models. Existing execution validation remains authoritative.

## Clarify UI

`clarify: true` with UI is already a user-facing editor that shows the final model selections and requires confirmation. Its confirmed final selections count as authorization for that invocation and do not trigger a second dialog.

If `clarify: true` is requested without UI, it cannot authorize an override. The ordinary `ask` no-UI rule rejects the override.

## Resume

Recovered model and fallback data belong to the previously authorized run and do not require a new prompt. Only an explicit `model` supplied on the resume action is checked. The check occurs after resolving the target and agent, but before creating a revived run or acquiring a revival lease.

## Append

An appended step is checked after the target chain and payload are validated, but before writing the append request. All sequential/static/dynamic model fields in the appended step are covered.

## Scheduled Runs

Authorization occurs when the schedule is created. In `ask` mode, schedule creation requires an available user UI; headless creation fails closed unless user-owned config already says `allow`. An approved scheduled payload stores a private approval receipt containing the canonical override digest. The receipt is not part of the public tool schema.

At fire time the runtime recomputes the override digest. A matching receipt authorizes the stored launch without reopening UI. Missing or mismatched receipts use the current permission mode and fail closed in no-UI execution. Changing the stored model payload therefore cannot accidentally reuse approval for a different override.

The receipt is provenance for a user-owned local scheduled-run store, not a cryptographic defense against a local filesystem owner.

## Typed Delegation And Bridges

Slash, prompt-template, and typed-delegation requests converge on the same executor and permission gate. They do not receive a trusted bypass merely because another extension emitted the request.

A typed delegation denied by policy returns the existing correlated terminal response with failed status and the permission error. No protocol version bump is required because no public request or response field is added.

## Prompt Contract

Update Skill, full/compact/custom mandatory Tool description, model schema descriptions, and README:

- Omit `model` by default and use the selected agent's configured route.
- Supply `model` only when the user explicitly requests that exact per-run override.
- Do not substitute another model after provider, tool, schema, acceptance, or child execution failure.
- Configured fallbacks may run automatically for eligible provider/model failures.
- After a child tool-call failure, inspect status/artifacts and resume or recover the same session when useful; do not launch a replacement model without user approval.
- Explain `modelOverridePermission` and headless fail-closed behavior.

Custom Tool descriptions always receive the mandatory policy suffix, so project prose cannot remove the authorization rule.

## Failure And Fallback Separation

This permission contract does not change `isRetryableModelFailure`. Existing safeguards remain:

- provider/model failures may advance to configured fallbacks;
- child tool failures, even when their text contains network words, do not trigger model fallback;
- a recovered child with a clean non-empty final answer can succeed;
- a tool error followed by no clean final answer can remain failed.

The permission error itself is not retryable and must not trigger configured fallback because no child attempt starts.

## Compatibility

- Calls that omit `model` are unchanged.
- Agent primary/fallback execution is unchanged.
- Explicit no-op selectors matching the configured primary are unchanged.
- Explicit effective overrides now prompt or fail unless config says `allow`.
- Headless automation that intentionally uses overrides must set `modelOverridePermission: "allow"` in user-owned config; there is no model-supplied bypass field.
- Existing stored scheduled jobs without an approval receipt can still run when they contain no effective override. Jobs with overrides must satisfy the current permission policy.

## Verification

Fail-first tests must cover:

- default `ask`, explicit `allow` and `deny`, invalid fail-closed;
- canonical no-op versus effective override;
- configured fallback route requiring no prompt;
- single, tasks, sequential chain, static parallel, dynamic template;
- one aggregated prompt for multiple overrides;
- user approve and reject;
- no-UI rejection before session/run/worktree artifacts;
- serialized concurrent confirmations;
- clarify confirmation without duplicate prompt;
- explicit resume override versus recovered model;
- append mutation only after approval;
- scheduled receipt match and mismatch;
- slash and typed delegation convergence;
- child-safe fanout no-UI rejection;
- Skill, Tool description, schema and README policy text;
- existing model fallback tests, especially child-tool errors not retryable.

A real Pi canary must use the worktree extension with temporary settings and fixed configured agent route. It must prove that an off-route headless override is denied with zero child artifacts, while a model-omitted launch uses the configured route. Persistent user settings are changed only after code, tests, review, and canary are green.
