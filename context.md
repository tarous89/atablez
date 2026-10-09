# AtableZ — working context

Updated: 2026-10-09. Owner: Tarek Roustom. Repo: https://github.com/tarous89/atablez.

## Product and interfaces

AtableZ: **Your custom reusable database.** ChatGPT-first reusable structured tables, with one shared React UI for the website and embedded ChatGPT app. Top navigation, inline editing, rich field types, saved appearance, and owner-controlled Viewer/Editor sharing. Workspace rather than projects. General / Workspace / Team settings. General shows email/password/sign-out and actual file/table/row usage. No billing or upgrade buttons.

Appearance is deterministic validated data (dimensions, colors, conditional rules) plus optional original user prompt; never arbitrary generated executable code. ChatGPT and manual changes use the same revision-checked service. Settings opened from a table targets that table, not workspace defaults. Enter/blur saves numeric settings with visible validation/status. Current resource: ui://atablez/workspace-v5.html (old aliases supported). Refresh the custom ChatGPT connection after resource/tool metadata changes.

## Hosting and identity

- Existing Render service: `srv-db4aism0tbcc73do32l0`, workspace `tea-cspqipl6l47c739nslfg`, Frankfurt, free. Auto-deploy from main; do not manually trigger another deploy after pushing.
- Existing address: https://atablez.onrender.com. Keep working for existing OAuth and ChatGPT connections during migration.
- Database: `dpg-db4aije0tbcc73do24rg-a`, free PostgreSQL, expires 2026-11-08T08:43:58Z. Upgrade before relying on storage beyond that date.
- Actual ChatGPT custom app: `asdk_app_6ac8b3f0b32c8191b910bdef2f0f87aa`. Do not update/recreate the unrelated old desktop-only plugin archive.
- Last verified live release before domain work: `df8aedf1fded26ab5d7c11fd9c4ba29e6cfd4310`.

## Confirmed domain decision (2026-10-09)

User owns AtableZ.com and explicitly requested:

| Purpose | Address |
| --- | --- |
| Landing page | https://atablez.com |
| App | https://app.atablez.com |
| Invitation sender | AtableZ <invite@atablez.com> |
| Future canonical MCP endpoint | https://app.atablez.com/mcp |

Use the existing Render service for both website hosts; no extra compute/database is required for the implementation. Root hostname serves public/landing.html; app hostname serves the existing app. /welcome previews the landing page on the current Render hostname. render.yaml declares the two intended domain associations; **this is not confirmation they have been applied in Render**.

DNS inspected: IONOS nameservers (`ns1104.ui-dns.biz`, `ns1066.ui-dns.com`, `ns1068.ui-dns.de`, `ns1036.ui-dns.org`). Existing apex A is 217.160.0.207; AAAA is 2001:8d8:100f:f000::200. Existing root MX records are mx00.ionos.de / mx01.ionos.de, priority 10; preserve them. No DNS records have been changed by the agent.

### Website DNS to apply after binding domains in Render

| Type | Host | Value |
| --- | --- | --- |
| CNAME | app | atablez.onrender.com |
| A | @ | 216.24.57.1 |

Replace the existing apex website A and remove its conflicting AAAA when moving the website. Check for conflicting app A/AAAA/CNAME before applying. Preserve unrelated email records. Render reference: https://render.com/docs/configure-other-dns . Add app.atablez.com and atablez.com in the existing service's Custom Domains (or sync the Blueprint); verify DNS and TLS before changing canonical PUBLIC_URL. Do not disable the onrender.com subdomain.

### Resend setup

Resend domain `atablez.com` created in eu-west-1; sending enabled, receiving disabled, open/click tracking disabled. Domain ID: `f562e746-d14f-4482-8fdb-492c26800e29`. Verification pending DNS. Resend conversation ID for follow-up calls: `01a1208b-618e-71c6-8c55-6cb8e18930de` (reuse exactly; do not invent a new one).

Add these exact provider-returned DNS records (TTL Auto / IONOS default):

| Type | Host | Value | Priority |
| --- | --- | --- | --- |
| TXT | resend._domainkey | p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDrU/xdfCQ+U5AbcGMVfe0ZUbZWBKz/XIU1ptbdCANLiy3xzeq3fc16PxbXpY4ybjrZIUs6fmdmfeLjuT0kgvT237KvmPk0anskGRCI9WrbKOFWvbYPEkbbDocKpG6VEJcUXuj0y4Cu8Kh6EGMYJT1wanIF6IP8wsKsyvu9ZTCCowIDAQAB | — |
| MX | send | feedback-smtp.eu-west-1.amazonses.com | 10 |
| TXT | send | v=spf1 include:amazonses.com ~all | — |
| CNAME | rsend | send.forge.rmta.net | — |

Inspect existing _dmarc before adding/modifying DMARC. Do not replace root SPF/MX with the send subdomain records. Resend sending does not create an incoming mailbox for invite@atablez.com.

After DNS verifies, create a sending-only Resend key scoped to this domain and put it in the existing Render service's RESEND_API_KEY secret; set INVITE_FROM to `AtableZ <invite@atablez.com>`. Never commit secrets. The Resend key-creation tool requires showing its once-only token to the owner; handle the tool response carefully. No key has been created and production email sending is still disabled. No real test invitations are authorized.

### Migration sequence / outstanding access

1. Finish IONOS DNS and Render custom-domain bindings. Available connected tools cannot edit IONOS DNS or Render domain bindings; browser fallback requires user permission under the browser tool rules. Do not claim this step done based on the Blueprint file alone.
2. Verify website TLS, root landing page, app routes, API origins and Resend domain authentication.
3. Configure the scoped email key and INVITE_FROM; verify configuration without emailing real recipients.
4. Set PUBLIC_URL=https://app.atablez.com once it is reachable. Verify OAuth discovery/consent and MCP resource/CSP URLs; keep the existing hostname working and explain any required ChatGPT reconnection.

## Email and access behavior

Invitations are implemented for app and MCP, with recipient binding, explicit delivery failure results, retry IDs, 30/day/owner cap, and owner approval after the recipient signs in. Accounts currently lack verified-email signup/password recovery. Never silently grant permissions based on an entered email address. Only owners manage grants/teams. Shared users retain their own actor identity through browser and OAuth tokens.

## Quotas and verification

Guest preview: 1 hour, 3 tables, 100 rows, 5 MiB files. Saved account: 20 tables, 2,000 rows, 20 MiB files; bounded JSON workspace storage, global upload budget and 2 MiB/file. Private beta; no promise of unlimited storage.

Build: npm run build. Integration: npm test (13 tests). Browser/sandbox: CHROMIUM_PATH=/tmp/atablez-chromium npm run test:ui (the /tmp/chromium file is unusable). Existing tests cover ACLs, OAuth, appearance/undo, chat-to-settings height edits, attachments and mocked email delivery. Main is pushed using GitHub connector with expected-SHA guard because local git HEAD is older than the remotely published tree; never blindly reset or force-push the local checkout.

See PROJECT.md for full implementation history. Keep both context.md and PROJECT.md current, and separate prepared / deployed / DNS verified / email enabled states.

Domain-preparation validation: production build/TypeScript passed. Local proxy-host checks passed for apex landing vs app/legacy editor, invitation handoff, and desktop/mobile rendering with no page overflow or browser errors. Repeat with `CHROMIUM_PATH=/tmp/atablez-chromium node --import tsx scripts/check-domains.mjs`. This verifies source behavior, not live DNS/TLS.

## DNS follow-up — 2026-10-09 13:18 UTC

User confirmed saving IONOS records. Public DNS checks now return the expected app CNAME, apex A 216.24.57.1 (some resolver caches still return the former IP), no apex AAAA, and all four exact Resend records. Resend verification was triggered and remains pending. HTTPS checks for custom hosts have not succeeded yet; keep PUBLIC_URL unchanged until verified. No API key created or actual invitation sent. Domain preparation release 58fb5af011931ae5669cae6efb99ed47dc5798be deployed successfully through Blueprint sync.

## Domain activation — 2026-10-09 14:46 UTC

Both https://atablez.com (landing) and https://app.atablez.com (app and health endpoint) return HTTP 200 over valid HTTPS. Resend domain and all four records are verified. A sending-only key restricted to this domain was created and installed in Render RESEND_API_KEY; never copy the token into this file. INVITE_FROM is AtableZ <invite@atablez.com>. PUBLIC_URL updated to https://app.atablez.com and declared in Blueprint. Runtime configuration deployment triggered automatically. Legacy origin explicitly retained in CORS so existing browser sessions keep working. No real test email sent. Existing ChatGPT connection may need refreshing for the new canonical OAuth/MCP host; do not claim installed connection refreshed. These verified facts supersede earlier pending-status entries.

## OAuth migration regression — 2026-10-09

User screenshot showed `OAuth failed: invalid_request - Wrong resource` on reconnect. Cause: changing PUBLIC_URL made authorization/code exchange/refresh reject the legacy MCP resource used by the existing ChatGPT installation. Provider now treats only the two exact production HTTPS MCP URLs (app.atablez.com/mcp and atablez.onrender.com/mcp) as equivalent resources for this same service. Other origins, paths, HTTP and lookalike hosts remain rejected. Login stays on the new app host; account, PKCE, client, token rotation and ACL checks remain intact. Added HTTP regression covering both resources, consent, code exchange, refresh, authenticated MCP read and invalid resource rejection. User must retry Reconnect after the fix deploys; installed ChatGPT flow is not directly verified by local tests.

## Password minimum — 2026-10-09

User requested a 6-character minimum instead of 12. Signup and account password changes now enforce 6 characters, with matching validation messages. Both app and ChatGPT extension use these shared endpoints. This supersedes the previous 12-character policy; login still accepts existing passwords.

## ChatGPT-first connection experience — 2026-10-09

OAuth ?connect tickets now render a dedicated centered connection screen instead of the app dashboard and its banner. Signup/sign-in explicitly consents to table access and immediately completes the existing OAuth callback; signed-in users approve with Connect & return to ChatGPT. The normal app is optional. Embedded top navigation includes Open app, and existing full settings remain embedded. Embedded signup remains supported; permanent ChatGPT account linking still uses the host OAuth flow (do not promise iframe signup alone links ChatGPT). No auth/security changes. Official reference: https://developers.openai.com/plugins/build/auth .

Connection UI validation: production build and OAuth migration regression passed. Browser visual test unavailable because Chromium download returned an invalid archive. Resource bumped to v5 with earlier aliases retained; verify installed ChatGPT UI after refresh.
