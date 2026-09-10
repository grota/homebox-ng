# Phase 1: Foundation + Catalog Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working self-hosted home-inventory app where a user can sign in and catalogue items (name, description, quantity, type, location, tags, photos), with admin-created accounts, nested locations, user-defined item types with custom fields, and a React UI.

**Architecture:** pnpm workspaces + Turborepo monorepo. `apps/api` is a Fastify + tRPC (v11) Node/TS server backed by SQLite (better-sqlite3 + Drizzle). `apps/web` is a Vite React SPA consuming the tRPC router with a typed client. `packages/shared` holds zod validation + types; `packages/db` holds the Drizzle schema, client, and migrations. Images are written to disk under `DATA_DIR` (relative paths in the DB) with a `sharp`-generated thumbnail.

**Tech Stack:** Node ≥20, pnpm ≥9, TypeScript (strict), Fastify, tRPC v11, zod, better-sqlite3, Drizzle ORM + drizzle-kit, React 18, Vite, Tailwind, react-query, react-router, Vitest, Playwright, sharp, argon2.

**Spec:** `docs/superpowers/specs/2026-09-04-homebox-ng-design.md`

## Global Constraints

- Node ≥ 20; pnpm ≥ 9; TypeScript `strict: true`; ECMAScript modules.
- DB: SQLite via `better-sqlite3` (synchronous) + Drizzle ORM; drizzle-kit migrations.
- API: Fastify + tRPC v11. All input validation via zod schemas in `packages/shared`.
- Password hashing: argon2id (use `argon2`). Sessions: httpOnly, SameSite=Lax cookie; store a SHA-256 hash of the token in `sessions`.
- Images: stored on disk under `DATA_DIR` (`uploads/originals/`), thumbnail under `uploads/thumbs/`; DB stores relative paths, not blobs. Thumbnail ~400px wide via `sharp`.
- Shared catalog: every user can read all items. Normal items are created `published=true`; the `published` flag exists in the schema (default `true`), draft flow is introduced in Phase 6 (folder `unpack` deferred).
- Roles: `admin` (manage users, item types, instance settings) and `user` (CRUD items/locations/tags). Role check via tRPC middleware.
- Item types are **instance-wide** and admin-managed (Phase 1: any admin can create them; not per-user).
- Locations form a nested tree via nullable `parent_id`. Tags are unique by name.
- `DATA_DIR` (default `./data`), `DATABASE_PATH` (default `./data/homebox.db`), `SESSION_SECRET` come from env (`packages/db` reads `env.ts`).
- Repos live in `apps/api/src/modules/<name>/`; each module has `repo.ts` (Drizzle queries) + `service.ts` (business logic) + `router.ts` (tRPC). Keep files focused.

## File Structure

- `package.json` (root), `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `eslint.config.js`.
- `packages/shared/` — `src/schemas.ts` (zod inputs + inferred types), `src/constants.ts`, `src/index.ts`, `vitest.config.ts`.
- `packages/db/` — `src/schema.ts` (Drizzle tables), `src/client.ts` (drizzle + better-sqlite3 factory), `src/migrate.ts`, `src/index.ts`, `drizzle/` (generated migrations), `vitest.config.ts`.
- `apps/api/` —
  - `src/env.ts`, `src/context.ts`, `src/router.ts`, `src/server.ts`, `src/auth/password.ts`, `src/auth/sessions.ts`, `src/uploads.ts`.
  - `src/modules/users/{repo,service,router}.ts`, `src/modules/locations/...`, `src/modules/itemTypes/...`, `src/modules/items/...`, `src/modules/tags/...`, `src/modules/images/...`.
  - `test/` (Vitest).
- `apps/web/` — `src/main.tsx`, `src/App.tsx`, `src/api/trpc.ts`, `src/app/AppProviders.tsx`, `src/app/routes.tsx`, `src/lib/auth.ts`; `src/features/{auth,locations,itemTypes,items,tags}/` (components + pages); `src/ui/`; `test/` (Vitest + a thin `e2e/` Playwright).

---

### Task 1: Workspace + shared validation package

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `eslint.config.js`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/schemas.ts`, `packages/shared/src/constants.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/schemas.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `packages/shared` exports `zod` schemas `loginInput`, `locationInput`, `itemTypeInput`, `itemInput`, `tagInput` and their inferred types (`type LoginInput = z.infer<typeof loginInput>`, etc.). `constants.ts` exports `LOCATION_DEPTH_MAX = 8`, `ROLES = ['admin','user'] as const`. Build script: `pnpm -r build` compiles every package.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/schemas.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { loginInput, itemInput, locationInput } from '../src/schemas'

describe('shared schemas', () => {
  it('accepts a valid login', () => {
    expect(loginInput.safeParse({ email: 'a@b.c', password: 'x'.repeat(8) }).success).toBe(true)
  })
  it('rejects a short password', () => {
    expect(loginInput.safeParse({ email: 'a@b.c', password: 'short' }).success).toBe(false)
  })
  it('rejects an item with a negative quantity', () => {
    expect(itemInput.safeParse({
      name: 'Lamp', description: '', quantity: -1, unit: null,
      itemTypeId: 1, locationId: 1,
    }).success).toBe(false)
  })
  it('accepts a valid location', () => {
    expect(locationInput.safeParse({ name: 'Garage', parentId: null }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run from repo root: `pnpm --filter @homebox/shared test`
Expected: FAIL — `schemas.ts` module not found / symbols undefined.

- [ ] **Step 3: Scaffold the workspace + write the schemas**

Create the root files and `packages/shared` with working `package.json` (name `@homebox/shared`, scripts `test: vitest run`, `build: tsc -b`), `tsconfig.json` extending `tsconfig.base.json`. Then:

`packages/shared/src/schemas.ts`
```ts
import { z } from 'zod'

export const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})
export const locationInput = z.object({
  name: z.string().min(1),
  parentId: z.number().int().positive().nullable(),
})
export const itemTypeInput = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
})
export const itemInput = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  quantity: z.number().int().min(0).default(1),
  unit: z.string().nullable().default(null),
  itemTypeId: z.number().int().positive(),
  locationId: z.number().int().positive().nullable(),
})
export const tagInput = z.object({ name: z.string().min(1), color: z.string().default('#888888') })

export type LoginInput = z.infer<typeof loginInput>
export type LocationInput = z.infer<typeof locationInput>
export type ItemTypeInput = z.infer<typeof itemTypeInput>
export type ItemInput = z.infer<typeof itemInput>
export type TagInput = z.infer<typeof tagInput>
```

`packages/shared/src/constants.ts`
```ts
export const LOCATION_DEPTH_MAX = 8
export const ROLES = ['admin', 'user'] as const
export type Role = (typeof ROLES)[number]
```

`packages/shared/src/index.ts` re-exports both. `tsconfig.base.json` sets `"strict": true`, `"moduleResolution": "bundler"`, `"target": "ES2022"`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @homebox/shared test`
Expected: PASS (4 tests). Then `pnpm -r build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add . 
git commit -m "build: scaffold pnpm/turbo workspace and shared validation schemas"
```

---

### Task 2: Database schema, client, and migrations

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.config.ts`
- Create: `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/index.ts`
- Create: `packages/db/drizzle.config.ts`
- Test: `packages/db/test/migrate.test.ts`

**Interfaces:**
- Consumes: `@homebox/shared` not yet used directly here.
- Produces: `packages/db` exports `db` table objects: `users`, `sessions`, `locations`, `itemTypes`, `itemTypeFields`, `items`, `itemCustomFieldValues`, `tags`, `itemTags`, `images`; and `createDb(dbPath): DrizzleDb`, `runMigrations(db)`. `item_type_fields.field_type` union: `'text'|'number'|'currency'|'date'|'boolean'|'url'`.

- [ ] **Step 1: Write the failing test**

`packages/db/test/migrate.test.ts`
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createDb, runMigrations } from '../src/index'

let db: ReturnType<typeof createDb>
beforeAll(() => {
  db = createDb(':memory:')
  runMigrations(db)
})

describe('db schema', () => {
  it('creates the core tables', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const set = new Set(names.map(n => n.name))
    expect(['users','sessions','locations','item_types','items','tags','item_tags','images']).every(t => set.has(t))
  })
  it('enforces a non-null item name', () => {
    expect(() => db.prepare('INSERT INTO items (name) VALUES (NULL)').run()).toThrow()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @homebox/db test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write schema + client + migration runner**

Add deps: `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `@types/better-sqlite3`. `runMigrations` runs migrations from `migrate()` (drizzle). Define the tables in `schema.ts` following the spec's data model (Phase-1 columns; `published` default `true`; `images` with `original_path`, `thumb_path`, `is_primary`; `item_type_fields` with `field_type`, `config` JSON, `required`, `sort_order`). Live migration files committed under `packages/db/drizzle/`.

```ts
// client.ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
export const createDb = (dbPath: string) => {
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @homebox/db test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): drizzle schema, client, and migrations for core tables"
```

---

### Task 3: Fastify server bootstrap + tRPC router + health

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`
- Create: `apps/api/src/env.ts`, `apps/api/src/context.ts`, `apps/api/src/router.ts`, `apps/api/src/server.ts`
- Test: `apps/api/test/server.test.ts`

**Interfaces:**
- Consumes: `createDb`, `runMigrations` (`@homebox/db`).
- Produces: `createApp({ db })` returns a Fastify instance with `/health` (GET → `{ ok: true }`) and a mounted tRPC router (`app.trpc` via `@fastify/trpc` or tRPC's Fastify adapter). `context` type `{ user: SessionUser|null, db }`. The router exposes `appRouter` with a `ping` query.

- [ ] **Step 1: Write the failing test**

`apps/api/test/server.test.ts`
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
beforeAll(async () => {
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
})
afterAll(() => app.close())

describe('server', () => {
  it('serves /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @homebox/api test`
Expected: FAIL — module `../src/server` not found.

- [ ] **Step 3: Write the server + router**

Add deps: `fastify`, `@fastify/trpc` (or `@trpc/server` + a Fastify adapter), `@trpc/server`, `@homebox/shared`, `@homebox/db`, `zod`.

```ts
// context.ts
export type SessionUser = { id: number; role: 'admin' | 'user' }
export type Context = { db: DrizzleDb; user: SessionUser | null }
export const createContext = (db: DrizzleDb) => async ({ req }: { req: FastifyRequest }): Promise<Context> => {
  // phase 3 fills in session resolution
  return { db, user: null }
}
// router.ts
export const appRouter = router({
  ping: publicProcedure.query(() => 'pong'),
})
export type AppRouter = typeof appRouter
```

`server.ts` builds Fastify, mounts tRPC under `/trpc`, serves `/health`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @homebox/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): Fastify + tRPC bootstrap with health endpoint"
```

---

### Task 4: Password hashing + session store

**Files:**
- Create: `apps/api/src/auth/password.ts`, `apps/api/src/auth/sessions.ts`
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**
- Consumes: `users`, `sessions` tables.
- Produces: `hashPassword(pw): Promise<string>`, `verifyPassword(pw, hash): Promise<boolean>`; `createSession(db, userId, secret): Promise<{ token, expiresAt }>`, `getSessionUser(db, token, secret): Promise<SessionUser|null>`, `invalidateSession(db, token, secret)`. Sessions store `token_hash = sha256(token + secret)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password'
import { createDb, runMigrations, users, sessions } from '@homebox/db'
import { createSession, getSessionUser, invalidateSession } from '../src/auth/sessions'

it('hashes and verifies a password', async () => {
  const h = await hashPassword('password123')
  expect(h).not.toBe('password123')
  expect(await verifyPassword('password123', h)).toBe(true)
  expect(await verifyPassword('wrong', h)).toBe(false)
})
it('creates a session and resolves the user', async () => {
  const db = createDb(':memory:'); runMigrations(db)
  db.insert(users).values({ name: 'A', email: 'a@b.c', passwordHash: await hashPassword('password123'), role: 'admin' }).run()
  const user = db.select({ id: users.id, role: users.role }).from(users).get()!
  const { token } = createSession(db, user.id, 'sec')
  const got = getSessionUser(db, token, 'sec')
  expect(got?.id).toBe(user.id)
  invalidateSession(db, token, 'sec')
  expect(getSessionUser(db, token, 'sec')).toBeNull()
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @homebox/api test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement password + session modules**

`password.ts` uses `argon2.hash/verify`. `sessions.ts`:
```ts
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export const createSession = (db, userId, secret) => {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  db.insert(sessions).values({ userId, tokenHash: sha(token + secret), expiresAt: new Date(expiresAt), createdAt: new Date() }).run()
  return { token, expiresAt: new Date(expiresAt) }
}
export const getSessionUser = (db, token, secret) => {
  const s = db.select().from(sessions).where(eq(sessions.tokenHash, sha(token + secret))).get()
  if (!s) return null
  if (new Date(s.expiresAt) < new Date()) return null
  return db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, s.userId)).get() ?? null
}
```

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/test/auth.test.ts
git commit -m "feat(auth): argon2id password hashing and session store"
```

---

### Task 5: Auth tRPC procedures (setup, login, logout, me)

**Files:**
- Create: `apps/api/src/modules/auth/router.ts`
- Modify: `apps/api/src/context.ts` (resolve session user), `apps/api/src/router.ts` (mount auth)
- Test: `apps/api/test/authRouter.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `createSession`/`getSessionUser`, `users` table, `loginInput`, `SessionUser`.
- Produces: `authRouter` with `auth.setup` (create initial admin when no users exist), `auth.login` ({ email, password } → sets cookie + returns user), `auth.me` (returns current user or null), `auth.logout`. Uses tRPC `publicProcedure`. Cookie name `session`. `SessionUser = { id, role }`.

- [ ] **Step 1: Write the failing test**

```ts
it('bootstraps the admin, logs in, and returns /me', async () => {
  const app = buildApp({ db }); await app.ready()
  const setup = await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name:'A', email:'a@b.c', password:'password123' } })
  expect(setup.statusCode).toBe(200)
  const login = await app.inject({ method:'POST', url:'/trpc/auth.login', payload:{ email:'a@b.c', password:'password123' } })
  const setCookie = login.headers['set-cookie'] as unknown as string[]
  expect(setCookie?.[0]).toContain('session=')
  const me = await app.inject({ method:'GET', url:'/trpc/auth.me', headers:{ cookie: setCookie?.[0] } })
  expect(me.json()?.result?.data?.email).toBe('a@b.c')
})
```
(Exact URL shape depends on the tRPC Fastify adapter; adjust to `POST /trpc/auth.login?batch=1` if using the default JSON transport.)

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL — auth router undefined.

- [ ] **Step 3: Implement auth router + session context**

`setup` guards: if any user exists → throw `FORBIDDEN`. Else create admin user with `hashPassword`. `login` verifies password, calls `createSession`, sets `Set-Cookie: session=<token>; HttpOnly; SameSite=Lax; Path=/`. `me` reads cookie via `getSessionUser` → `{ id, name, email, role }` or `null`. `logout` invalidates + clears cookie. Update `context.ts` to resolve `user` from the `session` cookie using `SESSION_SECRET`.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth apps/api/src/context.ts apps/api/src/router.ts apps/api/test/authRouter.test.ts
git commit -m "feat(auth): setup, login, logout, me procedures"
```

---

### Task 6: Users module (admin creates users)

**Files:**
- Create: `apps/api/src/modules/users/{repo,service,router}.ts`
- Modify: `apps/api/src/router.ts`
- Test: `apps/api/test/users.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `Context.user.role`, `users` table.
- Produces: `usersRouter` with `users.list` (admin), `users.create` (admin, `{ name, email, password, role }` → user; temp password), `users.update` (admin), `users.delete` (admin). An `adminProcedure` middleware rejects non-admins with `FORBIDDEN`. `userDto = { id, name, email, role }`.

- [ ] **Step 1: Write the failing test**

```ts
it('lets an admin create a user', async () => {
  // login as admin (from Task 5 helper) -> cookie
  const res = await app.inject({ method:'POST', url:'/trpc/users.create', headers:{ cookie }, payload:{ name:'B', email:'b@c.d', password:'password123', role:'user' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()?.result?.data?.role).toBe('user')
})
it('rejects a non-admin', async () => {
  // login as normal user -> cookie
  const res = await app.inject({ method:'POST', url:'/trpc/users.create', headers:{ cookie:nonAdminCookie }, payload:{ name:'C', email:'c@d.e', password:'password123', role:'user' } })
  expect(res.json()?.error?.data?.code).toBe('FORBIDDEN')
})
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement users module + admin middleware**

`adminProcedure = protectedProcedure.use(({ ctx, next }) => ctx.user?.role === 'admin' ? next() : throwError('FORBIDDEN'))`. Repo does CRUD; service hashes the password; router maps inputs via zod (`userInput`).

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/users apps/api/src/router.ts apps/api/test/users.test.ts
git commit -m "feat(users): admin-only user management"
```

---

### Task 7: Locations module (nested tree)

**Files:**
- Create: `apps/api/src/modules/locations/{repo,service,router}.ts`
- Modify: `apps/api/src/router.ts`
- Test: `apps/api/test/locations.test.ts`

**Interfaces:**
- Consumes: `locationInput`, `locations` table, `LOCATION_DEPTH_MAX`.
- Produces: `locationsRouter` with `locations.list` (tree or flat), `locations.create`, `locations.update`, `locations.delete` (refuse deletion with children). `locationDto = { id, name, parentId, description, depth, children? }`.

- [ ] **Step 1: Write the failing test**

```ts
it('creates nested locations and blocks delete when children exist', async () => {
  const parent = await createLocation(cookie, { name:'Home', parentId:null })
  const child = await createLocation(cookie, { name:'Garage', parentId: parent.id })
  const del = await app.inject({ method:'POST', url:'/trpc/locations.delete', headers:{ cookie }, payload:{ id: parent.id } })
  expect(del.json()?.error?.data?.code).toBe('CONFLICT')
})
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement locations module**

Repo queries enforce depth ≤ `LOCATION_DEPTH_MAX`; delete refuses when `parent_id` of another row references the target. Same pattern as Task 6.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/locations apps/api/src/router.ts apps/api/test/locations.test.ts
git commit -m "feat(locations): nested location tree CRUD"
```

---

### Task 8: Item types + custom field definitions

**Files:**
- Create: `apps/api/src/modules/itemTypes/{repo,service,router}.ts`
- Modify: `apps/api/src/router.ts`
- Test: `apps/api/test/itemTypes.test.ts`

**Interfaces:**
- Consumes: `itemTypes`, `itemTypeFields` tables, `itemTypeInput`.
- Produces: `itemTypesRouter` (admin) with `.list`, `.create` (with `fields: ItemTypeFieldInput[]`), `.update`, `.delete` (refuse if items reference it). `ItemTypeFieldInput = { name, fieldType: 'text'|'number'|'currency'|'date'|'boolean'|'url', required?: boolean, config?: Json, sortOrder?: number }`.

- [ ] **Step 1: Write the failing test**

```ts
it('creates a type with custom fields', async () => {
  const res = await app.inject({ method:'POST', url:'/trpc/itemTypes.create', headers:{ cookie:adminCookie }, payload:{ name:'Book', fields:[{ name:'ISBN', fieldType:'text' }] } })
  const data = res.json()?.result?.data
  expect(data?.fields?.length).toBe(1)
  expect(data?.fields?.[0]?.fieldType).toBe('text')
})
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement itemTypes module**

`create` inserts the type + its field defs in a transaction (`db.transaction`). `delete` checks `items.item_type_id` references.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/itemTypes apps/api/src/router.ts apps/api/test/itemTypes.test.ts
git commit -m "feat(item-types): instance-wide types with custom fields"
```

---

### Task 9: Items module (CRUD + custom-field values)

**Files:**
- Create: `apps/api/src/modules/items/{repo,service,router}.ts`
- Modify: `apps/api/src/router.ts`
- Test: `apps/api/test/items.test.ts`

**Interfaces:**
- Consumes: `itemInput`, `items`, `itemCustomFieldValues`, `itemTypeFields` tables, `DrizzleDb.transaction`.
- Produces: `itemsRouter` with `items.create` (creates item + custom-field values, always `published=true`), `items.update`, `items.delete`, `items.get` (with `customFields`, `type`, `location`, `tags`, `images`), `items.list` (paginated `{ items, total }`). `itemDto` carries hydration.

- [ ] **Step 1: Write the failing test**

```ts
it('creates an item with custom-field values and reads it back', async () => {
  const type = await createTypeWithField(adminCookie, 'currency', 'price')
  const res = await app.inject({ method:'POST', url:'/trpc/items.create', headers:{ cookie }, payload:{ name:'Desk', itemTypeId:type.id, locationId:null, quantity:1, description:'wood', fieldValues:[{ fieldId: type.fields[0].id, value:'120.00' }] } })
  const data = res.json()?.result?.data
  expect(data?.name).toBe('Desk')
  expect(data?.customFields?.[0]?.value).toBe('120.00')
})
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement items module**

`create` runs a `db.transaction`: insert item (published true), insert each `fieldValues` row using the field id + stringified value. `get`/`list` join and hydrate. Validate quantity ≥ 0.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/items apps/api/src/router.ts apps/api/test/items.test.ts
git commit -m "feat(items): item CRUD with custom-field values"
```

---

### Task 10: Tags module

**Files:**
- Create: `apps/api/src/modules/tags/{repo,service,router}.ts`
- Modify: `apps/api/src/router.ts`
- Test: `apps/api/test/tags.test.ts`

**Interfaces:**
- Consumes: `tagInput`, `tags`, `itemTags`.
- Produces: `tagsRouter` with `tags.list`, `tags.create`, `tags.assign` (`{ itemId, tagIds }`), `tags.delete`. `tagDto = { id, name, color }`.

- [ ] **Step 1: Write the failing test**

```ts
it('creates a tag and assigns it to an item', async () => {
  const tag = await createTag(cookie, 'fragile')
  const res = await app.inject({ method:'POST', url:'/trpc/tags.assign', headers:{ cookie }, payload:{ itemId: 1, tagIds:[tag.id] } })
  expect(res.statusCode).toBe(200)
  const list = await app.inject({ method:'GET', url:'/trpc/tags.list', headers:{ cookie } })
  expect(list.json()?.result?.data?.some(t => t.name === 'fragile')).toBe(true)
})
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement tags module**

`create` upserts by name; `assign` replaces `item_tags` rows for the item in a transaction.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/tags apps/api/src/router.ts apps/api/test/tags.test.ts
git commit -m "feat(tags): tag CRUD and item assignment"
```

---

### Task 11: Image upload + thumbnail

**Files:**
- Create: `apps/api/src/uploads.ts`
- Modify: `apps/api/src/server.ts` (register route), `apps/api/src/env.ts` (`DATA_DIR`)
- Create: `apps/api/src/modules/images/{repo,service,router}.ts` (list/detail service used by items.get)
- Test: `apps/api/test/uploads.test.ts`

**Interfaces:**
- Consumes: `images` table, `sharp`, `max_upload_mb` (from `instance_settings`, default 10), `items`.
- Produces: `POST /upload/image` (multipart, `itemId`, file) → validates MIME (`image/*`) + size vs `max_upload_mb`, writes original to `DATA_DIR/uploads/originals/<uuid>.ext`, generates thumb `DATA_DIR/uploads/thumbs/<uuid>.jpg` (~400px, sharp), inserts an `images` row (`original_path`, `thumb_path`, `format`, `size_bytes`, `sort_order`; `is_primary` = first image). `images.setPrimary`, `images.delete`. File serving route `GET /file/<relpath>` (path-traversal guarded).

- [ ] **Step 1: Write the failing test**

```ts
it('uploads an image and creates a thumbnail', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  const res = await app.inject({ method:'POST', url:'/upload/image', headers:{ cookie, 'content-type':'multipart/form-data' }, payload: { itemId: '1', file: { mimetype:'image/png', data: png } } })
  expect(res.statusCode).toBe(200)
  const img = res.json()
  expect(img.originalPath).toMatch(/originals\//)
  expect(img.thumbPath).toMatch(/thumbs\//)
})
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement uploads route**

Use `@fastify/multipart`. Enforce size against `max_upload_mb`. Use `randomUUID()` for filenames; store relative paths. `sharp(input).resize({ width: 400 }).jpeg({ quality: 80 })` for the thumb. Guard `GET /file/<relpath>` against `..` and absolute paths.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/uploads.ts apps/api/src/server.ts apps/api/src/env.ts apps/api/src/modules/images apps/api/test/uploads.test.ts
git commit -m "feat(images): multipart image upload with sharp thumbnail"
```

---

### Task 12: Web SPA shell + tRPC client + auth pages

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/vitest.config.ts`
- Create: `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`
- Create: `apps/web/src/api/trpc.ts`, `apps/web/src/app/AppProviders.tsx`, `apps/web/src/app/routes.tsx`, `apps/web/src/lib/auth.tsx`
- Create: `apps/web/src/features/auth/{LoginPage,SetupPage}.tsx`
- Test: `apps/web/test/auth.test.tsx`

**Interfaces:**
- Consumes: `AppRouter` type (`@homebox/api`), the `session` cookie (httpOnly).
- Produces: a booted Vite React app with `QueryClientProvider`, `TrpcProvider` (typed `trpc` client pointing at `/trpc`), react-router routes (`/login`, `/setup`, `/`), and `useAuth()` guard that redirects to `/login` when `auth.me` returns null; `/setup` redirects to `/` when a user already exists.

- [ ] **Step 1: Write the failing test**

`apps/web/test/auth.test.tsx` (Vitest + React Testing Library, using `@trpc/server` `createCaller` against a temp router, or `@trpc/react-query` mocked):
```tsx
it('renders login form and submits credentials', async () => {
  render(<AppProviders><LoginPage/></AppProviders>)
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Email'), { target:{ value:'a@b.c' } })
  fireEvent.change(screen.getByLabelText('Password'), { target:{ value:'password123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByText(/signed in/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement the SPA shell + auth UI**

`vite.config.ts` proxies `/trpc` to `http://localhost:3000`. `trpc.ts` uses `createTRPCReact<AppRouter>()` with `credentials: 'include'` on fetch `url`. `AppProviders` wraps `TrpcProvider` + `QueryClientProvider`. `useAuth` calls `trpc.auth.me.useQuery()`; if `null` → `<Navigate to="/login">`. Setup page renders only when `auth.me` returns null and no users (from `auth.setup` availability).

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): React SPA shell with tRPC client and auth pages"
```

---

### Task 13: Web catalog pages (locations, item types, items, tags)

**Files:**
- Create: `apps/web/src/features/locations/{LocationsPage,LocationTree}.tsx`
- Create: `apps/web/src/features/itemTypes/ItemTypesPage.tsx`
- Create: `apps/web/src/features/items/{ItemsPage,ItemForm,ItemDetail}.tsx`
- Create: `apps/web/src/features/tags/TagsPage.tsx`
- Create: `apps/web/src/features/upload/PhotoUpload.tsx` (client → `POST /upload/image`)
- Create: `apps/web/src/routes.tsx` (wire pages) — Modify: `apps/web/src/app/routes.tsx`
- Test: `apps/web/test/catalog.test.tsx`

**Interfaces:**
- Consumes: `itemsRouter`, `locationsRouter`, `itemTypesRouter`, `tagsRouter`, and `upload.image` fetch.
- Produces: `routes.tsx` registers `/locations`, `/types`, `/tags`, `/items`, `/items/:id`. `ItemsPage` lists paginated items (thumbnail from `thumb_path`, name, location, type, tags), with a create/edit `ItemForm` (name/description/quantity/unit/type/location + dynamic custom fields + photo upload). `ItemDetail` shows the item with its photos.

- [ ] **Step 1: Write the failing test**

```ts
it('renders the item list and a create form', async () => {
  render(<AppProviders><ItemsPage/></AppProviders>)
  expect(await screen.findByText(/items/i)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /new item/i }))
  expect(screen.getByLabelText('Name')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test, verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement catalog pages**

Use `trpc.items.list.useQuery()`, `trpc.locations.list`, etc. `ItemForm` loads custom fields for the selected type and renders inputs; submits `items.create` with `fieldValues`. `PhotoUpload` posts multipart to `/upload/image` and refreshes. Wire the nav with react-router links. Style with Tailwind (base layout + a responsive grid).

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features apps/web/src/app/routes.tsx apps/web/test/catalog.test.tsx
git commit -m "feat(web): locations, types, tags, and item CRUD pages"
```

---

### Task 14: End-to-end smoke test

**Files:**
- Create: `apps/web/e2e/playwright.config.ts`, `apps/web/e2e/catalog.spec.ts`

**Interfaces:**
- Consumes: the built API + SPA (served by Fastify on `:3000` serving the built `apps/web/dist` and `/trpc`).
- Produces: a Playwright spec proving the happy path.

- [ ] **Step 1: Write the failing test**

`catalog.spec.ts`:
```ts
test('admin catalogs an item end to end', async ({ page }) => {
  await page.goto('/setup')
  await page.fill('input[name="name"]', 'Admin'); await page.fill('input[name="email"]','a@b.c'); await page.fill('input[name="password"]','password123')
  await page.click('button:has-text("Create admin")')
  await page.click('a:has-text("New item")')
  await page.fill('input[name="name"]', 'Lamp')
  await page.click('button:has-text("Save")')
  await expect(page.getByText('Lamp')).toBeVisible()
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @homebox/web test:e2e`
Expected: FAIL (no wiring).

- [ ] **Step 3: Make it pass**

Serve the app (`apps/api` builds `apps/web` and serves static + `/trpc` on one port). Ensure `/setup`, item creation, and the list render work. Fix any integration gaps found.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e apps/api/src/server.ts
git commit -m "test(e2e): admin catalogs an item end to end"
```

---

## Self-Review

- **Spec coverage (Phase-1 scope):** items (T9/13), locations nested (T7/13), item types + custom fields (T8/13), tags (T10/13), auth + admin users (T4/5/6/12), basic photo upload + thumbnail (T11/13), shared catalog/roles (T6–9), DB schema (T2). Out of scope for Phase 1 (deferred): non-destructive editor/filerobot (Phase 2), FTS search + facets (Phase 3), i18n/locale/theme + responsive (Phase 4), max-upload enforcement + backup/restore (Phase 5), unpack/drafts + Docker (Phase 6). The `published` column exists (T2) but draft flow is Phase 6.
- **Placeholder scan:** none; every code step contains concrete test/impl.
- **Type consistency:** `SessionUser`, `publicProcedure`/`protectedProcedure`/`adminProcedure`, `createDb`/`runMigrations`, `loginInput`/`itemInput`, and `fieldValues: { fieldId, value }` are consistent across tasks (defined in T1/T2/T4/T5/T8/T9 respectively).

That satisfies the Phase-1 goal: **a user can sign in and catalogue items with photos.**
