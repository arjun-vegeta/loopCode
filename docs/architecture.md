# LoopCode v2 Architecture Overview

LoopCode is a local-first autonomous software engineering orchestrator built on top of OpenCode. It does not replace OpenCode; rather, it drives OpenCode sessions by acting as the planning, state orchestration, and verification layer.

## 3-Layer Design

LoopCode runs in a 3-layer structure relative to your local computer and LLMs:

```
┌─────────────────────────────────────────────┐
│  LAYER 3: LOOPCODE V2 (TypeScript CLI)      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ State   │ │ Classifier│ │ Verify  │        │
│  │ Machine │ │ Engine  │ │ Engine  │        │
│  └─────────┘ └─────────┘ └─────────┘        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ SQLite  │ │ Dynamic │ │ Cost &  │        │
│  │ Store   │ │ Router  │ │ Budget  │        │
│  └─────────┘ └─────────┘ └─────────┘        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ Context │ │ Worktree│ │ Loop    │        │
│  │ Compres.│ │ Sched.  │ │ Detector│        │
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
- **Layer 3 (LoopCode v2)**: Decomposes natural language goals, coordinates execution task-by-task, runs local code checks (compile/test/lint), and tracks state with advanced safety and cost bounds.

## Module Boundaries

The project files are structured as follows:

- **`src/index.ts`**: CLI Entry point. Handled via `commander`. Resolves configuration files, flags, and coordinates start/resume actions.
- **`src/opencode.ts`**: Wrapper for `@opencode-ai/sdk`. Manages ephemeral server spawning, checks, execution timeouts, and session cancellations.
- **`src/orchestrator.ts`**: Core state machine. Directs transitions (planning, executing, verifying, done, failed) using V2 safety engines.
- **`src/classifier.ts`**: Fast regex and heuristic analyzer dividing simple tasks (Single-Agent path) from complex ones (Full-Loop path).
- **`src/router/dynamic.ts`**: Dynamic model routing using latency, input/output complexity, and budget limits.
- **`src/router/portfolio.ts`**: Portfolio constants for 2026 models (Claude Fable, Gemini 3.5, Opus 4.8).
- **`src/cost/engine.ts`**: Enforces spend bounds and terminates the process with **exit code 77** on breach.
- **`src/safety/loop.ts`**: State signature-based infinite loop and oscillation detector.
- **`src/context/engine.ts`**: Whitespace/comment code compressor and hierarchical summarizer.
- **`src/scheduler/worktree.ts`**: Git worktree manager for sandboxing, topological scheduler, and merge conflict checks.
- **`src/memory/engine.ts`**: SQLite memory manager storing logs, cache entries, and performance records.
- **`src/agents/`**: Planner, Researcher, Engineer, Reviewer, and Verifier roles.
- **`src/verifier.ts`**: Runs commands locally to verify tasks (Layers 1, 2, and 3).
