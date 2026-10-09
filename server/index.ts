import express from "express";
import { scrypt, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { store, hash, token } from "./store.ts";
import { oauth } from "./oauth.ts";
import { Problem, publicState } from "./domain.ts";
import { attachMcp } from "./mcp.ts";
const derive = promisify(scrypt);
export async function createApp() {
  const s = await store();
  const app = express();
  const base = (
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    const allowed = [
      base,
      "https://chatgpt.com",
      "https://web-sandbox.oaiusercontent.com",
    ];
    const allowedOrigin = origin && (allowed.includes(origin) ||
      /^https:\/\/[a-z0-9-]+\.web-sandbox\.oaiusercontent\.com$/.test(origin));
    if (allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, MCP-Protocol-Version",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    if (
      req.path.startsWith("/api") &&
      req.method === "POST" &&
      origin &&
      !allowedOrigin
    ) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  const attempts = new Map<string, { n: number; until: number }>();
  function limit(req: any, res: any, next: any) {
    const k = req.ip || "unknown";
    const n = attempts.get(k);
    if (!n || n.until < Date.now()) {
      attempts.set(k, { n: 1, until: Date.now() + 60000 });
      next();
      return;
    }
    if (++n.n > 40) {
      res
        .status(429)
        .json({ error: "Too many requests. Try again in a minute." });
      return;
    }
    next();
  }
  app.use("/api/auth", limit);
  app.use("/api/guest", limit);
  const bearer = (req: any) =>
    req.headers.authorization?.replace(/^Bearer /, "") || "";
  const who = async (req: any) => {
    const c = await s.identify(bearer(req));
    if (c.kind !== "browser") throw new Problem(401, "Invalid session");
    return c;
  };
  app.get("/health", async (_req, res) => {
    await s.query("SELECT 1");
    res.json({ ok: true });
  });
  app.post("/api/guest", async (_req, res) => res.json(await s.guest()));
  app.get("/api/workspace", async (req, res) => {
    const c = await who(req);
    const w = await s.workspace(c.workspace_id);
    res.json(publicState(w));
  });
  app.post("/api/change", async (req, res) => {
    const c = await who(req);
    res.json(await s.mutate(c.workspace_id, req.body));
  });
  app.post("/api/auth/signup", async (req, res) => {
    const input = z
      .object({
        email: z.email().max(254),
        password: z.string().min(12).max(128),
      })
      .parse(req.body);
    const email = input.email.toLowerCase();
    const salt = randomBytes(16).toString("hex");
    const digest = (
      (await derive(input.password, salt, 64)) as Buffer
    ).toString("hex");
    const old = bearer(req) ? await who(req) : null;
    const auth = await s.transaction(async (q) => {
      let id = old?.workspace_id;
      if (id) {
        await q("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [id]);
        const w = await s.workspace(id, q);
        if (!w.expires_at) throw new Problem(409, "Already signed in");
      } else {
        id = randomUUID();
        await q("INSERT INTO workspaces(id) VALUES($1)", [id]);
      }
      await q("INSERT INTO users VALUES($1,$2,$3,$4)", [
        randomUUID(),
        email,
        `${salt}:${digest}`,
        id,
      ]);
      await q("UPDATE workspaces SET expires_at=NULL WHERE id=$1", [id]);
      await q("DELETE FROM credentials WHERE workspace_id=$1", [id]);
      return s.credential(q, id);
    });
    res.json({ auth });
  });
  app.post("/api/auth/login", async (req, res) => {
    const input = z
      .object({
        email: z.email().max(254),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const u = (
      await s.query("SELECT * FROM users WHERE email=$1", [
        input.email.toLowerCase(),
      ])
    ).rows[0];
    const [salt, digest] = (
      u?.password || "00000000000000000000000000000000:" + "0".repeat(128)
    ).split(":");
    const actual = (await derive(input.password, salt, 64)) as Buffer;
    if (!u || !timingSafeEqual(actual, Buffer.from(digest, "hex")))
      throw new Problem(401, "Email or password is incorrect");
    const old = bearer(req) ? await who(req) : null;
    const auth = await s.transaction(async (q) => {
      if (old && old.workspace_id !== u.workspace_id) {
        const ids = [old.workspace_id, u.workspace_id].sort();
        for (const id of ids)
          await q("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [id]);
        const guest = await s.workspace(old.workspace_id, q);
        const target = await s.workspace(u.workspace_id, q);
        if (guest.expires_at) {
          const merged = [...target.data.tables, ...guest.data.tables];
          if (
            merged.length > 20 ||
            merged.reduce((n: number, t: any) => n + t.rows.length, 0) > 2000
          )
            throw new Problem(
              400,
              "Account limit reached; preview was not transferred",
            );
          target.data.tables = merged;
          target.data.history = [];
          if (JSON.stringify(target.data).length > 5_000_000)
            throw new Problem(400, "Account storage limit reached");
          await q(
            "UPDATE workspaces SET data=$1,revision=revision+1 WHERE id=$2",
            [JSON.stringify(target.data), u.workspace_id],
          );
          await q("DELETE FROM workspaces WHERE id=$1", [guest.id]);
        }
      }
      return s.credential(q, u.workspace_id);
    });
    res.json({ auth });
  });
  app.post("/api/auth/logout", async (req, res) => {
    await s.query("DELETE FROM credentials WHERE hash=$1", [hash(bearer(req))]);
    res.json({ ok: true });
  });
  const provider = oauth(s, base);
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(base),
      resourceServerUrl: new URL(`${base}/mcp`),
      scopesSupported: ["tables"],
      resourceName: "AtableZ",
    }),
  );
  app.get("/api/connect", async (req, res) => {
    const r = (
      await s.query(
        "SELECT data FROM oauth_data WHERE id=$1 AND kind=$2 AND expires_at>$3",
        [hash(String(req.query.ticket)), "pending", Date.now()],
      )
    ).rows[0];
    if (!r) throw new Problem(410, "Connection request expired");
    res.json({ clientName: r.data.clientName });
  });
  app.post("/api/connect", async (req, res) => {
    const c = await who(req);
    const w = await s.workspace(c.workspace_id);
    if (w.expires_at)
      throw new Problem(401, "Sign up or log in to connect your account");
    const result = await s.transaction(async (q) => {
      const r = (
        await q(
          "DELETE FROM oauth_data WHERE id=$1 AND kind=$2 AND expires_at>$3 RETURNING data",
          [hash(String(req.body.ticket)), "pending", Date.now()],
        )
      ).rows[0];
      if (!r) throw new Problem(410, "Connection request expired");
      const code = token();
      await q("INSERT INTO oauth_data VALUES($1,$2,$3,$4)", [
        hash(code),
        "code",
        Date.now() + 60000,
        JSON.stringify({ ...r.data, workspace: w.id }),
      ]);
      const url = new URL(r.data.redirectUri);
      url.searchParams.set("code", code);
      if (r.data.state) url.searchParams.set("state", r.data.state);
      return url.href;
    });
    res.json({ redirect: result });
  });
  await attachMcp(app, s, provider, base, limit);
  app.use(
    express.static("dist", {
      setHeaders(res) {
        res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/", (_req, res) => {
    if (!existsSync("dist/index.html")) {
      res.status(503).send("Run npm run build first.");
      return;
    }
    res.type("html").send(readFileSync("dist/index.html", "utf8"));
  });
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status =
      err instanceof Problem
        ? err.status
        : err instanceof z.ZodError
          ? 400
          : err.code === "23505"
            ? 409
            : 500;
    res
      .status(status)
      .json({
        error:
          status === 500
            ? "The request failed. Please try again."
            : err.code === "23505"
              ? "An account already exists. Please log in."
              : err instanceof z.ZodError
                ? err.issues.map((i) => i.message).join("; ")
                : err.message,
      });
    if (status === 500) console.error(err.message);
  });
  const cleanup = setInterval(() => {
    attempts.forEach((v, k) => {
      if (v.until < Date.now()) attempts.delete(k);
    });
    s.query("DELETE FROM workspaces WHERE expires_at<$1", [Date.now()]).catch(
      () => {},
    );
    s.query("DELETE FROM credentials WHERE expires_at<$1", [Date.now()]).catch(
      () => {},
    );
    s.query("DELETE FROM oauth_data WHERE expires_at<$1", [Date.now()]).catch(
      () => {},
    );
  }, 60000);
  cleanup.unref();
  return {
    app,
    s,
    close: async () => {
      clearInterval(cleanup);
      await s.close();
    },
  };
}
if (process.env.TEST_MODE !== "1") {
  const { app, close } = await createApp();
  const http = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log("AtableZ listening"),
  );
  process.on("SIGTERM", () =>
    http.close(() => close().then(() => process.exit(0))),
  );
}
