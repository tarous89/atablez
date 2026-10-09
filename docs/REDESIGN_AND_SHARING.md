# AtableZ — shared workspace and visual redesign scope

Date: 2026-10-09
Status: scoped for implementation; none of the features below should be described as shipped solely because this document exists.
Applies to: the hosted app and the existing ChatGPT extension, together.
Product name: AtableZ. Onboarding promise: “Your custom reusable database.”

## 1. Design decision

Combine the calm, minimal layout discussed using Things 3 as a reference with Airtable-inspired rich table cells. Use one shared React application, shared copy, components and design tokens for the website and MCP resource. Host-specific code handles authentication, navigation and sizing only.

Keep the table as the main content. Remove repeated product slogans, eyebrow headings, decorative status tags, redundant subheadings and large empty banners. Colour communicates values, categories, selection and progress.

Initial design tokens (our proposed palette, not asserted Airtable brand values):
- Canvas #F7F8FA; surfaces #FFFFFF; text #202124; secondary text #626B78; grid lines #E4E7EC.
- Primary action/selection #2563EB, selected-cell tint #EFF6FF.
- Choice backgrounds: blue #DBEAFE, green #DCFCE7, amber #FEF3C7, violet #EDE9FE, rose #FCE7F3; pair with dark readable labels.
- System font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; tabular numerals.
- Base text 14px desktop; practical touch targets; 40px default rows, taller image rows.
- Modest corners, subtle borders, minimal shadows; visible keyboard focus; reduced-motion support.

No automatic decorative icons or emoji prefixes. Users may type emoji into names or optionally choose a table emoji. Preserve names exactly unless the user requests a rename. Avoid the “Aa”/number glyph clutter previously rejected.

## 2. Navigation and wording

Top navigation only, in website and narrow extension:
- Editable workspace name / workspace switcher.
- Tables and Settings.
- Account access appropriate to session.
- Within a table: editable name, Share, and one More menu for structure, export and secondary actions.
- A small Add row control at the grid; contextual row actions.

Vocabulary:
- Workspace: container for owned tables, with optional shared access.
- Table: saved dataset and reusable column instructions.
- Team: named group of account members to whom the owner may grant access.
- No “projects” vocabulary or additional database/project setup hierarchy.
- A workspace can be described as “your database” in onboarding.

Account copy:
- Guest notice: “This preview expires in 1 hour. Create an account to keep your tables.” Show actual expiry/countdown when available, not a fresh hour after reopening.
- Primary guest action: “Keep my tables”; secondary “Sign in”.
- Returning user: “Sign in to access your saved tables.”
- ChatGPT connection: “Connect AtableZ to use your saved and shared tables in chat.”
- Signed in: “My tables”; shared items display owner/workspace only when necessary to distinguish them.
- Do not show an extra promotional connect screen before the actual sign-in flow.
- Keep preview data through signup/sign-in and return to the selected table.

## 3. Signup simplification

Remove the permanent “12 characters” helper/placeholder and any rule checklist. Use plain Email and Password fields, password-manager autocomplete, a Show password control, and clear local errors.

Interpretation: this request removes signup clutter; it does not silently weaken password validation. The current server minimum remains until an authentication-policy change is explicitly selected. If a submitted password is too short, explain the requirement beside that field rather than showing a generic server error. Keep frontend and backend validation consistent.

Sharing requires reliable account identity: add email verification and a recovery flow before enabling email-address-bound invitations. Do not treat an unverified typed email as proof of identity. Provider/configuration is an implementation dependency, not an existing capability.

## 4. Settings

A real routable Settings screen, using the same component in both surfaces.
- Workspace: rename; default table appearance; storage/usage information.
- Team & access: team name, members, pending invitations, roles and access management.
- Account: email, verification status, password/recovery and sign out.
- ChatGPT connection: connection state and clear instructions/action to connect.
- Return to the previous table without losing selection.

Website /settings must work after direct navigation and refresh. In the extension, Settings opens the same screen; “Open in app” opens /settings through the host's supported external-navigation API. Authenticate the destination normally; never put bearer tokens in URLs. Guests may adjust their draft workspace but are asked to sign up for persistent team/account features.

## 5. Sharing and teams

Sharing is live access to the original records, not copies, exports or the owner's session.
- Owner creates a named team and manages its members.
- Owner may grant a person or a team access to an entire workspace or one selected table.
- Share dialog: choose Workspace / This table, choose person/team, choose Can view / Can edit.
- Table-only recipients see only explicitly shared tables, not sibling tables, history, counts or metadata from the rest of the workspace.
- Recipients accept an invitation while signed into their own verified account.
- Show shared tables in their table list, with source owner/workspace as needed.
- Their own ChatGPT account connection resolves the same access automatically, including across new conversations.
- Owner can change permissions, cancel pending invitations and revoke access.
- Revoked access fails on the next server request; the active UI clears inaccessible content after its next refresh. Already read/exported copies cannot be recalled.
- Only owners administer invitations, team membership and grants in this release.
- Do not send invitations during development or testing to real people. UI-generated invitations are an explicit user action.

Permission matrix:

| Capability | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Read permitted data in app and chat | Yes | Yes | Yes |
| Search, sort, filter, export permitted data | Yes | Yes | Yes |
| Add/edit/delete rows and attachment references | Yes | Yes | No |
| Rename shared table; edit columns and instructions | Yes | Yes | No |
| Create tables in a workspace | Yes | Workspace grant only | No |
| Rename workspace | Yes | No | No |
| Delete table/workspace, manage access/members | Yes | No | No |

Editors may change column structures after a clear impact confirmation for destructive conversions/removals. Table-only editors cannot use workspace-wide undo. Viewer status is visible once; hide write controls, but independently enforce permissions on the server.

Effective access is the highest permission from direct, team and workspace grants. Removing a direct grant does not cancel a separate team/workspace grant; show the source of inherited access. Removing team membership removes all access inherited solely from that team.

Invitations: signed-in, verified-email-bound acceptance; expiring, single-use, hashed tokens; default seven-day expiry; no public anonymous edit links. Existing permission changes are effective without issuing a new ChatGPT token.

## 6. Beautiful, useful tables

Grid:
- Sticky headers, restrained grid lines, resizable columns, horizontal scrolling, useful compact spacing.
- Click to edit all editable cells and names; Enter saves, Escape cancels, Tab advances.
- Clear selected-cell focus, subtle row hover; no permanent input border in every cell.
- Column menu exposes type, description, reusable filling instruction, required/fixed settings and reorder/remove.
- User-created numbering remains an ordinary editable integer column.
- Search, sort and basic filters use a compact toolbar; controls collapse sensibly in the narrow extension.
- Missing/invalid data is identified without repeating badges throughout the screen.
- Unsaved local edits survive a refresh conflict; show refresh/retry rather than silently overwrite.

Rich cells:

| User-facing type | Stored value / semantics | Presentation |
| --- | --- | --- |
| Text / Long text | String | Clean text; expand long content |
| Integer / Number | Numeric value | Aligned numeric text |
| Link | Valid URL plus optional label | Clickable label, explicit editing affordance |
| Choice / Multiple choice | Stable option IDs and labels | Soft coloured chips, editable option colours |
| Checkbox | Boolean | Simple checkbox |
| Date | ISO date | Readable local presentation |
| Progress | Finite number 0–100 | Slim coloured bar plus percentage |
| Rating | Integer 0–configured maximum | Small rating marks plus accessible numeric label |
| Image | Authorized attachment references | Thumbnails, larger preview on click |
| Files | Authorized attachment references | File name, type and download/open action |

Progress is offered as a field type but stored as a number so ChatGPT can sort, compare and calculate with it. Blank is distinct from zero. Export the numeric value with an unambiguous column/type description. Number-to-progress conversion retains valid 0–100 values and reports incompatible values without clearing them.

Keep colours consistent between cells, option editor, app and extension. Colour is never the only signal. Emoji are supported as text. Optional row colour based on one choice field; complex conditional-formatting builders are later work.

Links are real clickable links. Only supported safe URL schemes; no script/HTML rendering from cell content. A linked external file is not described as a retained uploaded file.

## 7. Images and files

Scope includes actual uploads, not just fields holding remote URLs.
- Select/drop an image or file into a cell; show upload progress and retry on failure.
- Preview raster images; display filename/type for other documents. Office conversion and rich document previews are later work.
- Files inherit exact table permissions, including downloads from ChatGPT's extension.
- Authenticate every file read; prevent guessing file IDs to bypass access. No public permanent storage URLs.
- Supported initial image formats: JPEG, PNG, WebP. Initial document formats: PDF, TXT, CSV, DOCX, XLSX; serve non-image files as downloads.
- Validate size and file signature; user filenames are display metadata, never filesystem paths.
- Guest uploads expire with the preview; account claiming transfers ownership without broken references.
- Deletion/undo needs reference-aware cleanup so one removed cell does not break another reference.

For the small free beta, use a separate Postgres attachment table with bounded binary storage, not JSON/base64 inside the workspace document and not Render's local filesystem. Proposed launch ceilings: 2 MB/file, 20 MB/saved workspace, 5 MB/guest workspace, 100 MB/global attachment budget. Check quotas transactionally before upload; return an actionable limit message. These are conservative initial product limits, not claims about the provider's free allowance.

Put storage behind an adapter so growth can move bytes to private object storage without changing file IDs, cells or tools. Do not provision paid storage in this scope. Review actual Render/database capacity before enabling uploads; the existing free database expiry remains an operational task in PROJECT.md.

ChatGPT can read permitted file metadata/references. Importing a file from chat requires a supported host file handoff; never claim that an arbitrary local chat filename is accessible. Uploads in the app/extension are the fallback. Do not fetch arbitrary user URLs server-side without separate URL/network safeguards.

## 8. Implementation changes required

Current code review:
- web/main.tsx already supplies both the hosted interface and MCP resource; keep this shared architecture.
- credentials currently identify a workspace, not an individual actor; this must change before sharing.
- publicState and MCP result metadata currently serialize the whole workspace. Filter BEFORE serialization for table-only recipients.
- history and undo currently operate on whole workspace snapshots. Replace/partition history so shared-table undo cannot expose or restore unrelated tables.
- Images/files/progress are not yet supported by the current Field enum and validators.
- Signup currently enforces 12 characters on the server.
- Settings currently has no dedicated page.

Proposed data additions:
- Credentials/OAuth subjects linked to a stable user ID; guests remain restricted guest principals.
- Ownership on workspaces; teams; team_members; resource_grants; invitations.
- attachments with workspace/table/reference authorization and storage metadata.
- Actor-scoped audit/change events for shared mutations; per-table undo eligibility.
- Extend field definitions with display options, option colours and constraints without changing stable field IDs.
- Keep existing JSONB rows initially; avoid an unrelated full data-storage rewrite.

Migrate existing users/workspaces atomically and preserve current table IDs/data. Backfill owners; preserve guest expiry; migrate or expire/reissue old tokens safely. Never reinterpret an old workspace credential as an unrestricted member credential.

One shared authorization service governs REST, MCP, export, attachments, undo and UI hydration. Check actor, target and effective role on every request. Grant administration and concurrent mutations use transaction/locking rules; a revoked membership cannot authorize a later write.

MCP tools:
- List only accessible workspaces/tables, including shared items.
- Read current schema before writes; return effective permissions.
- Use explicit target IDs for shared operations; ask when a name is ambiguous.
- Reject Viewer mutations even if the model requests them.
- Tools return permitted structured values, including numeric progress and attachment metadata, not decorative rendered HTML.
- UI credentials issued by MCP retain actor/scope; never mint the owner's full-workspace browser credential for a viewer.

## 9. Delivery sequence and acceptance gates

All steps are scoped / not implemented in this document:
1. Shared visual system, cleaner wording, signup-copy cleanup and Settings routing.
2. Rich table types, typed cell renderers and schema-conversion validation.
3. Actor-based authentication migration, verification/recovery, teams, grants and invitations.
4. Protected uploads and shared-table discovery/access in ChatGPT.
5. Cross-surface end-to-end checks and release.

Required checks:
- Existing accounts, guest retention, login and current tables survive migrations.
- Website and extension show identical labels, types, colours and permissions.
- Two independent accounts can read/update the same permitted table; both see changes.
- Viewer writes fail through REST AND MCP, not just disabled UI.
- Table-only recipients cannot obtain other data through list/read/export/history/undo, metadata, file URLs or hydrated UI state.
- Revocation and team removal work with already-issued browser/OAuth tokens.
- Invite replay, wrong-account acceptance and unverified-email impersonation fail.
- Progress boundaries, blank-vs-zero, type changes and invalid files are validated.
- Uploads persist through restart; guest expiry, claiming and quota limits work.
- Narrow ChatGPT layout and desktop browser support editing, links, file selection, keyboard focus and Settings navigation.
- No success message before the server saves; failed fetch/upload/conflict states are recoverable.
- No real invitations sent in tests.

## 10. Later, beyond this iteration

Kanban/calendar/gallery views, formulas, linked-table relations, comments, full live cursors, public anonymous shares, enterprise SSO, team billing, complex conditional formatting and Office-file rendering.

## Reference material reviewed

- Things 3: https://culturedcode.com/things/
- Craft: https://www.craft.do/
- Flighty: https://flighty.com/
- Airtable record colouring: https://support.airtable.com/articles/9047816169-record-coloring-in-airtable
- Airtable attachment fields: https://support.airtable.com/articles/9139007724-attachment-fields-in-airtable
- Airtable number fields: https://support.airtable.com/articles/9701435990-number-based-fields-in-airtable

References inform interaction and visual decisions; the concrete scope, palette, limits and permission model above are AtableZ decisions.
