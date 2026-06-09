# Specs

This project is developed spec-first. Every tool exposed by the MCP server has a canonical
contract defined in a numbered spec in this directory. Code implements specs — not the other
way around.

## Workflow

1. A feature starts as a spec with status `Draft`.
2. Discussion happens on the spec PR. Once merged with status `Approved`, implementation may start.
3. The implementing PR flips the status to `Implemented` and links the test suite.
4. After the acceptance criteria are verified on CI (and manually where required), status
   becomes `Verified`.

Acceptance criteria are written as Given/When/Then and map 1:1 to named vitest cases.
Source files reference their spec by ID in a header comment (e.g. `// spec: 021`).

## Index

| ID | Spec | Pillar |
| --- | --- | --- |
| 000 | [Conventions](000-conventions.md) | Foundation |
| 001 | [Environment detection](001-environment-detection.md) | Foundation |
| 002 | [Capability gating](002-capability-gating.md) | Foundation |
| 010 | [Unified device schema](010-unified-device-schema.md) | Device control |
| 011 | [Device lifecycle tools](011-device-lifecycle-tools.md) | Device control |
| 012 | [App management tools](012-app-tools.md) | Device control |
| 013 | [Screenshot & status bar](013-screenshot-statusbar.md) | Device control |
| 020 | [Metro discovery & CDP session](020-metro-discovery-cdp.md) | Runtime bridge |
| 021 | [Console streaming](021-console-streaming.md) | Runtime bridge |
| 022 | [Runtime evaluate](022-runtime-evaluate.md) | Runtime bridge |
| 023 | [Reload](023-reload.md) | Runtime bridge |
| 030 | [Build runner & jobs](030-build-runner-jobs.md) | Build diagnostics |
| 031 | [Signature database](031-signature-db.md) | Build diagnostics |
| 032 | [Offline log parsing](032-parse-build-log.md) | Build diagnostics |
| 040 | [Docs site & llms.txt](040-docs-llms-txt.md) | Distribution |
| 041 | [Release & publishing](041-release-publishing.md) | Distribution |

Use [templates/spec-template.md](templates/spec-template.md) for new specs.
