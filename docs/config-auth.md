# Configuration, Auth, & CLI Reference

LoopCode exposes a simple command-line interface and configuration model.

## Configuration File (`~/.loopcode/config.toml`)

You can override default model settings by creating a configuration file at `~/.loopcode/config.toml`. It is parsed at startup using `smol-toml`:

```toml
[model]
# Default fallback model for tasks
default = "anthropic/claude-5-sonnet"

# Model used to decompose goals in PLANNING state
planning = "anthropic/claude-4.8-opus"

# Model used during task executions and verifications
verification = "anthropic/claude-5-sonnet"

[budgets]
# Hard limits on USD spend
monthly = 100.0
goal = 10.0
task = 2.0
```

---

## Provider & Key Management (BYOK)

LoopCode strictly adheres to the "Bring Your Own Key" (BYOK) principle and never proxies LLM requests through external servers.

- **Autodetect**: By default, LoopCode picks up your keys and setups from `~/.opencode/opencode.json` automatically when starting.
- **Manual CLI Auth**: If you prefer, LoopCode will offer a CLI mechanism that explicitly sets provider keys on OpenCode's client using `client.auth.set()` under the hood:
  ```typescript
  await client.auth.set({
    path: { id: 'anthropic' },
    body: { type: 'api', key: 'your-api-key' },
  });
  ```

---

## CLI Reference

Run LoopCode using standard node execution or compiled packages:

### Commands

```bash
node dist/index.js [goal] [options]
```

### Options

- `[goal]`: The natural language instruction you want LoopCode to complete.
- `-r, --resume <taskId>`: Attempts to reload and resume an in-progress task matching the given SQLite UUID.
- `-d, --db <path>`: Specifies a custom path to the SQLite log database (defaults to `loopcode.db`).

### Exit Codes

- `0`: Goal completed successfully (all tasks in the plan passed verification).
- `1`: Goal failed (fatal error, plan validation fail, or max task retries exceeded).
- `77`: Budget exceeded (CostEngine limit breached, execution aborted).
