# Model Override Permission Runtime Debug

Date: 2026-07-20

Implementation under test: `68d3fc89ecd49f9b8bef5db353b0d5dc2a0e36a1` (`research/agent-contract`)

Pi runtime: `0.80.6`

Parent model: `Mapleluv-Main/gpt-5.6-sol-pro`

Extension: `D:/Projects/PiAgent/plugins/pi-subagents/.worktrees/agent-contract-research/index.ts`

The canaries ran in fresh headless JSON sessions with `--no-extensions -e <worktree>/index.ts`. They omitted `timeoutMs`, `maxRuntimeMs`, `turnBudget`, and `toolBudget`.

## Off-route explicit model

The parent first called `subagent({action:"list"})`, then requested one child with `model:"anthropic/claude-sonnet-4"`. The request also supplied the old public `modelOverrideApproval` shape with a syntactically valid 64-character digest to probe receipt forgery. With the default `ask` policy and no UI, the second tool result was an error before child launch:

```text
Model override permission requires interactive user approval, but no UI is available.
Requested: model=anthropic/claude-sonnet-4:xhigh
Remove every model field to use the configured route. Do not retry with a different model. Ask the user before requesting an exact per-run model override.
```

The result had no `runId` or child result. No child session was created. The caller-supplied approval object did not bypass the scheduler-owned private receipt channel.

## Configured route with no override

The parent listed agents, then launched `delegate` with no `model` field. The child returned `CANARY_CONFIGURED_ROUTE_OK` and completed with `exitCode: 0`. The child model was `Mapleluv-Main-MSG/grok-4.5:xhigh`, which came from the configured `delegate` agent route and was not selected in the per-call request. The tool result had a normal `runId`, child artifact paths, and a completed execution projection.

## Regression evidence

- Unit: `1252 pass / 11 fail / 13 skip`; the 11 failures are the existing Windows symlink and agent-management state-pollution families.
- Integration: `596 pass / 2 fail / 7 skip`; the async hard-kill and runner-start timing cases each passed `1/1` in isolation.
- E2E: `2/2`.
- Focused permission, Clarify, scheduler, bridge, delegation, nested-control, single, parallel, chain, and fork closures passed.

## Local policy activation

`C:/Users/mapleland/.pi/agent/extensions/subagent/config.json` now explicitly sets `modelOverridePermission: "ask"`. A byte backup and structural comparison verified that `asyncByDefault`, `globalConcurrencyLimit`, and control notification settings were unchanged. `pi list` continued to resolve this research worktree. Existing Pi processes require reload or restart to use the new extension instance.

## Interpretation

The preflight enforces the user-authorization boundary for per-call route changes while preserving configured agent primary/fallback behavior. Headless mode fails closed. These canaries do not test provider failure fallback; the existing fallback test suites cover that path.
