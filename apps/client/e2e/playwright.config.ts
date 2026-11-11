/**
 * End-to-end checks in a real browser: two people on one board, sections
 * moved and split without visual faults, and a frame-time trace. Runs its own
 * server on a fresh data folder (:4430) and its own client (:1450), so it
 * never touches the dev board or another session's servers.
 *
 *   npm run e2e -w @foundation/client
 */

import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = mkdtempSync(join(tmpdir(), "foundation-e2e-"));
/** :1450 by default; E2E_CLIENT_PORT moves it (Windows can reserve 1437–1536 at boot) */
export const CLIENT = `http://localhost:${process.env.E2E_CLIENT_PORT ?? 1450}`;

export default defineConfig({
  testDir: ".",
  outputDir: "../../../docs/evidence/e2e-results",
  timeout: 90_000,
  workers: 1, // one board, one server: tests take turns
  reporter: [["list"]],
  use: {
    baseURL: CLIENT,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    actionTimeout: 10_000,
    // a machine whose Chromium isn't the one this Playwright downloads (a cloud box, CI) names its own
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  webServer: [
    {
      command: "node slack-standin.mjs 4440",
      cwd: ".",
      url: "http://127.0.0.1:4440/auth.test",
      reuseExistingServer: false,
      timeout: 20_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: `npx tsx src/index.ts`,
      cwd: "../../server",
      env: {
        FOUNDATION_PORT: "4430",
        FOUNDATION_DATA_DIR: data,
        FOUNDATION_CLIENT_URL: CLIENT,
        FOUNDATION_ADMIN_EMAILS: "admin@normal.dev",
        FOUNDATION_DEV_LOGIN: "1",
        // a stand-in Slack (e2e/slack-standin.mjs); no agent runtime, so a check never spends an agent turn
        SLACK_API_BASE: "http://127.0.0.1:4440",
        SLACK_USER_TOKEN: "xoxp-standin",
        SLACK_BOT_TOKEN: "xoxb-standin",
        FOUNDATION_CLAUDE_CLI: "/nonexistent/claude",
        // the crew's agents run a fixed playbook through the real board tools (no model, nothing spent)
        FOUNDATION_AGENT_SCRIPT: "1",
        FOUNDATION_SCRIPT_STEP_MS: "450",
        // never the real Vision Code: hand-offs here fail to start, and say why
        T3_CLI: "/nonexistent/t3",
        T3_URL: "http://127.0.0.1:9",
        T3CODE_HOME: "/nonexistent/t3home",
        ANTHROPIC_API_KEY: "",
      },
      url: "http://127.0.0.1:4430/api/me",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${process.env.E2E_CLIENT_PORT ?? 1450} --strictPort`,
      cwd: "..",
      env: { FOUNDATION_SERVER_URL: "http://127.0.0.1:4430" },
      url: CLIENT,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
