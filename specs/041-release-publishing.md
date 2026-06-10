# 041 — Release & publishing

**Status:** Approved
**Pillar:** Distribution

## Motivation

v0.1.0 is a big-bang release: npm + MCP Registry + GitHub Release land together, once all
three pillars are Verified. The pipeline must be exercised before the public release via a
release candidate.

## Pipeline

1. **Versioning:** changesets. Every user-facing PR adds a changeset; the changesets bot
   maintains a release PR with the changelog (GitHub-linked via
   `@changesets/changelog-github`).
2. **npm:** publish from `release.yml` using **OIDC trusted publishing** (no NPM_TOKEN
   secret; `id-token: write` permission) with provenance attestation.
3. **MCP Registry:** after npm publish, `mcp-publisher` pushes `server.json`
   (`io.github.luizhbesper/react-native-dev-mcp`) authenticated via GitHub OIDC.
4. **GitHub Release:** created by the changesets action with the changelog; tag `vX.Y.Z`.

## Dry-run gate

Before v0.1.0: publish `v0.1.0-rc.1` under the `next` dist-tag through the full pipeline and
verify from a clean machine:

- `npx react-native-dev-mcp@next` starts and answers `initialize`.
- `claude mcp add rn-dev -- npx -y react-native-dev-mcp@next` → `doctor` runs in Claude Code.
- Provenance badge visible on npm; registry entry resolves.

## Release checklist (per release)

- [ ] All specs touched in the release are `Verified`.
- [ ] CI green on all three OSes; nightly green within the last 7 days.
- [ ] Docs updated (install snippets re-verified).
- [ ] Changeset descriptions read like release notes.

## Acceptance criteria

- **AC-1** Merging the release PR publishes to npm with provenance, with no token secrets in
  the repo.
- **AC-2** The registry entry updates within the same workflow run.
- **AC-3** `npx react-native-dev-mcp@latest` works on a machine that never installed it.

## Out of scope

Homebrew/winget distribution; Docker images; signed binaries.
