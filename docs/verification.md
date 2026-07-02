# Verification Engine

LoopCode enforces task success through local project tools, avoiding costly and unreliable LLM self-assessments.

## 3-Layer Verification Flow

Verification steps are run sequentially after each task execution. If a critical layer fails (compilation or tests), the verifier immediately halts and reports the failure without executing later steps.

### Layer 1: Compilation

- **Purpose**: Type checking, syntax validation, build integrity.
- **Execution**: Runs compiler checks (e.g. `tsc`, `cargo check`).
- **Cost**: $0 (runs locally).
- **Behavior**: Must pass before testing or formatting is checked.

### Layer 2: Unit Tests

- **Purpose**: Verifies that the task's logic changes are functionally correct.
- **Execution**: Runs test runners (e.g. `jest`, `vitest`, `pytest`).
- **Cost**: $0 (runs locally).
- **Behavior**: Parses test counts (total and failed tests) using regex mappings on terminal outputs.

### Layer 3: Lint & Format

- **Purpose**: Code style adherence, formatting rules, linting checks.
- **Execution**: Runs linters (e.g. `eslint`, `prettier`, `clippy`).
- **Cost**: $0 (runs locally).
- **Behavior**: Ensures formatting is clean before marking the task complete.

---

## Command Execution Safety

Verification commands are executed as shell processes via Node's `child_process.spawn`.

- **Standard Output Capture**: Stdout and Stderr are buffered, logged to the SQLite results ledger, and used as failure feedback context for subsequent retry attempts.
- **Exit Code Constraints**: Commands are marked as "passed" only if their exit code matches the task contract's `expectedExitCode` (typically `0`).
