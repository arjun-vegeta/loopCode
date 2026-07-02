# State Machine & Persistence

The core execution logic of LoopCode is driven by a finite state machine, not a DAG. This allows loops and cycles (such as retries and re-planning) to be expressed naturally.

## State Transitions

The execution state transitions are driven by concrete evidence:

```
[PLANNING] ── plan generated ──> [EXECUTING] ── retry < MAX_RETRIES ──> [EXECUTING]
   ▲                                 │                                    ▲
   │                                 ▼                                    │
re-plan (retries exhausted) ◄── [VERIFYING] ────────── failed ────────────┘
                                     │
                                   passed
                                     │
                                     ▼
                                  [DONE]
```

### 1. PLANNING

- **Trigger**: New goal requested, or previous task retries are exhausted (requires re-planning).
- **Process**: The planner parses the goal and generates a list of Tasks.
- **Evidence to transition**: Valid task list written to DB.

### 2. EXECUTING

- **Trigger**: Tasks generated, or verification failed but retry is allowed.
- **Process**: The orchestrator triggers an OpenCode session to resolve the specific task.
- **Evidence to transition**: OpenCode prompt execution completes or times out.

### 3. VERIFYING

- **Trigger**: OpenCode task execution finishes.
- **Process**: Runs local verification steps defined in the task contract (compilation, testing, linting).
- **Evidence to transition**:
  - **Overall Pass**: If all tests pass, update state to `done` (or transition back to `executing` for the next task).
  - **Overall Fail (Retries Remaining)**: Back to `executing` on the current task, incrementing attempt count.
  - **Overall Fail (Retries Exhausted)**: Transition back to `planning` to regenerate remaining tasks based on the failure evidence.

---

## Retry Loops & Failure Feedback

When verification fails and retries are available, the orchestrator feeds previous compiler errors or test failure details directly into the prompt context for the next attempt. This prevents the LLM from making the same mistake repeatedly:

```typescript
// Failure feedback context is prepended to the task guidelines:
const failureEvidence = `
=== PREVIOUS ATTEMPT FAILED ===
Compiler output:
STDOUT: ${report.layers.compile?.stdout}
STDERR: ${report.layers.compile?.stderr}
===============================
`;
```

---

## SQLite Persistence & Crash Recovery

Every state transition is written to `loopcode.db` before it takes effect. If the CLI process is killed or crashes mid-task, you can resume execution from the last persisted state by running:

```bash
node dist/index.js --resume <task-uuid>
```

### Key Tables (`db/schema.sql`):

- `tasks`: Records goals, overall phase states (`planning`, `executing`, etc.), task arrays, and cumulative run cost.
- `state_log`: Chronological ledger of all state transitions and transition metadata.
- `task_results`: Saves the verification outputs, costs, and durations for each completed task.
