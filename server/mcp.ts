import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import type { Express } from "express";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { Fields, publicState, Problem } from "./domain.ts";
import type { Store } from "./store.ts";
const uri = "ui://atablez/workspace.html";
export async function attachMcp(
  app: Express,
  s: Store,
  provider: OAuthServerProvider,
  base: string,
  limit: any,
) {
  app.post("/mcp", limit, async (req, res) => {
    let wid: string | undefined;
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    if (bearer) {
      try {
        wid = (await provider.verifyAccessToken(bearer)).extra
          ?.workspace as string;
      } catch {
        res.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        );
        res.status(401).json({ error: "invalid_token" });
        return;
      }
    }
    const server = new McpServer({ name: "AtableZ", version: "0.1.0" });
    const meta = {
      ui: { resourceUri: uri },
      "openai/outputTemplate": uri,
      securitySchemes: [
        { type: "noauth" },
        { type: "oauth2", scopes: ["tables"] },
      ],
    };
    const authMeta = {
      ...meta,
      securitySchemes: [{ type: "oauth2", scopes: ["tables"] }],
    };
    const annotations = {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    };
    async function result(id: string, selected?: string) {
      const w = await s.workspace(id);
      const auth = await s.credential(
        s.query,
        id,
        "browser",
        w.expires_at ? Math.max(1, Number(w.expires_at) - Date.now()) : 3600000,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: "Saved workspace opened. Values are persisted. Guest previews expire after one hour; sign up in the panel to retain them.",
          },
        ],
        structuredContent: {
          workspaceId: id,
          workspaceName: w.data.name ?? "My workspace",
          revision: w.revision,
          tableId: selected ?? null,
          tables: w.data.tables.map((t: any) => ({
            id: t.id,
            name: t.name,
            rowCount: t.rows.length,
          })),
          ...(selected
            ? {
                table: (() => {
                  const t = w.data.tables.find((t: any) => t.id === selected);
                  return t
                    ? {
                        ...t,
                        rows: t.rows.slice(0, 50),
                        totalRows: t.rows.length,
                      }
                    : null;
                })(),
              }
            : {}),
        },
        _meta: { auth, apiBase: base, selected, state: publicState(w) },
      };
    }
    function required() {
      if (!wid)
        throw new Problem(
          401,
          "Connect your AtableZ account to retrieve and edit saved tables across conversations. You can edit an unsigned preview directly in its panel.",
        );
      return wid;
    }
    const safe = (fn: any) => async (args: any) => {
      try {
        return await fn(args);
      } catch (e: any) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: e.message }],
          ...(e.status === 401
            ? {
                _meta: {
                  "mcp/www_authenticate": [
                    `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="tables"`,
                  ],
                },
              }
            : {}),
        };
      }
    };
    server.registerResource(
      "workspace",
      uri,
      { mimeType: "text/html;profile=mcp-app" },
      async () => ({
        contents: [
          {
            uri,
            mimeType: "text/html;profile=mcp-app",
            text: readFileSync("dist/index.html", "utf8"),
            _meta: {
              "openai/widgetCSP": {
                connect_domains: [base],
                resource_domains: [base],
              },
              ui: {
                csp: { connectDomains: [base], resourceDomains: [base] },
                prefersBorder: false,
              },
              "openai/ui": {
                availableDisplayModes: ["inline", "fullscreen"],
                preferredDisplayMode: "fullscreen",
              },
              "openai/widgetDescription":
                "Editable AtableZ tables with top navigation and reusable column instructions.",
            },
          },
        ],
      }),
    );
    server.registerTool(
      "open_workspace",
      {
        title: "My tables",
        description:
          "Open AtableZ to see saved tables or begin a one-hour guest preview.",
        inputSchema: {},
        annotations: { ...annotations, readOnlyHint: true },
        _meta: {
          ...meta,
          "openai/ui": {
            entrypoints: [{ type: "thread" }, { type: "global" }],
          },
        },
      },
      safe(async () => {
        if (wid) return result(wid);
        const g = await s.guest();
        return result(g.state.id);
      }),
    );
    server.registerTool(
      "create_table",
      {
        title: "Save as a table",
        description:
          "Use when the user wants to save information in a reusable AtableZ table. Generate a concise table name, appropriate column types, descriptions, and reusable filling instructions. Save only supplied information; keep unknown values empty. Unconnected users receive an editable one-hour preview; they must sign up and connect to reuse it in later conversations.",
        inputSchema: {
          name: z.string().min(1).max(120),
          description: z.string().max(2000).optional(),
          instructions: z.string().max(5000).optional(),
          fields: Fields,
          rows: z.array(z.record(z.string(), z.any())).max(100),
          requestId: z.string().max(100),
        },
        annotations,
        _meta: meta,
      },
      safe(async (args: any) => {
        const id: string = wid || (await s.guest()).state.id;
        const w = await s.workspace(id);
        const r = await s.mutate(id, {
          ...args,
          action: "create",
          revision: w.revision,
        });
        return result(id, r.result.tableId);
      }),
    );
    server.registerTool(
      "read_tables",
      {
        title: "Find saved tables",
        description:
          "Find AtableZ tables and retrieve their field definitions before filling or editing records. Without tableId returns names and counts; with tableId returns schema and a bounded page of rows.",
        inputSchema: {
          tableId: z.string().optional(),
          search: z.string().max(200).optional(),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(100).default(50),
        },
        annotations: { ...annotations, readOnlyHint: true },
        _meta: authMeta,
      },
      safe(async (args: any) => {
        const w = await s.workspace(required());
        const tables = w.data.tables.filter(
          (t: any) =>
            !args.search ||
            t.name.toLowerCase().includes(args.search.toLowerCase()),
        );
        let output: any = {
          revision: w.revision,
          tables: tables.map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            rowCount: t.rows.length,
          })),
        };
        if (args.tableId) {
          const t = w.data.tables.find((t: any) => t.id === args.tableId);
          if (!t) throw new Problem(404, "Table not found");
          output = {
            revision: w.revision,
            table: {
              ...t,
              rows: t.rows.slice(args.offset, args.offset + args.limit),
            },
            total: t.rows.length,
            offset: args.offset,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }),
    );
    server.registerTool(
      "change_table",
      {
        title: "Update saved table",
        description:
          "Rename the workspace with action workspace and name (no tableId). Modify any column, including numbering, through structure; numbering is an ordinary user-defined column. Modify AtableZ records or structure using stable IDs from read_tables. Pass the current workspace revision and unique requestId. Patches preserve unspecified fields. Do not overwrite a conflicting revision; reread first. Required fields may be blank in drafts. Removing columns or replacing fixed values requires the user to review and confirm the impact.",
        inputSchema: {
          action: z.enum([
            "workspace",
            "metadata",
            "structure",
            "add",
            "patch",
            "deleteRow",
            "deleteTable",
            "undo",
          ]),
          tableId: z.string().optional(),
          rowId: z.string().optional(),
          name: z.string().optional(),
          description: z.string().optional(),
          instructions: z.string().optional(),
          fields: Fields.optional(),
          rows: z.array(z.record(z.string(), z.any())).max(100).optional(),
          values: z.record(z.string(), z.any()).optional(),
          revision: z.number().int(),
          requestId: z.string().max(100),
          confirmRemoval: z.boolean().optional(),
        },
        annotations: { ...annotations, destructiveHint: true },
        _meta: authMeta,
      },
      safe(async (args: any) => {
        const id = required();
        await s.mutate(id, args);
        return result(id, args.tableId);
      }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", (_req, res) => res.status(405).send("Use POST for MCP"));
}
