# LoopCode CLI Features & User Guide

LoopCode introduces a premium, interactive Hybrid Terminal User Interface (TUI) built with Ink v6, Clack, and Commander, providing full visual feedback, session orchestration, granular security controls, and standalone binary packaging.

---

## 1. The Visual Dashboard TUI

When executing a goal, LoopCode launches a fullscreen, responsive terminal dashboard featuring:

1. **Phase Pipeline Indicator**: A visual stepper displaying `[PLANNING] ──► [EXECUTING] ──► [VERIFYING] ──► [DONE]` with icons (`○`, `▶`, `✓`).
2. **Active Task Cards**: Dynamic cards showing:
   - Current task title and target LLM model.
   - Execution status with retrying indicator (`↻`).
   - Visual progress bars detailing task step completion.
   - Task-specific cost meters with color warnings (Green under 50% budget, Yellow over 50%, Red over 80%, Flashing inverse Red when exceeded).
3. **5-Layer Verification Log**: A live table highlighting the pass/fail state, runtime, and cost of compilation, linting, unit testing, security scanning, and code review checks.
4. **Interactive Multiline Input**: Prompts matching current permission modes (`[auto-accept]`, `[confirm-cmds]`, or `[confirm-all]`) supporting multiple lines of input via `Shift+Enter` or `Ctrl+J`.
5. **Toast Notifications**: Non-blocking popups reporting background status changes.

---

## 2. Keyboard Navigation & Shortcuts

LoopCode utilizes global hotkeys to steer execution:

- **`Shift+Tab`**: Cycle global permission modes (`auto` ➔ `acceptEdits` ➔ `plan`).
- **`Ctrl+S`**: Open the interactive **Session Picker**.
- **`Ctrl+M`**: Open the interactive **Model Picker** to update overrides in `~/.loopcode/config.toml`.
- **`Ctrl+R`**: Activate **Reverse History Search** matching previous input prompts.
- **`Up/Down Arrows`**: Navigate input history.
- **`Ctrl+C` or `Ctrl+D`**: Cleanly terminate execution.

---

## 3. Session Management

All task sessions are persisted locally in SQLite. The interactive session picker (`Ctrl+S`) or slash commands support:

- **`/pause`**: Pause the current session.
- **`/rename <name>`**: Rename a session (or `Ctrl+R` in the picker).
- **`/delete`**: Delete a session (or `Ctrl+D` in the picker).
- **`/status`**: Print a detailed status summary.
- **`/compact`**: Compress SQLite logs.
- **`/clear`**: Clear terminal logs.
- **`/diff`**: Display a git diff of the current session changes.
- **`/undo`**: Rollback the last executed task.

The database indexes `idx_sessions_status`, `idx_sessions_name`, and `idx_sessions_activity` guarantee fast query execution.

---

## 4. Trust & Security Prompts

### First-Run Directory Trust

On first run in any directory, LoopCode blocks execution and prompts for trust validation:

- **`Trust and run`**: Automatically adds the path to `~/.loopcode/trusted_dirs.json`.
- **`Run once`**: Allows execution without adding to the allowlist.
- **`Exit`**: Safely aborts.

### Dangerous Directory Block

LoopCode strictly blocks running inside system directories (e.g., `/`, `/usr`, `/System`) or directly in the user's home directory (`~/` root) to prevent accidental filesystem damage.

---

## 5. Interactive Approvals & Editor Integration

- **Command Approval**: Shell commands in `acceptEdits` or `plan` modes require selection approval. Destructive operations (e.g., `rm`, `git reset --hard`, `git push --force`) always require approval.
- **File Edit Preview**: In `plan` mode, file modifications display a colorized ANSI diff, offering options:
  - **`Accept this edit`**
  - **`Reject this edit`**
  - **`[E] Edit file in $EDITOR`**: Synchronously launches terminal editors (e.g. `vim`, `nano`) on the target file so you can modify code manually before finalizing.

---

## 6. Standalone Binary Packaging

LoopCode packages into a single standalone binary (`./loopcode`) utilizing Bun's compiler:

```bash
bun run package
```

The packaging pipeline:

1. Bundles TS/ESM files into `dist/bundle.js` with `esbuild` using `--packages=external` to keep native bindings external.
2. Compiles the TypeScript entry point into a standalone executable using `bun build --compile`.
3. Packages necessary native dynamic libraries (e.g., SQLite extensions) alongside the executable into a release archive.
