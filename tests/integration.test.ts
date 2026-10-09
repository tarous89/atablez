import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
process.env.TEST_MODE = "1";
process.env.TEST_DB = "memory";
const { createApp } = await import("../server/index.ts");
let instance: Awaited<ReturnType<typeof createApp>>, http: any, base: string;
before(async () => {
  instance = await createApp();
  http = instance.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", r));
  base = `http://127.0.0.1:${http.address().port}`;
});
after(async () => {
  await new Promise<void>((r) => http.close(r));
  await instance.close();
});
async function call(path: string, body?: any, auth?: string) {
  const res = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json() };
}
const fields = [
  { id: "name", name: "Name", type: "string" },
  { id: "score", name: "Score", type: "integer" },
];
async function preview() {
  return (await call("/api/guest", {})).data;
}
async function create(g: any) {
  return (
    await call(
      "/api/change",
      {
        action: "create",
        name: "Suppliers",
        fields,
        rows: [{ name: "Acme", score: 4 }],
        revision: g.state.revision,
        requestId: randomUUID(),
      },
      g.auth,
    )
  ).data;
}
test("typed writes, retry idempotency, optimistic conflicts, and account isolation", async () => {
  const g = await preview();
  const a = await create(g);
  assert.equal(a.tables.length, 1);
  const table = a.tables[0];
  const op = {
    action: "patch",
    tableId: table.id,
    rowId: table.rows[0].id,
    values: { score: 8 },
    revision: a.revision,
    requestId: randomUUID(),
  };
  const saved = await call("/api/change", op, g.auth);
  assert.equal(saved.status, 200);
  assert.equal(
    (await call("/api/change", op, g.auth)).data.revision,
    saved.data.revision,
  );
  assert.equal(
    (await call("/api/change", { ...op, requestId: randomUUID() }, g.auth))
      .status,
    409,
  );
  assert.equal(
    (
      await call(
        "/api/change",
        {
          ...op,
          values: { score: 2.5 },
          revision: saved.data.revision,
          requestId: randomUUID(),
        },
        g.auth,
      )
    ).status,
    400,
  );
  const other = await preview();
  assert.equal(
    (
      await call(
        "/api/change",
        { ...op, revision: 0, requestId: randomUUID() },
        other.auth,
      )
    ).status,
    404,
  );
});
test("one-hour TTL is enforced server-side and cannot be claimed after expiry", async () => {
  const g = await preview();
  assert.ok(Math.abs(g.state.expiresAt - Date.now() - 3600000) < 2000);
  await instance.s.query("UPDATE workspaces SET expires_at=$1 WHERE id=$2", [
    Date.now() - 1,
    g.state.id,
  ]);
  assert.equal((await call("/api/workspace", undefined, g.auth)).status, 410);
  assert.equal(
    (
      await call(
        "/api/auth/signup",
        { email: "expired@example.test", password: "a-long-password-123" },
        g.auth,
      )
    ).status,
    410,
  );
});
test("signup preserves preview, rotates credentials, login merges a second guest workspace", async () => {
  const g = await preview();
  await create(g);
  const creds = {
    email: "person@example.test",
    password: "a-long-password-123",
  };
  const user = await call("/api/auth/signup", creds, g.auth);
  assert.equal(user.status, 200);
  assert.equal((await call("/api/workspace", undefined, g.auth)).status, 401);
  const w = (await call("/api/workspace", undefined, user.data.auth)).data;
  assert.equal(w.expiresAt, null);
  assert.equal(w.tables.length, 1);
  const second = await preview();
  await create(second);
  const login = await call("/api/auth/login", creds, second.auth);
  assert.equal(login.status, 200);
  assert.equal(
    (await call("/api/workspace", undefined, login.data.auth)).data.tables
      .length,
    2,
  );
  assert.equal(
    (await call("/api/workspace", undefined, second.auth)).status,
    401,
  );
});
test("structure changes preserve values and destructive changes can be undone", async () => {
  const g = await preview();
  let w = await create(g);
  const id = w.tables[0].id;
  const removal = {
    action: "structure",
    tableId: id,
    fields: [fields[0]],
    revision: w.revision,
    requestId: randomUUID(),
  };
  assert.equal((await call("/api/change", removal, g.auth)).status, 409);
  w = (
    await call(
      "/api/change",
      { ...removal, requestId: randomUUID(), confirmRemoval: true },
      g.auth,
    )
  ).data;
  assert.equal(w.tables[0].fields.length, 1);
  w = (
    await call(
      "/api/change",
      { action: "undo", revision: w.revision, requestId: randomUUID() },
      g.auth,
    )
  ).data;
  assert.equal(w.tables[0].rows[0].values.score, 4);
});
test("OAuth PKCE links account, rejects wrong verifier and code replay", async () => {
  const g = await preview();
  const user = (
    await call(
      "/api/auth/signup",
      { email: "oauth@example.test", password: "a-long-password-123" },
      g.auth,
    )
  ).data;
  const client = (
    await call("/register", {
      client_name: "Integration test",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    })
  ).data;
  assert.ok(client.client_id);
  const verifier = "x".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(base + "/authorize");
  Object.entries({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "test-state",
    scope: "tables",
    resource: "http://localhost:3000/mcp",
  }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, { redirect: "manual" });
  assert.equal(res.status, 302);
  const ticket = new URL(res.headers.get("location")!).searchParams.get(
    "connect",
  );
  const consent = await call("/api/connect", { ticket }, user.auth);
  assert.equal(consent.status, 200);
  const redirect = new URL(consent.data.redirect);
  assert.equal(redirect.searchParams.get("state"), "test-state");
  const code = redirect.searchParams.get("code")!;
  async function exchange(v: string) {
    return fetch(base + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        code,
        code_verifier: v,
        resource: "http://localhost:3000/mcp",
      }),
    });
  }
  assert.equal((await exchange("y".repeat(64))).status, 400);
  const exchanged = await exchange(verifier);
  assert.equal(exchanged.status, 200);
  const tokens = await exchanged.json();
  assert.ok(tokens.access_token);
  assert.equal((await exchange(verifier)).status, 400);
});
test("MCP advertises app and creates guest table without exposing browser credentials to model", async () => {
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_table",
        arguments: {
          name: "Test table",
          fields,
          rows: [{ name: "Example", score: 2 }],
          requestId: randomUUID(),
        },
      },
    }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.result.structuredContent.table.rows.length, 1);
  assert.ok(data.result._meta.auth);
  assert.equal(
    JSON.stringify(data.result.structuredContent).includes(
      data.result._meta.auth,
    ),
    false,
  );
});

test("sandbox subdomain preflight allows bearer requests but rejects lookalike origins", async () => {
  for (const origin of ["https://atablez-test.web-sandbox.oaiusercontent.com", "https://web-sandbox.oaiusercontent.com"]) {
    const r = await fetch(base + "/api/workspace", {method:"OPTIONS", headers:{Origin:origin,"Access-Control-Request-Headers":"authorization,content-type"}});
    assert.equal(r.headers.get("access-control-allow-origin"),origin);
  }
  for (const origin of ["https://evil.example", "https://atablez.web-sandbox.oaiusercontent.com.evil.example", "http://atablez.web-sandbox.oaiusercontent.com"]) {
    const r = await fetch(base + "/api/guest", {method:"POST", headers:{Origin:origin,"Content-Type":"application/json"},body:"{}"});
    assert.equal(r.status,403);
    assert.equal(r.headers.get("access-control-allow-origin"),null);
  }
});
