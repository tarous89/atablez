# AtableZ

ChatGPT-first reusable tables with a shared web and MCP App editor. Private beta implementation.

## Run locally

Node 24 recommended.

```sh
npm ci
npm run build
npm start
```

Open http://localhost:3000. Local development uses PGlite under `.local/db`; production requires `DATABASE_URL` and uses PostgreSQL. No model API key is required.

```sh
npm test
npm run build
```

## What works

- Top navigation, table gallery, direct editing of titles, descriptions, and cells.
- Column structure editor: name, description, filling instruction, type, required/fixed value, order.
- One-hour guest previews enforced by the backend; signup retains the data; login can merge a guest preview.
- Integer/number/date/boolean/choice/link/text validation; conflicts and retry-safe mutations.
- Search, sort, incomplete-entry filter, CSV export, entry detail, ten-change undo history.
- PostgreSQL-backed password accounts, OAuth 2.1 authorization with PKCE via the MCP SDK, rotating refresh tokens.
- MCP tools and a shared self-contained MCP App with global/thread entrypoints and fullscreen preference.

## Deploy on Render

Apply `render.yaml` using:

https://dashboard.render.com/blueprint/new?repo=https://github.com/tarous89/atablez

This defines a dedicated app and Postgres database in Frankfurt. Free plans are for testing: the web service sleeps and the database expires after 30 days. Upgrade both before promising durable public storage. `RENDER_EXTERNAL_URL` supplies the canonical origin automatically; set `PUBLIC_URL` to the HTTPS origin if using a custom domain.

No email provider is connected yet. Signup uses email/password without email delivery. Email verification, recovery, public legal pages, account deletion, and production backup/restore checks are public-release gates.

## Connect in ChatGPT

After deployment, use `https://YOUR-RENDER-HOST/mcp` as the MCP endpoint. OAuth metadata and registration endpoints are served automatically. The app's Connect flow includes an explicit consent screen and returns to ChatGPT.

`create_table` can create an unsigned one-hour preview. Its browser credential is returned only in tool-result `_meta`, not model-readable content. The preview can be edited in its panel. Other chat-driven retrieval/mutation tools require OAuth account connection. Guest follow-up continuity and the actual panel display must be verified on the target ChatGPT host before calling the plugin ready.

The bundle contains no deployed URLs or credentials. A final installable plugin package is generated only after a deployed endpoint is verified. Server tooling has been tested locally; no public directory submission has been made.

## Architecture and limits

A React editor is bundled into one HTML resource for web and MCP. An Express service exposes browser APIs and SDK-based MCP/OAuth endpoints. Workspaces are stored as bounded PostgreSQL JSONB documents with row-level transaction locking and revisions. This first beta favors simple atomic operations; normalize entries and move filters into indexed SQL before increasing the 2,000-entry account cap.

Guest sessions: 3 tables / 100 entries / 1 hour. Accounts: 20 tables / 2,000 entries. 50 columns per table; maximum 5 MB serialized workspace including history. Cleanup runs every minute while the service is active; all access checks expiry even when the server was asleep. Browser sessions use sessionStorage; embedded credentials stay in memory. Saved account data remains in PostgreSQL after the browser session ends.

See [PROJECT.md](PROJECT.md) for agreed scope, exact delivery status, and remaining work.
