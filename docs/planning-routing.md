# Goal Classification, Planning & Routing

LoopCode coordinates execution through goal classification, structured DAG planning, and catalog-driven dynamic model routing.

## Smart Classification

Before planning, the goal is classified using the `Classifier` engine:

- **Tier 1: Rule-based fast regex filter**: Identifies simple goals (documentation updates, version updates, single variable renames).
- **Tier 2: Complexity heuristics**: Evaluates file count and keyword complexity (`refactor`, `optimize`, `security`).
- **Paths**:
  - **Single-Agent Path**: Fast-tracks execution through a single engineer agent session.
  - **Full-Loop Path**: Performs full multi-agent DAG planning, execution, and verification.

---

## Structured Goal Planning

For full-loop goals, `PlannerAgent` decomposes the goal into a Directed Acyclic Graph (DAG) of task nodes.

### Topological Sorting & Batch Execution

Tasks are grouped into non-conflicting batches using `GitWorktreeScheduler.topologicalSort()`. Tasks without overlapping `writeAllowlist` paths execute concurrently in isolated Git worktrees (`.loopcode/worktrees/`).

### Failure Evidence Injection

When a task exhausts retries during verification, the orchestrator logs state transitions back to `planning`. The aggregated failure evidence (compilation errors, test failures, reviewer comments) is injected into `PlannerAgent` to generate an updated plan.

---

## Catalog-Driven Dynamic Model Router (`src/router/dynamic.ts`)

The `DynamicRouter` resolves models dynamically based on user catalog capabilities (`setCatalog`):

1. **Role & Task Category**: Maps planning/review tasks to frontier reasoning models (`claude-opus-4-6`) and execution/quickFix tasks to balanced/fast models (`claude-sonnet-4-6`, `gemini-3-flash`).
2. **Complexity Escalation**: Escalates simple tasks to frontier models if multi-file dependencies are detected.
3. **Budget Cap Downgrade**: Automatically falls back to cheaper models when goal spend approaches configured budget limits.
4. **Prompt Cache Discounting**: Applies cost discounts for prompt-caching supported providers.
