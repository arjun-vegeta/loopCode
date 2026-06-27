# Planning, Task Contracts, & Routing

LoopCode coordinates execution through structured plans, validation, and static model routing rules.

## Structured Goal Planning

Goal decomposition is performed by querying a strong model via OpenCode and requesting a strictly-typed JSON schema using OpenCode's structured output parser.

### Prompt Strategy
The planner prompt provides overall constraints and requests a list of sequential tasks matching our schema. We define a JSON schema matching the following TS `Task` interface:

```typescript
export interface Task {
  id: string;
  description: string;
  goal: string;
  category: 'test' | 'docs' | 'security' | 'refactor' | 'feature' | 'fix' | 'other';
  systemPrompt: string;
  expectedOutputs: string[];
  writeAllowlist: string[];
  verification: VerificationStep[];
  maxCost: number;
  timeout: number;
  model?: string; // Optional override
}
```

---

## Plan Validation & Write Allowlists

Before executing the generated task plan, the orchestrator validates it using `validatePlan`:
- **Timeout and Budget Bounds**: Standard default fallbacks are applied if values are invalid.
- **Write Conflict Analysis**: Checks if multiple sequential tasks write to the same file.

### Sequential Tolerance (Step 2.1 Fix)
Unlike parallel multi-agent platforms, LoopCode v1 runs tasks strictly sequentially. This means that two tasks writing to the same file does not cause a merge conflict; rather, it is a valid incremental change (e.g. task 1 creates a file, task 2 imports code into it).
- **Behavior**: `validatePlan` logs a non-blocking warning informing you of sequential same-file edits, but does **not** reject the plan.

---

## Category-Based Routing (Step 2.3 Fix)

Instead of fragile free-text keyword matching (like searching for substrings in a task's description), the planner outputs a structured `category` field. LoopCode routes tasks to models based on these categories:

| Category | Routed Model | Rationale |
|---|---|---|
| `test`, `docs` | `claude-5-sonnet` | Fast, cost-efficient, standard reasoning. |
| `security`, `refactor` | `claude-4.8-opus` | High reasoning strength, conservative logic. |
| `feature`, `fix` | `claude-5-sonnet` / `claude-4.8-opus` | Routes to Opus if `expectedOutputs.length > 2` (complex changes), otherwise Sonnet. |
| Other | Default config model | Configurable. |
