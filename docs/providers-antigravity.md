# Antigravity Proxy Provider Integration

> **RISK NOTICE**: The Antigravity proxy is an unofficial tool that is not affiliated with, endorsed by, or supported by Google or Anthropic. Using it may violate Google's Terms of Service. Users have reported Google accounts being suspended, banned, or restricted without notice. Use at your own risk, preferably with a secondary account.

## Overview

The `antigravity-claude-proxy` runs a local HTTP server that exposes an Anthropic Messages API surface and forwards requests to Google's Antigravity backend using Google OAuth credentials.

LoopCode supports managing the proxy process and routing model calls to it under these strict principles:

1. **Opt-in only**: `proxy.enabled` is `false` by default.
2. **Explicit consent**: Enabling the proxy requires explicit risk confirmation.
3. **No implicit global package installation**: LoopCode never runs `npm install -g`. If the binary is missing, the installation command is shown for the user to run themselves.
4. **Quota telemetry**: Metered cost calculation is disabled for proxy routes; quota percentages and reset windows are displayed instead.

## Configuration

In `~/.loopcode/config.toml`:

```toml
[proxy]
enabled = true
kind = "antigravity"
port = 8080
autoStart = true
providerId = "antigravity"
riskAcceptedAt = "2026-07-25T12:00:00.000Z"
```

## Management Commands

- `/proxy status` — View proxy health, version, linked accounts, and quota reset times.
- `/proxy enable` — Trigger consent flow and enable proxy routing.
- `/proxy disable` — Stop local proxy and restore direct provider routing.
- `/proxy start` — Start local proxy daemon.
- `/proxy stop` — Stop local proxy daemon.
