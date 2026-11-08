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
// Ports can move: Windows (Hyper-V/WSL) reserves blocks of the dynamic range at
// boot, and on some machines that range starts at 1024 (SPEC §7).
const SERVER_PORT = process.env.E2E_SERVER_PORT ?? "4430";
const CLIENT_PORT = process.env.E2E_CLIENT_PORT ?? "1450";
const SLACK_PORT = process.env.E2E_SLACK_PORT ?? "4440";
process.env.E2E_CLIENT_PORT = CLIENT_PORT;
export const CLIENT = `http://localhost:${CLIENT_PORT}`;

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
  },
  webServer: [
    {
      command: `node slack-standin.mjs ${SLACK_PORT}`,
      cwd: ".",
      url: `http://127.0.0.1:${SLACK_PORT}/auth.test`,
      reuseExistingServer: false,
      timeout: 20_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: `npx tsx src/index.ts`,
      cwd: "../../server",
      env: {
        FOUNDATION_PORT: SERVER_PORT,
        FOUNDATION_DATA_DIR: data,
        FOUNDATION_CLIENT_URL: CLIENT,
        FOUNDATION_ADMIN_EMAILS: "admin@normal.dev",
        FOUNDATION_DEV_LOGIN: "1",
        // a stand-in Slack (e2e/slack-standin.mjs); no agent runtime, so a check never spends an agent turn
        SLACK_API_BASE: `http://127.0.0.1:${SLACK_PORT}`,
        SLACK_USER_TOKEN: "xoxp-standin",
        SLACK_BOT_TOKEN: "xoxb-standin",
        FOUNDATION_CLAUDE_CLI: "/nonexistent/claude",
        // never the real Vision Code: hand-offs here fail to start, and say why
        T3_CLI: "/nonexistent/t3",
        T3_URL: "http://127.0.0.1:9",
        T3CODE_HOME: "/nonexistent/t3home",
        ANTHROPIC_API_KEY: "",
      },
      url: `http://127.0.0.1:${SERVER_PORT}/api/me`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // E2E_BUILD=1: the production build (what the packaged app ships), with the test page beside it
      command: process.env.E2E_BUILD
        ? `npx vite build && node -e "require('fs').cpSync('e2e/frame.html','dist/e2e/frame.html')" && npx vite preview --port ${CLIENT_PORT} --strictPort`
        : `npx vite --port ${CLIENT_PORT} --strictPort`,
      cwd: "..",
      env: { FOUNDATION_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}`, ...(process.env.E2E_BUILD ? { VITE_E2E_HOOKS: "1" } : {}) },
      url: CLIENT,
      reuseExistingServer: false,
      timeout: process.env.E2E_BUILD ? 240_000 : 60_000,
    },
  ],
});
