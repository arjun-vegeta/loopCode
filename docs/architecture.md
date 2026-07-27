# LoopCode Architecture Overview

LoopCode is a local-first autonomous software engineering orchestrator built on top of OpenCode. It drives OpenCode sessions by acting as the event-driven planning, state orchestration, knowledge, and verification layer.

## 3-Layer Design

```
┌──────────────────────────────────────────────┐
│  LAYER 3: LOOPCODE (TypeScript TUI & Engine) │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐       │
│  │ Controller│ │EventBus  │ │ Verify  │       │
│  │ Engine   │ │ Pub/Sub  │ │ Engine  │       │
│  └──────────┘ └──────────┘ └─────────┘       │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐       │
│  │ Embedded │ │ Dynamic  │ │ Cost &  │       │
│  │ SQLite   │ │ Router   │ │ Budget  │       │
│  └──────────┘ └──────────┘ └─────────┘       │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐       │
│  │ Context  │ │ Worktree │ │ Loop    │       │
│  │ Engine   │ │ Sched.   │ │ Detector│       │
│  └──────────┘ └──────────┘ └─────────┘       │
│  ┌────────────────────────────────────────┐ │
│  │  Inline Transcript-First TUI (Ink)     │ │
│  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
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

## Module Boundaries

- **`src/app/`**: Event-driven application architecture.
  - `session-controller-impl.ts`: Main controller contract managing OpenCode client, auth service, proxy, orchestrator, and event subscription snapshot.
  - `events.ts`: Strongly typed `EventBus` pub/sub with central secret redaction (`scrub`).
  - `logger.ts`: Rotating file logger (`~/.loopcode/logs/loopcode.log`).
  - `redact.ts`: Redaction rules masking API keys, JWTs, and credential assignments.
- **`src/auth/`**: Provider authentication and catalog management.
  - `provider-catalog.ts`: Provider discovery, model capabilities, and connection status.
  - `auth-service.ts`: API key validation and OAuth authorization.
  - `oauth-listener.ts`: Loopback server (`127.0.0.1`) capturing OAuth code redirects safely.
  - `web-onboard.ts`: Token-gated loopback onboarding page enforcing CSP headers.
- **`src/proxy/`**: Local proxy integration for Antigravity models.
  - `antigravity.ts`: Daemon process management (`start`/`stop`/`health`).
  - `consent.ts`: Opt-in risk acceptance tracking.
  - `registration.ts`: Registration of local proxy endpoint with OpenCode configuration.
- **`src/config/`**: Canonical Zod configuration schema, store, and migration.
  - `schema.ts`: Schema definition for `[model]`, `[budget]`, `[proxy]`, `[ui]`, `[safety]`.
  - `store.ts`: Atomic persistence to `~/.loopcode/config.toml` (mode `0600`).
- **`src/db/`**: Embedded database DDL.
  - `schema.ts`: Embedded `SCHEMA_SQL` string source of truth.
- **`src/platform/`**: Cross-platform path resolution, environment detection, and package manager resolution.
- **`src/orchestrator.ts`**: Core state machine emitting events (`phase`, `plan`, `task-state`, `verification`, `cost`, `approval-request`, `escalation`, `notice`).
- **`src/cost/engine.ts`**: Cost tracking throwing `BudgetExceededError` (exit code `77`).
- **`src/scheduler/worktree.ts`**: Parallel batch execution in isolated Git worktrees using safe spawn arguments and path containment checks.
- **`src/agents/`**: Planner, Researcher, Engineer, Reviewer, and Verifier agents operating against shared memory.
- **`src/cli/`**: Ink TUI implementation: inline transcript, LiveStatus, multiline Composer, CommandPalette, and modal overlays.
