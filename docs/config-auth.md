# Configuration, Auth, CLI & Packaging Reference

LoopCode exposes a simple command-line interface, canonical configuration model, and standalone executable bundle.

## Configuration File (`~/.loopcode/config.toml`)

Override default settings by creating a configuration file at `~/.loopcode/config.toml`. It is parsed using `smol-toml` and validated via Zod:

```toml
[model]
default      = "anthropic/claude-sonnet-4-6"
planning     = "anthropic/claude-opus-4-6"
execution    = "anthropic/claude-sonnet-4-6"
verification = "anthropic/claude-sonnet-4-6"

[budget]
maxMonthlyCostUsd = 100.0
maxGoalCostUsd    = 10.0
maxTaskCostUsd    = 2.0

[proxy]
enabled        = false
kind           = "antigravity"
port           = 8080
autoStart      = true
providerId     = "antigravity"

[ui]
theme = "auto"
ascii = false

[safety]
permissionMode           = "acceptEdits"
allowDestructiveRollback = false
maxParallelAgents        = 5
```

---

## In-TUI Authentication & Provider Onboarding

LoopCode supports complete provider authentication directly inside the TUI without requiring external commands:

1. **API Key Entry**: Direct in-TUI input with masked display (`maskKey`). API keys are set via `client.auth.set()` and cleared from memory immediately upon submit.
2. **OAuth Flow**:
   - `auto`: Browser authorization with automated loopback code capture (`startLoopbackListener`).
   - `code`: Copy-paste auth code input for headless or manual setups.
3. **Web Onboarding Loopback Page**:
   - Spawns a token-gated loopback page (`startWebOnboarding`) on `http://127.0.0.1:<port>/<token>/`.
   - Single-use, 10-minute TTL, enforcing strict Content Security Policy (`default-src 'none'`).

---

## CLI Reference

Run LoopCode using Bun natively or compiled packages:

```bash
bun run src/index.ts [goal] [options]
```

### Options

- `[goal]`: The natural language instruction you want LoopCode to complete.
- `-r, --resume <sessionIdOrTaskId>`: Reloads and resumes an in-progress session or task matching the given SQLite UUID.
- `-d, --db <path>`: Path to the SQLite log database (default: `loopcode.db`).
- `--login`: Opens the interactive provider onboarding wizard.
- `--headless`: Runs in non-interactive CI automation mode.

### Exit Codes

| Code  | Meaning           | Description                                             |
| :---: | :---------------- | :------------------------------------------------------ |
|  `0`  | `OK`              | Goal completed successfully (all plan tasks verified).  |
|  `1`  | `ERROR`           | Fatal error, unhandled exception, or execution failure. |
| `77`  | `BUDGET_EXCEEDED` | Spend cap breached; execution terminated.               |
| `130` | `INTERRUPTED`     | Execution interrupted via `Esc` or SIGINT (`Ctrl+C`).   |

---

## Standalone Binary Packaging

Generate a self-contained executable `./loopcode` containing the Bun runtime:

```bash
bun run package
```

This transpiles TypeScript files and compiles a single binary executable using `bun build --compile`, linking native C/C++ extensions (`sqlite-vec`, `tree-sitter`) externally.
