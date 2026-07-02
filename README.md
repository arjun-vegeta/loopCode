# LoopCode v1

LoopCode v1 is an autonomous CLI orchestrator that drives **OpenCode** sessions to implement software engineering goals. LoopCode is not a coding agent itself—OpenCode is the runtime coding agent. LoopCode acts as the planner, state machine, and verifier that guides OpenCode through executing complex, multi-task goals.

> **Disclaimer:** This project is not affiliated with, sponsored by, or endorsed by the OpenCode/Anomaly team.

## Key Features

1. **Local-First & Ephemeral**: Runs entirely on your local machine using an ephemeral local OpenCode server instance.
2. **Sequential Execution**: Avoids parallel git merge conflicts by executing tasks one at a time.
3. **Robust State Machine**: Preserves all progress and logs state transitions in SQLite. If LoopCode crashes or is killed, it can resume from the last known state.
4. **3-Layer Verification**: Checks outputs using local tools (compilation, unit testing, and linting) rather than relying on LLM self-assessment.
5. **Category-Based Model Routing**: Dynamically maps task goals to the most cost-effective model based on structured task categories.
6. **Hard Timeouts**: Automatically aborts runaway tasks using strict timeouts.

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
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
