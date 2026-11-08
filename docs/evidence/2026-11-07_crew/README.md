# The crew: agents you can see (2026-11-07)

Brief and the four questions: SPEC §0.3. Status: SPEC §3 "The crew".

## How it was checked

- **Server, `npm test`**: `apps/server/test/crew.test.ts`, 8 tests.
  - Two runs are two named presences, each with its asker.
  - An agent aims at the section before the table exists, then lands on it, and its activity is signed.
  - `bring_view` guides only the asker; an outside MCP agent can't move anyone's view.
  - A run is a crew member from start to finish: the lead calls in a helper, both sign their work, and none is left in awareness after the linger.
  - Helper caps: none outside an ask, two per ask, none from a helper.
  - A viewer's agent reads but can't write or call in help.
  - `arrange_section` reorders without new times; `rename_section` renames.
  - An MCP crew id counts only for its own person and board.
- **Browser, `npm run e2e -w @foundation/client`**: `e2e/crew.spec.ts`, 5 tests in Chromium, with two people (Ada and Kai) in separate browser contexts. The server ran the `script` runtime (`FOUNDATION_AGENT_SCRIPT=1`: the real board tools, a fixed playbook, no model), so the run is the same every time.

| File | What it shows |
|---|---|
| `01_tap-space-types.png` | A tap of Space: the sheet opens for typing (a held Space that turned into a pan stood down first) |
| `02_ada-holding-space.png` | Holding Space: Ada's words as the stand-in recogniser hears them |
| `03_kai-watches-the-crew.png` | **Kai's** screen: Tern, Ada's agent, at the slot beside the table it just made, "hooking up FactoryForm" |
| `04_ada-brought-to-supply.png` | Ada brought to Supply (Back offered). Tern and its helper Basalt (· with Tern) both done where they finished |
| `05_asked-first-while-busy.png` | Ada was wheeling round the board, so the agent asked first (Go) and didn't move her |
| `06_stopped-seen-by-kai.png` | Ada pressed Stop; Kai's roster shows the agent stopped |
| `07_design-crew-{day,night}.png` | `#/design` → The crew: cursors, the guide pill (brought / asked), the sheet listening and typing |
| `08_v-listening.png`, `09_v-sent-to-the-crew.png` | V does the same as holding Space (`e2e/build.spec.ts`) |

**Measured** (Kai's browser, `e2e/crew.spec.ts`): how far ahead of each card the cursor was in the section.

| Card | Cursor ahead by |
|---|---|
| Parts (a table) | 534–549 ms |
| FactoryForm (a connector) | 989–1009 ms |
| What's here (a note) | 2438–2476 ms |
| Suppliers to call (the helper's note) | 2487–2563 ms |

For every card, a crew cursor was already inside the section when the card first appeared.

**Back** returned Ada's camera to within 2 px. Kai's camera stayed within 2 px of where he left it while Ada was brought.

## Not checked

- **A real model.** A real Claude Code subscription turn was started from the sheet (typed after a real Space tap in the in-app browser). Claude Code answered "Failed to authenticate: OAuth session expired and could not be refreshed". The agent (Onyx) joined, said that in a toast and left. Sign Claude Code in on this machine and ask the crew again.
- **A real microphone.** The in-app browser blocks the mic, and Playwright's recogniser is a stand-in. So the mic-level bars were seen breathing, not following a voice.
