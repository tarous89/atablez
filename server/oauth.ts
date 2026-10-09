import { randomUUID } from "node:crypto";
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidRequestError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { Store } from "./store.ts";
import { hash, token } from "./store.ts";
export function oauth(s: Store, base: string): OAuthServerProvider {
  const resource = `${base}/mcp`;
  const get = async (id: string, kind: string) => {
    const r = (
      await s.query(
        "SELECT data FROM oauth_data WHERE id=$1 AND kind=$2 AND (expires_at IS NULL OR expires_at>$3)",
        [id, kind, Date.now()],
      )
    ).rows[0];
    if (!r) throw new InvalidGrantError("Invalid or expired authorization");
    return r.data;
  };
  const issue = async (q: any, workspace: string, clientId: string) => ({
    access_token: await s.credential(q, workspace, "access", 3600000, clientId),
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: await s.credential(
      q,
      workspace,
      "refresh",
      30 * 86400000,
      clientId,
    ),
    scope: "tables",
  });
  return {
    clientsStore: {
      getClient: async (id) => {
        try {
          return await get(id, "client");
        } catch {
          return undefined;
        }
      },
      registerClient: async (client) => {
        if (
          client.redirect_uris.some((uri) => {
            try {
              const u = new URL(uri);
              return (
                u.protocol !== "https:" &&
                !(
                  process.env.NODE_ENV !== "production" &&
                  u.hostname === "localhost"
                )
              );
            } catch {
              return true;
            }
          })
        )
          throw new InvalidRequestError("HTTPS redirect URIs required");
        const data = {
          ...client,
          client_id: randomUUID(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        await s.query("INSERT INTO oauth_data VALUES($1,$2,NULL,$3)", [
          data.client_id,
          "client",
          JSON.stringify(data),
        ]);
        return data;
      },
    },
    authorize: async (client, params, res) => {
      if (params.resource && params.resource.href !== resource)
        throw new InvalidRequestError("Wrong resource");
      if (params.scopes?.some((x) => x !== "tables"))
        throw new InvalidRequestError("Unknown scope");
      const ticket = token();
      await s.query("INSERT INTO oauth_data VALUES($1,$2,$3,$4)", [
        hash(ticket),
        "pending",
        Date.now() + 600000,
        JSON.stringify({
          clientId: client.client_id,
          clientName: client.client_name || "ChatGPT",
          ...params,
          resource,
        }),
      ]);
      res.redirect(`${base}/?connect=${ticket}`);
    },
    challengeForAuthorizationCode: async (client, code) => {
      const data = await get(hash(code), "code");
      if (data.clientId !== client.client_id)
        throw new InvalidGrantError("Wrong client");
      return data.codeChallenge;
    },
    exchangeAuthorizationCode: async (
      client,
      code,
      _verifier,
      redirectUri,
      requested,
    ) =>
      s.transaction(async (q) => {
        const row = (
          await q(
            "DELETE FROM oauth_data WHERE id=$1 AND kind=$2 AND expires_at>$3 RETURNING data",
            [hash(code), "code", Date.now()],
          )
        ).rows[0];
        if (
          !row ||
          row.data.clientId !== client.client_id ||
          row.data.redirectUri !== redirectUri ||
          (requested && requested.href !== resource)
        )
          throw new InvalidGrantError("Invalid code");
        return issue(q, row.data.workspace, client.client_id);
      }),
    exchangeRefreshToken: async (client, refresh, scopes, requested) =>
      s.transaction(async (q) => {
        if (
          scopes?.some((x) => x !== "tables") ||
          (requested && requested.href !== resource)
        )
          throw new InvalidGrantError("Invalid scope/resource");
        const r = (
          await q(
            "DELETE FROM credentials WHERE hash=$1 AND kind=$2 AND client_id=$3 AND expires_at>$4 RETURNING workspace_id",
            [hash(refresh), "refresh", client.client_id, Date.now()],
          )
        ).rows[0];
        if (!r) throw new InvalidGrantError("Invalid refresh token");
        return issue(q, r.workspace_id, client.client_id);
      }),
    verifyAccessToken: async (value) => {
      try {
        const c = await s.identify(value, "access");
        return {
          token: value,
          clientId: c.client_id,
          scopes: ["tables"],
          expiresAt: Math.floor(Number(c.expires_at) / 1000),
          resource: new URL(resource),
          extra: { workspace: c.workspace_id },
        };
      } catch {
        throw new InvalidTokenError("Invalid or expired token");
      }
    },
    revokeToken: async (client, req) => {
      await s.query("DELETE FROM credentials WHERE hash=$1 AND client_id=$2", [
        hash(req.token),
        client.client_id,
      ]);
    },
  };
}
