# Verification Engine & Interactive Approvals

LoopCode enforces code correctness and prevents regressions by running sequential verification checks locally and providing manual interactive override triggers.

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

## Interactive Approvals & Editor Integrations

In addition to static verification layers, LoopCode provides human-in-the-loop approvals before operations are executed:

### Shell Command Approvals

When running in `plan` or `acceptEdits` mode, shell commands require approval:

- **Destructive Commands Rule**: Commands containing destructive keys (e.g., `rm `, `rmdir`, `mkfs`, `dd `, `git push --force`, `git reset --hard`, `git clean -fd`) **ALWAYS** require confirmation, bypassing `auto` mode settings.
- **Acceptance Choices**: Options include `Yes, run this time`, `Yes, always allow this command in this session`, and `No, skip`.

### File Edit Preview & $EDITOR Integration

In `plan` mode, proposed code edits display a colorized git diff. Users can choose to:

1. **Accept the edit**
2. **Reject the edit**
3. **[E] Edit in $EDITOR**: Launches the terminal editor of choice (e.g., `nano`, `vim`, `emacs` configured via `$EDITOR`) directly on the target file, letting the developer manually tweak changes before making a final acceptance decision.

---

## IDE Terminal Screen-glitch fixes

Under the `/terminal-setup` command, LoopCode writes configuration file overrides to the target editor (VS Code, Cursor). This routine sets `"terminal.integrated.gpuAcceleration": "off"`. This turns off GPU acceleration in the integrated terminal emulator, eliminating screen rendering artifacts or character overlaps common to complex Ink/react terminal interfaces.
