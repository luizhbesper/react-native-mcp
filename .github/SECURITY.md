# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use [GitHub private vulnerability reporting](https://github.com/luizhbesper/react-native-mcp/security/advisories/new)
or email luiz.hb.esper@gmail.com. You will get an acknowledgement within 72 hours.

## Scope notes

This server executes local developer toolchains (`xcrun`, `adb`, `xcodebuild`, `gradlew`) on
behalf of an AI agent. Reports we are especially interested in:

- Argument/shell injection through tool inputs (device ids, URLs, paths)
- Escaping the project root via `projectRoot`/`logPath` style inputs
- The `evaluate_js` surface (it intentionally executes JS in the *app under development*,
  but must never execute anything on the host)

## Supported versions

Only the latest published minor receives security fixes before 1.0.
