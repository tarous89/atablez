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
  for (const origin of [
    "https://atablez-test.web-sandbox.oaiusercontent.com",
    "https://web-sandbox.oaiusercontent.com",
  ]) {
    const r = await fetch(base + "/api/workspace", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    assert.equal(r.headers.get("access-control-allow-origin"), origin);
  }
  for (const origin of [
    "https://evil.example",
    "https://atablez.web-sandbox.oaiusercontent.com.evil.example",
    "http://atablez.web-sandbox.oaiusercontent.com",
  ]) {
    const r = await fetch(base + "/api/guest", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  }
});

test("workspace rename is persistent and undoable; numbering remains an editable field", async () => {
  const g = await preview();
  let w = await create(g);
  w = (
    await call(
      "/api/change",
      {
        action: "workspace",
        name: "Research workspace",
        revision: w.revision,
        requestId: randomUUID(),
      },
      g.auth,
    )
  ).data;
  assert.equal(
    (await call("/api/workspace", undefined, g.auth)).data.name,
    "Research workspace",
  );
  assert.equal(w.tables[0].rows[0].values.score, 4);
  w = (
    await call(
      "/api/change",
      { action: "undo", revision: w.revision, requestId: randomUUID() },
      g.auth,
    )
  ).data;
  assert.equal(w.name, "My workspace");
  const fields = [
    { id: "position", name: "Number", type: "integer" },
    { id: "company", name: "Company", type: "string" },
  ];
  w = (
    await call(
      "/api/change",
      {
        action: "create",
        name: "Numbered table",
        fields,
        rows: [{ position: 10, company: "Example" }],
        revision: w.revision,
        requestId: randomUUID(),
      },
      g.auth,
    )
  ).data;
  const t = w.tables[1];
  w = (
    await call(
      "/api/change",
      {
        action: "patch",
        tableId: t.id,
        rowId: t.rows[0].id,
        values: { position: 25 },
        revision: w.revision,
        requestId: randomUUID(),
      },
      g.auth,
    )
  ).data;
  assert.equal(w.tables[1].rows[0].values.position, 25);
  w = (
    await call(
      "/api/change",
      {
        action: "structure",
        tableId: t.id,
        fields: [fields[1]],
        confirmRemoval: true,
        revision: w.revision,
        requestId: randomUUID(),
      },
      g.auth,
    )
  ).data;
  assert.equal(w.tables[1].fields.length, 1);
  assert.equal(w.tables[1].rows[0].values.company, "Example");
});

async function account(prefix: string) {
  const g = await preview();
  const result = await call(
    "/api/auth/signup",
    {
      email: `${prefix}-${randomUUID()}@example.test`,
      password: "testing-strong-password",
    },
    g.auth,
  );
  assert.equal(result.status, 200);
  return {
    auth: result.data.auth,
    state: (await call("/api/workspace", undefined, result.data.auth)).data,
  };
}
async function share(
  owner: any,
  recipient: any,
  tableId: string,
  role = "viewer",
  teamId?: string,
) {
  const invite = await call(
    "/api/sharing",
    { action: "invite", tableId, role, teamId },
    owner.auth,
  );
  assert.equal(invite.status, 200);
  const token = new URL(invite.data.url).searchParams.get("invite");
  assert.equal(
    (await call("/api/invitation", { token }, recipient.auth)).status,
    200,
  );
  const pending = (
    await call("/api/sharing", undefined, owner.auth)
  ).data.invitations.find((x: any) => x.status === "requested");
  assert.ok(pending);
  assert.equal(
    (
      await call(
        "/api/sharing",
        { action: "approve", id: pending.id },
        owner.auth,
      )
    ).status,
    200,
  );
  assert.equal(
    (await call("/api/invitation", { token }, recipient.auth)).status,
    410,
  );
}
async function mcp(auth: string, name: string, args: any) {
  const r = await fetch(base + "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer " + auth,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return (await r.json()).result;
}
test("shared table ACLs apply to REST, MCP, hydration, minted UI tokens and revocation", async () => {
  const owner = await account("owner"),
    member = await account("member"),
    stranger = await account("stranger");
  let w = await create(owner);
  const shared = w.tables[0];
  w = (
    await call(
      "/api/change",
      {
        action: "create",
        name: "PRIVATE SECRET",
        fields,
        rows: [{ name: "Never disclose", score: 9 }],
        revision: w.revision,
        requestId: randomUUID(),
      },
      owner.auth,
    )
  ).data;
  const accessToken = await instance.s.credential(
    instance.s.query,
    member.state.id,
    "access",
    3600000,
    "test-client",
  );
  await share(owner, member, shared.id);
  const listed = (await call("/api/workspaces", undefined, member.auth)).data;
  assert.equal(
    listed.find((x: any) => x.id === owner.state.id).tables.length,
    1,
  );
  let visible = (
    await call(
      "/api/workspace?workspaceId=" + owner.state.id,
      undefined,
      member.auth,
    )
  ).data;
  assert.equal(visible.tables.length, 1);
  assert.equal(visible.canUndo, false);
  assert.equal(JSON.stringify(visible).includes("PRIVATE SECRET"), false);
  assert.equal(
    (
      await call(
        "/api/workspace?workspaceId=" + owner.state.id,
        undefined,
        stranger.auth,
      )
    ).status,
    404,
  );
  const op = {
    workspaceId: owner.state.id,
    tableId: shared.id,
    rowId: shared.rows[0].id,
    action: "patch",
    values: { score: 7 },
    revision: visible.revision,
    requestId: randomUUID(),
  };
  assert.equal((await call("/api/change", op, member.auth)).status, 403);
  assert.equal(
    (await call("/api/change", { ...op, action: "undo" }, member.auth)).status,
    403,
  );
  const read = await mcp(accessToken, "read_tables", {
    workspaceId: owner.state.id,
  });
  assert.equal(read.structuredContent.tables.length, 1);
  assert.equal(JSON.stringify(read).includes("PRIVATE SECRET"), false);
  assert.equal((await mcp(accessToken, "change_table", op)).isError, true);
  const panel = await mcp(accessToken, "open_workspace", {
    workspaceId: owner.state.id,
    tableId: shared.id,
  });
  assert.equal(panel._meta.state.tables.length, 1);
  assert.equal(JSON.stringify(panel).includes("PRIVATE SECRET"), false);
  assert.equal((await call("/api/change", op, panel._meta.auth)).status, 403);
  let grants = (await call("/api/sharing", undefined, owner.auth)).data.grants;
  assert.equal(
    (
      await call(
        "/api/sharing",
        { action: "role", id: grants[0].id, role: "editor" },
        owner.auth,
      )
    ).status,
    200,
  );
  const saved = await mcp(accessToken, "change_table", {
    ...op,
    requestId: randomUUID(),
  });
  assert.equal(saved.isError, undefined);
  assert.equal(saved._meta.state.tables[0].rows[0].values.score, 7);
  assert.equal(saved._meta.state.tables.length, 1);
  assert.equal(
    (
      await call(
        "/api/change",
        { ...op, action: "deleteTable", revision: saved._meta.state.revision },
        member.auth,
      )
    ).status,
    403,
  );
  await call(
    "/api/sharing",
    { action: "revoke", id: grants[0].id },
    owner.auth,
  );
  assert.equal(
    (
      await call(
        "/api/workspace?workspaceId=" + owner.state.id,
        undefined,
        panel._meta.auth,
      )
    ).status,
    404,
  );
  assert.equal(
    (await mcp(accessToken, "read_tables", { workspaceId: owner.state.id }))
      .isError,
    true,
  );
});
test("team membership and inherited workspace grants work without copying records", async () => {
  const owner = await account("team-owner"),
    member = await account("team-member");
  await create(owner);
  await call("/api/sharing", { action: "team", name: "Research" }, owner.auth);
  let info = (await call("/api/sharing", undefined, owner.auth)).data;
  const team = info.teams[0];
  await call(
    "/api/sharing",
    { action: "grantTeam", teamId: team.id, tableId: "*", role: "editor" },
    owner.auth,
  );
  await share(owner, member, "*", "viewer", team.id);
  let w = (
    await call(
      "/api/workspace?workspaceId=" + owner.state.id,
      undefined,
      member.auth,
    )
  ).data;
  assert.equal(w.role, "editor");
  const created = await call(
    "/api/change",
    {
      action: "create",
      workspaceId: owner.state.id,
      name: "Shared new",
      fields,
      rows: [],
      revision: w.revision,
      requestId: randomUUID(),
    },
    member.auth,
  );
  assert.equal(created.status, 200);
  assert.equal(created.data.tables.length, 2);
  info = (await call("/api/sharing", undefined, owner.auth)).data;
  await call(
    "/api/sharing",
    { action: "removeMember", teamId: team.id, userId: info.members[0].id },
    owner.auth,
  );
  assert.equal(
    (
      await call(
        "/api/workspace?workspaceId=" + owner.state.id,
        undefined,
        member.auth,
      )
    ).status,
    404,
  );
});
test("rich values, file validation, authorized download and reference isolation", async () => {
  const owner = await account("files-owner"),
    member = await account("files-member"),
    other = await account("files-other");
  let w = await create(owner),
    t = w.tables[0];
  const upload = await call(
    "/api/attachments",
    {
      workspaceId: w.id,
      tableId: t.id,
      name: "notes.txt",
      data: Buffer.from("Private attachment").toString("base64"),
    },
    owner.auth,
  );
  assert.equal(upload.status, 200);
  assert.equal(
    (await call("/api/attachments/" + upload.data.id, undefined, other.auth))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        "/api/attachments",
        {
          workspaceId: w.id,
          tableId: t.id,
          name: "x.png",
          data: Buffer.from("Not a PNG").toString("base64"),
        },
        owner.auth,
      )
    ).status,
    400,
  );
  const richer = [
    ...fields,
    { id: "progress", name: "Progress", type: "progress" },
    { id: "file", name: "Files", type: "files" },
  ];
  w = (
    await call(
      "/api/change",
      {
        action: "structure",
        tableId: t.id,
        fields: richer,
        revision: w.revision,
        requestId: randomUUID(),
      },
      owner.auth,
    )
  ).data;
  const op = {
    action: "patch",
    tableId: t.id,
    rowId: t.rows[0].id,
    revision: w.revision,
    requestId: randomUUID(),
  };
  assert.equal(
    (
      await call(
        "/api/change",
        { ...op, values: { progress: 101 } },
        owner.auth,
      )
    ).status,
    400,
  );
  w = (
    await call(
      "/api/change",
      { ...op, values: { progress: 0, file: [upload.data.id] } },
      owner.auth,
    )
  ).data;
  assert.equal(w.tables[0].rows[0].values.progress, 0);
  await share(owner, member, t.id);
  assert.equal(
    (await call("/api/attachments/" + upload.data.id, undefined, member.auth))
      .status,
    200,
  );
  assert.equal(
    (
      await call(
        "/api/attachments",
        {
          workspaceId: w.id,
          tableId: t.id,
          name: "x.txt",
          data: Buffer.from("x").toString("base64"),
        },
        member.auth,
      )
    ).status,
    403,
  );
  const b = await create(other);
  assert.equal(
    (
      await call(
        "/api/change",
        {
          action: "structure",
          tableId: b.tables[0].id,
          fields: [
            ...fields,
            {
              id: "bad",
              name: "Bad file",
              type: "files",
              fixed: true,
              fixedValue: [upload.data.id],
            },
          ],
          confirmRemoval: true,
          revision: b.revision,
          requestId: randomUUID(),
        },
        other.auth,
      )
    ).status,
    400,
  );
  const grants = (await call("/api/sharing", undefined, owner.auth)).data
    .grants;
  await call(
    "/api/sharing",
    { action: "revoke", id: grants[0].id },
    owner.auth,
  );
  assert.equal(
    (await call("/api/attachments/" + upload.data.id, undefined, member.auth))
      .status,
    404,
  );
});
