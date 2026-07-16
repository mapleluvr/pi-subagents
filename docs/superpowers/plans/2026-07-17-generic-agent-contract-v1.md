# Generic Agent Contract v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in generic agent contract that preserves process facts, makes acceptance and file-mutation effects explicit policy results, and exposes caller-defined structured output across every launch surface without breaking legacy behavior.

**Architecture:** Keep current behavior as the default compatibility mode. A new `agentContract: { version: 1 }` config/call mode changes omitted acceptance to not requested, evaluates explicit acceptance in observe mode without rewriting execution, disables implicit CompletionGuard while retaining explicit `completionGuard: true` as a file-mutation effect policy, and adds explicit execution/review/effect projections. Existing `outputSchema`/`structured_output` machinery is reused for direct single, top-level tasks, async, and typed delegation. Chain transitions gain `gateOn: execution | acceptance`; legacy chains retain current mixed behavior.

**Tech Stack:** TypeScript, TypeBox, Node test runner, Pi extension APIs, JSON lifecycle artifacts.

## Global Constraints

- Preserve current behavior when `agentContract.version` is absent.
- Persist contract version and policy provenance through async/recovery descriptors.
- No acceptance or effect rejection may rewrite process exit code in v1.
- Omitted v1 acceptance injects no acceptance prompt and performs no acceptance report parsing.
- Verify-only v1 acceptance must run without a child acceptance report.
- `outputSchema` remains a structural wire contract; value/policy judgment stays in acceptance or independent review.
- CompletionGuard remains available only when explicitly enabled in v1 and reports a policy/effect result instead of changing execution facts.
- No automatic reviewer is introduced.
- No generic profile/extension registry is introduced in this implementation.
- Existing worktree, watchdog, timeout, model, and orchestration behavior remains unchanged.
- The implementation branch remains `research/agent-contract` in the existing isolated worktree.

---

## Execution Checklist

- [x] Task 1: Define and resolve the v1 contract
- [x] Task 2: Make v1 acceptance explicit, report-optional, and observational
- [x] Task 3: Convert CompletionGuard into an explicit v1 effect policy
- [x] Task 4: Promote structured output to every launch and delegation surface
- [x] Task 5: Align agent-facing guidance and compatibility diagnostics
- [x] Task 6: Verify runtime behavior with the requested Pi model
- [ ] Task 7: Whole-change review, proposal, and upstream issue

### Task 1: Define and resolve the v1 contract

**Purpose:** Callers and config can select v1, while legacy remains the default and all execution paths receive one normalized contract context.

**Files/modules:**
- Modify: `src/shared/types.ts`
- Modify: `src/extension/schemas.ts`
- Modify: `src/extension/config.ts`
- Modify: `src/runs/foreground/subagent-executor.ts`
- Modify: `src/runs/background/async-execution.ts`
- Modify: `src/runs/background/async-resume.ts`
- Test: `test/unit/schemas.test.ts`
- Test: `test/unit/config-dir-runtime.test.ts`
- Test: `test/unit/async-resume.test.ts`

**Interfaces and dependencies:**
- Produces `AgentContractConfig`, `ResolvedAgentContract`, and a resolver shared by foreground/async paths.
- Adds optional top-level `agentContract: { version: 1 }`; per-call value overrides extension config.
- Persists `agentContract` in recovery descriptors so revive never re-infers legacy/new behavior.

**Constraints and invariants:**
- Only version `1` is accepted.
- Omission resolves to legacy.
- The schema/config parser rejects malformed version values before launch.

**Acceptance evidence:**
- RED: focused schema/config/recovery tests fail because fields and validation do not exist.
- GREEN: focused tests pass with v1 round-trip and legacy omission.
- Regression: `npm run test:unit` passes.

**Risk and rollback:**
- Risk is inconsistent propagation across entry points; tests assert single, tasks, chain, async descriptor, and revive contexts.
- Rollback is additive field removal; no persisted legacy format changes.

**Implementation intent:**
- Resolve once at executor preflight and pass the normalized value, not raw optional objects, to execution builders.
- Record source as `call`, `config`, or `legacy-default` for diagnostics/recovery.

**Commit:**
```bash
git add src/shared/types.ts src/extension/schemas.ts src/extension/config.ts src/runs/foreground/subagent-executor.ts src/runs/background/async-execution.ts src/runs/background/async-resume.ts test/unit/schemas.test.ts test/unit/config-dir-runtime.test.ts test/unit/async-resume.test.ts
git commit -m "feat: add generic agent contract v1 mode"
```

### Task 2: Make v1 acceptance explicit, report-optional, and observational

**Purpose:** A successful child remains execution-successful when optional policy rejects it, while explicit verify-only acceptance works without child JSON.

**Files/modules:**
- Modify: `src/shared/types.ts`
- Modify: `src/runs/shared/acceptance.ts`
- Modify: `src/runs/foreground/execution.ts`
- Modify: `src/runs/background/subagent-runner.ts`
- Modify: `src/runs/foreground/subagent-executor.ts`
- Modify: `src/runs/foreground/chain-execution.ts`
- Modify: `src/runs/shared/workflow-graph.ts`
- Modify: `src/runs/background/chain-root-attachment.ts`
- Modify: `src/slash/delegation-adapters.ts`
- Test: `test/unit/acceptance.test.ts`
- Test: `test/integration/single-execution.test.ts`
- Test: `test/integration/async-execution.test.ts`
- Test: `test/integration/chain-execution.test.ts`
- Test: `test/unit/delegation-api.test.ts`

**Interfaces and dependencies:**
- Consumes `ResolvedAgentContract` from Task 1.
- Adds policy provenance/mode to resolved acceptance and ledger.
- Adds derived `execution` and `review` projections to results/status while retaining existing fields.
- Adds `gateOn: execution | acceptance` to chain/dynamic steps; v1 default is execution.

**Constraints and invariants:**
- In v1, omitted acceptance resolves to level none/not requested and no prompt.
- Explicit acceptance has no rank floor and does not inherit name/task/async inference.
- Child report is required only for checks that explicitly consume child claims; verify-only runs execute directly.
- V1 acceptance rejection never changes `exitCode`, execution status, success events, aggregate execution success, or delegation execution status.
- `gateOn: acceptance` controls only the chain transition.
- Legacy mode preserves current inference, report, exit rewrite, status, event, aggregate, and delegation behavior.

**Acceptance evidence:**
- RED: new unit/integration tests fail on current inference, report-before-verify, exit rewrite, status/event coupling, and missing `gateOn`.
- GREEN: focused suites pass in both v1 and legacy fixtures.
- Regression: acceptance/file-report/chain/async/delegation suites pass.

**Risk and rollback:**
- Highest risk is a missed acceptance consumer. A consumer matrix test covers foreground/async exit code, child status, complete event, aggregate, chain transition, delegation adapter, and recovery projection.
- Rollback is contract-mode scoped; legacy behavior remains available.

**Implementation intent:**
- Centralize execution projection derivation and policy gate predicates instead of repeating `acceptance.status === rejected` checks.
- In v1, parse a child report only when present or when criteria/evidence require it; always run configured `verify[]` before deciding report absence is fatal.
- Keep independent review status separate; do not synthesize review success from worker claims.

**Commit:**
```bash
git add src/shared/types.ts src/runs/shared/acceptance.ts src/runs/foreground/execution.ts src/runs/background/subagent-runner.ts src/runs/foreground/subagent-executor.ts src/runs/foreground/chain-execution.ts src/runs/shared/workflow-graph.ts src/runs/background/chain-root-attachment.ts src/slash/delegation-adapters.ts test/unit/acceptance.test.ts test/integration/single-execution.test.ts test/integration/async-execution.test.ts test/integration/chain-execution.test.ts test/unit/delegation-api.test.ts
git commit -m "feat: decouple acceptance from execution"
```

### Task 3: Convert CompletionGuard into an explicit v1 effect policy

**Purpose:** V1 never infers file mutation from prose unless a caller-selected agent explicitly enables CompletionGuard, and a missing mutation is reported as an effect-policy rejection rather than a process failure.

**Files/modules:**
- Modify: `src/shared/types.ts`
- Modify: `src/runs/shared/completion-guard.ts`
- Modify: `src/runs/foreground/execution.ts`
- Modify: `src/runs/background/subagent-runner.ts`
- Modify: `src/runs/foreground/subagent-executor.ts`
- Modify: `src/runs/background/async-execution.ts`
- Modify: `src/runs/background/async-resume.ts`
- Test: `test/unit/completion-guard.test.ts`
- Test: `test/integration/single-execution.test.ts`
- Test: `test/integration/async-execution.test.ts`
- Test: `test/unit/async-resume.test.ts`

**Interfaces and dependencies:**
- Consumes `ResolvedAgentContract`.
- Adds an additive `effects.fileMutation` result with `not-requested | satisfied | rejected`, source/provenance, and message.
- Existing `AgentConfig.completionGuard` stays the explicit opt-in surface for v1; no profile registry is added.

**Constraints and invariants:**
- Legacy omission still enables current guard and exit rewrite.
- V1 omission disables the guard.
- V1 `completionGuard: true` evaluates the existing heuristic but never changes exit code or execution projection.
- Recovery preserves the resolved on/off policy and contract version.

**Acceptance evidence:**
- RED: v1 implementation-task test currently fails execution and lacks an effects ledger.
- GREEN: v1 omission succeeds with not-requested; explicit true returns rejected effect with exit 0; observed edit returns satisfied; legacy still exits 1.
- Regression: focused and full unit suites pass.

**Risk and rollback:**
- Risk is silently weakening existing coding agents; v1 is opt-in and explicit true restores the policy.
- Rollback is mode-local.

**Implementation intent:**
- Evaluate the same existing mutation classifier only after resolving whether the policy was requested.
- Treat effect result as policy metadata; chain acceptance gating does not automatically gate on effects in this release.

**Commit:**
```bash
git add src/shared/types.ts src/runs/shared/completion-guard.ts src/runs/foreground/execution.ts src/runs/background/subagent-runner.ts src/runs/foreground/subagent-executor.ts src/runs/background/async-execution.ts src/runs/background/async-resume.ts test/unit/completion-guard.test.ts test/integration/single-execution.test.ts test/integration/async-execution.test.ts test/unit/async-resume.test.ts
git commit -m "feat: make completion effects explicit in v1"
```

### Task 4: Promote structured output to every launch and delegation surface

**Purpose:** Non-code callers can request machine-readable child content without using acceptance or wrapping a direct task in a chain.

**Files/modules:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/settings.ts`
- Modify: `src/extension/schemas.ts`
- Modify: `src/runs/foreground/subagent-executor.ts`
- Modify: `src/runs/background/async-execution.ts`
- Modify: `src/runs/shared/parallel-utils.ts`
- Modify: `src/api/delegation.ts`
- Modify: `src/slash/prompt-template-bridge.ts`
- Modify: `src/slash/delegation-adapters.ts`
- Test: `test/unit/schemas.test.ts`
- Test: `test/integration/single-execution.test.ts`
- Test: `test/integration/parallel-execution.test.ts`
- Test: `test/integration/async-execution.test.ts`
- Test: `test/unit/delegation-api.test.ts`

**Interfaces and dependencies:**
- Adds `outputSchema` to direct single, top-level task item, async single params, and delegation request/response.
- Reuses `createStructuredOutputRuntime`, `structured_output`, and existing `SingleResult.structuredOutput` fields.
- Delegation remains protocol v1 through additive optional fields; old consumers remain valid.

**Constraints and invariants:**
- Schemas are object-root JSON Schema values.
- Missing/invalid requested structured output remains protocol/execution failure.
- Structured content remains child-owned and is not acceptance evidence by default.
- Distinct tasks receive distinct structured-output paths.

**Acceptance evidence:**
- RED: schema and direct/tasks/delegation tests fail because fields are absent or ignored.
- GREEN: foreground/async direct and tasks return validated structured content; delegation carries it.
- Regression: structured-output chain tests remain unchanged and pass.

**Risk and rollback:**
- Risk is path collision and request serialization loss; tests cover parallel uniqueness and delegation bridge round-trip.
- Additive protocol fields permit rollback without breaking v1 consumers.

**Implementation intent:**
- Allocate structured runtime paths using run id and child index.
- Do not duplicate validation logic outside `structured-output.ts`.

**Commit:**
```bash
git add src/shared/types.ts src/shared/settings.ts src/extension/schemas.ts src/runs/foreground/subagent-executor.ts src/runs/background/async-execution.ts src/runs/shared/parallel-utils.ts src/api/delegation.ts src/slash/prompt-template-bridge.ts src/slash/delegation-adapters.ts test/unit/schemas.test.ts test/integration/single-execution.test.ts test/integration/parallel-execution.test.ts test/integration/async-execution.test.ts test/unit/delegation-api.test.ts
git commit -m "feat: expose structured output across launch modes"
```

### Task 5: Align agent-facing guidance and compatibility diagnostics

**Purpose:** The Skill/tool description teaches v1 as domain-neutral opt-in behavior without removing legacy coding recipes.

**Files/modules:**
- Modify: `skills/pi-subagents/SKILL.md`
- Modify: `src/extension/tool-description.ts`
- Modify: `README.md`
- Test: `test/unit/tool-description.test.ts`
- Test: `test/unit/package-manifest.test.ts`

**Interfaces and dependencies:**
- Documents `agentContract`, explicit acceptance, `gateOn`, explicit CompletionGuard, and full-mode `outputSchema`.
- Keeps existing coding workflows but labels them as coding recipes rather than universal defaults.

**Constraints and invariants:**
- Do not recommend launch timeout by default.
- Do not claim automatic independent review.
- Do not claim profile/extension loading that this implementation does not include.

**Acceptance evidence:**
- Direct artifact assertions fail first on absent v1 guidance, then pass.
- Tool-description unit tests and package checks pass.

**Risk and rollback:**
- Documentation is additive and can be reverted independently.

**Implementation intent:**
- Change only statements made obsolete by v1; do not rewrite the full Skill.

**Commit:**
```bash
git add skills/pi-subagents/SKILL.md src/extension/tool-description.ts README.md test/unit/tool-description.test.ts test/unit/package-manifest.test.ts
git commit -m "docs: describe generic agent contract v1"
```

### Task 6: Verify runtime behavior with the requested Pi model

**Purpose:** Confirm the built extension works through Pi's real CLI/tool registration path using `Mapleluv-Main/gpt-5.6-sol-pro` as the main model.

**Files/modules:**
- Create: `.pi-subagents/debug/generic-contract-v1/` runtime artifacts only (ignored, not committed)
- Modify production files only if a reproduced runtime defect receives a failing regression test first.

**Interfaces and dependencies:**
- Uses the local worktree extension path and a temporary Pi config/session directory.
- Starts Pi with explicit model `Mapleluv-Main/gpt-5.6-sol-pro` and the repository extension.

**Constraints and invariants:**
- Do not alter persistent model config or user agent overrides.
- The explicit model must appear in the launched Pi session metadata.
- Debug v1 and legacy behavior separately.

**Acceptance evidence:**
- Pi loads the local extension and exposes the updated subagent schema.
- A v1 no-acceptance task receives no acceptance fence.
- A v1 verify-only task runs verification without a child report.
- A v1 explicit CompletionGuard miss retains exit 0 and records rejected file-mutation effect.
- A direct `outputSchema` task returns validated structured output.
- A legacy control reproduces existing inferred acceptance/CompletionGuard semantics.

**Risk and rollback:**
- Provider/network failures are reported separately from extension behavior.
- All debug config is temporary and removable.

**Implementation intent:**
- Read Pi CLI docs before selecting exact startup flags.
- Capture command, model, extension path, result JSON, and exit status for each scenario.

**Commit:**
```bash
# No commit for ignored debug artifacts.
```

### Task 7: Whole-change review, proposal, and upstream issue

**Purpose:** Ship a reviewable implementation link and an upstream issue that accurately explains motivation, compatibility, tradeoffs, and evidence.

**Files/modules:**
- Create: `docs/proposals/generic-agent-contract-v1-issue.md`
- Modify: implementation/docs/tests only for reviewed fixes.

**Interfaces and dependencies:**
- Proposal links to the pushed implementation commit/compare view and both research reports.
- Oracle reviews the exact issue body for missing context, unsupported claims, and hallucinated behavior before submission.

**Constraints and invariants:**
- Oracle verdict must be `APPROVE`; `APPROVE_WITH_CHANGES` requires correction and delta review.
- The issue is submitted to `nicobailon/pi-subagents` only after code review, full verification, push, and Oracle approval.
- No PR is created unless the user separately requests it.

**Acceptance evidence:**
- Mandatory whole-change reviewer reports no blocker/high findings.
- `npm run test:all` passes or environment-specific failures are independently attributed with focused passing evidence.
- `git diff --check`, clean worktree, local/remote SHA match.
- Oracle approves the exact final issue body.
- `gh issue view` confirms issue URL, title, body, and implementation link.

**Risk and rollback:**
- Upstream issue is public and durable; verify repository, body, links, and Oracle verdict before creation.
- If submission fails, preserve the approved draft and report the exact external error.

**Implementation intent:**
- Findings lead with user-visible failure modes, then the proposed opt-in v1 contract, compatibility, implementation evidence, and open maintainer decisions.
- Avoid claiming the implementation is production-ready beyond demonstrated tests/debug evidence.

**Commit:**
```bash
git add docs/proposals/generic-agent-contract-v1-issue.md
git commit -m "docs: propose generic agent contract v1"
git push mapleluvr research/agent-contract
```
