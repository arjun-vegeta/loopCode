# LoopCode v2

LoopCode v2 is an autonomous software engineering orchestrator built on top of **OpenCode**. LoopCode acts as the planning, state machine, and verification layer that guides OpenCode through executing complex, multi-task software goals.

> **Disclaimer:** This project is not affiliated with, sponsored by, or endorsed by the OpenCode/Anomaly team.

## Key Features in v2

1. **Smart Goal Classification**: Bypasses full planning overhead for simple changes (e.g. typos, simple doc edits) by fast-tracking them to a Single-Agent path, saving significant token costs.
2. **Git Worktree Scheduling**: Spawns sandboxed environments in `.loopcode/worktrees/task-{id}` allowing multi-agent tasks to run concurrently without local file corruption or merge conflicts.
3. **Dynamic Cascading Model Router**: Maps tasks to the optimal 2026 models (Claude Fable, Gemini 3.5, Opus 4.8) based on complexity overrides, budget caps, and cache-hit adjustments.
4. **Hierarchical Context Compression**: Automatically removes whitespace and JS/TS comments (Level 1 summarization) to minimize token consumption on large files.
5. **Cost & Budget Limits**: Enforces Monthly ➔ Goal ➔ Task spend caps, logs detailed usage, and terminates the orchestrator with **exit code 77** if limits are breached.
6. **Loop/Oscillation Prevention**: Hashes state signatures (phase, task index, modified files, and retry attempts) to detect and abort infinite loops.

## CLI Usage

### Installation

```bash
npm install
npm run build
```

### Running a Goal

Decompose a natural language goal, plan, execute, and verify:

```bash
node dist/index.js "Add a new endpoint for user profile retrieval"
```

### Resuming a Task

If a task execution was interrupted, resume it by passing the task ID:

```bash
node dist/index.js --resume "<task-uuid>"
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

[budget]
maxCostUsd = 10.0
maxTokens = 50000
```

## Running Tests

Run all unit and integration test suites:

```bash
npm run test
```

For linting and styling check:

```bash
npm run lint
npm run format:check
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
