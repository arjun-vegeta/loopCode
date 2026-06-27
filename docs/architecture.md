# LoopCode v1 Architecture Overview

LoopCode is a local-first autonomous software engineering orchestrator built on top of OpenCode. It does not replace OpenCode; rather, it drives OpenCode sessions by acting as the planning, state orchestration, and verification layer.

## 3-Layer Design

LoopCode runs in a 3-layer structure relative to your local computer and LLMs:

```
┌─────────────────────────────────────────────┐
│  LAYER 3: LOOPCODE V1 (TypeScript CLI)      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ State   │ │ Task    │ │ Verify  │        │
│  │ Machine │ │ Contract│ │ Engine  │        │
│  └─────────┘ └─────────┘ └─────────┘        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ SQLite  │ │ Static  │ │ Cost    │        │
│  │ Store   │ │ Router  │ │ Tracker │        │
│  └─────────┘ └─────────┘ └─────────┘        │
└─────────────────────────────────────────────┘
                      │
                      │ @opencode-ai/sdk
                      ▼
┌─────────────────────────────────────────────┐
│  LAYER 2: OPENCODE RUNTIME                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ Session │ │ Tool    │ │ Provider│        │
│  │ Manager │ │ Registry│ │ Router  │        │
│  └─────────┘ └─────────┘ └─────────┘        │
└─────────────────────────────────────────────┘
                      │
                      │ Local Process Spawning
                      ▼
┌─────────────────────────────────────────────┐
│  LAYER 1: USER ENVIRONMENT                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ File    │ │ Git     │ │ LLM     │        │
│  │ System  │ │ Repo    │ │ APIs    │        │
│  └─────────┘ └─────────┘ └─────────┘        │
└─────────────────────────────────────────────┘
```

- **Layer 1 (User Environment)**: The local file system, Git repository, and the LLM API keys provided by the user.
- **Layer 2 (OpenCode Runtime)**: Manages model integrations, runs specific tools (file editing, terminal commands, web search), and exposes an API surface.
- **Layer 3 (LoopCode)**: Decomposes natural language goals, coordinates execution task-by-task, runs local code checks (compile/test/lint), and tracks state.

## Module Boundaries

The project files are strictly structured as follows:

- **`index.ts`**: CLI Entry point. Handled via `commander`. Resolves setup configs, CLI flags, and coordinates start/resume actions.
- **`opencode.ts`**: Wrapper for `@opencode-ai/sdk`. Manages ephemeral server spawning, pre-flight check logic, execution timeouts, and session cancellations.
- **`orchestrator.ts`**: Core state machine. Moves the orchestrator loop through transitions (planning, executing, verifying, done, failed).
- **`planner.ts`**: Handles goal decomposition. Prompt-engineers task plans and enforces structured output via OpenCode's JSON Schema prompt configuration.
- **`task.ts`**: Task validation contract. Enforces structural properties of task declarations and logs sequential file-conflict warnings.
- **`verifier.ts`**: Run commands locally to check if a task met verification criteria (Layers 1, 2, and 3).
- **`router.ts`**: Handles static model routing based on explicit task categories.
- **`memory.ts`**: Interface for `better-sqlite3`. Instantiates tables using schema files, logs state transitions, and manages task outputs.
- **`cost.ts`**: Tracks execution pricing in USD.
- **`config.ts`**: TOML configuration parser.
- **`types.ts`**: Houses all shared data contracts.
