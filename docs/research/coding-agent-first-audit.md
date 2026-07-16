# Coding-Agent-First Audit

Status: research audit
Baseline: `315e1eb1482c`
Branch: `research/agent-contract`
Date: 2026-07-16

## Question

Which parts of pi-subagents are genuinely domain-neutral orchestration, which parts are legitimate optional coding features, and which coding assumptions leak into universal defaults, public contracts, or execution success?

This audit follows the design in `docs/research/agent-contract.md`. That design was independently reviewed by an Oracle. The Oracle first returned `APPROVE_WITH_CHANGES`, requiring four boundary clarifications:

1. `outputSchema` is structural, not a policy gate.
2. `structuredOutput` is child-owned content surfaced by the runtime, not a runtime-observed fact.
3. No default or profile mechanism may silently restore domain inference.
4. Extension namespaces should use reverse-DNS ownership plus a major-version segment.

After those corrections, a fresh-context Oracle returned `APPROVE` with no blocker or high-severity contradiction. The direction therefore passes the generalization and decoupling taste gate. This audit asks the broader follow-up question: what else in the plugin must move to the same boundary?

## Verdict

The plugin is not uniformly Coding-Agent-first. Its lower-level orchestration machinery is mostly general:

- child process lifecycle;
- foreground, async, chain, parallel, and dynamic fanout execution;
- session and artifact persistence;
- status, control, resume, and reconciliation;
- caller-defined structured output where available;
- parent-owned coordination;
- explicit shell verification;
- path-based output capture;
- optional Git worktree isolation.

The Coding-Agent-first assumptions are concentrated in three policy layers placed above that generic substrate:

1. **Acceptance is an implicit code-change profile embedded in the universal contract.**
2. **CompletionGuard is a second implicit code-change profile embedded in execution success.**
3. **The packaged Skill and several generic-looking roles present software delivery as the default complex-work workflow.**

The first two are architectural defects for a generic agent runtime because they can turn a successful non-code run into an execution failure. The third is a behavior-shaping product default: it does not corrupt process state directly, but it steers parent agents toward planning, implementation, diffs, tests, review loops, and shipping even when the domain does not call for them.

The correct response is not to remove coding capabilities. Git worktrees, LSP watchdog review, code-oriented agents, code review recipes, and repository verification are valuable. They should remain explicit features or profiles. The correction is to stop selecting them silently through omitted fields, agent names, English task keywords, async topology, or generic complex-work guidance.

## Classification

This report uses four classes:

- **Core**: domain-neutral runtime behavior suitable for every agent domain.
- **Profile**: legitimate coding behavior that should remain available only through explicit selection.
- **Leak**: coding behavior embedded in a universal default, public contract, or execution/control-flow decision.
- **Cosmetic**: coding terminology that does not change behavior.

A Git reference is not automatically a leak. A feature is a leak only when a non-coding caller encounters it without selecting a coding capability, or when it changes generic execution semantics.

## Scope and method

The audit covered the tracked plugin at baseline `315e1eb1482c`:

- 287 tracked files;
- 123 TypeScript source files;
- 131 TypeScript tests;
- 8 packaged agents;
- 7 packaged prompt workflows;
- 1 packaged Skill;
- extension schemas and tool descriptions;
- foreground and background runners;
- acceptance, completion, task-intent, output, artifact, status, resume, and chain paths;
- public delegation API and slash adapters;
- TUI, intercom, profiles, watchdog, and settings;
- README and package guidance.

Four independent read-only reviewers inspected separate slices: core contract/lifecycle, execution/isolation, public product surfaces, and packaged guidance. The parent then checked disputed classifications directly against source. Reviewer reports were evidence inputs, not the final classification.

The audit deliberately rejects these false-positive rules:

- "Uses Git" does not imply a defect if the feature is explicitly opt-in.
- "Has a worker or reviewer" does not imply a defect if the role is explicitly selected.
- "Runs a shell command" does not imply code bias; `verify[]` can run Lean, data, operations, or policy checks.
- "Allows files" does not imply code bias; artifacts are domain-neutral.
- One writer for the same shared path is a general concurrency rule, not a code-only rule.
- The host package name `pi-coding-agent` is a platform dependency, not an agent-contract requirement.

## Priority findings

### F1. Acceptance is a code-change profile embedded in the universal default

Severity: critical
Class: Leak

The accepted design report already identifies this as the primary contract problem. The plugin's default acceptance path combines code evidence, Git state, child self-report, runtime verification, and independent review into one fixed mechanism.

Evidence:

- `src/shared/types.ts:430-439` defines a closed evidence vocabulary containing `changed-files`, `tests-added`, `no-staged-files`, `diff-summary`, and `review-findings`.
- `src/runs/shared/acceptance.ts:59-70` makes code/Git fields mandatory for `checked`, `verified`, and inferred `reviewed` levels.
- `src/runs/shared/acceptance.ts:73-143` infers those levels from agent names, `acceptanceRole`, English write verbs, async execution, dynamic fanout, and risk keywords.
- `src/runs/shared/acceptance.ts:318-355` applies a rank floor, so explicit acceptance generally cannot lower an inferred level except through the special `{ level: "none", reason }` form.
- `src/runs/shared/acceptance.ts:358-406` injects a mandatory fenced `acceptance-report` whose example is a software patch.
- `src/runs/shared/acceptance.ts:854-898` checks field presence and invokes `git status --short` for staged files.
- `src/runs/shared/acceptance.ts:1040-1061` rejects before running `verify[]` if the child report is missing.
- `src/runs/shared/acceptance.ts:911-941` synthesizes the same code-shaped report for dynamic groups.
- `src/extension/schemas.ts:68-75` tells every caller that omission means auto-inference.

The mechanism is not merely code-flavored documentation. It changes control flow. A Lean worker can create `Formal.lean`, run Lean successfully, and still be rejected because it omitted `testsAddedOrUpdated`. A research writer can be forced to claim changed files and Git staging state. An async topology choice can escalate a task to inferred `reviewed` even though async says nothing about the domain's correctness requirements.

Boundary correction:

- Omitted acceptance means `not_requested` in the new contract mode.
- Remove name, keyword, async, and dynamic topology inference.
- Remove the rank floor.
- Allow report-optional, verify-only acceptance.
- Keep child claims optional and non-authoritative.
- Move the fixed evidence vocabulary, Git status checks, and code report example to an explicit `code-change/1` profile or namespaced extension.
- Replace fixed dynamic aggregate reports with per-child results plus an explicit parent aggregate evaluator.

### F2. Acceptance failure is propagated as execution failure

Severity: critical
Class: Leak

The plugin does not merely attach an acceptance result. It rewrites or derives execution status from policy rejection.

Evidence:

- `src/runs/foreground/execution.ts:1431-1437` rewrites a successful explicit-acceptance run from exit code 0 to 1.
- `src/runs/background/subagent-runner.ts:1323-1334` performs the async equivalent.
- `src/runs/foreground/subagent-executor.ts:393-395` marks a child failed when acceptance is rejected.
- `src/runs/foreground/subagent-executor.ts:412` emits success only when exit code is 0 and acceptance is not rejected.
- `src/runs/shared/acceptance.ts:911-941` includes rejected acceptance among aggregate blockers.
- `src/runs/foreground/chain-execution.ts:898-901` and `1067-1070` can fail dynamic groups and stop chains. The foreground zero-item path can fail whenever a step acceptance object is present, while the non-zero path checks `explicit`; the async zero-item path has a different explicit-only condition (`src/runs/background/subagent-runner.ts:2614-2632`). This asymmetry must be normalized or retained only in legacy mode.
- `src/slash/delegation-adapters.ts` maps explicit rejection to `acceptance_failed`, while downstream results may also carry the rewritten exit code.
- Notifications, fleet status, TUI styling, and resume projections inherit these mixed signals.

This violates the approved invariant: process execution, policy evaluation, and independent review are separate facts. A child process that exited successfully did not become a failed process because a policy rejected its result.

Boundary correction:

- Preserve runtime exit code and lifecycle state.
- Add derived `execution`, `acceptance`, and `review` projections without immediately renaming all legacy fields.
- Make policy mode explicit: `observe` or `gate`.
- Make chain gating explicit: `gateOn: execution | acceptance | review`.
- Update every consumer, not only the exit-code assignment: child status, success events, aggregates, chain transitions, delegation adapters, notifications, TUI, resume, and recovery descriptors.

### F3. CompletionGuard is a second default code policy that rewrites execution success

Severity: high
Class: Leak

The broader plugin audit found a separate failure path outside acceptance. CompletionGuard is enabled whenever `completionGuard !== false`, so omission enables it. It reads English task text, infers whether file edits were required, inspects a hardcoded set of editing tools, and converts a successful run into exit code 1 if no recognized mutation occurred.

Evidence:

- `src/runs/shared/task-intent.ts:20-175` uses English code and file vocabulary, agent-name heuristics, GitHub issue exceptions, code artifact nouns, and verbs such as implement, edit, modify, refactor, delete, fix, patch, apply, and make changes. Its separate `taskMayMutate` path also treats `commit` as a write verb for acceptance inference.
- `src/runs/shared/completion-guard.ts:7-17` hardcodes a read-only tool set.
- `src/runs/shared/completion-guard.ts:33-49` treats unknown/MCP capabilities as mutation-capable but recognizes actual mutation only through `edit`, `write`, or selected mutating `bash` patterns.
- `src/runs/foreground/execution.ts:1078-1101` enables the guard by default and rewrites exit code 0 to 1 with "completed without making edits".
- `src/runs/background/subagent-runner.ts:1211-1235` performs the same check and includes it in `effectiveExitCode`.
- Agent frontmatter can disable the guard, but generic callers do not opt into it; they must know to opt out.

This is both Coding-Agent-first and English-first. It assumes that "implement" means repository mutation and that valid mutation is observable through Pi's built-in code editing tools or recognized shell syntax. A formalizer, document producer, data operator, design agent, remote API agent, or domain MCP tool can perform the requested effect without satisfying those assumptions.

Boundary correction:

- Disable CompletionGuard by default in the generic contract mode.
- Model required effects as an explicit caller/profile policy, not inferred prose intent.
- Do not rewrite process exit code for a missing policy effect.
- If a code profile retains the guard, let the profile declare recognized effect tools/checks rather than hardcoding global tool names.
- Keep legacy behavior under compatibility mode for existing coding agents and tests.

This finding expands the implementation boundary beyond the original acceptance-only first slice. Fixing acceptance while leaving CompletionGuard unchanged would still allow domain success to become orchestration failure.

### F4. Generic structured child output is less available than code acceptance

Severity: high
Class: Leak by public-contract asymmetry

The runtime already has a suitable generic channel: caller-defined `outputSchema` validated through `structured_output`. However, it is available only on selected chain and dynamic surfaces, while the code-shaped acceptance contract is available almost everywhere.

Evidence:

- `src/extension/schemas.ts:111-125` exposes `outputSchema` on chain-parallel items.
- Sequential and dynamic chain schemas also expose it.
- `src/extension/schemas.ts:95-108` omits it from top-level `tasks[]`.
- `src/extension/schemas.ts:283-295` omits it from direct single-agent calls.
- `src/api/delegation.ts:76-92` omits it from the typed delegation request.
- The same public surfaces do expose `acceptance`.

A non-code caller that wants a small machine-readable result is therefore pushed toward the acceptance report or forced to wrap a simple task in a chain.

Boundary correction:

- Promote one `outputSchema`/`structuredOutput` mechanism to direct single, top-level tasks, chain, dynamic, foreground, async, and typed delegation.
- Preserve the Oracle-approved boundary: schema is a structural wire contract. Value or policy judgments belong to acceptance, `verify[]`, or review.
- Missing/invalid required structured output remains a protocol/execution failure; a schema must not encode domain success as a backdoor policy gate.

### F5. Delegation protocol v1 freezes code evidence as the public acceptance vocabulary

Severity: high
Class: Leak

The extension-to-extension API exports the internal coding assumptions as stable public types.

Evidence:

- `src/api/delegation.ts:22-31` exports `SubagentDelegationAcceptanceEvidence` with the fixed code/Git evidence kinds.
- `src/api/delegation.ts:63-74` exports the same acceptance levels and special none behavior.
- `src/api/delegation.ts:76-92` gives the request acceptance but no `outputSchema`.
- `src/api/delegation.ts:111-132` mixes lifecycle statuses with `acceptance_failed` and duplicates acceptance status vocabulary.
- Delegation tests use code commands and code evidence as the complete v1 example, locking the design into external consumers.

Boundary correction:

- Add or version a domain-neutral delegation contract with `outputSchema`, explicit policy mode, and separate execution/acceptance/review projections.
- Preserve v1 decoding during a compatibility window.
- Move fixed code evidence under a namespaced code extension instead of expanding the closed core enum.
- Persist whether a recovered policy came from legacy inference, caller input, agent configuration, or a selected profile.

### F6. The packaged Skill selects software delivery as the default complex-work posture

Severity: high
Class: Leak in universal behavioral guidance

The Skill contains strong domain-neutral orchestration rules, but its default complex-work workflow is explicitly software delivery.

Evidence:

- `skills/pi-subagents/SKILL.md:19-24` says Fable is the default parent loop for complex work and immediately describes code review, implementation handoff, scout/context-builder, and planner roles.
- `skills/pi-subagents/SKILL.md:805-817` defines gates around repository verification harnesses, one worker in a worktree, build/typecheck, code execution, final diff, commit, push, release, and PRs.
- `skills/pi-subagents/SKILL.md:819-863` presents clarify -> plan -> implement -> reviewers -> fix worker -> final diff as the default non-trivial path.
- `skills/pi-subagents/SKILL.md:843-845` teaches auto-inferred acceptance and ordinary writer code gates.
- `skills/pi-subagents/SKILL.md:865-901` gives changed-files/tests/no-staged-files and current-diff examples.
- `prompts/review-loop.md` defines a repository diff, worker, reviewers, fix worker, and final diff as the whole loop.

This guidance materially shapes parent behavior even though it is not runtime code. A policy brief, formal proof, data investigation, operations procedure, or visual analysis can be needlessly converted into a code implementation and review pipeline.

Boundary correction:

- Make the default complex-work skeleton domain-neutral: understand -> decide -> produce -> evaluate -> review if requested -> finalize.
- Label Fable's current implementation/build/diff/ship content as an explicit `code-change/1` recipe.
- Keep code review loops, staged fix orchestration, and PR shipping as packaged coding recipes.
- Teach omission as no acceptance in the new mode.
- Show non-code examples using artifacts, caller-defined output schemas, domain verify commands, and separate reviewers.

### F7. Generic-looking built-in roles and recipes are code-specialized

Severity: medium
Class: Profile when explicitly selected; Leak when presented as generic/default

The presence of code roles is not a defect. The problem is that several role names and descriptions appear general while their contracts are fixed to source-file work, and the Skill selects them as the ordinary path.

Examples:

- `agents/planner.md:14-52` always produces an implementation plan with exact source files, files to modify, new files, and `.ts` examples.
- `agents/context-builder.md:12-43` assumes a codebase, implementation approach, tests, validation path, and planner handoff.
- `agents/scout.md:13-47` is correctly described as codebase recon but emits only `Code Context` and files likely to need changes.
- `agents/reviewer.md` calls itself versatile but leads with code diffs, tests, Git inspection, and corrective edits.
- `prompts/parallel-review.md`, `parallel-cleanup.md`, `parallel-context-build.md`, and `parallel-handoff-plan.md` primarily target diffs and implementation handoffs.
- `agents/oracle.md:71-73` still names a worker execution prompt, although it correctly says no worker handoff is the default.

Boundary correction:

- Keep `worker`, code scout, code planner, code reviewer, and diff recipes as explicit packaged roles/recipes.
- Either rename them to communicate their domain or make their base templates domain-neutral with optional code sections.
- Do not infer policy from their names.
- Do not let the parent Skill choose them merely because a task is complex.
- Preserve neutral roles already present: `delegate`, `researcher`, and most of `oracle`.

### F8. Progress and child boundary prompts carry low-level code framing

Severity: low to medium
Class: Leak in generic templates

Evidence:

- `src/shared/settings.ts:11` seeds every enabled progress file with a `Files Changed` section.
- Several built-in agents enable progress by default, so research and planning runs inherit that template.
- `src/runs/shared/subagent-prompt-runtime.ts:35-50` unconditionally tells every child to use editing tools and not print patches or pseudo-tool calls, including read-only and non-file agents.

These do not normally hard-fail a run, but they bias output shape and inherited instructions.

Boundary correction:

- Use a neutral progress template: Status, Tasks, Artifacts, Notes.
- Add Files Changed only in a coding profile.
- Make the universal child boundary say "use only available tools and do not simulate tool calls in prose."
- Add editing/patch wording only when a declared role or capability requires it.

### F9. Output authorship is coupled to one built-in coding tool

Severity: medium
Class: Host-tool leak

`single-output.ts` has a strong generic disk snapshot path, but its higher-confidence authorship path recognizes only successful `write` tool calls.

Evidence:

- `src/runs/shared/single-output.ts:13-20` explicitly says `bash` and `edit` construction are invisible.
- `src/runs/shared/single-output.ts:22-51` extracts content only from `part.name === "write"`.
- Acceptance uses that provenance for authoritative file report selection.

This protects against sibling writers, so the intent is sound. The problem is treating one host coding tool as the only authoring protocol. A domain artifact tool, remote store tool, or other registered file writer cannot establish equivalent provenance.

Boundary correction:

- Keep disk snapshot observation as the generic fallback.
- Introduce declared output/effect tool adapters or runtime capture hooks rather than a global `write` special case.
- Keep authorship confidence separate from content truth and acceptance.
- Do not expand this into broad shell guessing; explicit adapters are safer than more regexes.

### F10. Tests encode legacy code assumptions as expected universal behavior

Severity: medium migration risk
Class: Compatibility constraint

The current tests are valuable evidence but many assert the behavior that must become legacy-only:

- async writer inference to `reviewed`;
- fixed evidence bundles;
- omission versus empty code report fields;
- Git staging checks;
- exit-code failure on explicit rejection;
- default-on completion mutation guard;
- code-specific task-intent grammar;
- code-shaped delegation API examples;
- prompt workflow discovery without domain-neutral content checks.

Boundary correction:

- Preserve those tests under explicit legacy mode during migration.
- Add new-mode tests where omitted acceptance injects no prompt, no code evidence, and no policy evaluation.
- Add non-code fixtures: Lean, research synthesis, document production, data operations, visual review, and remote-tool effects.
- Add parity tests for structured output on every execution mode.
- Add failure-separation tests for exit code, status, events, aggregates, chains, delegation, notifications, resume, and TUI projections.
- Add guidance tests that prevent generic Skill sections from silently selecting code profiles.

## Area-by-area result

| Area | Classification | Result |
| --- | --- | --- |
| Process lifecycle and child protocol | Core | Domain-neutral and reusable |
| Async/status/control/resume | Core with mixed consumers | Generic mechanics; must stop inheriting policy failure as execution failure |
| Session lease | Core | Domain-neutral ownership of session files |
| Artifacts and path-based outputs | Core | Domain-neutral; one `write`-only provenance path needs abstraction |
| Structured output | Core but incomplete | Correct generic mechanism, missing from direct/tasks/delegation surfaces |
| Acceptance | Leak | Code profile embedded in universal default and public types |
| CompletionGuard/task intent | Leak | Default English code heuristic changes exit status |
| Chain/dynamic fanout | Core with acceptance leak | Generic expansion/collection; fixed acceptance aggregate is code-specific |
| Git worktrees | Profile | Correctly explicit and optional; keep |
| Worktree diffs/setup hooks | Profile | Correctly scoped to the selected Git isolation feature |
| Watchdog/LSP/repo-edits | Profile | Disabled by default and explicitly code-oriented; keep |
| Model profiles and discovery | Core/Profile packaging | Not a domain contract leak |
| Built-in worker/scout roles | Profile | Valid coding roles when explicitly selected |
| Planner/context-builder/reviewer | Mixed | Generic names with code-fixed templates; relabel or generalize |
| Skill/Fable/common workflow | Leak | Software delivery is the default complex-work posture |
| Prompt workflows | Mostly Profile | Keep code recipes, label them; provide neutral equivalents |
| Delegation API v1 | Leak | Public code evidence vocabulary and missing generic schema channel |
| Slash layer | Mixed | Generic runner plus acceptance/code workflow defaults |
| TUI/status formatting | Core consumer | Mostly generic; currently displays mixed execution/policy status |
| Intercom/supervisor coordination | Core | Domain-neutral |
| README/package host identity | Cosmetic/Profile | Coding-host marketing is expected; contract claims must distinguish profiles |

## What should remain outside the generic core

The following are useful, but must be explicit coding capabilities:

- `changed-files`, `tests-added`, `no-staged-files`, `diff-summary`, and code review evidence;
- Git status/diff/staging checks;
- repository clean-tree requirements;
- Git worktree creation, patch capture, and `node_modules` setup;
- build/typecheck/test defaults;
- LSP/repo-edits watchdog behavior;
- completion expectations based on source-file edits;
- worker -> diff reviewers -> fix worker loops;
- commit, push, release, and PR shipping steps;
- code-oriented progress templates;
- source-file planner and scout output formats.

These belong in explicit profiles, agents, or recipes such as:

```text
io.github.mapleluvr.pi-subagents.code/1
code-change/1
code-review/1
git-worktree/1
```

They should not be selected from agent names, task keywords, async mode, dynamic fanout, or generic defaults.

## What belongs in the generic core

The core can remain small:

1. Runtime lifecycle and process facts.
2. Text output, artifacts, sessions, and output references.
3. Optional caller-defined structural output.
4. Optional explicit evaluators such as `verify[]`.
5. Separately named acceptance and review results.
6. Explicit gate selection.
7. Parent-owned orchestration, concurrency, budgets, control, and recovery.
8. Namespaced extensions and explicitly selected reusable profiles.

No child JSON is required by default. No domain evidence vocabulary is built into completion. No policy failure changes the process facts.

## Revised implementation boundary

The approved `agent-contract.md` direction remains correct, but its acceptance first slice is not sufficient by itself: the minimum correctness slice is **Tracks 1 and 2 together**. The first implementation plan must include CompletionGuard as a peer execution boundary, with guidance and profile migration as adjacent tracks.

### Track 1: contract/lifecycle decoupling

- New opt-in contract version; omitted acceptance means not requested.
- Report-optional verify evaluation.
- Separate execution, acceptance, and review projections.
- Remove policy failure from exit code, status, success event, aggregate, chain, delegation, notification, and recovery semantics.
- Explicit `observe` versus `gate` and explicit `gateOn`.

### Track 2: explicit effect contracts

- CompletionGuard off by default in new mode.
- No prose/name inference of required mutation.
- Optional code profile may request file-change effects and declare observable effect adapters.
- Missing effects are policy outcomes, not process crashes.

### Track 3: generic content parity

- Add `outputSchema` to direct single, top-level tasks, typed delegation, foreground, and async.
- Reuse the existing `structured_output` pipeline.
- Keep structural validation distinct from domain acceptance.

### Track 4: public API compatibility

- Preserve v1 acceptance and recovery descriptors in legacy mode.
- Add provenance for caller policy, agent default, recovered legacy policy, and selected profile.
- Add a domain-neutral delegation version or additive contract fields.

### Track 5: profile extraction

- Move fixed evidence, Git checks, code progress fields, code completion effects, and code review conventions into explicit versioned profiles.
- Keep worktree and watchdog capabilities opt-in.

### Track 6: behavioral guidance

- Make the universal Skill workflow domain-neutral.
- Relabel Fable's current repository delivery pipeline as a code-change recipe.
- Label packaged diff/review/fix prompts as code workflows.
- Generalize or rename planner/context-builder/reviewer roles.

These tracks should not be implemented as one rewrite. Contract/lifecycle and CompletionGuard are the correctness-critical boundary. Guidance and profile extraction can follow behind compatibility flags, but documentation must not continue teaching the deprecated implicit behavior once new mode exists.

## Migration risks

### Saved agents and frontmatter

`defaultAcceptance`, `acceptanceRole`, and `completionGuard` may already exist in user/project agents. New mode must distinguish explicit configuration from legacy implicit defaults. A generic default must not silently attach a code profile through frontmatter or a future `defaultProfile` key.

### Async recovery and resume

Recovery descriptors store resolved acceptance and CompletionGuard state. Revival must retain provenance instead of reclassifying a previously inferred legacy policy as newly explicit.

### Dynamic groups

Foreground and async zero-item/non-zero-item acceptance paths differ today. New-mode gating should normalize those paths while legacy tests preserve old behavior.

### External delegation consumers

Protocol v1 is public. Additive fields or a version bump must allow older extensions to continue receiving legacy status and result shapes.

### Status vocabulary

Current code uses both `complete` and `completed`, plus acceptance tokens such as `not-required` and `rejected`. Introduce derived views before broad renaming to avoid breaking fleet/status/TUI readers.

### Schema policy smuggling

JSON Schema can encode value constraints. The runtime must document and test that `outputSchema` is used for wire shape, not domain verdicts. Acceptance and review own policy judgments.

## Verification obligations for implementation

A redesign is not complete until these cases are covered in foreground and async paths:

1. Plain text task with no policy completes with no injected JSON contract.
2. Lean artifact task exits 0 without code evidence or Git checks.
3. Verify-only acceptance runs without a child acceptance report.
4. Acceptance rejection leaves execution exit code and lifecycle success unchanged in observe mode.
5. Explicit acceptance gate stops only the configured chain transition.
6. CompletionGuard omission does not infer file effects in new mode.
7. Explicit code profile can still require edits, tests, Git checks, and code review.
8. `outputSchema` works for single, tasks, chain, dynamic, delegation, foreground, and async.
9. Missing required structured output is a protocol failure, while a policy verdict is not.
10. Recovery preserves legacy/new-mode and policy provenance.
11. Dynamic empty/non-empty groups have symmetric gate behavior.
12. TUI, notifications, intercom, and API consumers display execution, acceptance, and review separately.
13. Non-English and non-code tasks do not depend on English mutation regexes for success.
14. Worktree and watchdog behavior is unchanged when explicitly selected.

## Final assessment

The approved agent-contract direction meets the requested taste standard for generalization and decoupling. It chooses the right default machine contract, avoids inventing a mandatory mini-envelope, separates child claims from runtime facts, and provides explicit customization boundaries.

The full-plugin audit shows that acceptance is not the only place where Coding-Agent-first policy leaked into the core. CompletionGuard independently performs the same architectural mistake: infer a domain effect from names and prose, then rewrite execution success. Public delegation types and the packaged Skill reinforce the same worldview at the API and behavior-guidance layers.

The plugin can become genuinely general without abandoning its coding strengths. Its orchestration substrate is already mostly generic. The work is to extract implicit coding policy into explicit profiles and recipes, make all policy opt-in, and preserve execution facts regardless of domain judgment.
