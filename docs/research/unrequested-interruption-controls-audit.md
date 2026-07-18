# Unrequested Interruption Controls Audit

Date: 2026-07-18
Baseline: upstream `315e1eb1482c`; active local package: `research/agent-contract@f024f97`
Scope: model-facing prompts, schemas, runtime defaults, lifecycle controls, and tests that can stop, fail, pause, skip, or materially degrade delegated work when the caller did not request a finite limit.

## Executive Summary

The most important defect is an agent-facing policy contradiction in the research branch:

- timeout guidance correctly says to omit `timeoutMs`/`maxRuntimeMs` unless the user explicitly requires a hard deadline;
- the same guidance then says to prefer `turnBudget`/`toolBudget` to bound effort.

Those are not non-interrupting alternatives. `turnBudget` aborts a child after the soft limit plus grace turns. `toolBudget` blocks configured tools after the hard limit and can leave the child unable to inspect evidence or complete a structured protocol. The bundled Skill repeats this recommendation. Two real parent sessions demonstrate the consequence: the model invented budgets for read-only review tasks, and both delegated runs failed with `exitCode: 1` from turn-budget exhaustion despite no launch timeout.

The correct default policy for a quota-rich user is: omit wall-clock, turn, tool-call, verification, wait, review-round, and numeric retrieval limits unless the user explicitly requests that particular limit. Evidence-based completion and no-progress rules are not quotas, but they must derive from the task's success criteria rather than an invented count. Resource-safety bounds and lifecycle protocol limits remain a separate category and must be surfaced rather than silently treated as unlimited work.

## Direct Evidence

### Prompt contradiction

`src/extension/tool-description.ts:13` currently says:

```text
Run-timeout safety: omit timeoutMs/maxRuntimeMs and leave runs unlimited unless the user explicitly requires a hard deadline. One launch timeout is shared across the entire single, parallel, or chain run and terminates active child work when it expires; prefer turnBudget/toolBudget to bound effort.
```

`skills/pi-subagents/SKILL.md:25` says the equivalent:

```text
Leave timeoutMs/maxRuntimeMs unset unless the user explicitly requires a hard wall-clock deadline ... Use turnBudget ... or toolBudget ... when the goal is to bound agent effort rather than wall-clock time.
```

The final clause is a normative recommendation to select another terminating or tool-blocking budget. It is not merely API documentation.

### Two real failures

The local Pi session JSONL contains two model-generated calls:

1. Reviewer run `4a9876c6-ad01-4ec2-b38a-dffe97617999` supplied `turnBudget: { maxTurns: 12, graceTurns: 2 }` without `timeoutMs` or `maxRuntimeMs`. Persisted status:

   ```text
   state: failed
   error: Subagent exceeded turn budget after 14 assistant turns (soft limit 12 + grace 2).
   exitCode: 1
   turnBudgetExceeded: true
   toolCount: 53
   ```

2. Oracle run `99ec2b47-5ed9-48d9-815b-e12e45211a37` supplied:

   ```json
   {
     "turnBudget": { "maxTurns": 4, "graceTurns": 2 },
     "toolBudget": {
       "soft": 9,
       "hard": 12,
       "block": ["read", "grep", "find", "ls", "bash"]
     }
   }
   ```

   Persisted status:

   ```text
   state: failed
   error: Subagent exceeded turn budget after 6 assistant turns (soft limit 4 + grace 2).
   exitCode: 1
   turnBudgetExceeded: true
   toolCount: 9
   toolBudget: within-budget
   ```

   The parent explicitly recorded that the `4+2` budget was too low and that the Oracle was terminated while reading the required files. The turn budget fired first. The persisted tool-budget counter was 7, below its soft threshold of 9; aggregate progress counted nine tool calls. The tool budget therefore remained a latent hard-denial risk rather than the cause of this failure.

These were read-only review/research tasks. Neither limit was requested by the user. This is an observed workflow failure, not a hypothetical concern.

## Control Classification

### A. Model-facing limits that can stop or degrade work

| Control                         |                                 Default when omitted | Effect                                                                                                                 | Classification                               | Attribution                                                                                                            |
| ------------------------------- | ---------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `timeoutMs` / `maxRuntimeMs`    |                                                 none | Shared run deadline; terminates active child work                                                                      | Hard stop                                    | Runtime pre-existing; active-branch commit `1af19b3b` corrected timeout policy but redirected the model toward budgets |
| `turnBudget`                    |       none unless call, agent, or config supplies it | Soft wrap-up request, then child abort after grace; partial output and exit 1                                          | Hard stop                                    | Runtime pre-existing; current research prompt actively recommends it                                                   |
| `toolBudget`                    | none unless step, call, agent, or config supplies it | Soft nudge, then configured tools are blocked at hard count; `block:"*"` can block every tool                          | Hard degradation / possible protocol failure | Runtime pre-existing; current research prompt actively recommends it                                                   |
| `acceptance.verify[].timeoutMs` |                                           120,000 ms | Kills verification subprocess; acceptance can reject and `gateOn:"acceptance"` can stop a chain                        | Hard verification stop                       | Upstream default                                                                                                       |
| `subagent_wait.timeoutMs`       |                                         1,800,000 ms | Returns an error while active work continues; parent may wrongly stop reacting                                         | Parent wait interruption, child survives     | Upstream default                                                                                                       |
| `failFast:true`                 |                                                false | Skips not-yet-started parallel siblings after first failure                                                            | Explicit orchestration stop                  | Runtime pre-existing; no current recommendation found                                                                  |
| `gateOn:"acceptance"`           |                   v1 sequential default is execution | Stops later sequential steps on acceptance rejection                                                                   | Explicit policy gate                         | Deliberate v1 feature, not a budget                                                                                    |
| dynamic `expand.maxItems`       |                           required unless configured | Over-limit materialization fails before children run                                                                   | Structural fanout bound                      | Deliberate safety bound; model must not guess an arbitrary low value                                                   |
| `parallel.maxTasks`             |                                                    8 | Top-level `tasks[]` with more than 8 items is rejected before launch                                                   | Hidden launch cap                            | Upstream default; inconsistent with unlimited cumulative spawn default                                                 |
| review-loop max rounds          |                            3 in bundled prompt/Skill | Parent stops loop after three reviewer rounds even if work is not clean                                                | Prompt workflow stop                         | Upstream prompt policy; not runtime-enforced                                                                           |
| scheduled-run lateness          |                                                5 min | In the opt-in scheduling subsystem, a persisted job becomes `missed` and never launches when Pi is unavailable or late | Scheduled work omission                      | Upstream `scheduledRuns.maxLatenessMs` default                                                                         |

### B. Persistent defaults that cannot be disabled by an ordinary launch call

The effective precedence is:

- direct-single timeout: explicit call value, then that agent's `defaultTimeoutMs`;
- direct-single turn budget: explicit call value, then that agent's default, then global config;
- `tasks[]` and chains do not inject a selected agent's `defaultTurnBudget`; they resolve call/step and global values through their own execution paths;
- tool budget: step, run, agent, then global config.

The execution schemas accept positive objects/numbers but do not accept an ordinary per-launch `false`/`unlimited` override for these fields. Agent management can clear persistent values with `false` or an empty string, but a normal subagent call cannot say “ignore the inherited budget for this run.” A model-created agent with a finite default can therefore impose a future hidden limit until the agent is updated.

### C. Fixed lifecycle windows

| Window                             | Effect                                                                                       | Risk                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| steering acknowledgement 3 s       | If a top-level single child does not acknowledge, `steer` may commit recovery                | A healthy long tool call can be interrupted                                        |
| steering pause/recovery 15 s       | After the 3 s miss, source is interrupted and must reach paused state within 15 s            | Source can remain paused and require manual recovery                               |
| native supervisor reply 10 min     | Child supervisor request returns/errs after no reply                                         | Child coordination can fail, but does not directly kill the child                  |
| runner startup 10 s                | Recovery/revival startup handshake can fail                                                  | Replacement launch can fail after source was paused                                |
| runner lock 5 s                    | Cross-process runner lock acquisition can fail                                               | Recovery or competing launch can fail under contention                             |
| worktree setup hook 30 s default   | Hook is killed when it exceeds the default                                                   | Slow install/setup can reject a valid launch                                       |
| headless auto-drain 30 min         | Parent agent-end drain fails while children may continue                                     | Parent finalization can end before long work is observed                           |
| scheduled-run lateness 5 min       | When opt-in scheduling is enabled, a due persisted job is marked `missed` and never launched | Host downtime or delayed wake-up can silently omit requested future work           |
| stale live-PID reconciliation 24 h | Quiet live PID is rewritten as failed if status is not updated                               | Extremely long quiet tool can be falsely failed; process is not necessarily killed |
| child JSONL line 4 MiB             | Protocol failure and child termination                                                       | Very large single event cannot complete even with quota                            |

The 3/15-second steering behavior is especially important: `steer` is phrased as acknowledged delivery, but a missed acknowledgement is not merely a pending result for a top-level single. It triggers interrupt/revive automatically. Chain, parallel, and nested runs do not auto-interrupt.

### D. Controls that are not work-interruption budgets

These should not be misreported as child termination limits:

- global/per-step concurrency limits queue work; they do not abort it;
- `maxSubagentSpawnsPerSession` is unlimited by default;
- `maxSubagentDepth` defaults to 2 and blocks nested orchestration as a recursion safety boundary;
- `needsAttention` and active notices are signals; they do not kill a run;
- `subagent_wait` timeout leaves active work running;
- completion batching delays notifications but does not stop work;
- final-drain and post-exit windows clean up after a terminal child;
- scheduling is disabled unless `scheduledRuns.enabled === true`; when enabled, `scheduledRuns.maxPending` defaults to 20 and rejects the 21st pending/running schedule at creation, which is an admission/resource bound rather than termination of accepted work;
- provider retry and request deadlines belong to Pi/provider infrastructure, not this plugin's delegation budget contract.

## E. Non-Budget Hard Lifecycle Gates

These are not quotas, but they can look like accidental interruption or can turn productive work into a failed delegation:

| Gate                                   | Effect                                                                                                 | Risk / policy                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unknown or disabled agent              | Static requests are preflighted and the whole request is rejected before any child starts              | Surface the failing agent and preserve per-task diagnostics; do not present it as a budget exhaustion                                                     |
| unavailable requested tool             | Child may do work, then its result is rewritten to failure when the requested tool set is diagnosed    | Validate tool availability before launch where possible, or report the post-run correction explicitly                                                     |
| unavailable `pi-subagents` child Skill | Explicit/default use is a hard pre-spawn failure; ordinary missing Skills are warning-only             | This is an intentional recursion boundary, but the error must say that child orchestration is unavailable                                                 |
| invalid/missing `outputSchema` result  | Structured-output protocol failure can fail an otherwise useful child                                  | Keep structural output opt-in and distinguish protocol failure from domain task failure                                                                   |
| dynamic fanout materialization         | Bad pointer, schema mismatch, duplicate key, overflow, or `onEmpty:"fail"` can fail before later steps | Keep as explicit data-shape/safety policy; do not infer a small limit to make it pass                                                                     |
| legacy acceptance rewrite              | Legacy explicit acceptance rejection can still rewrite execution to failure and gate later work        | Compatibility behavior; v1 never rewrites successful execution, while a separately explicit `gateOn:"acceptance"` may still stop later steps on rejection |

Two lifecycle inconsistencies deserve separate implementation work:

- A foreground launch timeout covers the child attempt, but foreground acceptance verification runs after that timer is cleared and has its own 120-second limit. A foreground call can therefore outlive its advertised launch deadline; async execution keeps its absolute deadline through acceptance.
- A normal `resume` is a fresh follow-up and does not automatically inherit remaining per-call turn/tool limits, while steering recovery intentionally persists and subtracts them. This is a semantic difference that should be documented, not treated as quota availability.

The nominal global concurrency limit is per invocation/runner semaphore, not process-global. It queues work within that run; independent or nested runs can collectively exceed it. This is a capacity model detail, not an accidental child termination.

## User-Facing Surfaces That Induce Limits

### Mandatory tool safety guidance

The safety block is appended to full and compact descriptions and is mandatory even for custom descriptions (`src/extension/tool-description.ts:199-207`). Therefore the “prefer turnBudget/toolBudget” wording cannot be removed by a project custom tool description.

### Skill and workflow prompt

The bundled Skill repeats the effort-budget recommendation at line 25. The `/review-loop` prompt also says `Default to a maximum of 3 review rounds` and makes reaching that cap a stop condition. The Skill repeats the same cap at lines 117 and 936.

At lines 244-246 the Skill also asks the parent to supply stop rules and calls evidence-guided research a `retrieval budget`. Its concrete rule is outcome-based: search again only when a required fact is missing, then stop after the required evidence is present. That is compatible with completion-oriented work, but the word `budget` and unconstrained `when to stop after enough evidence` can invite an invented numeric cap. P0 should rename this a retrieval policy and require stop rules to derive from explicit success criteria or verified no-progress, never from a model-invented count.

### Copyable README examples

The canonical examples include finite values without stating that a caller explicitly requested them:

- `README.md:690-714`: agent example with `timeoutMs: 900000` and `turnBudget: {maxTurns:20,graceTurns:2}`;
- `README.md:981-995`: typed delegation with `toolBudget: {soft:10,hard:16,block:"*"}`;
- `README.md:1517-1526`: verification with `timeoutMs:120000`, which is also the hidden runtime default;
- `src/runs/background/wait-tool.ts:17`: copyable `subagent_wait({ timeoutMs: 600000 })`, shorter than the actual omitted default of 30 minutes.

Neutral API documentation such as field tables is not itself a model directive, but should clearly label these values as deliberate examples rather than defaults to copy.

### Current local state

The current local runtime policy has:

```json
{
  "asyncByDefault": true,
  "globalConcurrencyLimit": 4,
  "control": {
    "activeNoticeAfterMs": 300000,
    "needsAttentionAfterMs": 600000,
    "notifyChannels": ["event", "async"]
  }
}
```

It has no configured `turnBudget`, `toolBudget`, `timeoutMs`, `maxSubagentSpawnsPerSession`, parallel `maxTasks`, or enabled scheduled-run subsystem. Consequently, the observed budget failures were model-supplied, while top-level parallel launches remain subject to the runtime default `maxTasks=8`; scheduled lateness/pending defaults do not affect the current local session unless scheduling is explicitly enabled.

## Minimum Remediation

### P0: correct the prompt contract

Change Skill, mandatory Tool safety guidance, schema descriptions, wait-tool help, review-loop prompt, and copyable README examples so that:

1. `timeoutMs`/`maxRuntimeMs`, `turnBudget`, and `toolBudget` are all omitted by default;
2. each is passed only when the user explicitly requests that exact kind of limit;
3. turn budgets are described as aborting after grace, and tool budgets as blocking tools, not as harmless effort bounds;
4. one limit is never substituted for another merely because a task is long, broad, expensive, or likely to sprawl;
5. review loops continue until clean/blocked unless the user sets a numeric round cap; repeated verified no-progress is a separate stop rule;
6. research retrieval stops when explicit evidence/success criteria are met or progress is demonstrably blocked; rename `retrieval budget` and do not invent numeric source/search caps;
7. wait examples omit `timeoutMs` unless the user requests a wait deadline.

### P1: remove hidden inherited-limit traps

Add an explicit per-launch `false`/`unlimited` override for timeout, turn, and tool budgets, or make inherited limits visible and overridable through a clearly named `limits` policy. A caller that did not request a limit must be able to run without editing an agent definition or global config.

### P1: remove or make explicit hidden hard caps

Evaluate these changes as separate runtime work, not prompt-only edits:

- make top-level `parallel.maxTasks` unlimited by default, retaining an explicit configured cap for hosts that need one;
- make `subagent_wait` and headless auto-drain unbounded by default or require an explicit parent deadline, while preserving user cancellation and status visibility;
- make verification timeout absent by default, with explicit timeout/configured safety policy for commands that may hang;
- make steering non-destructive by default: return `pending` on a missed acknowledgement and require an explicit recovery action/flag before interrupting a top-level single;
- make persisted scheduled jobs launch on the next available Pi process by default, or require an explicit caller/host lateness policy before marking them `missed`;
- replace fixed recovery/setup windows with explicit configuration or state-based waiting where possible.

### P2: keep safety bounds, but make them visible

Retain recursion depth, protocol line size, dynamic fanout bounds, concurrency, and scheduled-run admission capacity as safety/resource controls. Document that they are not quota budgets. For dynamic fanout, avoid guessing a low `maxItems`; inspect or materialize the source first, or provide an explicit caller-owned unbounded/large policy. Keep `failFast` false unless the caller says remaining siblings are no longer useful. Surface the `maxPending=20` schedule admission bound before creation and keep it host-configurable.

## Verification Plan

Any implementation should add focused regression coverage for:

1. omitted timeout/turn/tool fields do not appear in child prompts or runtime state;
2. model-facing descriptions explicitly say all three are opt-in and non-substitutable;
3. inherited limits can be disabled for one launch;
4. top-level tasks above the default cap either queue or require an explicit configured cap, according to the chosen policy;
5. wait and headless drain behavior beyond the old 30-minute default;
6. verify commands without a timeout are not killed by an implicit 120-second deadline;
7. `steer` missed acknowledgement returns pending without interrupt unless recovery was explicitly requested;
8. scheduled jobs beyond the old five-minute lateness window follow the explicit caller/host catch-up policy, while `maxPending` remains an admission check;
9. dynamic fanout and fail-fast safety behavior remain explicit and deterministic;
10. legacy compatibility and v1 execution/acceptance projections remain unchanged.

Focused baseline evidence: fresh parent verification ran `194 pass / 0 fail` across turn-budget, tool-budget, acceptance, wait/auto-drain, scheduled runs, dynamic fanout, steering, nested control/events/rendering, and v1 foreground/async acceptance integration.
