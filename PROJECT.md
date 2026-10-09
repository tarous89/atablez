# AtableZ — scope and project status

Last updated: 2026-10-09
Repository: https://github.com/tarous89/atablez
Stage: first private-beta implementation built locally; deployment and live ChatGPT validation pending.
Owner: Tarek Roustom

## 1. Product and agreed direction

AtableZ is a ChatGPT-first product for saving information into reusable, user-defined tables and retrieving, comparing, and updating it across conversations.

Core promise: "Save this as a table. Keep using it."

The first successful interaction creates a useful table with real entries from the conversation and opens the editable workspace alongside chat, on supported hosts. Users should not have to complete a schema wizard first.

Confirmed requirements:
- Name: AtableZ. This is the chosen working name; its trademark/domain availability has not been checked. AnyTable was rejected following existing-use findings.
- Source code and living project documentation stay in this GitHub repository.
- Owner-controlled hosting on Render, using dedicated AtableZ app and PostgreSQL services. No Cloudflare/Supabase or Sites hosting.
- ChatGPT is the primary entry point; the website provides the same editor and access to existing work.
- One personal workspace per user initially; no projects.
- Top navigation only; preserve horizontal room for tables.
- Direct click-to-edit table names, descriptions, and entry values; no edit-mode buttons.
- Modify table opens a structure editor for column names, descriptions, data types, and filling instructions.
- Tables are the primary interface; reusable structured notes/forms are also supported.
- Users can create and edit structures and data through chat or directly in the app.
- Field and collection instructions tell ChatGPT how to fill future entries.
- Temporary free guest use; authentication required to retain work in an account.
- Free initial product with bounded usage. Billing is outside the MVP.
- Changes made through chat appear in the open extension.
- Persistent records must be retrievable in later conversations when the plugin is connected and invoked.

The differentiation is reliable accumulation and management of structured records: exact filtering, stable record identity, updates without duplicates, consistent templates, and missing-field visibility.

## 2. Vocabulary and data model

Use "Tables" in the UI rather than asking users to learn "collections."

- Workspace: privately owned container for all tables.
- Table: name, description, collection-level filling instructions, template, and entries.
- Template: versioned field definitions plus an ordered structured-note layout.
- Entry/row: one saved item with a stable ID and values keyed by stable field IDs.
- Views: table grid and structured note/detail view of the same entry data.
- Section: an optional layout group containing fields, such as title, description, and score.

A form is a reusable entry layout, not a separate disconnected database. A notes-first template may open in detail view while its entries remain available in a table.

Each field contains:
- Stable ID, editable display name, optional description.
- Type: short text, long text, number, date, single choice, multiple choice, checkbox, URL.
- Filling instruction: a short prompt describing what belongs here.
- Required/optional setting.
- Constraints appropriate to the type: min/max, allowed choices, length.
- Value mode: variable or fixed; optional default.
- Display order and section assignment.

Fixed values are preserved by record-writing tools; changing them requires an explicit template edit. Defaults apply only to new values. Prompt instructions and enforced validation remain separate.

Example: a "Product assessment" table has a variable product-name title, a long-text description instructed to summarize intended use, and a numeric score constrained to 1–10.

Suggested physical entities: workspaces, tables, template_versions, entries, change_events, guest_sessions, and account/linking records as required by the chosen auth integration. Store flexible entry values in PostgreSQL JSONB keyed by field IDs; do not create physical SQL tables from user-provided names. Scope all records to a workspace.

## 3. MVP user journeys

### A. First save without configuration

1. User invokes AtableZ and asks to save information from the conversation.
2. ChatGPT infers a sensible table name, typed fields, and concise reusable instructions.
3. Server validates and saves the structure and entries atomically.
4. The side panel opens the saved table and indicates the changes.
5. User can rename columns, edit values, or ask for changes in chat.
6. A guest retention notice explains when the draft expires and how to keep it.

Do not invent missing facts. Leave unknown values blank and flag incomplete entries. Ask only when ambiguity would materially affect record identity or the saved structure.

### B. Keep adding across conversations

1. Authenticated user asks to add more items or use an existing template.
2. Plugin lists/searches accessible tables and retrieves the relevant template.
3. ChatGPT applies collection and field instructions.
4. Plugin adds new entries or updates explicitly identified existing entries.
5. It returns affected IDs, saved values, and validation feedback.

Never rely on ChatGPT remembering the schema. Retrieve it when needed. Do not silently copy the entire workspace into context.

### C. Read, compare, and update

- Search tables by name and description.
- Filter records by typed values; sort, paginate, count, and compute basic count/sum/average/min/max for numeric fields.
- Search text inside one table.
- Open an entry as a structured note and edit it.
- Distinguish add from update. Preview ambiguous duplicate matches.
- Exact-ID updates preserve unspecified fields.
- Tool retries do not create duplicate writes.
- Concurrent edits produce a visible conflict rather than silently overwrite each other.
- Saved results can be returned to chat or exported.

### D. Reusable structured notes

- Create a template from an example document's content supplied by ChatGPT.
- Define ordered sections, headings, text, and metadata fields.
- Choose fixed headings or entry-specific title fields.
- Fill repeatedly into new entries.
- Edit the template in the UI or by explicit chat request.
- Export a note as Markdown; retain CSV/JSON for structured data.

MVP consumes text/structured content supplied to the tool. It does not build a separate OCR/document parsing pipeline or promise permanent storage of original attachments.

### E. Guest to account

- Provide a temporary workspace before signup.
- Signup/login preserves the draft and returns to the original table.
- A signed, single-use claim operation transfers guest ownership atomically.
- Account creation, web login, and ChatGPT account linking are distinct states that the UI must explain accurately.
- Verify the authenticated plugin can retrieve the claimed table in a new conversation.
- Guest data is never public merely because someone knows a table ID.
- Guest credentials must not be placed in model-visible tool output or exposed as public share links.
- Prototype host-compatible guest persistence early. If safe no-auth access is unsupported on a target surface, explain the limitation and require connection; do not weaken access control.

## 4. UI scope

Shared responsive React editor in the embedded panel and standalone web app:
- Workspace home with table search, entry counts, and recent updates.
- Table grid with inline edits, sorting, filters, column resizing, and pagination.
- Entry detail / structured note editor.
- Template editor for fields, instructions, validation, fixed values, and sections.
- Chat-driven changes highlighted after committed saves.
- Saving/saved/error state; refresh must retain committed changes.
- Simple recent change history and undo for supported data edits.
- Clear guest expiry, sign-in, account-link, and quota states.
- Export controls and account/data deletion controls.

Avoid a second chatbot inside the web app for MVP. Manual editing must work independently of ChatGPT.

## 5. Proposed technical approach

Implemented architecture:
- TypeScript, React, Express, official MCP SDK and MCP Apps SDK.
- One dedicated Render web service serves API, MCP/OAuth, and the same bundled UI used on the web and in ChatGPT.
- Dedicated Render PostgreSQL. Local development/tests use PGlite; production refuses to start without DATABASE_URL.
- Workspace data uses bounded JSONB documents with transaction locks and revisions for this private beta. Maximum 2,000 entries/account. Normalize entry storage and indexed queries before raising limits.
- Scrypt password hashing, opaque sessions stored hashed in PostgreSQL, standard SDK OAuth routes with PKCE and rotating refresh tokens. No Supabase dependency.
- Authenticated polling refreshes the UI after chat writes; polling pauses while an input is focused.
- Inline app resource with fullscreen preference and global/thread entrypoints. Host behavior still needs live validation.
- No model API or API key required.

Repository layout:
- server/ — database adapter, domain validation, service layer, web APIs, OAuth, MCP.
- web/ — shared editor and styling.
- tests/ — backend integration tests.
- scripts/check-ui.mjs — browser workflow check.
- render.yaml — app + PostgreSQL Blueprint.
- PROJECT.md — scope, decisions, status, and handoff.

Hosting decisions:
- Render chosen by user, replacing the earlier Cloudflare + Supabase proposal.
- Blueprint uses free test plans because paid instance sizes have not been selected. Free database expires after 30 days; free app sleeps. Do not promise durable public storage on this configuration.
- Small paid app + database starts around $13/month at reviewed pricing, before overages; sizing remains a deployment decision.
- No resources or subscriptions have been created. Render's connected workspace must be confirmed before provisioning.

## 6. Proposed defaults, not yet user-approved product policy

These can be changed without blocking the first implementation:
- Guest retention: **one hour from creation**, explicitly confirmed by the user on 2026-10-09. Enforced server-side; signup retains the workspace.
- Guest limits: 3 tables, 100 total entries.
- Free account limits: 20 tables, 2,000 total entries, 50 fields per table, plus explicit byte/request limits.
- English UI initially.
- Email-based account access initially; evaluate additional sign-in methods during auth spike.
- 30-day recoverable deletion/change-history window where feasible.
- Application payload limits and usage rate limits are enforced server-side.

Final retention, backup, privacy, and quota policies must be settled before public launch. Restores must honor subsequent account deletion requests.

## 7. MCP capability scope

Proposed operations, to refine during SDK implementation:
- Open workspace or a particular table.
- List/search tables; read template and layout.
- Create table with fields and initial rows in one operation.
- Edit table metadata/template with expected revision.
- Query entries with typed filters, pagination, counts, and bounded aggregates.
- Read one or selected entries.
- Add or patch entries with idempotency keys and expected revisions.
- Preview destructive schema/data changes, then apply the explicit requested operation.
- Delete/restore entries; undo supported changes.
- Export selected or filtered data.

Keep responses bounded. Return IDs, revisions, actual affected rows, and authoritative counts; do not represent a paginated sample as the complete result. Reject unknown field IDs and invalid types. Account/workspace scope comes from verified credentials, never a caller-supplied user ID.

Discovery descriptions should emphasize saving reusable tables and updating persistent records. Test direct requests, requests without the brand name, and cases where native chat is sufficient. Do not force activation for every mention of a table.

## 8. Data behavior and reliability

- Validate all writes on the server.
- Draft entries may omit required values; completion validation lists missing fields.
- Template renames preserve field IDs and data.
- Added fields do not fabricate values in existing entries.
- Field deletion/type conversion requires an impact preview and recoverable handling of old values.
- Template versions retain the schema needed to interpret older entries.
- Store optional source URLs, source excerpts, timestamps, and whether a value was supplied or inferred. Do not invent a chat URL.
- Record data is untrusted content, never executable instructions. Template instructions cannot override permissions.
- Parameterized database operations; no arbitrary model-generated SQL execution.
- Private-by-default data, minimal operational logs without saved record text or tokens.
- CSV export neutralizes spreadsheet formula injection.
- Backups and restore verification before depending on the service for durable production storage.

## 9. Out of MVP

Team workspaces and permissions, projects/folders, public sharing, live multi-user editing, boards/calendars, formulas, linked-table relationships, attachments/OCR, scheduled refreshes, web scraping, autonomous enrichment, external integrations, billing, and a separate website chatbot.

PDF/DOCX output can initially be created by ChatGPT from retrieved records; dedicated server-side generation is deferred.

## 10. Milestones and acceptance gates

| Milestone | Deliverable | Acceptance gate | Status |
| --- | --- | --- | --- |
| M0 Scope | Living plan in repo | Requirements and proposed defaults separated | Complete |
| M1 Integration spike | Minimal real MCP + panel + auth/guest proof | Save a row, see it in panel, link account, retrieve in another conversation | Local MCP/OAuth tested; live ChatGPT pending |
| M2 Data foundation | Migrations, validation, ownership, revisions | Cross-user access denied; retry-safe writes; conflicts detected | Initial implementation tested; production migrations/restore pending |
| M3 Shared table editor | Browser/panel grid and template editing | Edits persist and appear through both interfaces | Implemented; browser QA passed, hosted panel pending |
| M4 Reusable entries | Structured note view, query, export, history | Reuse template; filter/count accurately; undo supported edit | Basic entry detail/export/undo implemented; advanced query and note layouts pending |
| M5 Guest/account flow | Claim, expiry, limits | Existing and new-account claims work without losing data | Local integration tests pass; email verification/recovery pending |
| M6 Private beta | Deployment, monitoring, recovery, plugin package | Full end-to-end checks on supported target hosts | Not started |
| M7 Public release | Listing, policy pages, support, submission | Name check, production budget, and launch gates resolved | Not started |

The first build should be one vertical slice: create a supplier table from chat, open it beside chat, edit one price, authenticate and preserve it, then find/update the same supplier in a new conversation.

Meaningful verification:
- Isolation between two users and between guest sessions.
- OAuth return and account claim on fresh and existing accounts.
- Retry idempotency and stale-edit conflict handling.
- Required/type/range validation and template changes without data loss.
- UI/tool consistency and bounded pagination with correct counts.
- Guest expiry, deletion, export, and backup restore.
- SDK/host-specific panel opening and updates.
- Target warm-server save/read p95 under 2 seconds on a documented representative dataset; measure rather than promise host/model latency.

## 11. Decisions and handoff

| Date | Decision | Basis |
| --- | --- | --- |
| 2026-10-09 | Working name AtableZ | User selected name and existing repo |
| 2026-10-09 | GitHub source and owner-hosted service | Explicit user preference |
| 2026-10-09 | Tables primary; reusable structured notes share records | User table-first direction and earlier agreed model |
| 2026-10-09 | Build authorized | User approved first implementation |
| 2026-10-09 | Render app + Render PostgreSQL | User selected Render after cost comparison |
| 2026-10-09 | One-hour guest preview, top navigation, direct editing | Explicit latest user requirements |

Current verified state:
- Initial app, shared editor, persistent backend, OAuth, MCP tools, and Render Blueprint implemented.
- Production bundle and TypeScript check pass.
- Six backend integration tests pass: typed writes/isolation/retries/conflicts; expiry; signup and login claim; structure undo; OAuth PKCE/code replay; MCP guest result privacy.
- Browser QA passed at desktop and 520px panel widths: title/cell editing, reload persistence, column renaming, guest-to-account signup, and no browser runtime errors. Screenshots in docs/screenshots/.
- Not deployed, not connected as an installed ChatGPT plugin, not publicly published.

Known implementation limits / release gates:
- Unsigned ChatGPT creation opens an editable preview, but subsequent chat-driven edits require account linking. Safe guest chat continuity remains an integration task; never pass preview credentials to the model.
- Email verification/password recovery, account deletion, public legal/support pages, production backup/restore verification are not finished. Private beta only.
- Entry details currently list fields; sectioned reusable note layouts are not complete.
- Grid supports search, sort, and missing-required filter; advanced typed filters/aggregates and large-data pagination remain pending.
- Undo retains ten snapshots, not a guaranteed 30-day audit history.
- Database startup creates initial tables; versioned production migrations must precede schema evolution.
- Name availability for AtableZ remains unchecked.

Next action: confirm the Render destination, deploy the dedicated app/database, and test the real ChatGPT guest/panel/OAuth flow before finalizing the installable plugin package.

Later inputs needed:
- Hosting account/project access and final domain before deployment.
- Confirmation of launch budget and public policies before production.
- AtableZ name screening before public branding/registration.

Maintenance rule: update this file in each meaningful implementation change with completed milestones, test evidence, decisions, blockers, and the exact next step. Distinguish planned, implemented, tested, deployed, and published. Do not mark tasks complete based only on a plan.

## 12. Reference documentation

Verified/reviewed during scope on 2026-10-09; recheck before implementation:
- https://developers.openai.com/plugins/build/extensions
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/guides/optimize-metadata
- https://supabase.com/pricing
- https://developers.cloudflare.com/workers/platform/pricing/
