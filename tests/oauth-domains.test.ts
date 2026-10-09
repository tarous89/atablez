import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

process.env.TEST_MODE = "1";
process.env.TEST_DB = "memory";
process.env.PUBLIC_URL = "https://app.atablez.com";
const { createApp } = await import("../server/index.ts");

test("ChatGPT domain migration accepts both exact resources through authorization and refresh", async () => {
  const instance = await createApp();
  const http = instance.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const base = `http://127.0.0.1:${(http.address() as any).port}`;
  const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
  const verifier = "x".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  async function post(path: string, body: any, token?: string) {
    return fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  }
  try {
    const guest = await (await post("/api/guest", {})).json();
    const user = await (await post("/api/auth/signup", {
      email: "migration@example.test", password: "a-long-password-123",
    }, guest.auth)).json();
    const client = await (await post("/register", {
      client_name: "Domain migration regression", redirect_uris: [redirect],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    })).json();
    async function authorize(resource: string) {
      return fetch(base + "/authorize?" + new URLSearchParams({
        client_id: client.client_id, redirect_uri: redirect, response_type: "code",
        code_challenge: challenge, code_challenge_method: "S256", scope: "tables", resource,
      }), { redirect: "manual" });
    }
    async function exchange(body: Record<string, string>) {
      return fetch(base + "/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: client.client_id, ...body }),
      });
    }
    for (const resource of ["https://atablez.onrender.com/mcp", "https://app.atablez.com/mcp"]) {
      const auth = await authorize(resource);
      assert.equal(auth.status, 302);
      const login = new URL(auth.headers.get("location")!);
      assert.equal(login.origin, "https://app.atablez.com");
      const consent = await (await post("/api/connect", { ticket: login.searchParams.get("connect") }, user.auth)).json();
      const code = new URL(consent.redirect).searchParams.get("code")!;
      const response = await exchange({ grant_type: "authorization_code", code,
        redirect_uri: redirect, code_verifier: verifier, resource });
      assert.equal(response.status, 200);
      const tokens = await response.json();
      const denied = await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token,
        resource: "https://unrelated.example/mcp" });
      assert.equal(denied.status, 400);
      const refreshed = await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, resource });
      assert.equal(refreshed.status, 200);
      const next = await refreshed.json();
      const mcp = await fetch(base + "/mcp", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${next.access_token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_tables", arguments: {} } }),
      });
      assert.equal(mcp.status, 200);
      const result = await mcp.text();
      assert.ok(!result.includes('"isError":true'), result);
    }
    for (const resource of ["https://unrelated.example/mcp", "http://atablez.onrender.com/mcp", "https://app.atablez.com/other", "https://app.atablez.com.evil.example/mcp"]) {
      const denied = await authorize(resource);
      assert.match(denied.headers.get("location") || await denied.text(), /invalid_request/);
    }
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await instance.close();
  }
});
