# 040 — Docs site & llms.txt

**Status:** Approved
**Pillar:** Distribution

## Motivation

Docs are the product's front door for humans *and* agents. The site must make install
copy-paste trivial for every major MCP client and expose machine-readable docs (llms.txt) so
coding agents can self-serve.

## Stack

- Astro Starlight under `docs/` (own package.json, not a pnpm workspace), deployed to GitHub
  Pages by `docs.yml` on pushes to `main`.
- `starlight-llms-txt` plugin generating `/llms.txt` and `/llms-full.txt`.
- Pagefind search (built-in), dark mode default.

## Information architecture

```
Getting Started
  Why this server / Quickstart (60s)
  Install: Claude Code · Codex CLI · Cursor · Claude Desktop · raw .mcp.json
  Requirements & doctor
Guides
  The agent loop: build → boot → install → logs → evaluate → screenshot
  Working with Expo / with bare RN
  Debugging build failures (signature DB explained)
  Troubleshooting (DEBUGGER_OCCUPIED, ports, multiple targets)
Reference
  Tools (one page per pillar, generated from zod schemas)
  Error codes
  CLI flags & environment variables
For AI Agents
  llms.txt pointers · suggested prompts · AGENTS.md example for app repos
  Tool selection guidance (when to reload vs rebuild)
Contributing
  Signature contribution guide (YAML + fixture, step by step)
  Spec-driven workflow
```

## Acceptance criteria

- **AC-1** `pnpm --dir docs build` succeeds on CI; site deploys to Pages.
- **AC-2** `/llms.txt` and `/llms-full.txt` exist in the build output.
- **AC-3** Every registered tool appears in the reference with its description, input fields
  and error codes (generated — drift fails CI).
- **AC-4** Each install page's snippet is copy-paste runnable (manually verified per release).

## Out of scope

Versioned docs (single-version until v1); i18n (English-only for now).
