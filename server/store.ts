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
  async function mutate(id: string, op: any) {
    return db.transaction(async (q) => {
      await q("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [id]);
      const w = await workspace(id, q);
      const key = typeof op.requestId === "string" ? op.requestId : "";
      if (!key || key.length > 100)
        throw new Problem(400, "A request ID is required");
      const fingerprint = hash(JSON.stringify({ ...op, revision: undefined }));
      const previous = w.data.requests[key];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Problem(409, "Request ID reused for a different operation");
        return { ...publicState(w), result: previous.result };
      }
      if (op.revision !== w.revision)
        throw new Problem(
          409,
          "This table changed elsewhere. Refresh and retry your edit.",
        );
      const { data, result } = apply(w.data, op, !!w.expires_at);
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
      return { ...publicState(updated), result };
    });
  }
  return { ...db, credential, workspace, identify, guest, mutate };
}
export type Store = Awaited<ReturnType<typeof store>>;
