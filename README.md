# Foundation

The company brain of Form Industries. It is one shared grid where people, the apps we build, and the agents that work with us meet.

- **The grid:** sections hold tables, maps, notes and media, plus live panels: running apps (with their GitHub repo, MCP tools and input/output ports), web pages, machines, uploaded files and CAD, live company systems, agent jobs, and asks to teammates.
- **The agent layer:** sits above the grid and shows how apps are wired, where agents are working, and what everyone just did.
- **The agent:** runs the whole interface. It runs on your Claude Code subscription or on API credits. It can organize the board, open and wire apps, find repos, read BomForm and FactoryForm, brief Vision, chase people for CAD (Hermes), and queue reverse-engineering (REA).
- **The company board:** shows Vision, BomForm, FactoryForm, the Data Room, Creation and Foundation live, wired by how data actually flows between them.

**[SPEC.md](SPEC.md)** is the plan, with status, the hookups you need to do, known issues and phases. **[DESIGN.md](DESIGN.md)** is the design language. Inside the app, `#/design` renders it live.

## Run it locally

```sh
npm install
npm run dev            # server :4410 + client :1430 → open http://localhost:1430
```

Sign in with **Continue with Google**, the same Google sign-in as the flowform client, through flowform-server (`FLOWFORM_URL`, default https://server.formresearch.ai), or with your name and an allowlisted email (dev login). To configure Slack, BomForm, API credits and more, copy `.env.example` to `.env`; see SPEC §6.

```sh
npm test               # server invariants (node:test)
npm run typecheck      # every workspace
npm run tauri dev      # the desktop window (needs Rust)
```

Connect Claude Code (or Codex) to a board: press **⌘K**, choose **Connect Claude Code**, and paste the command it copies.

## Keys

| Key | Action |
|---|---|
| **⌘K** | Search everything, paste a link to open it as a live app, or run an action |
| **⌘J** | The agent (🎙 to talk) |
| **A** | Agent layer |
| **P** | Present |
| **⌘U** | Upload |
| **Esc** | Release an app and step up the grid |

On the grid itself:
- Drag empty space to pan; Ctrl + scroll to zoom.
- Drag a card header to float it.
- Drag from an output port to wire it.

## Layout

```
apps/client       React 19 + Vite grid and shell (Tauri desktop in src-tauri)
apps/server       Node 22 + TypeScript: SQLite, Yjs sync, auth, files, search, MCP, agent, connectors
packages/protocol the board schema every side shares
packages/ui       design tokens, springs and the night engine
```

Foundation also takes in the work of `flowform-client` and `flowform-server` (see SPEC §3.1). The Gantt and digital-twin features were dropped.
