# State Machine, Sessions & Safety Policies

The core execution of LoopCode is managed by a state machine that handles planning, execution, verification, and failure feedback loop cascades, with real-time UI logging and session management.

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

## State Transitions & Actions

### 1. PLANNING

- **Action**: Classifier analyzes goal complexity. Bypasses to `single_agent` path if simple. Otherwise, `PlannerAgent` creates task DAG.
- **Transition Target**: `executing`.

### 2. EXECUTING

- **Action**: `DynamicRouter` resolves the optimal model. Pre-call budget is checked via `CostEngine.canSpend()`. Spawns sandboxed `GitWorktreeScheduler` execution.
- **Transition Target**: `verifying`.

### 3. VERIFYING

- **Action**: Executes local checks (compilation, unit testing, linting).
- **Decisions**:
  - _Pass_: Proceed to next task or transition to `done`.
  - _Fail (Retries Left)_: Increment retry attempt and transition back to `executing` with failure evidence injected.
  - _Fail (Retries Exhausted)_: Transition back to `planning` to re-plan the remaining steps.

---

## Safety Engines & Policies

### 1. Loop Oscillation Detection

Before executing a state transition, the `LoopDetector` constructs a SHA-256 signature hash of the current orchestrator state:

```typescript
const sig = {
  phase: taskRecord.state,
  taskIndex: taskRecord.current_task_index,
  filesChanged: [...files],
  retryAttempt: attempts,
};
```

If an identical state signature is encountered twice (indicating no progress is being made), the execution is paused. LoopCode will present an interactive terminal prompt asking the user for manual guidance. If provided, the guidance is appended to the replan request; otherwise, the execution aborts to prevent runaway LLM costs.

### 2. Budget Enforcement

Before spawning any model execution, the `CostEngine` validates estimated costs against limits in `config.toml`. If a breach is detected:

1. The `GitWorktreeScheduler` runs `git reset --hard` to rollback all uncommitted changes.
2. It terminates the CLI session with a custom **exit code 77**.

```typescript
process.exit(77);
```

### 3. First-Run Trust Verification & Dangerous Paths

To protect the host operating system from catastrophic commands (e.g. `rm -rf /`):

1. **Trust Verification**: Spawns a select prompt on the first run in any directory, caching approved paths in `~/.loopcode/trusted_dirs.json`.
2. **Dangerous Directory block**: Explicitly blocks execution if the current directory is a system root path (e.g. `/`, `/usr`, `/System`) or the parent home directory (`~/` directly).

### 4. SQLite Persistence & Session Management

Every transition and session is saved to `loopcode.db`.

- **Session Picking**: Use `Ctrl+S` or `/resume <session-id>` to switch to, pause, rename, or delete past session tasks.
- **Storage Indexes**: Migration indexes `idx_sessions_status`, `idx_sessions_name`, and `idx_sessions_activity` prevent latency bottlenecks on databases with thousands of logs.
