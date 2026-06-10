---
title: Installation
description: Copy-paste install for Claude Code, Codex CLI, Cursor, Claude Desktop and raw MCP configs.
---

The server is published as [`react-native-dev-mcp`](https://www.npmjs.com/package/react-native-dev-mcp)
on npm and runs via `npx` — no global install needed. Node 22+ required.

## Claude Code

```bash
# user scope (all projects)
claude mcp add rn-dev -- npx -y react-native-dev-mcp

# or project scope — committed .mcp.json your whole team shares
claude mcp add rn-dev --scope project -- npx -y react-native-dev-mcp
```

Equivalent `.mcp.json`:

```json
{
  "mcpServers": {
    "rn-dev": {
      "command": "npx",
      "args": ["-y", "react-native-dev-mcp"]
    }
  }
}
```

## Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.rn-dev]
command = "npx"
args = ["-y", "react-native-dev-mcp"]
```

## Cursor

Settings → MCP → Add new server, or `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "rn-dev": {
      "command": "npx",
      "args": ["-y", "react-native-dev-mcp"]
    }
  }
}
```

## Claude Desktop

In `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "rn-dev": {
      "command": "npx",
      "args": ["-y", "react-native-dev-mcp"]
    }
  }
}
```

## Windows note

If `npx` fails to spawn from your client on Windows, wrap it with cmd:

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "react-native-dev-mcp"]
}
```

## Server flags

Append flags after the package name, e.g. `npx -y react-native-dev-mcp --metro-port 8082`.
See the [CLI reference](/react-native-mcp/reference/cli/).
