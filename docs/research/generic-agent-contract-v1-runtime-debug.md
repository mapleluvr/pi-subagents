# Generic Agent Contract v1 Runtime Debug

Date: 2026-07-17

## Runtime

- Pi: `0.80.6`
- Parent and child model: `Mapleluv-Main/gpt-5.6-sol-pro`
- Extension: this worktree's `index.ts`, loaded directly with `--no-extensions -e <worktree>/index.ts`
- Sessions and raw JSON-mode events: ignored `.pi-subagents/debug/generic-contract-v1/`
- Persistent model configuration and agent overrides: unchanged

Representative startup command:

```bash
PI_SKIP_VERSION_CHECK=1 pi \
  --mode json \
  --model Mapleluv-Main/gpt-5.6-sol-pro \
  --no-extensions \
  -e D:/Projects/PiAgent/plugins/pi-subagents/.worktrees/agent-contract-research/index.ts \
  --no-skills --no-prompt-templates --no-context-files \
  --approve \
  --session-dir <case-session-dir> \
  "<case-prompt>"
```

Each case used a fresh Pi process and session directory. No launch timeout was supplied.

## Results

| Case | Observed result |
|---|---|
| v1 omitted acceptance + explicit CompletionGuard policy | Child returned `exitCode: 0`; no acceptance report contract was injected; `effects.fileMutation.status` was `rejected`; derived projections were `execution.state: "completed"` and `review.status: "not-requested"`. |
| v1 verify-only acceptance | Child returned ordinary text with no acceptance report. Runtime executed `node -e "process.exit(0)"`; acceptance was `verified`, `requiresChildReport: false`, and execution remained `exitCode: 0`. |
| Direct single `outputSchema` | The first production-model run returned `structuredOutput: {"answer":42}` with `exitCode: 0`. Three post-review retries reached the v1 runtime but the child provider returned two request timeouts and one connection error before producing structured output; deterministic direct/async/Clarify parity tests remained green. |
| Sequential `gateOn: "execution"` | Step 1 verification deliberately failed, so acceptance was `rejected` while `execution` stayed `{state:"completed", exitCode:0}`; step 2 still ran and returned `SECOND`. |
| Legacy compatibility control | The same implementation-shaped/no-edit task retained old behavior: CompletionGuard set `completionGuardTriggered: true`, acceptance was `rejected`, and execution was rewritten to `exitCode: 1`. |
| Async launch and wait | Detached status reached `state: "complete"`; derived run/step execution was `completed`; step `exitCode` stayed `0`; contract provenance was persisted; the rejected file-mutation effect remained observational. `subagent_wait` completed after 8.7 seconds in the post-review run. |

The parent-facing grouped result is intentionally compact; JSON mode's `tool_execution_end.result.details` and async `status.json` supplied the runtime-owned projections above. Isolated extension loading can also emit a grouped-result acknowledgement warning when intercom is absent; persisted status/results remain authoritative. The three post-review structured-output provider failures were child sampling failures, not plugin timeouts: no `timeoutMs` or `maxRuntimeMs` was supplied.

## Regression Evidence

- Post-review focused contract/lifecycle suites: `426 pass / 6 Windows-specific skip / 0 fail` after isolated rerun of the Clarify parallel-schema case.
- Pre-review focused generic-contract suites: `295 pass / 6 skip / 0 fail`.
- Release full unit run: `1237 pass / 13 skip / 12 fail`. Ten failures are pre-existing agent-management isolation pollution; one is Windows symlink `EPERM`; the watchdog malformed-output timing failure passed immediately in isolation (`1/1`). Focused affected contract suites pass.
- Release full integration run: `577 pass / 7 skip / 1 fail`. The sole hard-kill runner-start timing test timed out at 10 seconds and passed immediately when rerun in isolation (`1/1`).
- E2E smoke: `2 pass / 0 fail`.

This runtime debug validates transport and lifecycle behavior with the requested production model. It does not replace the deterministic unit and integration coverage for malformed schemas, recovery descriptors, dynamic fan-out, or typed delegation adapters.
