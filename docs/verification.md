# Verification Engine

LoopCode v2 enforces code correctness and prevents regressions by running sequential verification checks locally, bypassing unreliable self-assessments.

## 3-Layer Verification Flow

The verifier executes steps defined in each task's contract sequentially. If a critical layer (compilation or tests) fails, it aborts fast and feeds the error details back to the agent.

### Layer 1: Compilation

- **Purpose**: Validates build integrity, syntax, and TypeScript types.
- **Execution**: Spawns local compilers (`tsc`, `npm run build`).
- **Outcome**: Must return code `0` before any subsequent layers are evaluated.

### Layer 2: Unit Tests

- **Purpose**: Verifies functional correctness of new logic.
- **Execution**: Spawns test runners (`vitest`, `jest`).
- **Outcome**: Captures test outputs and parses total/failed counts using regular expressions.

### Layer 3: Lint & Style

- **Purpose**: Style guide compliance and format standards.
- **Execution**: Runs static analysis tooling (`eslint`, `prettier --check`).
- **Outcome**: Logs formatting and styling warnings or errors.

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
