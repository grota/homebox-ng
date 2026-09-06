# HomeBox-BG — Phase 5: Admin Settings, Backup/Restore & Instance Config Spec

**Date:** 2026-09-06
**Status:** Draft for review
**Type:** Incremental design (extends `2026-09-04-homebox-bg-design.md`)

## Overview

Phase 5 delivers the instance-wide admin surface and the destructive-safety operations the master
spec groups under "Admin settings & backup/restore". It introduces:

- **Instance settings** (`instance_settings`, a single row): `max_upload_mb`, `detection_provider`,
  `detection_config` — editable by admins and enforced app-wide.
- **Backup / restore**: an admin action that builds a single `.tar.gz` (SQL dump + `data/uploads/`
  tree) and streams it for download; and a destructive restore that validates an uploaded archive
  and, after explicit confirmation, replaces the DB + uploads in place.
- **Forced password change**: admins create users with a temp password; the user is prompted to
  change it on first login.
- **Detection interface**: the pluggable `DetectionProvider` interface + registry (no concrete
  provider yet) plus the config surface for it, exactly as the master spec's "setting and the
  interface exist now".
- A **tabbed `/admin` back-office** (Users / Instance settings / Backup & restore / System)
  shelled into the responsive Shell, visible and reachable only by admins.

Much of user management already exists — the `users` tRPC router ships `list`/`create`/`update`/
`delete` (all `adminProcedure`) and a `role` column. The one real gap is the forced-password-change
flag. This spec therefore scopes Phase 5 tightly and avoids re-implementing what's already there.

## Scope

**In (Phase 5):**
- **`instance_settings` table** (single row, fixed `id = 1`): `max_upload_mb` (int, default 10),
  `detection_provider` (`remote`|`local`, default `remote`), `detection_config` (JSON). Seeded on
  first run if absent.
- **`instanceSettings` API module**: `get` (returns the row or defaults), `update` (partial). Both
  `adminProcedure`.
- **Wire `max_upload_mb`**: the image upload routes enforce the instance setting per request
  (replacing the `MAX_UPLOAD_MB` module constant as the *effective* cap).
- **`system` API module**: `rebuildFts` (`adminProcedure`) — re-index the search blob.
- **Backup / restore**: raw Fastify routes `GET /backup` (admin, streams tar.gz) and
  `POST /upload/backup` (admin, ingests an archive), with validate → preview → confirm → in-place
  swap.
- **Forced password change**: `users.must_change_password` column, set on create/reset, surfaced as
  a signal from auth so the client routes to a change-password screen, cleared after the change.
- **Detection interface**: `DetectionProvider` interface + `DetectionProviderRegistry` in `apps/api`
  with **no concrete provider registered**.
- **`/admin` feature** in `apps/web`: tabs Users, Instance settings, Backup & restore, System; an
  admin-only nav entry + route guard.

**Out (deferred to later phases / non-goals):**
- Unpack / drafts / publish lifecycle and the real detection providers — **Phase 6** (the interface
  and setting surface exist now; nothing calls them in Phase 5).
- Document upload pipeline (the `POST /upload/document` route doesn't exist yet). When it lands it
  enforces the same `max_upload_mb` cap — noted below, not built here.
- Docker packaging — **Phase 6**.
- Non-English translations (i18n architecture ready; strings bundled under `en`).
- Item-type admin CRUD — item types are already instance-wide and admin-managed via the existing
  `itemTypes` router; not re-worked here.

## Current state (what this changes)

- `packages/db/src/schema.ts` — `users` (id, name, email, passwordHash, role, createdAt),
  `sessions`, `locations`, `itemTypes`, `itemTypeFields`, `items`, `itemCustomFieldValues`, `tags`,
  `userSettings`, `itemTags`, `images`, `itemsFts`. **No `instance_settings`**, no
  `must_change_password` on `users`.
- `apps/api/src/modules/users/` — `router.ts` has `list`/`create`/`update`/`delete`, all
  `adminProcedure`; `service.ts` `createUser` hashes a provided password and sets role but never
  forces a change on first login. `repo.ts` is the repository layer.
- `apps/api/src/trpc.ts` — `publicProcedure`, `protectedProcedure`, `adminProcedure`
  (`ctx.user?.role !== 'admin' → FORBIDDEN`) already exist and are reused.
- `apps/api/src/uploads.ts` — `MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 10` (line 18)
  used as both the multipart parser `fileSize` limit (registered once at startup) and the
  post-buffer cap (lines 96/169). Only image upload/edit routes exist; no document route.
- `apps/api/src/router.ts` — mounts `auth`, `users`, `locations`, `itemTypes`, `items`, `images`,
  `tags`, `settings`. No `instanceSettings`, `system`, or `backup`.
- `apps/api/src/index.ts` / `server.ts` — `const db = createDb(path)` then `buildApp({ db, dataDir })`;
  `createContext(db)` closes over that single `db` for the life of the app. Restore needs to swap it.
- `apps/web/src/features/` — `auth`, `home`, `items`, `itemTypes`, `locations`, `settings`, `tags`,
  `upload`. **No `admin` feature**; no `/admin` route; no admin-only nav entry or route guard.

## Architecture

### A. Data model — `packages/db`

Add to `schema.ts` (camelCase JS keys, snake_case SQL columns; booleans `integer(..., { mode:
'boolean' })`; JSON `text(..., { mode: 'json' })`), following the existing `userSettings` pattern:

```ts
export const instanceSettings = sqliteTable('instance_settings', {
  id: integer('id').primaryKey(),             // fixed row id = 1
  maxUploadMb: integer('max_upload_mb').notNull().default(10),
  detectionProvider: text('detection_provider', { enum: ['remote', 'local'] })
    .notNull().default('remote'),
  detectionConfig: text('detection_config', { mode: 'json' }),
})

export const users = sqliteTable('users', { ... , // existing columns unchanged
  mustChangePassword: integer('must_change_password', { mode: 'boolean' })
    .notNull().default(false),
})
```

A drizzle-kit migration creates the table and column. The app seeds the single `instance_settings`
row (`id = 1`) on first run if it's absent, so readers can assume it exists. Helper accessors in
`packages/db` (or the api repo layer) provide `getInstanceSettings(db)` returning the row (inserting
defaults the first time) and `updateInstanceSettings(db, partial)`.

### B. API layer — `apps/api`

Three new top-level modules, following the existing `modules/<noun>/router.ts + service.ts +
repo.ts` pattern, all gated by the existing `adminProcedure`:

**`instanceSettings`** (`modules/instanceSettings/`)
- `get` — `adminProcedure.query` → returns the current `{ maxUploadMb, detectionProvider,
  detectionConfig }` (defaults when the row is absent).
- `update` — `adminProcedure` + zod partial (mirrors the per-user `settings` update) → upserts,
  returns the full DTO.
- Shared zod schemas in `packages/shared/src/settings.ts` (extend the existing file):
  `instanceSettingsSchema`, `instanceSettingsUpdateSchema`, defaults const.

**`system`** (`modules/system/`)
- `rebuildFts` — `adminProcedure.mutation` → re-indexes `items_fts` from the catalog; returns
  `{ reindexed: number }`.

**`backup`** — raw Fastify routes (tRPC does not handle multipart/streaming well; the existing
image routes already take their own cookie auth), registered in `server.ts`:
- `GET /backup` — admin-gated (session + role check, as the image routes do) → builds the archive and
  streams it as a download, cleaning up the temp file afterwards.
- `POST /upload/backup` — admin-gated multipart → ingests the archive to a temp path, **validates it
  (destructive step not yet taken)**, and returns `{ preview, restoreId }` where `restoreId` keys the
  validated extraction on disk. The restore **is not applied** by this call.
- `POST /backup/restore` — admin-gated JSON `{ restoreId }` → applies the confirmed restore (the only
  destructive call). Refuses if `restoreId` is unknown/expired or the DB is busy.

**`users` + `auth` changes**
- `users.create` — set `mustChangePassword = true`; the response includes the temp password once
  (admin relays it to the user). `users.update` — when `password` is provided, also set
  `mustChangePassword = true` (an admin-initiated reset).
- `auth.me` / the login result returns a `mustChangePassword` boolean so the client routes to a
  forced change-password screen.
- New `auth.changePassword` (protected) — validates `oldPassword` + `newPassword`, re-hashes,
  clears `mustChangePassword`, and refreshes/invalidates sessions as appropriate.

### C. `max_upload_mb` wiring — `uploads.ts`

The instance value is the *effective* upload cap. The multipart parser's `fileSize` is registered
once at startup, so it cannot track a runtime change; therefore:
- Register the parser with a generous fixed safety ceiling (e.g. `fileSize` for a constant
  `HARD_UPLOAD_CEILING_MB`, default 100) so it never pre-truncates a file the instance setting
  would allow.
- In each upload handler, read the instance `maxUploadMb` per request via a single PK lookup on the
  1-row table (trivial cost) and use the post-buffer check already present
  (`buffer.length > maxUploadBytes` → 413). This makes the cap dynamically adjustable without a
  restart. (The env `MAX_UPLOAD_MB` remains as the hard ceiling default.) Document this same cap
  applies to the document route when it is added.

### D. Backup & restore

**Backup (`GET /backup`):**
1. `VACUUM INTO '<tmpdir>/homebox.db'` on the live connection — an atomic, self-contained,
   WAL-independent standalone database file.
2. Concatenate into a `.tar.gz` with layout: `homebox.db` at the archive root + the `uploads/`
   subtree (whatever `originals/`, `edited/`, `thumbs/`, and (if present) `documents/` exist).
3. Stream the tar.gz to the response (`createReadStream`) and delete the temp dir + archive on all
   paths (`try/finally`).

**Restore (two-phase: validate, then confirm):**

*Phase 1 — validate (`POST /upload/backup`, non-destructive):*
1. Write the uploaded archive to a temp path; extract to a temp dir.
2. Validate — never touch the live DB before this passes:
   - `homebox.db` present and opens cleanly (`PRAGMA integrity_check` returns `ok`).
   - `uploads/` subtree present and path-safe (reuse the traversal guard).
3. Keep the validated extraction in place keyed by a short-lived `restoreId` and return
   `{ preview: { dbBytes, uploadCount, maxUploadMb, userCount, itemCount }, restoreId }`. Nothing is
   applied.

*Phase 2 — confirm (`POST /backup/restore`, destructive):*
4. Given `restoreId`, the app **closes the live connection**, checkpoints (or relies on the archived
   dump already being standalone), swaps the validated dump into `DATABASE_PATH`, removes stale
   `-wal`/`-shm` siblings, replaces `data/uploads/` (remove existing, extract the archive's tree),
   **reopens** via `createDb`, re-runs the idempotent `runMigrations`, and swaps the app's active DB
   reference. Refuses if it cannot obtain an exclusive lock (a busy DB) or if `restoreId` is
   unknown/expired.
5. Isolated in one `backup` module (`service.ts` + raw route wrappers) with its own tests against
   temp DBs.

**In-place swap requires a mutable DB ref.** Small refactor: `buildApp` accepts `{ dbHolder,
dataDir }` where `dbHolder = { current: DrizzleDb }`; `createContext` reads `dbHolder.current` per
request (context is already built per request), and `registerUploadRoutes` takes the holder too.
Restore replaces `dbHolder.current` with a fresh `createDb(path)`. Requests after the swap use the
new DB; an app restart after restore is an acceptable, explicit alternative.

### E. Detection interface + setting surface

In `apps/api` (e.g. `modules/detection/provider.ts`):
- `type DetectionBox = { box: { x, y, width, height }, label: string, confidence: number }`
- `interface DetectionProvider { name: string; detectBoxes(image: Buffer): Promise<DetectionBox[]> }`
- `DetectionProviderRegistry` (`Map<string, DetectionProvider>`) **with no concrete provider
  registered** — `get(provider)` returns `undefined` and `detectBoxes` would throw/return a clear
  "provider not configured" error.

The `detection_provider` / `detection_config` fields are stored in `instance_settings` and edited
via the admin UI (a `remote`|`local` radio + per-provider sub-options). Nothing invokes the registry
in Phase 5 — this is exactly the spec's "setting and the interface exist now; providers wire in
later."

### F. Web `/admin` feature (`apps/web/src/features/admin/`)

A new feature directory, routed at `/admin`, rendered inside the responsive `Shell`, and guarded to
`role === 'admin'` (nav entry hidden for non-admins + a route guard redirecting to `/`). Tabs:

- **Users** — list (from `users.list`), create (name/email/temp password/role → shows the temp
  password once), edit (name/email/role/reset password → sets `must_change_password`), delete.
- **Instance settings** — `max_upload_mb` number field, `detection_provider` radio
  (`remote`|`local`), and provider sub-options from `detection_config`; persisted via
  `instanceSettings.update`.
- **Backup & restore** — a Download backup button (`GET /backup`); an upload control
  (`POST /upload/backup`) that validates and shows the preview, then a destructive confirm step that
  calls `POST /backup/restore`; status messaging for success/failure.
- **System** — a Rebuild search index button (`system.rebuildFts`).

All via tRPC `useQuery`/`useMutation` + react-query invalidation, react-i18next strings under
`apps/web/public/locales/en/`, consistent with the existing `/settings` and items screens.

## Authentication & authorization

- Every phase-5 tRPC procedure is `adminProcedure` (non-admins → `FORBIDDEN`); `auth.changePassword`
  is `protectedProcedure`.
- The raw `GET /backup` and `POST /upload/backup` routes replicate the image routes' cookie-auth +
  role check (an admin session is required), since tRPC middleware does not cover raw routes.

## Error handling & security

- Validation errors → typed `TRPCError` with zod messages; one central error boundary.
- Backup/restore temp files are cleaned in `finally`; path traversal guard is reused on every
  extraction/swap path.
- Restore is two-phase and **never auto-applies** — validation produces a preview; destructive
  application happens only after explicit confirmation, and refuses if the DB is busy (can't get an
  exclusive lock).
- `max_upload_mb` enforced per request; over-limit uploads → 413.
- csrf/session protections inherited from the existing middleware; no new auth primitives.

## Testing

**Backend (Vitest, temp SQLite):**
- `instanceSettings` get/update (defaults when absent, round-trip of `maxUploadMb`,
  `detectionProvider`, `detectionConfig`).
- `max_upload_mb` enforcement: setting a lower cap rejects an over-limit image upload (413).
- Backup: produced tar.gz contains a `homebox.db` that opens with `integrity_check` `ok` and a
  matching `uploads/` subtree.
- Restore: round-trip (backup → restore → data matches, including uploads); refuses an
  invalid/truncated archive; refuses a busy DB; leaves the live DB untouched when validation fails.
- `rebuildFts` re-indexes.
- Forced password change: create sets `must_change_password`; `auth.changePassword` clears it;
  login/me surfaces the flag.
- The mutable-DB holder swap is exercised by the restore round-trip test.

**Frontend (Vitest + React Testing Library):**
- `/admin` route guard: a non-admin cannot reach it (redirect); an admin sees the tabs.
- Users create screen shows the temp password once; settings form persists.


**E2E (Playwright):** admin login → create a user with a temp password → the user is forced to
change it on first login → can then log in; create a backup → download; restore round-trip.

## Migration

- Drizzle-kit migration adds `instance_settings` + `users.must_change_password`. Verified against a
  clean database. The app seeds the `instance_settings` row if absent.

## Open questions / deferred

- **Restore requires shutting down app activity** for the swap if a request is mid-flight on the old
  connection; the design accepts a restart after restore as a clean alternative. Whether to
  auto-restart or document "restart after restore" is left to the plan/implementation, not a Phase 5
  blocker.
- Detection provider details (which cloud API, which local model) are Phase 6; only the interface
  and setting surface ship here.
