# Model Override Permission Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans. Track steps with checkboxes.

**Goal:** Prevent Main or another caller from replacing a configured subagent model route without real user authorization, while preserving automatic configured fallback behavior.

**Architecture:** Add one fail-closed `ask | deny | allow` permission contract and a pure canonical override collector. The foreground executor owns one serialized authorization gate shared by direct tools, slash, typed delegation, and child-safe fanout. Lifecycle actions authorize resume/append/schedule before mutation; scheduled approval is bound to a canonical digest. Prompt/schema guidance mirrors the runtime rule. Existing model resolution and fallback classification remain authoritative and unchanged.

**Tech Stack:** TypeScript, TypeBox, Node test runner, Pi ExtensionContext UI API, JSON scheduled-run store.

**Approved spec:** `docs/superpowers/specs/2026-07-20-model-override-permission.md` at `3419ca06ace56b9b4c818ef58f6f74a573c383b2`.

**Base SHA:** `3419ca06ace56b9b4c818ef58f6f74a573c383b2`.

**Selective baseline:** `87 passed / 0 failed` on `model-fallback`, `schemas`, `tool-description`, `delegation-api`, and `prompt-template-bridge` unit suites under Node `v24.15.0`. Repository-wide Windows baseline has known symlink and agent-management isolation failures from prior runs; these remain separately classified.

**Fail-first frontier:** `model-override-permission` pure contract and executor tests must demonstrate that default `ask` currently launches an off-route model without confirmation. No production permission wiring starts before that RED is observed.

## Global Constraints

- The configured primary plus ordered `fallbackModels` is user-authorized and unchanged.
- An explicit selector matching the canonical configured primary is a no-op and is not prompted.
- Selecting a configured fallback directly is an override and requires authorization.
- `ask` is the default; no UI means deny.
- `deny` never prompts; `allow` is persistent user pre-authorization.
- Invalid permission config fails closed before launch.
- Authorization occurs before child/session/worktree/async/spawn/append/revive side effects.
- Clarify UI confirmation authorizes its displayed final model selection for that invocation.
- Scheduled approval is bound to the canonical override digest and cannot authorize a changed payload.
- No natural-language inference, public bypass token, broad approval cache, fallback classifier change, or child-status redesign.
- One writer owns the worktree. Independent reviewers remain read-only.

## Ownership Map

| Contract                                                           | Owner                                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Permission type, default, canonical request/digest/receipt helpers | `src/runs/shared/model-override-permission.ts`, `src/shared/types.ts`                                            |
| Runtime authorization and launch-surface collection                | `src/runs/foreground/subagent-executor.ts`                                                                       |
| Scheduled approval persistence                                     | `src/runs/background/scheduled-runs.ts`                                                                          |
| Public guidance/schema                                             | `src/extension/schemas.ts`, `src/extension/tool-description.ts`, `skills/pi-subagents/SKILL.md`, `README.md`     |
| Local policy activation                                            | `C:/Users/mapleland/.pi/agent/extensions/subagent/config.json` only after repository L3, canary, and review pass |

## Execution Checklist

- [ ] Task 1: Define the pure model-override permission contract
- [ ] Task 2: Gate ordinary launches and delegation bridges before side effects
- [ ] Task 3: Gate resume, append, and scheduled lifecycle paths
- [ ] Task 4: Align Skill, Tool description, schema, and README
- [ ] Task 5: Final verification, real Pi canary, review, local policy activation, and push

### Task 1: Define the pure model-override permission contract

**Purpose:** Produce a deterministic, UI-independent decision model that distinguishes configured routing from effective caller overrides and binds scheduled approval to an exact request digest.

**Files/modules and ownership boundary:**

- Create: `src/runs/shared/model-override-permission.ts`
- Modify: `src/shared/types.ts`
- Create: `test/unit/model-override-permission.test.ts`
- Modify: `test/unit/model-fallback.test.ts` only if shared canonicalization coverage belongs there

**Interfaces and cross-task dependencies:**

- Consumes: existing `resolveEffectiveSubagentModel`, model registry shape, `AgentConfig`, and execution-step shapes.
- Produces: `ModelOverridePermission`, `ModelOverrideRequest`, private scheduled approval receipt, config resolver, canonical request collector, digest validator, denial/confirmation formatting.
- Task 2 consumes this contract without reimplementing model resolution.

**Mutable resources:**

- `mutableResources`: none; all Task 1 logic and tests are pure.

**Constraints and invariants:**

- Omitted config resolves to `ask`; malformed config returns a fail-closed error.
- Canonical equality includes provider resolution and thinking suffix.
- Fallback entries are display/provenance only; they never become implicit caller authorization.
- Digest ordering is deterministic across single/tasks/chain static/dynamic selectors.
- Internal receipt fields are absent from public schemas.

**Acceptance evidence:**

- L0: `node --experimental-strip-types --test test/unit/model-override-permission.test.ts` initially fails because the module and policy types do not exist.
- L1 RED: the same command records failures for default `ask`, no-op comparison, direct-fallback selection, multi-surface collection, and receipt mismatch.
- L1 GREEN: the same command passes all pure contract cases.
- L2 after integration: `node --experimental-strip-types --test test/unit/model-override-permission.test.ts test/unit/model-fallback.test.ts test/unit/schemas.test.ts` passes.

**Risk and rollback:** Canonical drift could prompt for no-op aliases or miss an override. Reusing existing resolution and table-driven aliases bounds the risk. Rollback removes an additive module/type without persisted runtime state.

**Implementation intent:**

- Represent collected selectors as path + agent + raw requested model.
- Resolve both requested and configured primary through the existing resolver, then drop canonical equals.
- Stable-sort the remaining request records before hashing and formatting.
- Receipt validation recomputes the digest; never trust a bare boolean.

**Commit:** Task 1 remains uncommitted until Tasks 1-3 close the runtime permission invariant together.

### Task 2: Gate ordinary launches and delegation bridges before side effects

**Purpose:** Default `ask` blocks unapproved model replacement across direct single, tasks, chains, dynamic templates, slash, typed delegation, and child-safe fanout.

**Files/modules and ownership boundary:**

- Modify: `src/runs/foreground/subagent-executor.ts`
- Modify: `src/extension/index.ts` only if authorizer lifecycle ownership requires explicit construction
- Modify: `src/extension/fanout-child.ts` only if child-safe authorizer construction differs
- Create: `test/integration/model-override-permission.test.ts`
- Modify: `test/unit/delegation-api.test.ts`
- Modify: `test/unit/prompt-template-bridge.test.ts`
- Modify existing test harness config only where an unrelated test deliberately exercises legacy explicit override; set `allow` explicitly rather than weakening production defaults.

**Interfaces and cross-task dependencies:**

- Consumes: Task 1 request collection and permission resolver.
- Produces: one executor-owned serialized `authorizeModelOverrides` gate and execution-mode-shaped permission errors.
- Existing slash and delegation adapters continue to call the same executor; no protocol field/version change.

**Mutable resources:**

- `mutableResources`: Pi confirmation UI queue within one extension instance; test temp session/artifact roots unique per test.

**Constraints and invariants:**

- Validate shape and discover agents before prompting.
- Authorize before run id persistence, session directory creation, worktree setup, spawn reservation, async runner creation, or child process launch.
- Aggregate all effective overrides in one prompt.
- Concurrent async invocations serialize dialogs and each receives its own decision.
- `clarify:true` with UI does not double-prompt; its confirmed final model choices are the authorization source.
- `clarify:true` without UI follows ordinary no-UI rejection.
- Denial text instructs Main to remove `model`, not to retry another model.
- Configured fallback execution and tool-failure non-retry tests remain unchanged.

**Acceptance evidence:**

- L0: static import/type check identifies the intended executor insertion point before session-root creation.
- L1 RED: `node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/model-override-permission.test.ts` proves current default launches off-route single/tasks/chain requests without confirmation.
- L1 GREEN: the same command covers approve/reject/no-UI/allow/deny/invalid/no-op/fallback/direct/static/dynamic/aggregate/concurrent/clarify/child-safe cases.
- L2 after integration: `node --experimental-strip-types --test test/unit/model-override-permission.test.ts test/unit/model-fallback.test.ts test/unit/delegation-api.test.ts test/unit/prompt-template-bridge.test.ts && node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/model-override-permission.test.ts test/integration/single-execution.test.ts test/integration/parallel-execution.test.ts test/integration/chain-execution.test.ts` passes except independently classified Windows-only baseline skips/failures.

**Risk and rollback:** The main risk is an entry-point bypass or duplicate UI. All bridges and child-safe execution converge on the executor, and direct tests assert zero side effects on rejection. Rollback can set config `allow`, but code is not shipped until all surfaces pass.

**Implementation intent:**

- Create the authorizer once per executor instance with a promise queue for UI serialization.
- Compute requests from raw effective params after validation and agent discovery.
- Return the existing `AgentToolResult<Details>` error shape with zero results.
- Do not pass an authorization parameter through public tool/delegation schemas.

**Commit:** Task 2 remains in the same runtime-invariant commit as Tasks 1 and 3.

### Task 3: Gate resume, append, and scheduled lifecycle paths

**Purpose:** Prevent management/lifecycle routes from bypassing the ordinary launch permission and preserve one-time scheduled approval across delayed execution.

**Files/modules and ownership boundary:**

- Modify: `src/runs/foreground/subagent-executor.ts`
- Modify: `src/runs/background/scheduled-runs.ts`
- Modify: `src/shared/types.ts` only for private scheduled receipt storage shape
- Modify: `test/unit/scheduled-runs.test.ts`
- Modify: `test/unit/async-resume.test.ts` or add focused executor resume coverage
- Modify: `test/unit/chain-append.test.ts` or add focused executor append coverage

**Interfaces and cross-task dependencies:**

- Consumes: Task 1 receipt digest and Task 2 executor authorizer.
- Produces: authorization-aware resume, append, schedule-create, and schedule-fire behavior.
- Scheduled-run public store version stays 1; receipt is an optional private field inside stored execution params.

**Mutable resources:**

- `mutableResources`: isolated scheduled-run JSON store roots, async append inbox files, revival lease/session fixtures.

**Constraints and invariants:**

- Resume checks only explicit `params.model`; recovered model/fallback provenance is already authorized.
- Resume denial precedes revived run creation and lease acquisition.
- Append denial precedes append inbox mutation.
- Schedule creation prompts while UI exists; approved payload stores a digest-bound receipt.
- Schedule fire recomputes digest; mismatch or missing receipt follows current policy and no-UI fails closed.
- Model-free legacy scheduled jobs still fire.
- `deny` rejects even when UI exists; `allow` needs no receipt.

**Acceptance evidence:**

- L0: unit fixtures assert target stores/inboxes/leases are unchanged after current unguarded override attempt, producing RED.
- L1 RED: focused scheduled/resume/append tests fail on missing authorization and receipt semantics.
- L1 GREEN: `node --experimental-strip-types --test test/unit/model-override-permission.test.ts test/unit/scheduled-runs.test.ts test/unit/async-resume.test.ts test/unit/chain-append.test.ts` passes.
- L2 after integration: Task 2 L2 plus `test/unit/scheduled-runs.test.ts` and affected async resume/append integration files passes.

**Risk and rollback:** Scheduled persistence is the highest risk. Optional receipt fields keep old stores readable; digest mismatch denies rather than silently launching. Resume/append changes occur before mutation and are reversible.

**Implementation intent:**

- Authorize schedule payload after schedule execution-shape validation and before store mutation.
- Persist only canonical digest/source/version, not a blanket authorization boolean.
- Reuse one denial formatter across ordinary and lifecycle calls.

**Commit:**

```bash
git add src/shared/types.ts src/runs/shared/model-override-permission.ts src/runs/foreground/subagent-executor.ts src/runs/background/scheduled-runs.ts test/unit/model-override-permission.test.ts test/integration/model-override-permission.test.ts test/unit/scheduled-runs.test.ts test/unit/async-resume.test.ts test/unit/chain-append.test.ts test/unit/delegation-api.test.ts test/unit/prompt-template-bridge.test.ts
git commit -m "feat: require approval for subagent model overrides"
```

### Task 4: Align Skill, Tool description, schema, and README

**Purpose:** Ensure Main does not request unauthorized overrides and document the local permission policy before runtime finalization.

**Files/modules and ownership boundary:**

- Modify: `skills/pi-subagents/SKILL.md`
- Modify: `src/extension/tool-description.ts`
- Modify: `src/extension/schemas.ts`
- Modify: `README.md`
- Modify: `test/unit/tool-description.test.ts`
- Modify: `test/unit/schemas.test.ts`
- Modify: `test/unit/prompt-workflows.test.ts`

**Interfaces and cross-task dependencies:**

- Consumes: runtime setting and denial semantics from Tasks 1-3.
- Produces: consistent full/compact/custom/schema/Skill/README policy.

**Mutable resources:**

- `mutableResources`: none; Task 4 changes repository prompt/schema/doc/test files only.

**Constraints and invariants:**

- Omit `model` by default; only the user can authorize an exact override.
- Configured fallback route remains automatic for eligible provider/model failure.
- Main must not respond to tool/schema/acceptance/execution failure by selecting another model.
- Recovery guidance uses status/artifacts/resume of the same session.
- Custom Tool descriptions retain mandatory permission guidance.
- Schema text is capability guidance, not a model-supplied authorization mechanism.
- No P1 fallback classifier/status behavior changes.

**Acceptance evidence:**

- L0: `rg` assertions identify current permissive `Override model` descriptions and absent permission setting docs.
- L1 RED: new Tool/schema/Skill assertions fail before prose edits.
- L1 GREEN: `node --experimental-strip-types --test test/unit/tool-description.test.ts test/unit/schemas.test.ts test/unit/prompt-workflows.test.ts` passes.
- L2 after integration: Task 3 L2 plus all three prompt/schema suites passes.

**Risk and rollback:** Prompt drift could weaken runtime expectations but cannot bypass enforcement. Repository changes are independently testable and reversible.

**Implementation intent:**

- Add one mandatory model-route paragraph shared by full/compact/custom descriptions.
- Replace permissive schema descriptions with user-authorization wording.
- Add a focused Skill recovery section referencing configured route and same-session recovery.
- Document `ask|deny|allow`, headless behavior, and legacy `allow` migration.

**Commit:**

```bash
git add skills/pi-subagents/SKILL.md src/extension/tool-description.ts src/extension/schemas.ts README.md test/unit/tool-description.test.ts test/unit/schemas.test.ts test/unit/prompt-workflows.test.ts
git commit -m "docs: enforce user-owned subagent model routing"
```

### Task 5: Final verification, real Pi canary, review, local policy activation, and push

**Purpose:** Prove the integrated branch enforces the approved boundary without changing configured fallback behavior, then explicitly activate `ask` in the local user policy.

**Files/modules and ownership boundary:**

- Create ignored runtime artifacts under `.pi-subagents/debug/model-override-permission/`.
- Modify production/tests only after a reproduced failure receives a focused RED test.

**Interfaces and cross-task dependencies:**

- Consumes all prior repository tasks; temporary canary config supplies `ask` before persistent activation.
- Produces clean commits, remote branch SHA, runtime evidence, independent whole-change review, and verified local `ask` policy.

**Mutable resources:**

- `mutableResources`: temporary Pi settings/session dirs for canary; user subagent config; provider calls for one configured-route launch.

**Finalization preconditions:**

- Tasks 1-4 L1/L2 green.
- Worktree contains only intended implementation/docs/tests.
- Local config backup exists and parses.
- No active reviewer writes to the worktree.

**Complete L3 commands:**

- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `git diff --check`
- `git diff --name-only 3419ca06ace56b9b4c818ef58f6f74a573c383b2^ -- '*.ts' '*.md' | xargs npx prettier --check`

**Runtime canary:**

- Launch Pi `0.80.6` with only this worktree extension and temporary session/settings wrapper.
- Use configured main/child route `Mapleluv-Main/gpt-5.6-sol-pro` where a provider call is needed.
- Headless off-route explicit model must return permission denial, zero child results, and no new child session/async artifacts.
- Model-omitted launch must pass permission preflight and show configured route/fallback provenance; provider instability is reported separately.
- An explicit temporary canary config `allow` must restore legacy override behavior at preflight without changing user config.

**Evidence record:**

- Bind exact HEAD, dirty state, commands, Node/npm/Pi versions, non-secret config hash, extension path, permission mode, result JSON, child artifact counts, and provider outcome.
- A material implementation/test/config fix invalidates prior L3 and review evidence.

**Mandatory review:**

- Fresh read-only reviewer checks every launch/lifecycle surface, authorization-before-side-effect ordering, clarify provenance, scheduled digest, headless fail-closed, prompt/runtime agreement, and unchanged configured fallback behavior.
- Any blocker/high finding requires RED/GREEN correction, rerun of affected L2, complete L3, and delta review.

**Local policy activation after all gates pass:**

- Byte-back up `C:/Users/mapleland/.pi/agent/extensions/subagent/config.json`.
- Add or replace only `modelOverridePermission: "ask"` through structured JSON parsing/writing.
- Verify JSON parse, unrelated-field equality, intended value, and backup hash.
- Restore the byte backup if any post-write check fails.

**Rollback boundary:**

- No persistent user config changes occur before L3, canary, and review pass.
- Before push, restore the user config backup if local activation verification fails.
- After green verification, push `mapleluvr/research/agent-contract`; no upstream PR/issue is created without a separate user request.

**Commit/push:**

```bash
git status --short
git push mapleluvr research/agent-contract
```
