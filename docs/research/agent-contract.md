# Research: A Minimal, Generic, Customizable Agent Contract

**Repository:** `mapleluvr/pi-subagents`
**Baseline:** `315e1eb1482c4ac2d912a8d95aac4287dc7e60ac`
**Branch:** `research/agent-contract`
**Status:** design research only; no runtime implementation
**Date:** 2026-07-16

## Executive conclusion

The current Acceptance subsystem combines four separate concerns:

1. execution lifecycle observed by the runtime;
2. content and artifacts returned by the child;
3. acceptance policy chosen by the caller;
4. independent review performed by another actor.

That coupling creates a large code-oriented report contract, domain-specific defaults, and control-flow failures when the child completes the requested work but does not reproduce the expected report shape.

The smallest general design is not a smaller mandatory child report. It is:

- an always-present, runtime-built result envelope;
- ordinary text and artifact outputs by default;
- caller-defined `outputSchema` only when machine-readable child content is needed;
- caller-defined acceptance checks only when acceptance is needed;
- independent review represented separately;
- namespaced extensions for domain-specific metadata.

No child JSON is required in the default path. The host already observes lifecycle, exit status, artifacts, output references, usage, and protocol failures. Requiring the child to restate these facts adds cost without adding trust.

## Scope

This brief answers:

- what information generic orchestration actually needs;
- which information belongs to the runtime, child, caller, or reviewer;
- how execution, output, acceptance, and review should be separated;
- how callers can customize structured output and acceptance without a fixed evidence vocabulary;
- how to migrate from the current Acceptance API without breaking persisted runs immediately.

It does not propose implementation code or a final public API spelling.

## Current implementation

### Data flow

At `315e1eb`, a run follows this path:

```text
parent call
  -> resolveEffectiveAcceptance(...)
  -> infer a level from agent name, acceptanceRole, task mutation intent, and async/dynamic context
  -> append formatAcceptancePrompt(...) to the child task
  -> run child
  -> parse an acceptance-report fence or configured output file
  -> run structural evidence checks and optional verify commands
  -> attach AcceptanceLedger to SingleResult
  -> for an explicit rejected policy, rewrite exitCode 0 to 1
  -> chain may stop because the step now failed
```

Relevant implementation:

- `src/runs/shared/acceptance.ts`: inference, normalization, prompt generation, parsing, structural checks, runtime verification, ledger evaluation;
- `src/shared/types.ts`: `SingleResult`, `AsyncStatus`, `AcceptanceInput`, `AcceptanceReport`, and `AcceptanceLedger`;
- `src/runs/foreground/execution.ts`: prompt injection, report evaluation, and explicit acceptance failure to exit-code conversion;
- `src/runs/background/subagent-runner.ts`: equivalent async evaluation and exit-code conversion;
- `src/runs/shared/structured-output.ts`: caller-defined JSON Schema validation through `structured_output`;
- acceptance and chain tests: current behavioral compatibility surface.

### Fixed evidence vocabulary

The runtime currently recognizes this closed set:

```text
changed-files
tests-added
commands-run
validation-output
residual-risks
no-staged-files
diff-summary
review-findings
manual-notes
```

Default levels select code-oriented bundles:

| Level | Required evidence |
|---|---|
| `attested` | manual notes, residual risks |
| `checked` | changed files, tests added, commands run, residual risks, no staged files |
| `verified` | checked fields plus validation output |
| `reviewed` | verified fields plus an independent-review expectation |

The table describes level defaults. Inferred reviewer/read-only work substitutes `review-findings` for `manual-notes`. An empty `testsAddedOrUpdated` array is treated as not applicable, but an omitted field is treated as missing. A correct domain artifact can therefore be rejected because its report omitted a code-specific field. Structural strength also varies: `commands-run` requires a non-empty array, while `residual-risks` accepts an empty string array.

### Automatic escalation

Current inference uses agent names, task wording, and orchestration context:

- async write-capable work becomes `reviewed`;
- ordinary write-capable work becomes `checked`;
- reviewer/scout/read-only work becomes `attested`;
- other work receives lightweight attestation.

Except for an explicit `{ level: "none", reason: "..." }`, an explicit level cannot lower the inferred rank. Explicit `evidence` adds to the inferred/default evidence and cannot replace it. The current API can infer `reviewed`, but rejects `reviewed` as an explicitly requested level because a worker call cannot supply its own independent review.

### Existing customization is uneven

Current acceptance supports:

- custom criteria;
- additive evidence tags from the closed vocabulary;
- parent-run verify commands;
- review metadata;
- textual stop rules.

However:

- custom evidence cannot replace level defaults;
- new evidence kinds cannot be declared;
- `stopRules` are prompt text, not runtime-enforced stop behavior;
- review metadata does not itself launch and wire an independent reviewer;
- acceptance has a second structured-report mechanism even though `outputSchema` already provides caller-defined structured output.

### Existing generic primitives

The plugin already has the pieces needed for a smaller design:

- versioned lifecycle artifacts;
- `SingleResult` and `AsyncStatus` runtime state;
- text output and file-only output references;
- artifact paths and session/transcript references;
- `structuredOutput` validated by caller-provided JSON Schema for chain steps, chain-parallel tasks, and dynamic collection (the direct top-level single-agent form, top-level `tasks[]`, and typed delegation request do not currently expose `outputSchema`);
- chain named outputs and dynamic collection;
- parent-run verify commands;
- separate child sessions for reviewers.

The redesign should reuse these primitives rather than introduce another mandatory report protocol.

## Failure modes

### Domain success becomes orchestration failure

A Lean worker may write `Formal.lean`, run Lean successfully, and omit `testsAddedOrUpdated`. Structural acceptance then rejects the report. If the policy was explicit, the runtime changes exit code `0` to `1`, so a sequential chain can stop before review. Rejection also affects child status, success events, aggregate fanout blockers, and delegation adapters; removing only the exit-code rewrite would not fully separate execution from acceptance.

### Presence checks create false confidence

A non-empty string or array proves only that the child emitted a value. It does not prove that a test ran or that validation was correct. Child statements are attestations, not runtime verification.

### Prompt and output duplication

Built-in worker/reviewer prompts already request changes, checks, blockers, and residual risk. Acceptance repeats these requirements and adds a large example JSON object to the task.

### Inference changes policy silently

`async: true` is an execution choice, not a domain acceptance requirement. Using it to raise a writer to `reviewed` silently changes the prompt and potential chain behavior.

### Lifecycle and policy are conflated

A process can execute successfully while its output is unacceptable. Rewriting the process exit code loses that distinction and makes diagnosis harder.

### Review is represented before it exists

A worker cannot independently review itself. A review status should be based on a real reviewer run, not an inferred worker-level field.

## Design principles

1. **Runtime observes; children communicate; callers define policy; reviewers judge independently.**
2. **Default delegation requires no child JSON.**
3. **Execution state never changes because an acceptance policy failed.**
4. **Machine-readable child output is opt-in through caller-provided JSON Schema.**
5. **Acceptance is opt-in and has no built-in domain evidence list.**
6. **Only runtime observations and configured evaluators can produce a verified result.**
7. **Child claims remain explicitly attested, not verified.**
8. **Review is a separate result produced by a separate actor.**
9. **Chain gating is explicit about the status it uses.**
10. **Domain features live in versioned, namespaced extensions or reusable profiles.**
11. **Missing optional fields never fail execution.**
12. **Persisted artifacts remain inspectable without parsing child prose.**

## Lessons from external protocols

These protocols are design references, not requirements for pi-subagents.

### MCP tools

MCP separates:

- human/multimodal `content`;
- optional `structuredContent`;
- optional caller-visible `outputSchema`;
- tool execution error signaling through `isError`;
- protocol errors through JSON-RPC errors.

The useful lesson is that structured output is optional and schema-driven. A tool does not have one universal domain report schema.

Source: https://modelcontextprotocol.io/specification/2025-06-18/server/tools

### JSON-RPC 2.0

JSON-RPC separates a successful `result` from a protocol/invocation `error`. Domain evaluation can be represented inside a successful result without pretending that transport failed.

Source: https://www.jsonrpc.org/specification

### A2A

A2A represents task lifecycle, messages, artifacts, and extensible metadata separately. A task has a status and artifacts; a message or artifact may contain text, files, or arbitrary structured data. Extensions are identified separately rather than growing the core task schema for every domain.

Sources:

- https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto
- https://github.com/a2aproject/A2A/blob/main/docs/specification.md

### JSON Schema

Caller-provided JSON Schema is the appropriate mechanism when a workflow requires a specific structured child result. pi-subagents already supports this through `outputSchema`; acceptance should consume or reference that result instead of requiring a second fenced JSON report.

Source: https://json-schema.org/draft/2020-12/json-schema-core

The current implementation compiles schemas through TypeBox. Any public contract must document the actually supported schema dialect/features rather than imply complete JSON Schema 2020-12 support.

## Proposed model

The model has four independent layers.

### Layer 1: runtime result envelope

The plugin always constructs this layer from observed state. The child does not emit it.

Illustrative shape:

```json
{
  "protocolVersion": "pi-subagents.result/1",
  "runId": "run-123",
  "agent": "worker",
  "execution": {
    "state": "completed",
    "exitCode": 0,
    "startedAt": "2026-07-16T12:00:00Z",
    "endedAt": "2026-07-16T12:04:00Z"
  },
  "content": [
    {
      "type": "text",
      "text": "Completed the requested proof."
    }
  ],
  "artifacts": [
    {
      "id": "artifact-1",
      "path": "Formal.lean",
      "mediaType": "text/plain",
      "role": "output"
    }
  ],
  "acceptance": {
    "status": "not_requested"
  },
  "review": {
    "status": "not_requested"
  },
  "extensions": {}
}
```

The exact public shape may remain close to `SingleResult`; the important requirement is semantic separation, not a wholesale type rename.

Minimum runtime-owned semantics:

- identity: run, agent, child index;
- execution state and exit code;
- runtime/protocol error details;
- output content or output references;
- artifacts and persisted session metadata;
- optional structured content;
- separately named acceptance and review results.

### Layer 2: child content

Default child output remains normal text plus artifacts. No standard JSON handoff is required.

When a caller needs machine-readable child content, it supplies `outputSchema`. The existing `structured_output` tool validates and stores the value as `structuredOutput`. Today this exists on chain steps, chain-parallel tasks, and dynamic items, but not the direct single-agent call, top-level `tasks[]`, or typed delegation request; the proposed API promotes the same mechanism across those surfaces. Missing or invalid required structured output remains an execution/protocol failure because the child did not satisfy its declared output contract. Acceptance may read that value later, but must not require a second report parser.

Example caller-defined result schema for a Lean worker:

```json
{
  "type": "object",
  "required": ["outcome", "artifacts"],
  "properties": {
    "outcome": {
      "enum": ["completed", "partial", "blocked"]
    },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "notes": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

That schema belongs to the caller or reusable task profile, not the core protocol.

### Layer 3: optional acceptance policy

Acceptance is absent by default. If requested, it describes how the parent/runtime will evaluate the result.

Illustrative policy:

```json
{
  "acceptance": {
    "policyVersion": "1",
    "mode": "gate",
    "criteria": [
      {
        "id": "formal-file",
        "must": "Formal.lean exists",
        "severity": "required"
      },
      {
        "id": "lean-check",
        "must": "Lean accepts Formal.lean",
        "severity": "required"
      }
    ],
    "verify": [
      {
        "id": "lean-check",
        "command": "lake env lean Formal.lean",
        "cwd": "."
      }
    ],
    "review": false,
    "extensions": {}
  }
}
```

Policy rules:

- callers should explicitly choose `mode: "observe"` or `mode: "gate"`; if compatibility requires a default, use `observe` so a policy cannot silently stop a chain;
- `mode: "observe"` records a verdict but never gates a chain;
- `mode: "gate"` gates according to explicit criteria/checks;
- omitted policy means `not_requested`;
- criteria with no runtime evaluator remain `unverified` or require review; child prose cannot promote them to verified;
- verify command results are runtime-owned;
- no automatic level escalation occurs from `async`, agent names, or task keywords;
- no fixed evidence fields are injected.

Suggested acceptance statuses:

```text
not_requested
pending
passed
failed
needs_review
skipped
policy_error
```

Acceptance failure does not change `execution.exitCode`.

### Layer 4: independent review

Review is based on a real reviewer result:

```json
{
  "review": {
    "status": "no_blockers",
    "reviewerRunId": "review-456",
    "findings": []
  }
}
```

Suggested review statuses:

```text
not_requested
pending
no_blockers
blockers
needs_parent_decision
skipped
```

The parent remains the default review scheduler. Automatic reviewer launch can be added later only as an explicit orchestration feature with real result wiring.

## Customization model

### Caller-defined output

Use existing `outputSchema` for arbitrary structured content. This is the primary customization mechanism and avoids a second report parser.

### Caller-defined verification

Keep parent/runtime-run `verify[]` commands. They provide stronger evidence than child-reported command claims. They are also a shell-level trust boundary: the current implementation uses `shell: true`, so commands must remain caller-supplied/trusted, scoped to an explicit cwd, and subject to time/resource controls.

### Caller-defined criteria

Criteria remain open text with stable IDs. A criterion becomes machine-verified only when linked to a runtime check, schema assertion, or reviewer result.

A later extension may support safe assertions over `structuredOutput`, for example JSON Pointer plus an operator. That should not be required for the first migration stage.

### Namespaced extensions

Domain-specific data belongs under namespaced keys:

```json
{
  "extensions": {
    "io.github.mapleluvr.pi-subagents.code/1": {
      "changedFiles": ["src/parser.ts"],
      "testsAddedOrUpdated": ["test/parser.test.ts"]
    },
    "org.lean-lang.proof/1": {
      "disallowSorry": true
    }
  }
}
```

Extension rules:

- core ignores unknown optional extensions;
- a required extension must be declared by the caller and supported by the runtime/profile;
- extension schemas are versioned independently;
- extensions do not mutate execution state;
- extension validation failures affect only an explicitly configured acceptance gate.

### Reusable profiles

Profiles are optional convenience packages, not inferred levels:

```text
code-change/1
lean-proof/1
read-only-review/1
```

A profile expands to caller-visible `outputSchema`, criteria, verify checks, review policy, and extensions. The resolved profile is persisted for audit. No profile is selected merely because a run is async or an agent is named `worker`.

## Lifecycle and chain semantics

### Execution state

Normalize runtime lifecycle independently:

```text
queued
running
completed
failed
timed_out
paused
stopped
detached
```

`completed` means the child process/protocol completed successfully. It does not mean the parent accepted the work.

### Task outcome

A child may communicate `completed`, `partial`, or `blocked` in text or caller-defined structured content. This is a claim, not runtime lifecycle.

### Chain gating

Each step should make its gate explicit:

```json
{
  "gateOn": "execution"
}
```

Supported concepts:

```text
execution
acceptance
review
```

Recommended behavior:

- default steps gate on execution only;
- an explicit acceptance policy in `mode: "gate"` adds acceptance gating;
- an explicit required review adds review gating;
- the result preserves all three statuses when a gate stops the chain;
- no gate rewrites another layer's status.

## Worked examples

### Lean proof

Call:

```json
{
  "agent": "worker",
  "async": true,
  "cwd": "D:/Lean/problems/001",
  "task": "Write SOLUTION.md and Formal.lean.",
  "outputSchema": {
    "type": "object",
    "required": ["outcome", "artifacts"],
    "properties": {
      "outcome": { "enum": ["completed", "partial", "blocked"] },
      "artifacts": { "type": "array", "items": { "type": "string" } }
    }
  },
  "acceptance": {
    "policyVersion": "1",
    "mode": "gate",
    "criteria": [
      { "id": "lean", "must": "Lean accepts Formal.lean" }
    ],
    "verify": [
      { "id": "lean", "command": "lake env lean Formal.lean" }
    ]
  }
}
```

Result semantics:

```json
{
  "execution": { "state": "completed", "exitCode": 0 },
  "structuredContent": {
    "outcome": "completed",
    "artifacts": ["SOLUTION.md", "Formal.lean"]
  },
  "acceptance": {
    "status": "passed",
    "checks": [
      { "id": "lean", "status": "passed", "exitCode": 0 }
    ]
  },
  "review": { "status": "not_requested" }
}
```

No `tests-added`, Git staging, or diff field is involved.

### Code patch

A project may explicitly select a code profile:

```json
{
  "agent": "worker",
  "task": "Fix parser null handling.",
  "acceptance": {
    "profile": "code-change/1",
    "mode": "gate",
    "verify": [
      { "id": "unit", "command": "npm test -- parser" }
    ]
  }
}
```

The code profile may request changed-file/test metadata, but only because the caller selected it. Runtime verification remains authoritative for test success.

### Read-only research

Default call:

```json
{
  "agent": "researcher",
  "task": "Map the authentication entry points. Read-only.",
  "async": true
}
```

Result:

```json
{
  "execution": { "state": "completed", "exitCode": 0 },
  "content": [
    { "type": "text", "text": "Authentication entry points and risks..." }
  ],
  "artifacts": [
    { "path": "research.md", "role": "report" }
  ],
  "acceptance": { "status": "not_requested" },
  "review": { "status": "not_requested" }
}
```

No structured child handoff is needed unless the caller intends to aggregate fields mechanically.

## Compatibility mapping

| Current concept | Proposed meaning |
|---|---|
| omitted acceptance / `auto` | no policy in the new mode; legacy behavior behind compatibility mode |
| `{ level: "none", reason }` | no policy |
| `attested` | optional legacy alias for a caller-selected handoff/claims profile |
| `checked` | legacy alias for an explicitly selected code-change profile, never inferred |
| `verified` | explicit runtime verify policy |
| inferred `reviewed` | removed; parent schedules a reviewer |
| explicit `reviewed` | remains invalid until a real reviewer-run API can satisfy it |
| agent `defaultAcceptance` | counts as requested only when deliberately configured for the new contract mode; legacy semantics remain in compatibility mode |
| recovered resolved acceptance | preserved as legacy policy metadata; must not be silently reclassified as a newly requested policy on revive |
| fixed `AcceptanceReport` | legacy extension/profile only |
| `AcceptanceLedger` | preserved during migration, then split into acceptance/review results |
| acceptance rejection -> exit code 1 | compatibility behavior only; removed in new mode |
| `acceptanceRole` | advisory/profile hint only; never silent mandatory policy |
| `stopRules` | remain prompt guidance or move to a separately defined runtime control policy |

## Migration plan

### Stage 0: document current semantics

- Clarify that acceptance rejection is not necessarily domain failure.
- Recommend no explicit checked/reviewed policy for non-code tasks.
- Use parent-run verification for Lean and similar domain work.

### Stage 1: additive result separation

- Add explicit `execution`, `acceptance`, and `review` projections alongside existing fields.
- Map existing mixed lifecycle names (`complete`/`completed` and related node states) into projections without renaming persisted fields.
- Preserve `exitCode`, `AcceptanceLedger`, status artifacts, and existing readers.
- Inventory every acceptance-dependent consumer: exit-code rewrite, foreground/async child status, success events, aggregate fanout blockers, chain transitions, delegation adapters, and notifications.
- Define how agent `defaultAcceptance`, `acceptanceRole`, and recovered resolved policies behave under each contract version.
- Persist a contract/protocol version.

### Stage 2: opt-in new contract mode

Introduce a configuration switch such as:

```json
{
  "agentContract": {
    "version": 1,
    "defaultAcceptance": "none"
  }
}
```

In this mode:

- no automatic acceptance prompt is injected;
- no rank-floor escalation occurs;
- the evaluator can execute verify-only acceptance without any child report;
- required `structuredOutput` presence/schema validity can be evaluated without an `acceptance-report` fence;
- `outputSchema` is promoted to the direct single-agent form and remains the only required child JSON mechanism;
- missing/invalid required structured output remains an execution/protocol failure, while an acceptance check failure remains acceptance-only;
- acceptance is explicit and separate;
- agent defaults count as requested policy only under documented new-mode rules; recovered legacy resolved policies retain legacy provenance.

### Stage 3: explicit chain gates

- Add execution/acceptance/review gating without rewriting execution state.
- Update all acceptance-dependent success/status/aggregate/delegation surfaces identified in Stage 1, not only `exitCode`.
- Normalize foreground/async and zero-item/non-zero dynamic-group behavior in the new mode.
- Use per-child acceptance plus an explicit parent aggregate evaluator instead of synthesizing fixed evidence reports.
- Preserve legacy gate and dynamic-group behavior for saved chains during transition.

### Stage 4: legacy profiles

- Implement old `attested`, `checked`, and `verified` behavior as compatibility profiles.
- Persist the resolved legacy profile in a namespaced extension.
- Warn when `auto` infers code-oriented evidence.

### Stage 5: make the new mode default

- Omitted acceptance means not requested.
- Remove automatic reviewed inference.
- Stop converting acceptance failure into process failure.
- Continue reading old status artifacts and saved chain definitions.

### Stage 6: retire the fixed report parser

After a major-version compatibility window:

- remove mandatory `acceptance-report` fences from the default path;
- retain an import/compatibility adapter for persisted legacy reports if needed;
- keep caller-defined `outputSchema`, verify checks, profiles, and extensions.

## Compatibility requirements

A migration must preserve:

- persisted async status readability;
- resume/revive descriptors containing resolved legacy acceptance and their provenance;
- saved agent/chain definitions using current acceptance levels;
- agent `defaultAcceptance` and `acceptanceRole` behavior under legacy mode;
- artifact metadata readers;
- dynamic fanout collection behavior and the legacy fixed aggregate report until its retirement stage;
- foreground and async parity, including zero-item dynamic groups;
- success events, child status, intercom notifications, aggregate blockers, and delegation adapter semantics in legacy mode;
- file-only output provenance;
- old tests under legacy compatibility mode.

In the new mode, omission should be sufficient for no acceptance; callers should not need the legacy `{ level: "none", reason }` escape hatch.

New tests should prove:

- default runs receive no acceptance prompt;
- caller-defined structured output works without acceptance in direct, parallel, chain, and async modes;
- verify-only acceptance runs without a child acceptance report;
- acceptance failure does not mutate execution exit code, child execution status, or execution success events;
- aggregate and delegation surfaces preserve execution success while reporting acceptance failure separately;
- chain gates stop on the selected layer only;
- custom schemas and verify checks work for non-code domains;
- unknown optional extensions are preserved/ignored safely;
- required unsupported extensions fail policy preflight, not child execution;
- legacy status and saved definitions still load.

## Rejected alternatives

### A smaller mandatory universal handoff schema

Rejected as the default. Even fields such as `outcome`, `checks`, and `residualRisks` are not necessary for every delegation and can be expressed through normal output or caller-defined schema.

### Free-form prose only

Insufficient for workflows that require dynamic fanout, deterministic aggregation, or machine validation. Those workflows should explicitly request `outputSchema`.

### Keep fixed evidence but permit replacement

Better than additive-only evidence, but still maintains two overlapping structured-output systems and keeps domain policy in core.

### Infer profiles from agent names or async mode

Rejected. Execution topology does not define what correctness means.

### Automatically launch a reviewer for every writer

Rejected as a default because it changes cost, latency, concurrency, and authority. It can be an explicit orchestration feature later.

### Encode common domains in the core union

Rejected. The core vocabulary would continually expand. Profiles/extensions provide the same convenience without coupling every run to every domain.

### Let child claims count as verified evidence

Rejected. Claims may be useful context, but verification requires runtime observation or an independent evaluator.

## Open decisions

1. Should the public result type be reshaped, or should the first release expose derived `execution/acceptance/review` views while retaining `SingleResult`?
2. Should the API require explicit `observe` versus `gate`? Recommendation: yes; if a transition default is unavoidable, use `observe`.
3. Which minimal structured-output checks belong in the first redesign? Verify-only/report-optional evaluation is required immediately; rich JSON Pointer assertions can be deferred.
4. Should reusable profiles be package resources, project config objects, or both?
5. What URI/namespace convention should extensions use?
6. How long should legacy auto-inference and exit-code rewriting remain available?
7. Should reviewer scheduling stay entirely parent-owned, or later support an explicit plugin-managed review step?
8. How should old dynamic aggregate acceptance reports map to per-child acceptance plus parent aggregation?

## Recommended first implementation slice

The smallest useful implementation should not begin with profiles or extensions. It should:

1. add an opt-in contract version/config mode;
2. make omitted acceptance mean not requested, with no inference rank floor or acceptance prompt in that mode;
3. add a report-optional evaluator so verify-only acceptance can run without a child report;
4. preserve and promote existing `outputSchema/structuredOutput` to direct single, top-level `tasks[]`, typed delegation, chain, dynamic, foreground, and async execution for custom child data;
5. expose derived `execution`, `acceptance`, and `review` views while retaining existing persisted result fields;
6. separate acceptance failure from every execution-success surface: exit code, child status, success events, aggregates, chain transitions, and delegation adapters;
7. let chains explicitly gate on execution or acceptance; defer review gating until reviewer-run wiring is concrete;
8. define new-mode semantics for agent defaults, `acceptanceRole`, and recovered resolved policies;
9. keep current behavior and tests under legacy compatibility mode.

This slice resolves the observed Lean/report failure without prematurely designing profiles, extension loading, or a plugin ecosystem.

## Final recommendation

pi-subagents should treat its runtime result as the stable machine contract. Child prose remains the default communication channel, and caller-defined `outputSchema` supplies structure only when needed. Acceptance becomes an optional evaluator over runtime observations and structured outputs; independent review remains a separate run. Domain-specific convenience belongs in versioned profiles or extensions, not in a mandatory universal report.
