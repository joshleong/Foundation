import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const server = process.env.FOUNDATION_SERVER_URL ?? "http://127.0.0.1:4410";

// Foundation's client. 1430 (Vision's browser edition owns 1420). The server's
// routes are proxied so the session cookie is same-origin in dev.
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    proxy: {
      "/api": { target: server, changeOrigin: false },
      "/auth": { target: server, changeOrigin: false },
      "/files": { target: server, changeOrigin: false },
      "/mcp": { target: server, changeOrigin: false },
      "/sync": { target: server.replace(/^http/, "ws"), ws: true, changeOrigin: false },
      "/huddle": { target: server.replace(/^http/, "ws"), ws: true, changeOrigin: false },
    },
  },
}));
