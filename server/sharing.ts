import type { Express } from "express";
import { randomUUID, scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { Problem } from "./domain.ts";
import { hash, token, type Store } from "./store.ts";
const derive = promisify(scrypt);
const role = z.enum(["viewer", "editor"]);
export function sharing(app: Express, s: Store, who: any, base: string) {
  const principal = async (req: any) => {
    const c = await who(req),
      u = await s.user(c.workspace_id);
    if (!u) throw new Problem(401, "Create an account to share tables");
    return { c, u };
  };
  app.get("/api/workspaces", async (req, res) => {
    const c = await who(req);
    res.json(await s.list(c.workspace_id));
  });
  app.get("/api/account", async (req, res) => {
    const { c, u } = await principal(req);
    res.json({ id: u.id, email: u.email, workspaceId: c.workspace_id });
  });
  app.post("/api/account/password", async (req, res) => {
    const { c, u } = await principal(req);
    const input = z
      .object({
        current: z.string().max(128),
        password: z
          .string()
          .min(12, "Choose a password with at least 12 characters")
          .max(128),
      })
      .parse(req.body);
    const record = (
      await s.query("SELECT password FROM users WHERE id=$1", [u.id])
    ).rows[0];
    const [salt, digest] = record.password.split(":");
    const actual = (await derive(input.current, salt, 64)) as Buffer;
    if (!timingSafeEqual(actual, Buffer.from(digest, "hex")))
      throw new Problem(400, "Current password is incorrect");
    const nextSalt = randomBytes(16).toString("hex"),
      next = (await derive(input.password, nextSalt, 64)) as Buffer;
    await s.transaction(async (q) => {
      await q("UPDATE users SET password=$1 WHERE id=$2", [
        `${nextSalt}:${next.toString("hex")}`,
        u.id,
      ]);
      await q("DELETE FROM credentials WHERE workspace_id=$1 AND hash<>$2", [
        c.workspace_id,
        c.hash,
      ]);
    });
    res.json({ ok: true });
  });
  app.get("/api/sharing", async (req, res) => {
    const { c } = await principal(req);
    const teams = (
      await s.query("SELECT * FROM teams WHERE workspace_id=$1", [
        c.workspace_id,
      ])
    ).rows;
    const members = (
      await s.query(
        "SELECT m.team_id,u.id,u.email FROM team_members m JOIN teams t ON t.id=m.team_id JOIN users u ON u.id=m.user_id WHERE t.workspace_id=$1",
        [c.workspace_id],
      )
    ).rows;
    const grants = (
      await s.query(
        `SELECT g.*,u.email,t.name AS team_name FROM grants g LEFT JOIN users u ON g.subject_type='user' AND u.id=g.subject_id LEFT JOIN teams t ON g.subject_type='team' AND t.id=g.subject_id WHERE g.workspace_id=$1`,
        [c.workspace_id],
      )
    ).rows;
    const invitations = (
      await s.query(
        `SELECT i.id,i.table_id,i.team_id,i.role,i.expires_at,i.status,i.applicant,u.email FROM invitations i LEFT JOIN users u ON u.id=i.applicant WHERE i.workspace_id=$1 AND i.status IN ('open','requested') AND i.expires_at>$2`,
        [c.workspace_id, Date.now()],
      )
    ).rows;
    res.json({ teams, members, grants, invitations });
  });
  app.post("/api/sharing", async (req, res) => {
    const { c } = await principal(req);
    const b = req.body;
    res.json(
      await s.transaction(async (q) => {
        await q("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
          c.workspace_id,
        ]);
        const w = await s.workspace(c.workspace_id, q);
        const table = (id: string) => {
          if (id !== "*" && !w.data.tables.some((t: any) => t.id === id))
            throw new Problem(404, "Table not found");
        };
        if (b.action === "team") {
          const name = z.string().trim().min(1).max(80).parse(b.name);
          if (b.id)
            await q(
              "UPDATE teams SET name=$1 WHERE id=$2 AND workspace_id=$3",
              [name, b.id, c.workspace_id],
            );
          else {
            const count = (
              await q("SELECT id FROM teams WHERE workspace_id=$1", [
                c.workspace_id,
              ])
            ).rows.length;
            if (count >= 10) throw new Problem(400, "Team limit reached");
            await q("INSERT INTO teams VALUES($1,$2,$3)", [
              randomUUID(),
              c.workspace_id,
              name,
            ]);
          }
        } else if (b.action === "invite") {
          const tid = b.tableId || "*";
          table(tid);
          if (
            b.teamId &&
            !(
              await q("SELECT id FROM teams WHERE id=$1 AND workspace_id=$2", [
                b.teamId,
                c.workspace_id,
              ])
            ).rows.length
          )
            throw new Problem(404, "Team not found");
          if (
            (
              await q(
                "SELECT id FROM invitations WHERE workspace_id=$1 AND status IN ('open','requested') AND expires_at>$2",
                [c.workspace_id, Date.now()],
              )
            ).rows.length >= 30
          )
            throw new Problem(400, "Too many pending invitations");
          const raw = token();
          await q(
            "INSERT INTO invitations(id,token_hash,workspace_id,table_id,team_id,role,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              hash(raw),
              c.workspace_id,
              tid,
              b.teamId || null,
              role.parse(b.role),
              Date.now() + 7 * 86400000,
            ],
          );
          return { url: `${base}/?invite=${raw}` };
        } else if (b.action === "approve") {
          const i = (
            await q(
              "SELECT * FROM invitations WHERE id=$1 AND workspace_id=$2 AND status='requested' AND expires_at>$3 FOR UPDATE",
              [b.id, c.workspace_id, Date.now()],
            )
          ).rows[0];
          if (!i) throw new Problem(404, "Request no longer available");
          table(i.table_id);
          if (i.team_id)
            await q(
              "INSERT INTO team_members VALUES($1,$2) ON CONFLICT DO NOTHING",
              [i.team_id, i.applicant],
            );
          else
            await q("INSERT INTO grants VALUES($1,$2,$3,$4,$5,$6)", [
              randomUUID(),
              c.workspace_id,
              i.table_id,
              "user",
              i.applicant,
              i.role,
            ]);
          await q("UPDATE invitations SET status='accepted' WHERE id=$1", [
            i.id,
          ]);
        } else if (b.action === "grantTeam") {
          table(b.tableId || "*");
          if (
            !(
              await q("SELECT id FROM teams WHERE id=$1 AND workspace_id=$2", [
                b.teamId,
                c.workspace_id,
              ])
            ).rows.length
          )
            throw new Problem(404, "Team not found");
          await q(
            "DELETE FROM grants WHERE workspace_id=$1 AND subject_type=$2 AND subject_id=$3 AND table_id=$4",
            [c.workspace_id, "team", b.teamId, b.tableId || "*"],
          );
          await q("INSERT INTO grants VALUES($1,$2,$3,$4,$5,$6)", [
            randomUUID(),
            c.workspace_id,
            b.tableId || "*",
            "team",
            b.teamId,
            role.parse(b.role),
          ]);
        } else if (b.action === "role") {
          await q("UPDATE grants SET role=$1 WHERE id=$2 AND workspace_id=$3", [
            role.parse(b.role),
            b.id,
            c.workspace_id,
          ]);
        } else if (b.action === "revoke") {
          await q("DELETE FROM grants WHERE id=$1 AND workspace_id=$2", [
            b.id,
            c.workspace_id,
          ]);
        } else if (b.action === "cancel") {
          await q(
            "UPDATE invitations SET status='cancelled' WHERE id=$1 AND workspace_id=$2",
            [b.id, c.workspace_id],
          );
        } else if (b.action === "removeMember") {
          await q(
            "DELETE FROM team_members WHERE team_id=$1 AND user_id=$2 AND team_id IN(SELECT id FROM teams WHERE workspace_id=$3)",
            [b.teamId, b.userId, c.workspace_id],
          );
        } else if (b.action === "deleteTeam") {
          await q(
            "DELETE FROM grants WHERE subject_type='team' AND subject_id=$1 AND workspace_id=$2",
            [b.id, c.workspace_id],
          );
          await q("DELETE FROM teams WHERE id=$1 AND workspace_id=$2", [
            b.id,
            c.workspace_id,
          ]);
        } else throw new Problem(400, "Unknown sharing action");
        return { ok: true };
      }),
    );
  });
  app.post("/api/invitation", async (req, res) => {
    const { u } = await principal(req);
    const raw = z.string().min(20).max(100).parse(req.body.token);
    // Acquiring the workspace lock first matches approval/revocation lock ordering.
    const found = (
      await s.query(
        "SELECT workspace_id FROM invitations WHERE token_hash=$1",
        [hash(raw)],
      )
    ).rows[0];
    if (!found) throw new Problem(404, "Invitation is unavailable");
    await s.transaction(async (q) => {
      await q("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        found.workspace_id,
      ]);
      const i = (
        await q(
          "SELECT * FROM invitations WHERE token_hash=$1 AND expires_at>$2 AND status IN ('open','requested') FOR UPDATE",
          [hash(raw), Date.now()],
        )
      ).rows[0];
      if (!i || (i.applicant && i.applicant !== u.id))
        throw new Problem(410, "Invitation is no longer available");
      if (u.workspace_id === i.workspace_id)
        throw new Problem(400, "Send this link to your teammate");
      await q(
        "UPDATE invitations SET applicant=$1,status='requested' WHERE id=$2",
        [u.id, i.id],
      );
    });
    res.json({
      message:
        "Request sent. The owner can approve you in Settings → Team & access.",
    });
  });
  app.post("/api/attachments", async (req, res) => {
    const c = await who(req);
    const input = z
      .object({
        workspaceId: z.string(),
        tableId: z.string(),
        name: z.string().min(1).max(180),
        data: z.string().max(2_800_000),
      })
      .parse(req.body);
    const bytes = Buffer.from(input.data, "base64");
    if (!bytes.length || bytes.length > 2 * 1024 * 1024)
      throw new Problem(400, "Files must be 2 MB or smaller");
    const ext = input.name.split(".").pop()?.toLowerCase();
    const sig = bytes.subarray(0, 12);
    let mime = "";
    if (
      ext === "png" &&
      sig.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      mime = "image/png";
    if (
      ["jpg", "jpeg"].includes(ext || "") &&
      sig[0] === 255 &&
      sig[1] === 216 &&
      sig[2] === 255
    )
      mime = "image/jpeg";
    if (
      ext === "webp" &&
      sig.subarray(0, 4).toString() === "RIFF" &&
      sig.subarray(8, 12).toString() === "WEBP"
    )
      mime = "image/webp";
    if (ext === "pdf" && sig.subarray(0, 5).toString() === "%PDF-")
      mime = "application/pdf";
    if (
      ["docx", "xlsx"].includes(ext || "") &&
      sig[0] === 80 &&
      sig[1] === 75 &&
      sig[2] === 3 &&
      sig[3] === 4
    )
      mime = "application/octet-stream";
    if (
      ["txt", "csv"].includes(ext || "") &&
      !bytes.includes(0) &&
      !bytes.toString("utf8").includes("\uFFFD")
    )
      mime = "text/plain";
    if (!mime)
      throw new Problem(
        400,
        "Use a valid PNG, JPEG, WebP, PDF, TXT, CSV, DOCX or XLSX file",
      );
    const id = randomUUID();
    await s.transaction(async (q) => {
      await q("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        input.workspaceId,
      ]);
      if (
        (await s.access(
          c.workspace_id,
          input.workspaceId,
          input.tableId,
          q,
        )) === "viewer"
      )
        throw new Problem(403, "You have read-only access");
      const w = await s.workspace(input.workspaceId, q);
      if (!w.data.tables.some((t: any) => t.id === input.tableId))
        throw new Problem(404, "Table not found");
      await q("SELECT id FROM storage_budget WHERE id=1 FOR UPDATE");
      const usage = (
        await q(
          "SELECT COALESCE(SUM(size),0) AS total,COALESCE(SUM(CASE WHEN workspace_id=$1 THEN size ELSE 0 END),0) AS own FROM attachments",
          [input.workspaceId],
        )
      ).rows[0];
      if (
        Number(usage.total) + bytes.length > 100 * 1024 * 1024 ||
        Number(usage.own) + bytes.length > (w.expires_at ? 5 : 20) * 1024 * 1024
      )
        throw new Problem(
          400,
          "File storage limit reached. Remove unused uploads in Settings.",
        );
      await q("INSERT INTO attachments VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [
        id,
        input.workspaceId,
        input.tableId,
        input.name,
        mime,
        bytes.length,
        bytes,
        Date.now(),
      ]);
    });
    res.json({ id, name: input.name, mime, size: bytes.length });
  });
  app.get("/api/attachments/:id", async (req, res) => {
    const c = await who(req);
    const a = (
      await s.query("SELECT * FROM attachments WHERE id=$1", [req.params.id])
    ).rows[0];
    if (!a) throw new Problem(404, "File not found");
    await s.access(c.workspace_id, a.workspace_id, a.table_id);
    const w = await s.workspace(a.workspace_id);
    if (!w.data.tables.some((t: any) => t.id === a.table_id))
      throw new Problem(404, "File not found");
    res.json({
      name: a.name,
      mime: a.mime,
      data: Buffer.from(a.bytes).toString("base64"),
    });
  });
  app.post("/api/attachments/cleanup", async (req, res) => {
    const { c } = await principal(req);
    const result = await s.transaction(async (q) => {
      await q("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        c.workspace_id,
      ]);
      const w = await s.workspace(c.workspace_id, q);
      // History retains references for undo. Only unreferenced uploads are removed.
      const doc = JSON.stringify({
        tables: w.data.tables,
        history: w.data.history,
      });
      const files = (
        await q("SELECT id FROM attachments WHERE workspace_id=$1", [
          c.workspace_id,
        ])
      ).rows;
      let removed = 0;
      for (const a of files)
        if (!doc.includes(a.id)) {
          await q("DELETE FROM attachments WHERE id=$1", [a.id]);
          removed++;
        }
      return { removed };
    });
    res.json(result);
  });
}
