---
title: Quickstart
description: From zero to an agent driving your React Native app in about a minute.
---

**Requirements:** Node 22+. macOS for iOS work (Xcode + simulators); any OS for Android
(Android SDK with `adb`). The server runs locally over stdio — nothing leaves your machine.

## 1. Add the server to your client

For Claude Code:

```bash
claude mcp add rn-dev -- npx -y react-native-dev-mcp
```

(Other clients: see [Installation](/react-native-mcp/getting-started/installation/).)

## 2. Check your environment

Ask your agent to run the `doctor` tool. You should see something like:

```text
✅ Host: darwin/arm64, Node 26.0.0
✅ iOS: Xcode 16.4, CocoaPods 1.16.2
✅ Android: adb 1.0.41, emulator yes, Java 17.0.10
⚠️ Metro: not running on :8081
✅ Project: expo · RN 0.85.1 · Expo SDK 56
```

`doctor` tells you (and the agent) exactly what is missing and how to fix it.

## 3. Start Metro and let the agent work

```bash
npx expo start        # or: npx react-native start
```

From here the agent can boot a device, build and install the app, read console logs in
real time, evaluate JS in the running app, and screenshot the result. See
[the agent loop](/react-native-mcp/guides/agent-loop/) for the full workflow.

:::tip[Project root]
The server uses its working directory as the project root. If your client starts servers
elsewhere, pass `--project-root /path/to/app` in the server args.
:::
