# Phase 5 — Admin Settings, Backup/Restore & Instance Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the instance-wide admin surface — `instance_settings` (max upload + detection config), backup/restore, a forced password-change on first login, the `DetectionProvider` interface (config-only), and a tabbed `/admin` back-office.

**Architecture:** Add `instance_settings` (single row) + `users.must_change_password` to the Drizzle schema; expose `instanceSettings`, `system`, and `backup` (raw Fastify routes) API with the existing `adminProcedure`; wire `max_upload_mb` into the image upload routes; introduce a mutable `dbHolder` so restore can swap the live DB in place; build the `/admin` web feature behind a role guard.

**Tech Stack:** TypeScript, Drizzle ORM + better-sqlite3 + drizzle-kit (SQLite), tRPC v11, Fastify, Zod v3, React 19 + Vite + Tailwind v4, react-i18next, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-phase5-admin-backup-design.md` — the binding authority the plan argues from. Executors read both the spec and this plan.

## Global Constraints

- **Build order:** `@homebox/shared` → `@homebox/db` → `@homebox/api` → `@homebox/web`. Consumers import from built `dist/`. **After editing `@homebox/shared` or `@homebox/db`, run `pnpm --filter <that-pkg> build` (or `pnpm build` at root, which is topo-ordered) before the depending package's tests** — otherwise a test failing on a missing export is a stale-build false positive, not a code regression.
- **SQLite conventions:** object keys are camelCase; SQL table/column names are snake_case (2nd arg of each column builder). Timestamps are INTEGER epoch **ms**. Booleans are `integer(..., { mode: 'boolean' })` (JS boolean, SQL 0/1). JSON is `text(..., { mode: 'json' })`. Single-row tables use a fixed `id` (not auto-increment).
- **Authorization:** every new tRPC procedure uses the existing `adminProcedure` from `apps/api/src/trpc.ts` (`ctx.user?.role !== 'admin' → FORBIDDEN`), except `auth.changePassword` which is `protectedProcedure`. Raw Fastify routes replicate their own cookie-auth + role check (see the image routes in `uploads.ts`).
- **i18n:** UI strings bundled under `apps/web/public/locales/en/` via react-i18next. English only (existing pattern).
- **Migrate command:** `pnpm --filter @homebox/db exec drizzle-kit generate` (schema `./src/schema.ts`, out `./drizzle`). The generated file is `0003_<name>.sql`.
- **Commit messages** end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Feature prefix `feat(api)`/`feat(web)`/`feat(db)`.
- **Never** bare `git stash`/`git stash pop`; never force-push; never `--force` a worktree removal on your own initiative.
- **Raw driver access:** drizzle's better-sqlite3 wrapper does not type-expose the raw driver, but the instance has `$client`. Backup/restore access it via a small `rawDb(db)` helper that casts to reach `$client` (used for `.backup()`, `.close()`, `.pragma()`). Do not widen `DrizzleDb`.

## File Structure

**Data (`packages/db`):**
- `src/schema.ts` — add `instanceSettings` table + `users.mustChangePassword`.
- `drizzle/0003_*.sql` — generated migration.
- `test/migrate.test.ts` — extend to assert the new columns/table.

**Shared (`packages/shared`):**
- `src/settings.ts` — `DETECTION_PROVIDERS`, `instanceSettingsSchema`, `instanceSettingsUpdateSchema`, `DEFAULT_INSTANCE_SETTINGS`, types.
- `test/settings.test.ts` — extend.

**API (`apps/api/src`):**
- `modules/instanceSettings/{repo,service,router}.ts` — new.
- `modules/system/{service,router}.ts` — new (`rebuildFts` via `items/fts.ts:rebuildFTS`).
- `modules/backup/{service,repository…}.ts` — new (create/validate/apply + raw route wrappers in `backupRoutes.ts`).
- `modules/detection/provider.ts` — new (`DetectionProvider` interface + empty registry, no providers).
- `modules/users/{repo,service}.ts` — add `mustChangePassword` to DTO + set on create/reset.
- `modules/auth/router.ts` — surface `mustChangePassword`; add `changePassword`.
- `uploads.ts` — read `max_upload_mb` per request; parser ceiling.
- `trpc.ts` — unchanged (reuse `adminProcedure`).
- `context.ts` — `createContext` reads a `DbHolder` (`{ current }`).
- `server.ts` — `dbHolder` creation; register `backupRoutes`.
- `index.ts` — pass `dbPath` into `buildApp`.
- `router.ts` — mount `instanceSettings`, `system`.
- `test/{instanceSettings,system,backup}.test.ts` — new; extend `users.test.ts`, `authRouter.test.ts`, `uploads.test.ts`.

**Web (`apps/web/src`):**
- `features/admin/` — `AdminPage.tsx`, `AdminGuard.tsx`, tabs pages (`Users`, `Settings`, `Backup`, `System`), hooks.
- `app/routes.tsx` — add `/admin` under the guarded Shell.
- `app/Shell.tsx` — admin nav entry (role-gated).
- `lib/auth.tsx` — add `RequireAdmin`.
- `public/locales/en/admin.json` — strings.
- `test/admin.test.tsx` — guard + navigation; extend `shell.test.tsx`.

**E2E (`apps/web/e2e`):**
- `admin.spec.ts` — new.

---

### Task 1: Data layer — `instance_settings` + `users.must_change_password`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0003_*.sql` (generated)
- Test: `packages/db/test/migrate.test.ts`

**Interfaces:**
- Produces: `instanceSettings` Drizzle table (JS keys `id`, `maxUploadMb`, `detectionProvider`, `detectionConfig`) auto-exported from `@homebox/db`; `users.mustChangePassword` boolean (SQL `must_change_password`).

- [ ] **Step 1: Add the `instanceSettings` table + `users.must_change_password`column** to `packages/db/src/schema.ts` (append after `userSettings`, and add the column inside the existing `users` table):

```ts
export const instanceSettings = sqliteTable('instance_settings', {
  id: integer('id').primaryKey(), // fixed row id = 1
  maxUploadMb: integer('max_upload_mb').notNull().default(10),
  detectionProvider: text('detection_provider', { enum: ['remote', 'local'] })
    .notNull().default('remote'),
  detectionConfig: text('detection_config', { mode: 'json' }),
})
```

```ts
// inside the existing `users = sqliteTable('users', { … })` definition:
mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @homebox/db exec drizzle-kit generate`
Expected: a new `packages/db/drizzle/0003_<name>.sql` containing `CREATE TABLE … instance_settings` and `ALTER TABLE users ADD COLUMN must_change_password integer DEFAULT false NOT NULL`.

- [ ] **Step 3: Rebuild the package**

Run: `pnpm --filter @homebox/db build`
Expected: `tsc -b` succeeds; `@homebox/db/dist` now exports `instanceSettings` and `users.mustChangePassword`.

- [ ] **Step 4: Extend `packages/db/test/migrate.test.ts`**

Add a test that a fresh temp SQLite DB migrated via `runMigrations` (from `@homebox/db`) has the `instance_settings` table and that `users.mustChangePassword` defaults to `false`:

```ts
test('new migration adds instance_settings + users.must_change_password', () => {
  const db = createDb(':memory:')
  runMigrations(db)
  // instance_settings row is not auto-seeded here (the api layer seeds it); the
  // table is just queryable.
  expect(() => db.select().from(instanceSettings).all()).not.toThrow()
  const insert = db.insert(users).values({ name, email, passwordHash, role: 'user' }).returning().get()
  expect(insert.mustChangePassword).toBe(false)
})
```

- [ ] **Step 5: Run the db test**

Run: `pnpm --filter @homebox/db test`
Expected: all db tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0003_*.sql packages/db/test/migrate.test.ts
git commit -m "feat(db): add instance_settings table + users.must_change_password

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Shared schemas — instance settings Zod types

**Files:**
- Modify: `packages/shared/src/settings.ts`
- Test: `packages/shared/test/settings.test.ts`

**Interfaces:**
- Produces: `DETECTION_PROVIDERS`, `DetectionProvider`, `instanceSettingsSchema`, `InstanceSettingsDto`, `instanceSettingsUpdateSchema`, `InstanceSettingsInput`, `DEFAULT_INSTANCE_SETTINGS` — auto-exported from `@homebox/shared` (index re-exports `./settings.js`).

- [ ] **Step 1: Add to `packages/shared/src/settings.ts`** (after `DEFAULT_USER_SETTINGS`):

```ts
// Detection provider selection (Phase 5 ships the setting + interface only; the
// concrete providers are wired in a later phase).
export const DETECTION_PROVIDERS = ['remote', 'local'] as const
export type DetectionProvider = (typeof DETECTION_PROVIDERS)[number]

// Single row of instance-wide settings.
export const instanceSettingsSchema = z.object({
  maxUploadMb: z.number().int().positive(),
  detectionProvider: z.enum(DETECTION_PROVIDERS),
  detectionConfig: z.record(z.unknown()).nullish(),
})
export type InstanceSettingsDto = z.infer<typeof instanceSettingsSchema>

// `instanceSettings.update` takes any subset.
export const instanceSettingsUpdateSchema = instanceSettingsSchema.partial()
export type InstanceSettingsInput = z.infer<typeof instanceSettingsUpdateSchema>

// Used when no row exists yet.
export const DEFAULT_INSTANCE_SETTINGS: InstanceSettingsDto = {
  maxUploadMb: 10,
  detectionProvider: 'remote',
  detectionConfig: null,
}
```

- [ ] **Step 2: Extend `packages/shared/test/settings.test.ts`** — assert defaults and that updateSchema accepts a subset:

```ts
test('instanceSettings defaults + partial update', () => {
  expect(DEFAULT_INSTANCE_SETTINGS.maxUploadMb).toBe(10)
  expect(instanceSettingsUpdateSchema.parse({ maxUploadMb: 25 })).toEqual({ maxUploadMb: 25 })
  expect(instanceSettingsSchema.parse(DEFAULT_INSTANCE_SETTINGS).detectionProvider).toBe('remote')
})
```

- [ ] **Step 3: Rebuild + run shared test**

Run: `pnpm --filter @homebox/shared build && pnpm --filter @homebox/shared test`
Expected: build + tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/settings.ts packages/shared/test/settings.test.ts
git commit -m "feat(shared): add instance settings zod schemas

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: `instanceSettings` API module

**Files:**
- Create: `apps/api/src/modules/instanceSettings/repo.ts`, `service.ts`, `router.ts`
- Test: `apps/api/test/instanceSettings.test.ts`

**Interfaces:**
- Consumes: `@homebox/db` `instanceSettings` table; `@homebox/shared` `InstanceSettingsDto`, `InstanceSettingsInput`, `DEFAULT_INSTANCE_SETTINGS`.
- Produces: `instanceSettingsRouter` with `get` (query) and `update` (mutation) — both `adminProcedure`.

- [ ] **Step 1: `repo.ts`** — seed-on-first-get and partial update against the fixed `id = 1`:

```ts
import { eq } from 'drizzle-orm'
import { instanceSettings } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import type { InstanceSettingsDto, InstanceSettingsInput } from '@homebox/shared'
import { DEFAULT_INSTANCE_SETTINGS } from '@homebox/shared'

const FIRST_ID = 1

const toDto = (row: typeof instanceSettings.$inferSelect): InstanceSettingsDto => ({
  maxUploadMb: row.maxUploadMb,
  detectionProvider: row.detectionProvider,
  detectionConfig: (row.detectionConfig as Record<string, unknown>) ?? null,
})

// Read the single row, seeding defaults (with the fixed id) on first access.
export const getOrCreate = (db: DrizzleDb): InstanceSettingsDto => {
  const row = db.select().from(instanceSettings).where(eq(instanceSettings.id, FIRST_ID)).get()
  if (row) return toDto(row)
  const inserted = db.insert(instanceSettings).values({ id: FIRST_ID }).returning().get()
  return toDto(inserted)
}

// Partial update; always operates on the seeded row.
export const update = (db: DrizzleDb, input: InstanceSettingsInput): InstanceSettingsDto => {
  getOrCreate(db)
  const data: Partial<InstanceSettingsDto> = {}
  if (input.maxUploadMb !== undefined) data.maxUploadMb = input.maxUploadMb
  if (input.detectionProvider !== undefined) data.detectionProvider = input.detectionProvider
  if (input.detectionConfig !== undefined) data.detectionConfig = input.detectionConfig
  const row = db.update(instanceSettings).set(data).where(eq(instanceSettings.id, FIRST_ID)).returning().get()
  return toDto(row)
}

// Escape hatch persisted defaults for callers (e.g. uploads) that must not
// depend on `repo`.
export { DEFAULT_INSTANCE_SETTINGS }
```

- [ ] **Step 2: `service.ts`**

```ts
import type { DrizzleDb } from '@homebox/db'
import type { InstanceSettingsDto, InstanceSettingsInput } from '@homebox/shared'
import * as repo from './repo.js'

export const getSettings = (db: DrizzleDb): InstanceSettingsDto => repo.getOrCreate(db)
export const updateSettings = (db: DrizzleDb, input: InstanceSettingsInput): InstanceSettingsDto =>
  repo.update(db, input)
```

- [ ] **Step 3: `router.ts`**

```ts
import { instanceSettingsUpdateSchema } from '@homebox/shared'
import { t, adminProcedure } from '../../trpc.js'
import * as service from './service.js'

export const instanceSettingsRouter = t.router({
  get: adminProcedure.query(({ ctx }) => service.getSettings(ctx.db)),
  update: adminProcedure.input(instanceSettingsUpdateSchema).mutation(({ ctx, input }) =>
    service.updateSettings(ctx.db, input)
  ),
})
```

- [ ] **Step 4: Mount the router** in `apps/api/src/router.ts` (add import + key):

```ts
import { instanceSettingsRouter } from './modules/instanceSettings/router.js'
export const appRouter = t.router({
  // …
  instanceSettings: instanceSettingsRouter,
})
```

- [ ] **Step 5: Rebuild api + write `apps/api/test/instanceSettings.test.ts`** — an authenticated admin can `get` (seeds defaults) and `update`; a non-admin gets `FORBIDDEN`. Follow the existing `apps/api/test/settings.test.ts` pattern for building the app and logging in.

```ts
test('admin round-trips instance settings; non-admin forbidden', async () => {
  const { app, admin } = await makeApp() // helper as in settings.test.ts
  const { ctx } = await createCaller(app, admin)
  expect(await ctx.instanceSettings.get()).toMatchObject({ maxUploadMb: 10 })
  const updated = await ctx.instanceSettings.update({ maxUploadMb: 25, detectionProvider: 'local' })
  expect(updated.maxUploadMb).toBe(25)
  // non-admin
  await expect(callAsUser.instanceSettings.get()).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
```

- [ ] **Step 6: Run the api test**

Run: `pnpm --filter @homebox/db build && pnpm --filter @homebox/shared build && pnpm --filter @homebox/api test`
Expected: api tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/instanceSettings apps/api/src/router.ts apps/api/test/instanceSettings.test.ts
git commit -m "feat(api): instanceSettings get/update (admin)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Wire `max_upload_mb` into the upload routes

**Files:**
- Modify: `apps/api/src/uploads.ts`
- Test: `apps/api/test/uploads.test.ts`

**Interfaces:**
- Consumes: `getInstanceSettings` (use `service.getSettings` from `./modules/instanceSettings/service.js`).
- Produces: no new API; upload enforcement reads the instance value per request.

- [ ] **Step 1: Bump the parser ceiling + add a per-request cap.** In `uploads.ts`, change the top constant and import:

```ts
import { getSettings as getInstanceSettings } from './modules/instanceSettings/service.js'

// Hard parser ceiling: never pre-truncate a file the admin might allow. The
// effective per-request cap is read from instance_settings below.
export const HARD_UPLOAD_CEILING_MB = Number(process.env.MAX_UPLOAD_MB) || 100
const hardUploadBytes = HARD_UPLOAD_CEILING_MB * 1024 * 1024
```

Replace the multipart registration limit with `{ limits: { fileSize: hardUploadBytes, files: 1 } }`.

- [ ] **Step 2: Replace every post-buffer size check** (the `buffer.length > maxUploadBytes` lines, currently in the `image` and `image/edit` handlers) with a per-request read:

```ts
const effBytes = getInstanceSettings(db).maxUploadMb * 1024 * 1024
if (buffer.length > effBytes) return reply.code(413).send({ error: 'file too large' })
```

`db` is already in scope (`RegisterUploadRoutesOptions.db`). **Task 7** adds the `dbHolder` so a restore can swap the live DB; it then changes this to read `dbHolder.current` instead of the registration-scoped `db`. Until Task 7 lands, `db` (the initial handle) is correct.

- [ ] **Step 3: Update `apps/api/test/uploads.test.ts`** — set `maxUploadMb` low via the instanceSettings service and assert an over-limit image upload returns 413:

```ts
const is = await ctx.instanceSettings.update({ maxUploadMb: 1 })
// upload a 2 MB buffer…
const res = await app.inject(postImage(itemId, bigBuffer))
expect(res.statusCode).toBe(413)
```

- [ ] **Step 4: Run api tests** (`pnpm --filter @homebox/api test`). Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/uploads.ts apps/api/test/uploads.test.ts
git commit -m "feat(api): enforce instance max_upload_mb on uploads

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: `system` module — `rebuildFts`

**Files:**
- Create: `apps/api/src/modules/system/{service,router}.ts`
- Test: `apps/api/test/system.test.ts`
- Modify: `apps/api/src/router.ts`

**Interfaces:**
- Consumes: `rebuildFTS` from `../items/fts.js`; `@homebox/db` `items`.
- Produces: `systemRouter.rebuildFts` (`adminProcedure.mutation`) → `{ reindexed: number }`.

- [ ] **Step 1: `service.ts`**

```ts
import { sql } from 'drizzle-orm'
import { items } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { rebuildFTS } from '../items/fts.js'

export const rebuild = (db: DrizzleDb): { reindexed: number } => {
  // `select().from().get()` is the proven count pattern (see repo.ts); avoid the
  // top-level `db.all(sql)` form.
  const row = db.select({ n: sql<number>`count(*)` }).from(items).get()
  rebuildFTS(db)
  return { reindexed: Number(row?.n ?? 0) }
}
```

- [ ] **Step 2: `router.ts`**

```ts
import { t, adminProcedure } from '../../trpc.js'
import * as service from './service.js'

export const systemRouter = t.router({
  rebuildFts: adminProcedure.mutation(({ ctx }) => service.rebuild(ctx.db)),
})
```

- [ ] **Step 3: Mount in `apps/api/src/router.ts`** (`system: systemRouter`).

- [ ] **Step 4: `apps/api/test/system.test.ts`** — insert items, run `rebuildFts`, assert `reindexed` equals the item count and `items_fts` is repopulated (follow `apps/api/test/fts.test.ts`).

- [ ] **Step 5: Run `pnpm --filter @homebox/api test`** (rebuild `@homebox/shared`/`@homebox/db` first if changed).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/system apps/api/src/router.ts apps/api/test/system.test.ts
git commit -m "feat(api): system.rebuildFts admin action

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: `users` + `auth` — forced password change

**Files:**
- Modify: `apps/api/src/modules/users/{repo,service}.ts`
- Modify: `apps/api/src/modules/auth/router.ts`
- Test: `apps/api/test/users.test.ts`, `apps/api/test/authRouter.test.ts`

**Interfaces:**
- Produces: `users` DTO gains `mustChangePassword: boolean`; `auth.me`/`auth.login` return it; `auth.changePassword` (`protectedProcedure`) clears it.
- Consumes: `hashPassword`/`verifyPassword` from `../../auth/password.js`.

- [ ] **Step 1:** `modules/users/repo.ts` — add to the row shape, DTO fields, and insert/update types:

```ts
export type UserRow = { id: number; name: string; email: string; role: 'admin' | 'user'; mustChangePassword: boolean }
const DTO_FIELDS = { id: users.id, name: users.name, email: users.email, role: users.role, mustChangePassword: users.mustChangePassword } as const
export type CreateUserData = { name: string; email: string; passwordHash: string; role: Role; mustChangePassword: boolean }
export type UpdateUserData = Partial<Pick<CreateUserData, 'name' | 'email' | 'passwordHash' | 'role' | 'mustChangePassword'>>
```

- [ ] **Step 2:** `modules/users/service.ts` — surface the flag and force it on create + password reset:

```ts
export type UserDto = { id: number; name: string; email: string; role: Role; mustChangePassword: boolean }
const toDto = (row: UserRow): UserDto => ({ id: row.id, name: row.name, email: row.email, role: row.role, mustChangePassword: row.mustChangePassword })
// createUser: add `mustChangePassword: true` to the repo.createUser payload.
// updateUser: inside `if (input.password !== undefined) data.passwordHash = await hashPassword(input.password)`,
//   also set `data.mustChangePassword = true`.
```

- [ ] **Step 3:** `modules/auth/router.ts` — add `mustChangePassword` to `USER_FIELDS`, to the `login` return, and add the procedure:

**Import `protectedProcedure` too** — the file currently imports `{ t, publicProcedure } from '../../trpc.js'`; `changePassword` needs `protectedProcedure` added to that import.

```ts
const USER_FIELDS = { id: users.id, name: users.name, email: users.email, role: users.role, mustChangePassword: users.mustChangePassword } as const
// login return: `return { id: found.id, name: found.name, email: found.email, role: found.role, mustChangePassword: found.mustChangePassword }`

const changePasswordInput = z.object({ current: z.string().min(8), next: z.string().min(8) })

// …inside authRouter:
changePassword: protectedProcedure.input(changePasswordInput).mutation(async ({ ctx, input }) => {
  const user = ctx.db.select().from(users).where(eq(users.id, ctx.user!.id)).get()
  if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  if (!(await verifyPassword(input.current, user.passwordHash)))
    throw new TRPCError({ code: 'FORBIDDEN', message: 'current password is incorrect' })
  await ctx.db.update(users)
    .set({ passwordHash: await hashPassword(input.next), mustChangePassword: false })
    .where(eq(users.id, user.id))
  return { ok: true }
})
```

- [ ] **Step 4: Extend the tests** — `users.test.ts`: create returns `mustChangePassword: true`, and resetting a password via `update` sets it true again. `authRouter.test.ts`: creating an admin user, `me`/`login` returns `mustChangePassword`, and `changePassword` with the wrong current password rejects (`FORBIDDEN`) while the correct one clears the flag.

- [ ] **Step 5: Run `pnpm --filter @homebox/api test`** (rebuild `@homebox/db` first — the schema changed in Task 1).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/users apps/api/src/modules/auth/router.ts apps/api/test/users.test.ts apps/api/test/authRouter.test.ts
git commit -m "feat(api): forced password change on create/reset

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Backup & restore API + `dbHolder` refactor

**Files:**
- Modify: `apps/api/src/context.ts`, `server.ts`, `index.ts`, `uploads.ts`
- Create: `apps/api/src/modules/backup/service.ts`, `backupRoutes.ts`
- Test: `apps/api/test/backup.test.ts`

**Interfaces:**
- Produces: raw routes `GET /backup` (stream tar.gz), `POST /upload/backup` (validate → `{ preview, restoreId }`), `POST /backup/restore` (confirm → apply). `createContext` now takes a `DbHolder`.
- Consumes: `createDb`, `runMigrations` from `@homebox/db`; raw driver via `$client`.

- [ ] **Step 1: `context.ts` — thread a `DbHolder`.** Change the type + factory so the app can swap the live DB:

```ts
export type DbHolder = { current: DrizzleDb }
export const createContext = (holder: DbHolder) => async ({ req, res }: { req: FastifyRequest; res: FastifyReply }): Promise<Context> => {
  const db = holder.current
  const token = parseSessionCookie(req.headers.cookie)
  const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
  return { db, user, req, res }
}
```

- [ ] **Step 2: `server.ts` — build the holder, register backup routes, add `dbPath`.** `buildApp` keeps its signature (`{ db, dataDir }`) but wraps the db in a holder and passes `dbPath`:

```ts
export type BuildAppOptions = { db: DrizzleDb; dataDir?: string; dbPath?: string }
export const buildApp = ({ db, dataDir = './data', dbPath }: BuildAppOptions) => {
  const app = Fastify()
  const dbHolder: DbHolder = { current: db }
  // …
  trpcOptions: { router: appRouter, createContext: createContext(dbHolder) },
  // Uploads read `dbHolder.current` per request too, so they keep working after
  // a restore swaps the live DB (otherwise they'd hold the closed pre-restore handle).
  registerUploadRoutes(app, { dbHolder, dataDir })
  registerBackupRoutes(app, { dbHolder, dataDir, dbPath })
  return app
}
```

**Add the parallel change in `uploads.ts`** — `registerUploadRoutes` takes `{ dbHolder, dataDir }` instead of `{ db, dataDir }`, and every handler that previously read `db` now reads `const db = dbHolder.current` at the top of the handler (this is what Task 4's per-request `getInstanceSettings(db)` consumes, so it now tracks the active DB). `dataDir` is unchanged.

- [ ] **Step 3: `index.ts` — pass the DB path.** `buildApp({ db, dataDir: env.DATA_DIR, dbPath: env.DATABASE_PATH })`.

**Also update the `listen` helper in `server.ts`** (line ~40): `buildApp({ db: opts.db, dataDir: env.DATA_DIR, dbPath: env.DATABASE_PATH })` — it reads `loadEnv()` so it can pass `env.DATABASE_PATH` just like `index.ts`.

- [ ] **Step 4: `modules/backup/service.ts`** — the file-format logic, isolated and testable (uses the raw driver for `.backup()`/`.close()`):

```ts
import { cp, copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { createDb, runMigrations, instanceSettings, items, users } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import type { DbHolder } from '../../context.js'

const exec = promisify(execFile)

// Access the raw better-sqlite3 driver the drizzle wrapper hides (needed for
// `.backup()`, `.close()`, `.pragma()`).
const rawDb = (db: DrizzleDb) =>
  (db as unknown as { $client: { backup: (d: string) => Promise<void>; close: () => void; pragma: (s: string) => void } }).$client

// Build `tmp/uploads` (copy of the live tree) then tar it with the dump at the
// archive root: layout = `homebox.db` + `uploads/…`. Returns the archive path + size.
export const createBackup = async (db: DrizzleDb, dataDir: string): Promise<{ archivePath: string; size: number }> => {
  const tmp = await mkdtemp(join(tmpdir(), 'homebox-backup-'))
  const dump = join(tmp, 'homebox.db')
  await rawDb(db).backup(dump) // safe: handles WAL, produces a standalone file
  // Only include the uploads tree if it exists (a fresh install may have none).
  try { await cp(join(dataDir, 'uploads'), join(tmp, 'uploads'), { recursive: true }) } catch { /* no uploads yet */ }
  const archive = join(tmp, `backup-${randomUUID()}.tar.gz`)
  await exec('tar', ['-czf', archive, 'homebox.db', 'uploads'], { cwd: tmp })
  return { archivePath: archive, size: (await stat(archive)).size }
}

// Validate an uploaded archive by extracting to `destDir` and opening the dump;
// applies nothing. Returns a preview + a restoreId the route keeps in a Map.
export const validateBackup = async (archivePath: string, destDir: string) => {
  await rm(destDir, { recursive: true, force: true })
  await mkdir(destDir, { recursive: true })
  await exec('tar', ['-xzf', archivePath, '-C', destDir])
  const dump = join(destDir, 'homebox.db')
  const check = createDb(dump)
  try {
    const integrity = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (integrity?.integrity_check !== 'ok') throw new Error('invalid backup: db integrity check failed')
    const is = check.select().from(instanceSettings).limit(1).get()
    const userCount = (check.prepare('select count(*) as n from users').get() as { n: number }).n
    const itemCount = (check.prepare('select count(*) as n from items').get() as { n: number }).n
    return {
      preview: {
        dbBytes: (await stat(dump)).size,
        uploadCount: await countFiles(join(destDir, 'uploads')),
        maxUploadMb: is?.maxUploadMb ?? 10,
        userCount: Number(userCount),
        itemCount: Number(itemCount),
      },
      restoreId: randomUUID(),
    }
  } finally {
    check.$client?.close?.()
  }
}

// Apply a validated extraction (already at `destDir`) to the live data: close the
// old connection, swap the dump + uploads tree, reopen. Destructive.
export const applyRestore = async (holder: DbHolder, destDir: string, dbPath: string, dataDir: string): Promise<void> => {
  if (!dbPath) throw new Error('restore requires a file-backed database path')
  const old = holder.current
  rawDb(old).pragma('wal_checkpoint(TRUNCATE)')
  rawDb(old).close()
  await copyFile(join(destDir, 'homebox.db'), dbPath)
  for (const ext of ['-wal', '-shm']) await rm(dbPath + ext, { force: true })
  await rm(join(dataDir, 'uploads'), { recursive: true, force: true })
  await cp(join(destDir, 'uploads'), join(dataDir, 'uploads'), { recursive: true })
  const fresh = createDb(dbPath)
  runMigrations(fresh)
  holder.current = fresh
}

const countFiles = async (dir: string): Promise<number> => {
  try {
    const { readdir } = await import('node:fs/promises')
    return (await readdir(dir, { recursive: true })).length
  } catch {
    return 0
  }
}
```

> **Implementation note:** `createBackup`/`validateBackup`/`applyRestore` live only in `service.ts`. The `restoreId` → `destDir` map (short-lived, in-memory) lives in `backupRoutes.ts`.

- [ ] **Step 5: `backupRoutes.ts`** — raw routes, cookie-auth + role check (mirror `uploads.ts`), admin-gated:

```ts
import { createReadStream } from 'node:fs'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSessionCookie } from '../../context.js'
import { getSessionUser } from '../../auth/sessions.js'
import { createBackup, validateBackup, applyRestore } from './service.js'

export const registerBackupRoutes = (app, { dbHolder, dataDir, dbPath }) => {
  // Use the CURRENT db handle for auth, mirroring uploads.ts.
  const admin = (req, reply) => {
    const token = parseSessionCookie(req.headers.cookie)
    const user = token ? getSessionUser(dbHolder.current, token, process.env.SESSION_SECRET ?? '') : null
    if (!user) { void reply.code(401).send({ error: 'UNAUTHORIZED' }); return null }
    if (user.role !== 'admin') { void reply.code(403).send({ error: 'FORBIDDEN' }); return null }
    return user
  }

  // Download a fresh backup archive.
  app.get('/backup', async (req, reply) => {
    if (!admin(req, reply)) return
    const { archivePath } = await createBackup(dbHolder.current, dataDir)
    reply.header('Content-Type', 'application/gzip')
    reply.header('Content-Disposition', 'attachment; filename="homebox-backup.tar.gz"')
    const stream = createReadStream(archivePath)
    stream.on('close', () => void rm(archivePath, { recursive: true, force: true }))
    return reply.send(stream)
  })

  // Phase 1 — ingest + validate (non-destructive).
  const restoreDirs = new Map<string, string>()
  app.post('/upload/backup', async (req, reply) => {
    if (!admin(req, reply)) return
    const part = await req.file()
    if (!part) return reply.code(400).send({ error: 'expected a backup archive' })
    const tmp = await mkdtemp(join(tmpdir(), 'homebox-restore-'))
    const archive = join(tmp, 'backup.tar.gz')
    await writeFile(archive, await part.toBuffer())
    const dest = join(tmp, 'extract')
    const { preview, restoreId } = await validateBackup(archive, dest)
    restoreDirs.set(restoreId, dest)
    return { preview, restoreId }
  })

  // Phase 2 — confirm (destructive).
  app.post('/backup/restore', async (req, reply) => {
    if (!admin(req, reply)) return
    const { restoreId } = (req.body ?? {}) as { restoreId?: string }
    const dest = restoreId ? restoreDirs.get(restoreId) : undefined
    if (!dest) return reply.code(400).send({ error: 'unknown restoreId' })
    await applyRestore(dbHolder, dest, dbPath, dataDir)
    restoreDirs.delete(restoreId)
    return { ok: true }
  })
}
```

> The `@fastify/multipart` plugin must be registered before these routes. The image routes register it with a hard `fileSize` ceiling; mount `registerBackupRoutes` **after** `registerUploadRoutes` (which `buildApp` already does) so it reuses that registration. `HARD_UPLOAD_CEILING_MB` is the constant from Task 4's `uploads.ts`, not a separate value here.

- [ ] **Step 6: `apps/api/test/backup.test.ts`** (temp `dbPath` + temp `dataDir`): build the app via `buildApp({ db, dataDir, dbPath })` with a real file-backed temp DB. Assert:
  - `GET /backup` returns a tar.gz whose extracted `homebox.db` passes `integrity_check` and contains the uploaded `uploads/` subtree.
  - `POST /upload/backup` returns `{ preview, restoreId }`; then `POST /backup/restore` swaps the data (round-trip: backup → restore → data matches). Non-admin gets 401/403. Invalid archive returns a 400 and leaves the live DB untouched.

- [ ] **Step 7: Run `pnpm build` (root) then `pnpm --filter @homebox/api test`.** Expected: api tests pass (other apps build too).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/context.ts apps/api/src/server.ts apps/api/src/index.ts apps/api/src/modules/backup apps/api/test/backup.test.ts
git commit -m "feat(api): backup/restore + swappable db holder

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Web — `/admin` guard + nav + route

**Files:**
- Modify: `apps/web/src/lib/auth.tsx`, `apps/web/src/app/routes.tsx`, `apps/web/src/app/Shell.tsx`
- Test: `apps/web/test/admin.test.tsx`, extend `apps/web/test/shell.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (`lib/auth.tsx`) → `user.role`; `trpc` from `api/trpc`.
- Produces: `RequireAdmin` guard; `/admin` route; admin nav item.

- [ ] **Step 1: `lib/auth.tsx` — add `RequireAdmin`:**

```tsx
// Route guard: non-admins can't reach the /admin area.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}
```

- [ ] **Step 2: `app/routes.tsx` — add the `/admin` route** inside the existing authenticated `Shell` block, wrapping the page in `RequireAdmin`:

```tsx
<Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
```

- [ ] **Step 3: `app/Shell.tsx` — show the admin nav item only to admins.** Add `const { user } = useAuth()`; extend `navItems` with an admin entry rendered conditionally in **both** the desktop nav and the drawer:

```tsx
const adminNav = user?.role === 'admin' ? [{ to: '/admin', key: 'admin' }] : []
const items = [...navItems, ...adminNav]
```

- [ ] **Step 4: `apps/web/test/admin.test.tsx`** — mock `auth.me`; non-admin visiting `/admin` is redirected to `/`; admin sees the page. Extend `shell.test.tsx` so an admin sees the Admin link and a non-admin does not.

- [ ] **Step 5: Run `pnpm --filter @homebox/web build && pnpm --filter @homebox/web test`** (`@homebox/api` must be built first so its new procedures typecheck).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/auth.tsx apps/web/src/app/routes.tsx apps/web/src/app/Shell.tsx apps/web/test/admin.test.tsx apps/web/test/shell.test.tsx
git commit -m "feat(web): /admin route + role-gated nav

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Web — `/admin` feature (Users, Instance settings, Backup & restore, System tabs)

**Files:**
- Create: `apps/web/src/features/admin/AdminPage.tsx`, `AdminUsersTab.tsx`, `AdminSettingsTab.tsx`, `AdminBackupTab.tsx`, `AdminSystemTab.tsx`, `index.ts`
- Create: `apps/web/public/locales/en/admin.json`
- Test: `apps/web/test/adminUsers.test.tsx`, `adminSettings.test.tsx`

**Interfaces:**
- Consumes: `trpc.users.*`, `trpc.instanceSettings.*`, `trpc.system.rebuildFts`, raw `GET /backup` / `POST /upload/backup` / `POST /backup/restore` via `fetch`.
- Produces: the tabbed admin page.

- [ ] **Step 1: `admin.json`** — keys: `admin.title`, `nav.admin`, `tabs.users/settings/backup/system`, and per-tab labels.

- [ ] **Step 2: `AdminPage.tsx`** — tab state + the four tab components. This anchors the pattern; the other tab files follow it:

```tsx
export type AdminTab = 'users' | 'settings' | 'backup' | 'system'

export function AdminPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<AdminTab>('users')
  const tabs: { id: AdminTab; label: string }[] = [
    { id: 'users', label: t('admin.tabs.users') },
    { id: 'settings', label: t('admin.tabs.settings') },
    { id: 'backup', label: t('admin.tabs.backup') },
    { id: 'system', label: t('admin.tabs.system') },
  ]
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('admin.title')}</h1>
      <div className="flex gap-1 border-b border-border">
        {tabs.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)}
            className={`px-3 py-1.5 border-b-2 ${tab === x.id ? 'border-accent text-accent' : 'border-transparent'}`}>
            {x.label}
          </button>
        ))}
      </div>
      {tab === 'users' && <AdminUsersTab />}
      {tab === 'settings' && <AdminSettingsTab />}
      {tab === 'backup' && <AdminBackupTab />}
      {tab === 'system' && <AdminSystemTab />}
    </div>
  )
}
```

Representative tab hook usage (the same `useQuery`/`useMutation` + `useUtils().invalidate` pattern used across `ItemTypesPage.tsx` and `SettingsPage.tsx`):

```tsx
export function AdminUsersTab() {
  const utils = trpc.useUtils()
  const { data: users } = trpc.users.list.useQuery()
  const create = trpc.users.create.useMutation({ onSuccess: () => void utils.users.list.invalidate() })
  // form → create.mutate({ name, email, password, role }); on success, surface the
  // one-time temp password (the create return has `mustChangePassword: true`).
  return <ul className="space-y-2">{users?.map((u) => <li key={u.id} className="flex justify-between">{u.name} · {u.role}</li>)}</ul>
}
```

- [ ] **Step 3: `AdminUsersTab.tsx`** — `trpc.users.list.useQuery()`; a create form (name/email/temp password/role) that shows the returned `mustChangePassword` prompt ("share this temp password") once; edit (role + a "reset password" that sets `mustChangePassword`); delete.

- [ ] **Step 4: `AdminSettingsTab.tsx`** — `trpc.instanceSettings.get/update`; number field for `max_upload_mb`; `remote`/`local` radio; provider sub-option inputs persisted into `detectionConfig`; save via `update`.

- [ ] **Step 5: `AdminBackupTab.tsx`** — Download button (`fetch('/backup')`) triggering a blob download; an upload `<input type="file">` → `POST /upload/backup` → show `preview` + a destructive confirm → `POST /backup/restore` → success/error messaging.

- [ ] **Step 6: `AdminSystemTab.tsx`** — a "Rebuild search index" button → `trpc.system.rebuildFts.useMutation()` → shows `reindexed`.

- [ ] **Step 7: Tests** — `adminUsers.test.tsx` (create flow shows temp password), `adminSettings.test.tsx` (form persists via update).

- [ ] **Step 8: Run `pnpm --filter @homebox/api build && pnpm --filter @homebox/web test`.**

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/admin apps/web/public/locales/en/admin.json apps/web/test/adminUsers.test.tsx apps/web/test/adminSettings.test.tsx
git commit -m "feat(web): /admin back-office with tabs

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: Web — forced password-change screen

**Files:**
- Modify: `apps/web/src/features/auth/LoginPage.tsx`
- Create: `apps/web/src/features/auth/ChangePasswordPage.tsx`
- Test: `apps/web/test/auth.test.tsx`

**Interfaces:**
- Consumes: `trpc.auth.me` (returns `mustChangePassword`), `trpc.auth.changePassword`.
- Produces: after login/me, users with `mustChangePassword` are routed to a change screen.

- [ ] **Step 1: `ChangePasswordPage.tsx`** — form (current + new password) → `auth.changePassword` → on success invalidate `auth.me` and route to `/`. Read the current user via `useAuth()`.

- [ ] **Step 2: `LoginPage.tsx`** — after successful `auth.login`, if the returned `mustChangePassword` is true, `navigate('/change-password')` instead of the home redirect; also `navigate('/change-password')` from `me` when the flag is set for an already-signed-in user.

- [ ] **Step 3: Add the `/change-password` route** in `routes.tsx` (authenticated, inside the `Shell` block).

- [ ] **Step 4: Extend `apps/web/test/auth.test.tsx`** — login with `mustChangePassword: true` lands on `/change-password`; submitting the form clears the flag.

- [ ] **Step 5: Run `pnpm --filter @homebox/web test`**.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/auth apps/web/src/app/routes.tsx apps/web/test/auth.test.tsx
git commit -m "feat(web): forced password change on first login

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: E2E — admin flow

**Files:**
- Create: `apps/web/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: the built app (see `apps/web/e2e/global-setup.ts` / `playwright.config.ts`).

- [ ] **Step 1: Write `admin.spec.ts`** following `catalog.spec.ts` — admin login → create a user with a temp password → the new user is forced to change it on first login → can then log in; admin reaches `/admin`; create a backup (download) and a restore round-trip.

- [ ] **Step 2: Run `pnpm --filter @homebox/web test:e2e`** (build the app first: `pnpm build`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/admin.spec.ts
git commit -m "test(e2e): admin user invite + backup/restore

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: Full verification + cleanup note

**Steps:**
- [ ] **Step 1: Run the whole suite** from the repo root: `pnpm build && pnpm test`. Expected: unit (db, shared, api, web) + e2e green. **If a `pnpm test` failure looks like a missing export from `@homebox/db`/`@homebox/shared`, it is almost certainly a stale `dist/` — run `pnpm build` again, not a code change.**

- [ ] **Step 2: Re-read the spec** (`docs/superpowers/specs/2026-09-06-phase5-admin-backup-design.md`) and confirm every section maps to a task above; fix any gap by adding a step, not by leaving it implicit.

### Task 13: DetectionProvider interface + registry (config-only)

**Files:**
- Create: `apps/api/src/modules/detection/provider.ts`
- Test: `apps/api/test/detection.test.ts`

**Interfaces:**
- Produces: `DetectionBox`, `DetectionProvider`, `DetectionProviderRegistry` (registered providers: none), `detectionRegistry` singleton.
- Consumes: nothing (pure types + a `Map`). Order-independent.

- [ ] **Step 1: `provider.ts`** — the interface and an empty registry, per spec §E ("setting and the interface exist now; providers wire in later"):

```ts
export type DetectionBox = {
  box: { x: number; y: number; width: number; height: number }
  label: string
  confidence: number
}

export interface DetectionProvider {
  name: string
  detectBoxes(image: Buffer): Promise<DetectionBox[]>
}

// No concrete provider is registered in Phase 5 — the config surface exists, and
// the providers are wired in a later phase. `get` returns undefined for any name;
// callers surface "configure a detection provider".
export class DetectionProviderRegistry {
  private providers = new Map<string, DetectionProvider>()
  register(p: DetectionProvider) { this.providers.set(p.name, p) }
  get(name: string) { return this.providers.get(name) }
  names() { return [...this.providers.keys()] }
}

export const detectionRegistry = new DetectionProviderRegistry()
```

- [ ] **Step 2: `apps/api/test/detection.test.ts`** — assert `detectionRegistry.get('remote')` is `undefined` and `names()` is `[]`; a fake provider round-trips through `register`/`get`/`detectBoxes`.

- [ ] **Step 3: Run `pnpm --filter @homebox/api test`.** Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/detection apps/api/test/detection.test.ts
git commit -m "feat(api): DetectionProvider interface + registry

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Risk notes

- **backup/restore is the highest-risk piece.** Keep all file/db side effects inside `modules/backup/`. The commit for Task 7 must leave `pnpm test` green; if restore is flaky under test, verify the `$client` raw-driver access is correct before touching anything else.
- **Stale-dist false positives** will dominate if the build order is skipped. After any `packages/db` or `packages/shared` change, rebuild before the downstream package's tests.
- **`tar` is a system dependency** — the backup module shells out to it. If the target deploy lacks `tar`, capstone the archive builder behind a small interface instead (defer to implementation only if a test fails on that path).
