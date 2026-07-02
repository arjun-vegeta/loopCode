# LoopCode

LoopCode is an autonomous software engineering orchestrator built on top of **OpenCode**. It acts as the planning, state machine, knowledge, and verification layer that guides OpenCode through executing complex, multi-task software goals.

> **Disclaimer:** This project is not affiliated with, sponsored by, or endorsed by the OpenCode/Anomaly team.

## Key Features

1. **Shared Memory Engine**: All multi-agent communication is centralized through a unified SQLite persistence layer. Agents (Planner, Engineer, Reviewer, Verifier) pass structured contracts (Task Plans, Executions, Reviews) asynchronously without direct coupling.
2. **Semantic Knowledge & Code Graph**: Fast local semantic embeddings using `fastembed` and `sqlite-vec`. Incremental codebase indexing parses classes, functions, and variables via `tree-sitter`, augmented by a JSON-RPC Language Server Protocol (LSP) client.
3. **Parallel Task Scheduling**: Decomposes natural language goals into a Directed Acyclic Graph (DAG) of tasks. The `GitWorktreeScheduler` performs a topological sort based on file `writeAllowlist` permissions and runs independent batches concurrently in isolated Git worktrees.
4. **5-Layer Verification Engine**: Validates task correctness via:
   - _Layer 1_: Compilation (Syntax/Type Checks)
   - _Layer 2_: Lint & Style validation
   - _Layer 3_: Unit Testing (e.g. Jest, bun:test)
   - _Layer 4_: Security Scanning (`semgrep`/`trivy` with regex fallbacks)
   - _Layer 5_: Independent LLM Review Agent
5. **Failure Evidence Re-planning**: If a task exhausts its execution retries, compilation errors, test failures, and reviewer notes are injected directly back into the Planner Agent to self-correct the task DAG.
6. **Cost & Budget Limits**: Enforces Monthly ➔ Goal ➔ Task spend caps. If breached, the system executes a `git reset --hard` to rollback changes and terminates with **exit code 77**.
7. **Loop/Oscillation Prevention**: Hashes state signatures (phase, task index, modified files, and retry attempts) to detect infinite loops. Pauses execution and prompts the user for manual guidance if oscillation occurs.
8. **Dynamic Cascading Model Router**: Maps tasks to optimal models (e.g., Claude Opus, Sonnet, Gemini Flash, DeepSeek Pro) based on task complexity overrides, budget caps, and caching adjustments.

## CLI Usage

### Installation

You can install LoopCode globally using the standard installer, the npm global package fallback, or build it locally.

**1. Standalone Binary Installer (Recommended)**

```bash
curl -fsSL https://raw.githubusercontent.com/arjun-vegeta/loopCode/main/install.sh | bash
```

**2. Global NPM Fallback (For environments without curl/bash access)**

```bash
npm install -g loopcode
```

**3. Local Development Build**

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

### Resuming a Task

If a task execution was interrupted (e.g., by a system crash or intentional pause), resume it by passing the task ID:

```bash
bun run src/index.ts --resume "<task-uuid>"
```

### Command Options

- `-d, --db <path>`: Path to the SQLite database (default: `loopcode.db`).
- `-r, --resume <taskId>`: UUID of the task to resume.

## Configuration

LoopCode checks for overrides in `~/.loopcode/config.toml`:

```toml
[model]
default = "anthropic/claude-5-sonnet"
planning = "anthropic/claude-4.8-opus"
verification = "anthropic/claude-5-sonnet"

[budgets]
# Hard limits on USD spend
monthly = 100.0
goal = 10.0
task = 2.0
```

## Running Tests

Run all unit and integration test suites:

```bash
bun run test
```

For linting and styling check:

```bash
bun run lint
bun run format
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
