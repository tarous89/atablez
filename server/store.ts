import { randomBytes, randomUUID, createHash } from "node:crypto";
import { database, type Query } from "./db.ts";
import { apply, Problem, publicState } from "./domain.ts";
export const token = () => randomBytes(32).toString("base64url");
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export async function store() {
  const db = await database();
  async function credential(
    q: Query,
    workspace: string,
    kind = "browser",
    ttl = 30 * 86400000,
    clientId: string | null = null,
  ) {
    const value = token();
    await q("INSERT INTO credentials VALUES($1,$2,$3,$4,$5)", [
      hash(value),
      workspace,
      Date.now() + ttl,
      kind,
      clientId,
    ]);
    return value;
  }
  async function workspace(id: string, q: Query = db.query) {
    const r = (await q("SELECT * FROM workspaces WHERE id=$1", [id])).rows[0];
    if (!r) throw new Problem(404, "Workspace not found");
    if (r.expires_at && Number(r.expires_at) <= Date.now())
      throw new Problem(
        410,
        "This one-hour preview has expired. Start a new preview.",
      );
    return r;
  }
  async function identify(value: string, kind?: string) {
    const c = (
      await db.query(
        "SELECT * FROM credentials WHERE hash=$1 AND expires_at>$2",
        [hash(value), Date.now()],
      )
    ).rows[0];
    if (!c || (kind && c.kind !== kind))
      throw new Problem(401, "Please sign in again");
    await workspace(c.workspace_id);
    return c;
  }
  async function guest() {
    return db.transaction(async (q) => {
      const id = randomUUID();
      await q("INSERT INTO workspaces(id,expires_at) VALUES($1,$2)", [
        id,
        Date.now() + 3600000,
      ]);
      const auth = await credential(q, id, "browser", 3600000);
      return { auth, state: publicState(await workspace(id, q)) };
    });
  }
  async function mutate(id: string, op: any, home = id) {
    return db.transaction(async (q) => {
      await q("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [id]);
      const w = await workspace(id, q);
      const permission = await access(home, id, op.tableId, q);
      if (permission === "viewer")
        throw new Problem(403, "You have read-only access");
      if (
        permission !== "owner" &&
        ["workspace", "undo", "deleteTable"].includes(op.action)
      )
        throw new Problem(403, "Only the owner can do that");
      if (
        op.action === "create" &&
        !["owner", "editor"].includes(await access(home, id, undefined, q))
      )
        throw new Problem(403, "Workspace edit access required");
      const key = typeof op.requestId === "string" ? op.requestId : "";
      if (!key || key.length > 100)
        throw new Problem(400, "A request ID is required");
      const fingerprint = hash(
        JSON.stringify({ ...op, actor: home, revision: undefined }),
      );
      const previous = w.data.requests[key];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Problem(409, "Request ID reused for a different operation");
        return { ...(await view(home, id, q)), result: previous.result };
      }
      if (op.revision !== w.revision)
        throw new Problem(
          409,
          "This table changed elsewhere. Refresh and retry your edit.",
        );
      const { data, result } = apply(w.data, op, !!w.expires_at);
      for (const t of data.tables) {
        if (op.tableId && op.tableId !== t.id) continue;
        for (const f of t.fields.filter((f) =>
          ["image", "files"].includes(f.type),
        )) {
          const ids = new Set(t.rows.flatMap((r) => r.values[f.id] || []));
          if (f.fixedValue) for (const id of f.fixedValue) ids.add(id);
          for (const aid of ids) {
            const file = (
              await q(
                "SELECT mime FROM attachments WHERE id=$1 AND workspace_id=$2 AND table_id=$3",
                [aid, id, t.id],
              )
            ).rows[0];
            if (
              !file ||
              (f.type === "image" && !file.mime.startsWith("image/"))
            )
              throw new Problem(
                400,
                "Attachment is unavailable for this table",
              );
          }
        }
      }
      data.requests[key] = { fingerprint, result };
      const keys = Object.keys(data.requests);
      keys
        .slice(0, Math.max(0, keys.length - 100))
        .forEach((k) => delete data.requests[k]);
      const updated = (
        await q(
          "UPDATE workspaces SET data=$1,revision=revision+1 WHERE id=$2 RETURNING *",
          [JSON.stringify(data), id],
        )
      ).rows[0];
      return { ...(await view(home, id, q)), result };
    });
  }
  async function user(home: string, q: Query = db.query) {
    return (
      await q("SELECT id,email,workspace_id FROM users WHERE workspace_id=$1", [
        home,
      ])
    ).rows[0];
  }
  async function access(
    home: string,
    id: string,
    tableId?: string,
    q: Query = db.query,
  ): Promise<string> {
    await workspace(home, q);
    if (home === id) return "owner";
    const u = await user(home, q);
    if (!u) throw new Problem(403, "Sign in to access shared tables");
    const roles = (
      await q(
        `SELECT g.role FROM grants g WHERE g.workspace_id=$1 AND (g.table_id='*' OR g.table_id=$2)
      AND ((g.subject_type='user' AND g.subject_id=$3) OR (g.subject_type='team' AND EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=g.subject_id AND m.user_id=$3)))`,
        [id, tableId || "*", u.id],
      )
    ).rows;
    if (!roles.length)
      throw new Problem(404, "Table or workspace is not available");
    return roles.some((r) => r.role === "editor") ? "editor" : "viewer";
  }
  async function view(home: string, id = home, q: Query = db.query) {
    await workspace(home, q);
    const w = await workspace(id, q);
    let role = "viewer";
    try {
      role = await access(home, id, undefined, q);
    } catch (e) {
      if (home === id) throw e;
    }
    const tables: any[] = [];
    for (const t of w.data.tables) {
      try {
        tables.push({ ...t, permission: await access(home, id, t.id, q) });
      } catch {}
    }
    if (home !== id && !tables.length) {
      await access(home, id, undefined, q);
    }
    const result = publicState(w);
    return {
      ...result,
      tables,
      role,
      canUndo: role === "owner" && result.canUndo,
      homeId: home,
      signedIn: !!(await user(home, q)),
      attachments: (
        await q(
          "SELECT id,table_id,name,mime,size FROM attachments WHERE workspace_id=$1",
          [id],
        )
      ).rows.filter((a) => tables.some((t) => t.id === a.table_id)),
    };
  }
  async function list(home: string) {
    const u = await user(home);
    const ids = u
      ? (
          await db.query(
            `SELECT DISTINCT g.workspace_id FROM grants g WHERE (g.subject_type='user' AND g.subject_id=$1) OR (g.subject_type='team' AND EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=g.subject_id AND m.user_id=$1))`,
            [u.id],
          )
        ).rows.map((r) => r.workspace_id)
      : [];
    const all = [];
    for (const id of new Set([home, ...ids])) {
      try {
        const w = await view(home, id);
        all.push({
          id,
          name: w.name,
          role: w.role,
          shared: id !== home,
          tables: w.tables.map((t) => ({
            id: t.id,
            name: t.name,
            permission: t.permission,
          })),
        });
      } catch {}
    }
    return all;
  }
  return {
    ...db,
    credential,
    workspace,
    identify,
    guest,
    mutate,
    user,
    access,
    view,
    list,
  };
}
export type Store = Awaited<ReturnType<typeof store>>;
