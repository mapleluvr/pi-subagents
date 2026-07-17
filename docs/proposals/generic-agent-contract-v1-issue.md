# Upstream Issue Proposal: Generic Agent Contract v1

Submitted as [nicobailon/pi-subagents#499](https://github.com/nicobailon/pi-subagents/issues/499).

## Problem

`pi-subagents` currently treats a code-writing workflow as part of the generic agent protocol:

- acceptance can be inferred from task wording, agent names, async mode, and write intent;
- inferred acceptance injects a fixed code-shaped child report and can turn a successful child exit into execution failure;
- CompletionGuard is enabled through mutation heuristics and can also rewrite a successful exit;
- chain progression therefore depends on mixed execution and acceptance semantics;
- `outputSchema` is not exposed consistently across every launch/delegation entry point;
- recovery consumers have to reconstruct contract semantics from legacy fields and current configuration.

Those defaults are useful for coding agents, but they make the core harder to reuse for research, formal methods, docs, operations, visual work, or any domain with different evidence and effect policies.

## Proposal

Add an opt-in, versioned generic contract:

```ts
agentContract: { version: 1 }
```

Omitting `agentContract` would preserve all current behavior. Under v1:

1. **Acceptance is explicit and observational**
   - omitted `acceptance` means no acceptance policy;
   - no policy is inferred from task text, role names, async mode, or write intent;
   - verify-only policies run without requiring a child self-report;
   - when report-dependent criteria and `verify[]` are combined, configured verification still runs before the final rejected decision;
   - rejection is recorded without rewriting child `exitCode`, execution status, success events, or aggregates.

2. **Execution, acceptance, and review remain separate**
   - runtime results/status expose derived `execution` and `review` projections while retaining legacy fields;
   - sequential steps use `gateOn: "execution" | "acceptance"`, defaulting to `execution` under v1;
   - review remains a real independent reviewer run, not a stronger worker self-report.

3. **Effects are explicit policy**
   - under v1, CompletionGuard runs only when the selected agent explicitly configures `completionGuard: true`;
   - its outcome is reported as `effects.fileMutation` and never changes execution success;
   - omitted agent policy does not infer a required workspace mutation.

4. **Structured child output has entry-point parity**
   - expose `outputSchema` on direct singles, top-level `tasks[]`, chain/parallel steps, async singles, Clarify-to-background conversion, and typed delegation;
   - keep `structuredOutput` child-owned and runtime-validated, not acceptance or review evidence.

5. **Contract provenance survives recovery**
   - persist whether a run resolved to v1 from the call/config or to the legacy default;
   - revive from the persisted resolved contract and raw acceptance input instead of re-inferring behavior from newer configuration.

## Why opt-in first

This keeps the migration additive. Existing coding workflows, acceptance inference, fixed evidence fields, CompletionGuard failure behavior, and default chain gating remain available in legacy mode. A later explicit coding profile/recipe could package those behaviors without making them the universal protocol, but profiles and extension namespaces are intentionally outside this first slice.

## Prototype

I implemented the proposal against upstream commit `315e1eb1482c` (the current `main` HEAD):

- implementation branch: https://github.com/mapleluvr/pi-subagents/tree/research/agent-contract
- implementation commit: https://github.com/mapleluvr/pi-subagents/commit/1af19b3b0e4b72dd7ed0f1e9d4d90637f59bf643
- contract design: https://github.com/mapleluvr/pi-subagents/blob/1af19b3b0e4b72dd7ed0f1e9d4d90637f59bf643/docs/research/agent-contract.md
- Coding-Agent-first audit: https://github.com/mapleluvr/pi-subagents/blob/1af19b3b0e4b72dd7ed0f1e9d4d90637f59bf643/docs/research/coding-agent-first-audit.md
- real Pi runtime debug: https://github.com/mapleluvr/pi-subagents/blob/1af19b3b0e4b72dd7ed0f1e9d4d90637f59bf643/docs/research/generic-agent-contract-v1-runtime-debug.md

Unit and integration tests cover foreground, async, dynamic fanout, detachment, recovery, chain gating, Clarify conversion, and typed delegation. Focused contract/lifecycle tests pass, e2e passes, and the full Windows runs retain only documented pre-existing isolation/symlink failures plus timing tests that pass in isolation. Foreground, async, chain gating, verify-only acceptance, structured output, explicit CompletionGuard, and the legacy control were additionally exercised through real Pi `0.80.6` using `Mapleluv-Main/gpt-5.6-sol-pro` for parent and child, with no persistent model/config changes and no launch timeout.

## Non-goals for this proposal

- replacing the legacy default immediately;
- defining universal evidence fields or a mandatory child JSON envelope;
- treating `outputSchema` as acceptance evidence;
- auto-running review inside the worker;
- removing worktrees, watchdog/LSP support, or code-oriented worker/scout roles;
- shipping domain profiles or a profile registry in the first change.

## Maintainer decisions requested

The prototype currently makes these choices:

- `agentContract: { version: 1 }` is the explicit compatibility boundary;
- `execution` and `review` projections land in the same correctness slice as lifecycle decoupling, so result and status consumers cannot temporarily disagree;
- `gateOn` is configured per sequential step, with no run-level default;
- the implementation is presented as one correctness slice. It may be split into reviewable commits or PRs only if v1 remains unexposed until every lifecycle consumer is consistent.

The primary upstream policy decision is whether the opt-in v1 boundary is acceptable. If a run-level `gateOn` default is preferred for ergonomics, it can be added without changing per-step override semantics. For review, I can keep the slice in one PR or split it mechanically while preserving that atomic exposure boundary.
