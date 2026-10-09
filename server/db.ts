import pg from "pg";
import { mkdirSync } from "node:fs";
export type Query = (sql: string, values?: any[]) => Promise<{ rows: any[] }>;
export async function database() {
  let query: Query;
  let close: () => Promise<void>;
  let transaction: <T>(fn: (q: Query) => Promise<T>) => Promise<T>;
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
    query = (s, v) => pool.query(s, v);
    close = () => pool.end();
    transaction = async (fn) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn((s, v) => c.query(s, v));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    };
  } else {
    if (process.env.NODE_ENV === "production")
      throw new Error("DATABASE_URL is required in production");
    mkdirSync(".local", { recursive: true });
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(
      process.env.TEST_DB === "memory" ? undefined : ".local/db",
    );
    query = (s, v) => db.query(s, v);
    close = () => db.close();
    transaction = (fn) => db.transaction((t) => fn((s, v) => t.query(s, v)));
  }
  await query(
    `CREATE TABLE IF NOT EXISTS workspaces(id text PRIMARY KEY, expires_at bigint, revision integer NOT NULL DEFAULT 0, data jsonb NOT NULL DEFAULT '{"tables":[],"history":[],"requests":{}}');`,
  );
  await query(
    `CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY, email text UNIQUE NOT NULL, password text NOT NULL, workspace_id text NOT NULL REFERENCES workspaces(id));`,
  );
  await query(
    `CREATE TABLE IF NOT EXISTS credentials(hash text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, expires_at bigint NOT NULL, kind text NOT NULL, client_id text);`,
  );
  await query(
    `CREATE TABLE IF NOT EXISTS oauth_data(id text PRIMARY KEY, kind text NOT NULL, expires_at bigint, data jsonb NOT NULL);`,
  );
  return { query, transaction, close };
}
