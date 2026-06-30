# Goal Classification, Planning & Routing

LoopCode coordinates execution through goal classification, structured plans, and dynamic cascading model routing rules.

## Smart Classification

Before planning, the goal is classified using the `Classifier` engine:

- **Tier 1: Rule-based fast regex filter** (e.g. documentation updates, version updates, single variable renames).
- **Tier 2: Complexity heuristics** (number of files affected, keywords like `optimize` or `refactor`).
- **Paths**:
  - **Single-Agent Path**: Bypasses full planning and spawns a single agent session.
  - **Full-Loop Path**: Performs full multi-agent code graph planning, execution, and verification.

---

## Structured Goal Planning

For full-loop goals, the `PlannerAgent` decomposes the goal into a Directed Acyclic Graph (DAG) of task contracts. The tasks match the TS `Task` interface:

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
  model?: string; // Optional static override
}
```

---

## Dynamic Cascading Model Router

Instead of static routes, the `DynamicRouter` evaluates the optimal 2026 model based on four cascading tiers:

| Tier       | Rule Type             | Action                                                                                                                                         |
| ---------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tier 1** | Task Category         | Routes `refactor` and `security` to high-reasoning frontier models (`claude-4.8-opus`), and `docs`/`test` to fast models (`gemini-3.5-flash`). |
| **Tier 2** | Complexity Classifier | Overrides model selections to stronger models if code change spans multiple modules.                                                           |
| **Tier 3** | Budget Cap            | Downgrades selected models to cheaper alternatives if current goal spend is approaching the limit.                                             |
| **Tier 4** | Cache Awareness       | Adjusts routing to benefit from prompt-caching models when the input context remains stable.                                                   |

### Supported 2026 Portfolio

- **Frontier / Strong**: `claude-4.8-opus`, `claude-5-sonnet`
- **Efficient / Budget**: `gemini-3.5-flash`, `deepseek-v4-pro`
