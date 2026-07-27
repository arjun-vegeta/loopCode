# LoopCode

LoopCode is an autonomous software engineering orchestrator built on top of **OpenCode**. It acts as the planning, state machine, knowledge, and verification layer that guides OpenCode through executing complex, multi-task software goals.

> **Disclaimer:** This project is not affiliated with, sponsored by, or endorsed by the OpenCode/Anomaly team.

## Key Features

1. **Shared Memory Engine**: All multi-agent communication is centralized through a unified SQLite persistence layer (`SCHEMA_SQL` embedded source of truth). Agents pass structured contracts asynchronously without direct coupling.
2. **Semantic Knowledge & Code Graph**: Fast local semantic embeddings using `fastembed` and `sqlite-vec`. Incremental codebase indexing parses classes, functions, and variables via `tree-sitter`, augmented by an LSP client.
3. **Parallel Task Scheduling**: Decomposes natural language goals into a Directed Acyclic Graph (DAG) of tasks. The `GitWorktreeScheduler` performs topological sorting based on file `writeAllowlist` permissions and runs independent batches concurrently in isolated Git worktrees.
4. **5-Layer Verification Engine**: Validates task correctness via Compilation, Lint & Style, Unit Testing, Security Scanning (`semgrep`/`trivy` with regex fallbacks), and LLM Review Agent. Distinct `skipped` status reported when scripts are missing.
5. **Failure Evidence Re-planning**: If a task exhausts its execution retries, compilation errors, test failures, and reviewer notes are injected back into the Planner Agent to self-correct the task DAG.
6. **Cost & Budget Limits**: Enforces Monthly ➔ Goal ➔ Task spend caps. If breached, the system raises a notice (or opt-in gated rollback) and terminates with **exit code 77**.
7. **Loop/Oscillation Prevention**: Hashes state signatures (phase, task index, modified files, retry attempts) to detect infinite loops and prompts the user or event bus for resolution.
8. **Catalog-Aware Model Router**: Maps tasks to optimal models based on capability requirements, catalog availability, budget caps, and caching adjustments.

## CLI Usage

### Installation

**1. Standalone Binary Installer (Recommended)**

```bash
curl -fsSL https://raw.githubusercontent.com/arjun-vegeta/loopCode/main/install.sh | bash
```

**2. Local Development Build**

```bash
bun install
bun run build
bun run package   # Compiles standalone binary via bun build
```

### Running a Goal

Decompose a natural language goal, plan, execute, and verify:

```bash
bun run src/index.ts "Add a new endpoint for user profile retrieval"
```

### Command Options

- `-d, --db <path>`: Path to the SQLite database (default: `loopcode.db`).
- `-r, --resume <sessionIdOrTaskId>`: Session ID or Task ID to resume.
- `--login`: Start in-TUI provider authentication workflow.
- `--headless`: Run in non-interactive CI mode.

### Exit Codes

| Code  | Meaning                     |
| :---: | :-------------------------- |
|  `0`  | Goal completed successfully |
|  `1`  | Fatal error                 |
| `77`  | Budget limit exceeded       |
| `130` | Execution interrupted       |

## Configuration

LoopCode checks for overrides in `~/.loopcode/config.toml`:

```toml
[model]
default      = "anthropic/claude-sonnet-4-6"
planning     = "anthropic/claude-opus-4-6"
execution    = "anthropic/claude-sonnet-4-6"
verification = "anthropic/claude-sonnet-4-6"

[budget]
maxMonthlyCostUsd = 100.0
maxGoalCostUsd    = 10.0
maxTaskCostUsd    = 2.0

[proxy]
enabled        = false
kind           = "antigravity"
port           = 8080
autoStart      = true
providerId     = "antigravity"

[ui]
theme = "auto"
ascii = false

[safety]
permissionMode           = "acceptEdits"
allowDestructiveRollback = false
maxParallelAgents        = 5
```

## Running Verification & Tests

Run full verification suite (typecheck, lint, formatting, and unit tests):

```bash
bun run typecheck
bun run lint
bun run format:check
bun run test
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
