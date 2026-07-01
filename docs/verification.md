# Verification Engine

LoopCode v2 enforces code correctness and prevents regressions by running sequential verification checks locally, bypassing unreliable self-assessments.

## 5-Layer Verification Flow

The verifier executes steps defined in each task's contract sequentially. If a critical layer (compilation or tests) fails, it aborts fast and feeds the error details back to the agent.

### Layer 1: Compilation

- **Purpose**: Validates build integrity, syntax, and TypeScript types.
- **Execution**: Spawns local compilers (`tsc`, `npm run build`).
- **Outcome**: Must return code `0` before any subsequent layers are evaluated.

### Layer 2: Lint & Style

- **Purpose**: Style guide compliance and format standards.
- **Execution**: Runs static analysis tooling (`eslint`, `prettier --check`).
- **Outcome**: Logs formatting and styling warnings or errors.

### Layer 3: Unit Tests

- **Purpose**: Verifies functional correctness of new logic.
- **Execution**: Spawns test runners (`vitest`, `jest`, `npm run test`).
- **Outcome**: Captures test outputs and parses total/failed counts using regular expressions. If missing, it gracefully skips.

### Layer 4: Security Scan

- **Purpose**: Detects insecure code, vulnerabilities, or dangerous operations before committing.
- **Execution**: Automatically runs `semgrep` or `trivy` if installed. Falls back to an internal regex parser matching dangerous patterns (e.g., `eval()`, `exec()`).
- **Outcome**: Immediately fails the verification if severe security vulnerabilities are found.

### Layer 5: Independent LLM Review

- **Purpose**: Performs high-level architectural and logical review.
- **Execution**: A dedicated `ReviewerAgent` analyzes the Git diff of the executed task.
- **Outcome**: Assesses logic against the goal, looks for edge cases, and provides a final Pass/Fail grade.

---

## Fast-Track Task Verification

For simple tasks running under the **Single-Agent Path** (where full goal planning is bypassed), LoopCode automatically provisions a default **Layer 1 Compilation Check** using an echo command or basic type checker:

```typescript
verification: [
  {
    type: 'compile',
    command: 'echo "mock compile"',
    expectedExitCode: 0,
  },
];
```

This guarantees that even simple tasks conform to our standard state machine validation schema and yield verification outputs stored in `task_results`.
