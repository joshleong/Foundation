/**
 * Foundation as an MCP server (streamable HTTP, stateless) at /mcp?board=<id>.
 * Claude Code, Codex, Vision's agent — any MCP client — gets the same board
 * tools the built-in agent uses. Auth: a session bearer (the person the agent
 * acts for) or the service token.
 *
 *   claude mcp add foundation --transport http http://localhost:4410/mcp?board=company \
 *     --header "Authorization: Bearer <token from Settings → Agents>"
 */

import type { ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { z } from "zod";
import { TOOLS, runTool } from "./tools.ts";
import { readBody, type Req } from "./http.ts";
import type { UserInfo } from "@foundation/protocol";

function buildServer(boardId: string, user: UserInfo) {
  const server = new McpServer({ name: "foundation", version: "0.1.0" });
  for (const t of TOOLS) {
    const shape = (t.schema as z.ZodObject<z.ZodRawShape>).shape;
    server.registerTool(t.name, { description: t.description, inputSchema: shape }, async (args: unknown) => {
      try {
        const out = await runTool({ boardId, actor: user.id === "agent" ? "Agent (MCP)" : `${user.name}'s agent`, userId: user.id }, t.name, args);
        return { content: [{ type: "text" as const, text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] };
      }
    });
  }
  return server;
}

export async function handleMcp(req: Req, res: ServerResponse, user: UserInfo) {
  const boardId = req.query.get("board") || "company";
  const server = buildServer(boardId, user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  let body: unknown;
  if (req.method === "POST") {
    const raw = await readBody(req, 8 * 1024 * 1024);
    body = raw.length ? JSON.parse(raw.toString("utf8")) : undefined;
  }
  await transport.handleRequest(req, res, body);
}
