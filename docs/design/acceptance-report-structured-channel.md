# Design: Acceptance Report Delivery via `acceptance.report` Switch (tool + prompt)

```text
Status:   draft — implementation not started
Scope:    local change to pi-subagents (this repository), not upstream yet
Context:  evolved from issue #499 / PR #577 post-mortem discussions (2026-08)
```

---

## 1. Problem

Acceptance reports today reach the parent through two mechanisms:

1. **Fenced JSON text (default)** — `formatAcceptancePrompt` (src/runs/shared/acceptance.ts:407)
   injects a ` ```acceptance-report ` fence template into the child prompt; the parent recovers it
   with a fault-tolerant regex/normalization pipeline (acceptance.ts:487–749: wrapper-key aliases,
   inline `ACCEPTANCE_REPORT:` markers, fence-scanning fallbacks). This is the #499 lesion:
   free-text delivery means fields can be dropped, and malformed reports become parse errors.
2. **`structured_output` piggyback (conditional)** — when the task already has `outputSchema`,
   the child-side `structured_output` tool grows an optional `acceptanceReport` parameter
   (structured-output.ts:64, subagent-prompt-runtime.ts:735–757), validated as an opaque object
   and captured to `acceptance-report.json` (structured-output.ts:140). The parent prefers this
   capture over text parsing (execution.ts:1479–1481, 2159–2160).

The gap: the piggyback path only exists when the parent supplies an `outputSchema`. Tasks
**without** `outputSchema` are locked to the text channel regardless of harness capability.
The piggyback `acceptanceReport` parameter is also only `type: "object"` — it is never
validated against the acceptance report shape.

## 2. Goal

Add a task-level switch `acceptance.report: "on" | "off"` (default unchanged → current behavior):

- **`on`** — the child MUST deliver the acceptance report through the structured channel
  (`structured_output` tool with a schema-validated `acceptanceReport` parameter) **plus** the
  text prompt contract; if the task has no `outputSchema`, a dedicated `structured_output`
  tool is still registered solely to carry the report.
- **`off`** — equivalent to today's no-`outputSchema` behavior: no structured channel for the
  report; the text fence channel remains the only self-report path (and hosts that prefer
  verify/gate-only evidence can stop requesting child reports at the `acceptance` level).

Key rules from the design discussion:

- **The switch has exactly two values.** No `prompt`/`tool` split: `on` means
  tool *and* prompt together (prompt explains the contract, tool enforces it); `off` means the
  report is delivered only if an existing text/manual path already would be, with no new
  machinery.
- **Structured-output hook augmentation.** The child-side `structured_output` tool registration
  gains a check: when acceptance report requirements are active (`on`), the tool (a) warns/
  instructs the child to fill `acceptanceReport`, and (b) validates the report against the real
  `AcceptanceReport` shape instead of `type: "object"`. When the requirement is off, the tool
  behaves exactly as the existing structured-output path does (unchanged).
- **A dedicated `structured_output` tool is registered whenever `report: "on"` is active**,
  even when the task has no `outputSchema`. In that case the tool carries only the
  `acceptanceReport` parameter. The tool still terminates the step on successful submission.
- **Steer-back gating changes under `on`.** When report requirements are active, the condition
  for the child to steer back / return control to the parent is
  **`structured output call` + `acceptance report` both present** (i.e. a successful
  `structured_output` call that includes a valid `acceptanceReport` is the child's terminal,
  parent-notifying action). Without `on`, steer-back conditions remain exactly as today.

## 3. Non-Goals

- No change to acceptance **semantics**: levels, criteria, evidence, verify commands, gate,
  memoization, host-side spawning, and the rejection-vs-report decision boundary are untouched.
- No version negotiation or `agentContract` coupling; this is a plain per-task field.
- The fenced-text channel and its tolerant parsing are **kept** (fallback for external CLI
  runners without tool-registration surfaces, and for `off`).
- No global settings-level default in this iteration (can follow later).

## 4. Design

### 4.1 Schema surface

`AcceptanceOverride` gains:

```ts
report?: "on" | "off";   // optional; omitted = current behavior (structured channel only
                         // when outputSchema present; text fence otherwise)
```

Surfaces to update: `src/extension/schemas.ts` (delegation/chain/parallel/dynamic +
workflowScript child fields), `src/shared/types.ts`, and the `acceptance` field description
in the tool schema (mention the switch and its default).

### 4.2 Runtime flag resolution

New resolver alongside `resolveEffectiveAcceptance`:

```
reportMode =
  acceptanceOverride.report === "on"  ? "required-structured" :
  acceptanceOverride.report === "off" ? "text-only" :
  /* omitted */                        structuredOutputPresent ? "piggyback" : "text-only"
```

`reportMode` is computed once per step in the two execution paths
(foreground `subagent-executor.ts` around :1985/:3641; async `async-execution.ts` around
:1001/:1634) and threaded into:

- `createStructuredOutputRuntime(..., { captureAcceptanceReport, reportRequired })`
- `formatAcceptancePrompt(..., { reportMode })`
- `buildPiArgs`/env construction (pi-args.ts:1005 area)

### 4.3 Child-side tool (the "hook")

In `subagent-prompt-runtime.ts` (structured_output registration block, :613 / :735–757):

- Add an env flag, e.g. `PI_SUBAGENT_ACCEPTANCE_REPORT_REQUIRED=1`, set by the parent when
  `report: "on"` (with or without an `outputSchema`).
- When `reportRequired` and no `outputSchema`: register a `structured_output` tool whose
  parameters contain **only** the `acceptanceReport` property; description tells the child
  this is the required acceptance report submission that ends the step.
- When `reportRequired` and `outputSchema` exists: keep one tool; the `acceptanceReport`
  property is upgraded from `{ type: "object" }` to a full JSON Schema materialization of
  `AcceptanceReport`, and the tool description is extended: "The `acceptanceReport` property
  is REQUIRED for this step; it will be validated on submission."
- Validation: run the existing `validateAcceptanceInput`-equivalent shape check on the
  `acceptanceReport` value inside the tool's `execute`. Invalid → throw the same
  "Structured output validation failed: …" style error so the child corrects and re-calls
  in-session (the cheap retry loop). Valid → write `acceptance-report.json`, then terminate.
- When `reportRequired` is false: zero behavioral change (the check is skipped; the optional
  `acceptanceReport` property stays as-is when a capture path exists).

### 4.4 Parent-side consumption

`evaluateAcceptance` already prefers `report` (the structured capture) over text parsing.
Changes needed:

- `readStructuredOutputAcceptanceReport` gains a required-mode branch: in required mode a
  missing capture file is surfaced as `reportError = "Missing acceptance report; the child
  must submit it via structured_output"` instead of silently falling back to text scraping.
- The steer-back condition: in required mode the run's completion/attention signal to the
  parent requires both the structured output call and a valid report. Concretely, the
  `structured_output` tool's `terminate: true` already ends the child step; add: if the
  required report is absent or invalid at terminate time, the tool call errors (no terminate),
  so the child keeps working until it produces a valid one — the parent is only notified on
  the valid pair.

### 4.5 Prompt (`formatAcceptancePrompt`)

Extend `options.structuredOutput` (boolean) into `reportMode`:

- `required-structured`: keep the full contract text (criteria/evidence/verify), replace the
  fence block with "End by calling `structured_output` with the required `acceptanceReport`
  property (validated on submission)". No ` ```acceptance-report ` fence is emitted.
- `piggyback` (today's `structuredOutput: true`): unchanged from current behavior.
- `text-only` (today's `structuredOutput: false`): unchanged fence template.

### 4.6 Async path

`async-execution.ts` mirrors foreground: pass `reportRequired` into runtime creation and env
construction (:1001, :1634); recovery/reattach validation reads the same capture files, so no
extra state is needed.

## 5. Acceptance Criteria

1. **Back-compat:** with `report` omitted, all existing tests pass and runtime behavior is
   byte-identical to v0.60.0 (prompt bytes, env vars, tool parameters).
2. **`report: "on"` without `outputSchema`:** child sees a `structured_output` tool carrying
   only `acceptanceReport`; submitting an invalid report errors in-session; a valid
   submission captures `acceptance-report.json` and terminates the step; the parent's
   `evaluateAcceptance` consumes the capture; no fence template is injected.
3. **`report: "on"` with `outputSchema`:** single `structured_output` tool; `acceptanceReport`
   is schema-validated (not `{type:"object"}`); steer-back to the parent happens only after a
   valid value+report pair.
4. **`report: "off"`:** no structured channel for the report even if the harness supports it;
   text fence behavior identical to today's no-`outputSchema` case; verify/gate-only
   workflows unaffected.
5. External CLI runner steps ignore the structured channel (no pi runtime) and behave as
   `text-only` regardless of the flag (documented).

## 6. Test Plan

- Unit: `reportMode` resolution matrix (override × outputSchema presence).
- Unit: tool parameter generation — report-only tool vs piggyback vs unchanged.
- Unit: `validateAcceptanceReportValue` shape validation; invalid field statuses rejected
  in-session; capture file written only on valid.
- Unit: `formatAcceptancePrompt` snapshots for the three modes.
- Unit: `evaluateAcceptance` required-mode missing-capture error; piggyback precedence intact.
- Integration (foreground + async): `report: "on"` run captures report, ledger reflects it,
  steer-back/completion gated on the valid pair; `report: "off"` produces no capture file and
  no structured tool.
- Regression: full existing suite green with the field omitted.

## 7. Implementation Checklist

- [ ] `AcceptanceOverride.report` in types + extension schemas (+ description text)
- [ ] `reportMode` resolver; thread through foreground + async execution paths
- [ ] `createStructuredOutputRuntime` `reportRequired` option; env var
      `PI_SUBAGENT_ACCEPTANCE_REPORT_REQUIRED`
- [ ] Child-side: report-only tool registration; schema-validated `acceptanceReport`
      parameter; required-mode description; terminate gating
- [ ] `formatAcceptancePrompt` mode-aware template
- [ ] `readStructuredOutputAcceptanceReport` required-mode error; `evaluateAcceptance` wiring
- [ ] `buildPiArgs` env propagation
- [ ] Tests per §6; docs touch: `docs/tool-reference.md` acceptance section,
      `docs/configuration.md` if a default is added later
