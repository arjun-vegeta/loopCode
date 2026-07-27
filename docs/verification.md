# Verification Engine & Interactive Approvals

LoopCode enforces code correctness by running sequential verification checks locally and providing interactive approval controls.

## 5-Layer Verification Flow

The verifier executes steps defined in each task's contract sequentially. If a critical layer fails, execution halts and failure evidence is fed back to the Planner Agent for DAG self-correction.

### Layer 1: Compilation

- **Purpose**: Validates build integrity, syntax, and TypeScript types.
- **Execution**: Spawns resolved build commands (`resolveProjectCommands`) without shell interpolation.
- **Outcome**: Returns `passed`, `failed`, or `skipped` (if no build script exists).

### Layer 2: Lint & Style

- **Purpose**: Style guide compliance and format standards.
- **Execution**: Runs static analysis tooling (`eslint`, `prettier --check`).
- **Outcome**: Reports `passed`, `failed`, or `skipped`.

### Layer 3: Unit Tests

- **Purpose**: Verifies functional correctness of logic.
- **Execution**: Spawns detected test runners (`bun test`, `jest`, `npm run test`).
- **Outcome**: Captures test outputs and parses pass/fail counts. Reports `skipped` when test scripts are absent or in test environments.

### Layer 4: Security Scan

- **Purpose**: Detects insecure code patterns before committing.
- **Execution**: Runs `semgrep` or `trivy` if available, falling back to regex scanners.
- **Outcome**: Reports `passed`, `failed`, or `skipped`.

### Layer 5: Independent LLM Review

- **Purpose**: Performs high-level architectural and logical review.
- **Execution**: A dedicated `ReviewerAgent` analyzes the Git diff.
- **Outcome**: Assesses logic against goals, extracts conventions/lessons into project memory.

---

## Package Manager Command Detection (`src/platform/package-manager.ts`)

LoopCode detects project package managers (`bun`, `pnpm`, `yarn`, `npm`) based on lockfiles (`bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`) or `package.json` declaration:

- `resolveProjectCommands(cwd)` returns concrete argv arrays (e.g. `['bun', 'run', 'test']`).
- Eliminates shell interpolation vulnerabilities and eliminates hardcoded `npm` calls.

---

## Interactive Approvals & Permission Modes

- **`auto`**: Auto-approves non-destructive commands; destructive commands (`rm`, `git reset --hard`, `git push --force`) require explicit approval.
- **`acceptEdits`**: Auto-approves file edits; shell commands require approval.
- **`plan`**: Requires explicit human approval for both file edits and shell commands.
- **Headless Mode (`--headless`)**: Auto-approves non-destructive operations and auto-declines destructive operations, marking the task failed.
