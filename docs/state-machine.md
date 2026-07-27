# State Machine, Event Bus & Safety Policies

The core execution of LoopCode is managed by an event-driven state machine (`Orchestrator`) emitting typed events (`phase`, `plan`, `task-state`, `verification`, `cost`, `approval-request`, `escalation`, `notice`) over an `EventBus`.

```
[PLANNING] ── plan generated ──► [EXECUTING] ── retry < MAX_RETRIES ──► [EXECUTING]
   ▲                                 │                                    ▲
   │                                 ▼                                    │
re-plan (retries exhausted) ◄── [VERIFYING] ────────── failed ────────────┘
                                     │
                                   passed
                                     │
                                     ▼
                                  [DONE]
```

## State Transitions & Event Bus Integration

- **`updateState(taskId, state)`**: Emits `phase` event with phase detail and updates SQLite task record.
- **`handlePlanning`**: Emits `plan` event containing DAG task batches and replan flags.
- **`handleExecuting`**: Emits `task-state` (`running`, `passed`, `failed`) and `cost` events per task.
- **`handleVerifying`**: Emits `verification` events on every layer evaluation (`compile`, `lint`, `test`, `security`, `review`).

---

## Event-Driven Escalation & Safety Policies

### 1. Loop Oscillation Detection & Escalation

- `LoopDetector` constructs state signature hashes (`phase`, `taskIndex`, `filesChanged`, `retryAttempt`).
- If oscillation occurs, `Orchestrator` emits an `escalation` event with options (`continue`, `replan`, `abort`) and awaits a non-blocking promise (`resolveEscalation`).
- In headless CI environments (`--headless`), oscillation auto-aborts to prevent runaway execution.

### 2. Cost & Budget Limits

- `CostEngine` validates spend against `maxMonthlyCostUsd`, `maxGoalCostUsd`, and `maxTaskCostUsd`.
- Breaches throw `BudgetExceededError` (exit code `77`, message prefix `BUDGET_TERMINATION:`).
- Workspace rollback (`rollbackWorkspace`) honors `allowDestructiveRollback`: defaults to `false` (warning notice) and requires confirmation when enabled.

### 3. Trust Gate & Dangerous Path Restrictions

- **Trust Verification**: Requires confirmation for new directories; saves trusted paths to `~/.loopcode/trusted_dirs.json`.
- **Warning Locations**: `~/Desktop`, `~/Documents`, and `~/Downloads` trigger warning notices.
- **Refused Locations**: System root directories (`/`, `/usr`, `/System`) and user home root (`~/`) are strictly refused.
