import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import type { Express } from "express";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { Fields, publicState, Problem } from "./domain.ts";
import type { Store } from "./store.ts";
import { Appearance, appearanceFor } from "../shared/appearance.ts";
import { readSharing, changeSharing, accountUsage } from "./sharing.ts";
const uri = "ui://atablez/workspace-v4.html";
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
      const home = wid || id;
      const w = await s.view(home, id);
      const auth = await s.credential(
        s.query,
        home,
        "browser",
        w.expiresAt ? Math.max(1, Number(w.expiresAt) - Date.now()) : 3600000,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: w.expiresAt
              ? "Preview opened. Create an account to keep these tables after one hour."
              : "Saved tables opened. Permissions apply to this account in both chat and the app.",
          },
        ],
        structuredContent: {
          workspaceId: id,
          workspaceName: w.name,
          revision: w.revision,
          appearance: w.appearance,
          workspaces: await s.list(home),
          tableId: selected ?? null,
          attachments: w.attachments,
          tables: w.tables.map((t: any) => ({
            id: t.id,
            name: t.name,
            rowCount: t.rows.length,
            permission: t.permission,
          })),
          ...(selected
            ? {
                table: (() => {
                  const t = w.tables.find((t: any) => t.id === selected);
                  return t
                    ? {
                        ...t,
                        effectiveAppearance: appearanceFor(
                          w.appearance,
                          t.appearance,
                        ),
                        rows: t.rows.slice(0, 50),
                        totalRows: t.rows.length,
                      }
                    : null;
                })(),
              }
            : {}),
        },
        _meta: {
          auth,
          apiBase: base,
          selected,
          state: w,
          accountConnected: !!wid,
        },
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
    for (const resourceUri of [
      uri,
      "ui://atablez/workspace-v3.html",
      "ui://atablez/workspace-v2.html",
      "ui://atablez/workspace.html",
    ])
      server.registerResource(
        resourceUri === uri
          ? "workspace"
          : `workspace-legacy-${resourceUri.split("/").at(-1)}`,
        resourceUri,
        { mimeType: "text/html;profile=mcp-app" },
        async () => ({
          contents: [
            {
              uri: resourceUri,
              mimeType: "text/html;profile=mcp-app",
              text: readFileSync("dist/index.html", "utf8"),
              _meta: {
                "openai/widgetCSP": {
                  connect_domains: [base],
                  resource_domains: [base, "blob:"],
                  redirect_domains: [base],
                },
                ui: {
                  csp: {
                    connectDomains: [base],
                    resourceDomains: [base, "blob:"],
                  },
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
        inputSchema: {
          workspaceId: z.string().optional(),
          tableId: z.string().optional(),
        },
        annotations: { ...annotations, readOnlyHint: true },
        _meta: {
          ...meta,
          "openai/ui": {
            entrypoints: [{ type: "thread" }, { type: "global" }],
          },
        },
      },
      safe(async (args: any) => {
        if (wid) return result(args.workspaceId || wid, args.tableId);
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
          workspaceId: z.string().optional(),
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
        const home: string = wid || (await s.guest()).state.id;
        const id = wid ? args.workspaceId || home : home;
        const w = await s.view(home, id);
        const r = await s.mutate(
          id,
          {
            ...args,
            action: "create",
            revision: w.revision,
          },
          home,
        );
        return result(id, r.result.tableId);
      }),
    );
    server.registerTool(
      "read_tables",
      {
        title: "Find saved tables",
        description:
          "Find owned and shared AtableZ tables. Pass workspaceId from workspaces to target a shared database. Permissions are enforced on the server. Retrieve their field definitions before filling or editing records. Without tableId returns names and counts; with tableId returns schema and a bounded page of rows.",
        inputSchema: {
          workspaceId: z.string().optional(),
          tableId: z.string().optional(),
          search: z.string().max(200).optional(),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(100).default(50),
        },
        annotations: { ...annotations, readOnlyHint: true },
        _meta: { securitySchemes: authMeta.securitySchemes },
      },
      safe(async (args: any) => {
        const home = required();
        const w = await s.view(home, args.workspaceId || home);
        const tables = w.tables.filter(
          (t: any) =>
            !args.search ||
            t.name.toLowerCase().includes(args.search.toLowerCase()),
        );
        let output: any = {
          revision: w.revision,
          appearance: w.appearance,
          workspaces: await s.list(home),
          tables: tables.map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            rowCount: t.rows.length,
            permission: t.permission,
          })),
        };
        if (args.tableId) {
          const t = w.tables.find((t: any) => t.id === args.tableId);
          if (!t) throw new Problem(404, "Table not found");
          output = {
            revision: w.revision,
            table: {
              ...t,
              effectiveAppearance: appearanceFor(w.appearance, t.appearance),
              rows: t.rows.slice(args.offset, args.offset + args.limit),
            },
            attachments: w.attachments.filter((a: any) => a.table_id === t.id),
            permission: t.permission,
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
          "Change saved table styling with action appearance: rowHeight/columnWidth/tableWidth/tableHeight in pixels, hex accent/headerColor, columnWidths keyed by field ID, and conditional rules (lt/lte/gt/gte/eq; target background/text/bar). Save the user styling prompt alongside concrete appearance rules; never execute prompts or code. Use action workspace with appearance for defaults and applyToAll only when explicitly requested. Rename the workspace with action workspace and name (no tableId). Modify any column, including numbering, through structure; numbering is an ordinary user-defined column. Modify AtableZ records or structure using stable IDs from read_tables. Pass the current workspace revision and unique requestId. Patches preserve unspecified fields. Do not overwrite a conflicting revision; reread first. Pass workspaceId for shared tables. Viewer permissions never allow writes. Progress is a numeric value from 0 to 100; images/files store attachment IDs uploaded through the app. Required fields may be blank in drafts. Removing columns or replacing fixed values requires the user to review and confirm the impact.",
        inputSchema: {
          action: z.enum([
            "workspace",
            "metadata",
            "appearance",
            "structure",
            "add",
            "patch",
            "deleteRow",
            "deleteTable",
            "undo",
          ]),
          workspaceId: z.string().optional(),
          tableId: z.string().optional(),
          rowId: z.string().optional(),
          name: z.string().optional(),
          density: z.enum(["comfortable", "compact"]).optional(),
          colorField: z.string().optional(),
          appearance: Appearance.optional(),
          applyToAll: z.boolean().optional(),
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
        const home = required();
        const id = args.workspaceId || home;
        await s.mutate(id, args, home);
        return result(id, args.tableId);
      }),
    );
    server.registerTool(
      "read_settings",
      {
        title: "Read settings and access",
        description:
          "Read your own workspace defaults, storage usage, teams, pending invitations and exact access grant IDs before changing settings or sharing. Does not expose credentials.",
        inputSchema: {},
        annotations: { ...annotations, readOnlyHint: true },
        _meta: { securitySchemes: authMeta.securitySchemes },
      },
      safe(async () => {
        const home = required();
        const output = {
          usage: await accountUsage(s, home),
          sharing: await readSharing(s, home),
          appearance: (await s.view(home)).appearance,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }),
    );
    server.registerTool(
      "manage_access",
      {
        title: "Manage team access",
        description:
          "Owner-only sharing for your own workspace. Supply a unique requestId and reuse it only to retry the same operation. Read settings first to resolve exact team, invitation, grant and user IDs. Invite sends an email only when the user explicitly requests it and supplies the exact recipient; never infer a recipient. Confirm the table/workspace and Viewer/Editor role before granting access. Team membership can grant all of that team's existing permissions. Email invitations still require the owner to approve the requesting account. Never send test invitations to real people.",
        inputSchema: {
          requestId: z.string().min(1).max(100),
          action: z.enum([
            "invite",
            "team",
            "grantTeam",
            "approve",
            "role",
            "revoke",
            "cancel",
            "removeMember",
            "deleteTeam",
          ]),
          id: z.string().optional(),
          tableId: z.string().optional(),
          teamId: z.string().optional(),
          userId: z.string().optional(),
          name: z.string().max(80).optional(),
          email: z.string().email().optional(),
          role: z.enum(["viewer", "editor"]).optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
        _meta: { securitySchemes: authMeta.securitySchemes },
      },
      safe(async (args: any) => {
        const output = await changeSharing(s, required(), args, base);
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
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
