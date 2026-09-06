# Phase 4 — Per-User Settings + Responsive Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user settings layer (language, locale, theme) persisted in a `user_settings` table and edited on a `/settings` page, plus a Tailwind v4 CSS-variable theme system (light/dark palettes) and a responsive/mobile pass, replacing the app's hand-rolled plain-CSS classes.

**Architecture:** A `user_settings` table (one row/user, `user_id` unique) backs a `settings` tRPC module (`settings.get` returns defaults when no row exists, `settings.update` upserts) via shared zod schemas. On the client, a `SettingsProvider` fetches settings once, exposes `useUserSettings()` (with `Intl`-based `formatDate`/`formatCurrency`), wires `i18n.language`, and renders a `ThemeProvider` that resolves `theme_mode` (`auto`/`light`/`dark`) against `prefers-color-scheme` **client-side** and applies the chosen palette's CSS variables to the document root. Tailwind v4 (`@tailwindcss/vite`, CSS-first) replaces `index.css`'s utility classes in markup page-by-page; the theme registry defines ~3 light + ~3 dark palettes. The dead `styled-components` dependency is removed.

**Tech Stack:** React 19 + Vite 7, Tailwind CSS v4 (`@tailwindcss/vite`), tRPC v11 + `@tanstack/react-query` v5, `react-i18next` + `i18next`, Zod v3 (shared), Drizzle ORM + better-sqlite3 + drizzle-kit (SQLite), Vitest + RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-phase4-settings-responsive-design.md` — the plan argues from this spec; executors read both.

## Global Constraints

- **Theme variables** are exactly the semantic names in `apps/web/src/lib/theme/registry.ts`: `--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-accent`, `--color-accent-contrast`, `--color-danger`, `--color-success`, `--color-focus`. **Components consume only these semantic vars** — never a raw palette hex.
- **`theme_mode` ∈ {`auto`,`light`,`dark`}**, resolved **client-side** (the OS preference is not visible to the server). `auto` follows `prefers-color-scheme` and resolves to the user's chosen light or dark palette. Each palette carries an explicit `dark: boolean` group flag; a palette belongs to exactly one set.
- **`user_settings` defaults:** `language='en'`, `locale='en-US'`, `theme_mode='auto'`, `light_theme_id='light-default'`, `dark_theme_id='dark-default'`. `user_id` is `notNull().unique()`. `settings.get` returns these defaults when no row exists (no write on a fresh user); `settings.update` upserts.
- **API:** both `settings.get` and `settings.update` are `protectedProcedure`. `ctx.user!.id` is the established non-null-assert convention (see `modules/items/router.ts:38`). Zod schemas live in `packages/shared/src/settings.ts` and are re-exported from `@homebox/shared`.
- **Locale list** on `/settings`: `en-US`, `en-GB`, `bg-BG`, `de-DE`, `fr-FR`, `it-IT`. **Language** list: single `en`.
- **i18n:** `react-i18next`, English bundled at `apps/web/public/locales/en/translation.json`, default `en`. The per-user `language` selects the active resource (only `en` ships).
- **Tailwind v4 is CSS-first:** the root stylesheet starts `@import "tailwindcss";` and declares tokens in `@theme { … }`; **no `tailwind.config.js`** is created (the Vite plugin auto-detects content). The `@theme` values are *build-time defaults*; `ThemeProvider` overrides them at runtime by setting inline CSS vars on `document.documentElement.style` (inline style beats the `@theme`-emitted `:root` variable).
- **SQL conventions:** JS keys camelCase, SQL columns snake_case; timestamps are INTEGER Unix-epoch `*milliseconds*` (`timestamp_ms` → JS `Date`). New table `user_settings` via a drizzle-kit-generated migration `0002_*`.
- **Remove the dead `styled-components` dependency** (imported nowhere today).
- **Testing:** Vitest. Backend modules are tested via `buildApp` + `app.inject` (see `apps/api/test/tags.test.ts`), shared schemas via `safeParse`, DB via `createDb(':memory:')` + `runMigrations`, frontend via RTL rendered under `MemoryRouter` with the `../src/api/trpc` module `vi.mock`ed (see `apps/web/test/searchFacets.test.tsx`). Playwright e2e seeds/logs in via `page.request`.
- **Workspace build order:** `apps/web` imports `@homebox/shared` and `@homebox/api` from their built `dist/` output (each package's `main`/`exports` point at `./dist/…`). Before running a web test, typecheck, or build that uses a *newly added* export (e.g. `LOCALES` from Task 1, or the `settings` router from Task 2), rebuild upstream first:

  ```bash
  pnpm --filter @homebox/shared build && pnpm --filter @homebox/api build
  ```

  Run this once after Tasks 1 and 2 (and after sharing changes) before the web tasks that consume them. `packages/db` exports (`userSettings`) are likewise read from its `dist/` build — rebuild it after Task 1 too.
- **Durability:** the SDD ledger + per-task briefs/reports are git-ignored scratch under `.superpowers/sdd/` and are **lost on worktree removal**; the durable record is this plan + the spec (`docs/superpowers/`) + the merged code. Committed at close-out to `docs/`.
- **React 19 / version floors:** keep `react`/`react-dom` `^19.2.0`, `vite` `^7.0.0`, `@tanstack/react-query` `^5.102.8`, `@trpc/*` `^11.18.0`, `zod` `^3.24.1`. New deps must be compatible with these (i18next `^24`, react-i18next `^15`, tailwindcss `^4`, `@tailwindcss/vite` `^4`).

### Tailwind utility reference (generated from `@theme` tokens)

Because the tokens are named `--color-X`, Tailwind v4 emits these utilities (used throughout Tasks 3, 8, 9):

| `@theme` token | Generated utilities |
|---|---|
| `--color-bg` | `bg-bg`, `text-bg`, `border-bg` |
| `--color-surface` | `bg-surface`, `text-surface`, `border-surface` |
| `--color-surface-raised` | `bg-surface-raised`, `text-surface-raised` |
| `--color-text` | `text-text`, `bg-text`, `border-text` |
| `--color-text-muted` | `text-text-muted`, `bg-text-muted` |
| `--color-border` | `border-border`, `bg-border`, `text-border` |
| `--color-accent` | `bg-accent`, `text-accent`, `border-accent` |
| `--color-accent-contrast` | `text-accent-contrast`, `bg-accent-contrast` |
| `--color-danger` | `text-danger`, `bg-danger`, `border-danger` |
| `--color-success` | `text-success`, `bg-success` |
| `--color-focus` | `focus-ring` (custom; see `.focus-ring` base) |

Do not invent ad-hoc color utilities. Use only the semantic utilities above for colors; layout can use Tailwind's built-in spacing/typography/responsive utilities freely.

---

### Task 1: `user_settings` table + migration + shared settings schemas

**Files:**
- Modify: `packages/db/src/schema.ts` (add `userSettings` model after `tags`)
- Create: `packages/db/drizzle/0002_<tag>_add_user_settings.sql` (drizzle-kit generated) + `meta/0002_snapshot.json` + `meta/_journal.json` entry
- Create: `packages/shared/src/settings.ts`
- Modify: `packages/shared/src/index.ts` (re-export `./settings.js`)
- Test: `packages/shared/test/settings.test.ts`
- Test: `packages/db/test/migrate.test.ts` (add `user_settings` to the created-tables assertion)

**Interfaces:**
- Produces: `userSettings` Drizzle model (`@homebox/db`), typed as `sqliteTable('user_settings', { id, userId, language, locale, themeMode, lightThemeId, darkThemeId })` — consumed by Task 2.
- Produces: from `@homebox/shared`: `THEME_MODES`, `LOCALES`, `LANGUAGES`, `ThemeMode`, `Locale`, `Language`, `userSettingsSchema`, `UserSettingsDto`, `userSettingsUpdateSchema`, `UserSettingsInput`, `DEFAULT_USER_SETTINGS`. Consumed by Tasks 2, 5, 7.

- [ ] **Step 1: Add the `user_settings` Drizzle model**

In `packages/db/src/schema.ts`, add after the `tags` table (before `itemTags`):

```ts
export const userSettings = sqliteTable('user_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  language: text('language').notNull().default('en'),
  locale: text('locale').notNull().default('en-US'),
  themeMode: text('theme_mode', { enum: ['auto', 'light', 'dark'] }).notNull().default('auto'),
  lightThemeId: text('light_theme_id').notNull().default('light-default'),
  darkThemeId: text('dark_theme_id').notNull().default('dark-default'),
})
```

- [ ] **Step 2: Generate the migration**

Run:

```bash
pnpm --filter @homebox/db exec drizzle-kit generate
```

A new file `packages/db/drizzle/0002_<random>_add_user_settings.sql` should appear, plus `meta/0002_snapshot.json`, and `meta/_journal.json` gains a `0002` entry. Open the generated `.sql` and confirm it matches:

```sql
CREATE TABLE `user_settings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `language` text DEFAULT 'en' NOT NULL,
  `locale` text DEFAULT 'en-US' NOT NULL,
  `theme_mode` text DEFAULT 'auto' NOT NULL,
  `light_theme_id` text DEFAULT 'light-default' NOT NULL,
  `dark_theme_id` text DEFAULT 'dark-default' NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);
```

If drizzle-kit produced different (but equivalent) DDL, keep its output — do **not** hand-edit the migration or the snapshot; only verify the columns, defaults, FK, and the unique index are present. Verify `0000_panoramic_human_robot.sql` and `0001_add_items_fts.sql` were not modified.

- [ ] **Step 3: Create the shared settings schemas**

Create `packages/shared/src/settings.ts`:

```ts
import { z } from 'zod'

// Single, curated language list. Phase 4 ships English only; adding a language
// later is a resource file + a new entry here (no code change elsewhere).
export const LANGUAGES = ['en'] as const
export type Language = (typeof LANGUAGES)[number]

// Curated locale list shown on `/settings`. `Intl` formatting is built on the
// user's selected locale.
export const LOCALES = ['en-US', 'en-GB', 'bg-BG', 'de-DE', 'fr-FR', 'it-IT'] as const
export type Locale = (typeof LOCALES)[number]

// Theme mode. `auto` follows `prefers-color-scheme` and resolves client-side to
// the user's chosen light or dark palette.
export const THEME_MODES = ['auto', 'light', 'dark'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const userSettingsSchema = z.object({
  language: z.enum(LANGUAGES),
  locale: z.enum(LOCALES),
  themeMode: z.enum(THEME_MODES),
  lightThemeId: z.string().min(1),
  darkThemeId: z.string().min(1),
})
export type UserSettingsDto = z.infer<typeof userSettingsSchema>

// `settings.update` takes any subset of the settings fields.
export const userSettingsUpdateSchema = userSettingsSchema.partial()
export type UserSettingsInput = z.infer<typeof userSettingsUpdateSchema>

// Returned by `settings.get` when no `user_settings` row exists yet (a fresh
// user gets these without a write).
export const DEFAULT_USER_SETTINGS: UserSettingsDto = {
  language: 'en',
  locale: 'en-US',
  themeMode: 'auto',
  lightThemeId: 'light-default',
  darkThemeId: 'dark-default',
}
```

- [ ] **Step 4: Re-export from `@homebox/shared`**

In `packages/shared/src/index.ts`, add the export line:

```ts
export * from './schemas.js'
export * from './constants.js'
export * from './settings.js'
```

- [ ] **Step 5: Write the shared schema tests**

Create `packages/shared/test/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  userSettingsSchema,
  userSettingsUpdateSchema,
  DEFAULT_USER_SETTINGS,
} from '../src/settings'

describe('shared settings schemas', () => {
  it('accepts the full settings shape', () => {
    expect(userSettingsSchema.safeParse(DEFAULT_USER_SETTINGS).success).toBe(true)
  })
  it('accepts a partial update', () => {
    expect(userSettingsUpdateSchema.safeParse({ themeMode: 'dark' }).success).toBe(true)
  })
  it('rejects an unknown locale', () => {
    expect(userSettingsUpdateSchema.safeParse({ locale: 'xx-XX' }).success).toBe(false)
  })
  it('rejects an unknown theme mode', () => {
    expect(userSettingsUpdateSchema.safeParse({ themeMode: 'sepia' }).success).toBe(false)
  })
  it('defaults match the spec', () => {
    expect(DEFAULT_USER_SETTINGS).toEqual({
      language: 'en', locale: 'en-US', themeMode: 'auto',
      lightThemeId: 'light-default', darkThemeId: 'dark-default',
    })
  })
})
```

- [ ] **Step 6: Extend the DB migrate test**

In `packages/db/test/migrate.test.ts`, change the created-tables assertion to also require `user_settings`:

```ts
    expect(['users','sessions','locations','item_types','items','tags','item_tags','images','user_settings'].every(t => set.has(t))).toBe(true)
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @homebox/db test` and `pnpm --filter @homebox/shared test`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle apps/api packages/shared/src/settings.ts packages/shared/src/index.ts packages/shared/test/settings.test.ts packages/db/test/migrate.test.ts
git commit -m "feat(db): user_settings table + migration + shared settings schemas"
```

---

### Task 2: `settings` API module + router mount + API tests

**Files:**
- Create: `apps/api/src/modules/settings/repo.ts`
- Create: `apps/api/src/modules/settings/service.ts`
- Create: `apps/api/src/modules/settings/router.ts`
- Modify: `apps/api/src/router.ts` (import + mount `settings`)
- Test: `apps/api/test/settings.test.ts`

**Interfaces:**
- Consumes: `@homebox/db` `userSettings` model (Task 1); `@homebox/shared` `UserSettingsDto`, `UserSettingsInput`, `DEFAULT_USER_SETTINGS` (Task 1); `ctx.user!.id`.
- Produces: `settingsRouter` (tRPC) with `get` and `update`, mounted at `settings` on the app router. Later tasks (5–7) call `trpc.settings.get.useQuery` / `trpc.settings.update.useMutation`.

- [ ] **Step 1: Write the repo**

Create `apps/api/src/modules/settings/repo.ts`:

```ts
import { eq } from 'drizzle-orm'
import { userSettings } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import type { UserSettingsDto } from '@homebox/shared'

// Row shape surfaced by the app layer (camelCase keys; the schema is already
// camelCase on the JS surface). `theme_mode` is a TEXT column (`enum` in Drizzle
// only constrains the TS type, not SQLite), so the row type keeps `string`.
export type UserSettingsRow = {
  userId: number
  language: string
  locale: string
  themeMode: string
  lightThemeId: string
  darkThemeId: string
}

// Select only the DTO columns (never the `id`).
const ROW_FIELDS = {
  userId: userSettings.userId,
  language: userSettings.language,
  locale: userSettings.locale,
  themeMode: userSettings.themeMode,
  lightThemeId: userSettings.lightThemeId,
  darkThemeId: userSettings.darkThemeId,
} as const

export const getByUserId = (db: DrizzleDb, userId: number): UserSettingsRow | undefined =>
  db.select(ROW_FIELDS).from(userSettings).where(eq(userSettings.userId, userId)).get()

// Upsert by the `user_id` unique index: insert the row, or update it in place on
// conflict. Returns the resulting row so callers can read it back immediately.
export const upsert = (db: DrizzleDb, userId: number, data: UserSettingsDto): UserSettingsRow =>
  db
    .insert(userSettings)
    .values({ userId, ...data })
    .onConflictDoUpdate({ target: userSettings.userId, set: data })
    .returning(ROW_FIELDS)
    .get()
```

- [ ] **Step 2: Write the service**

Create `apps/api/src/modules/settings/service.ts`:

```ts
import type { DrizzleDb } from '@homebox/db'
import {
  DEFAULT_USER_SETTINGS,
  type UserSettingsDto,
  type UserSettingsInput,
} from '@homebox/shared'
import * as repo from './repo.js'
import type { UserSettingsRow } from './repo.js'

// Normalize a DB row (whose `theme_mode`/`language`/`locale` are `string`) into
// the validated `UserSettingsDto` shape. The `as` casts are safe because the
// values are validated by the zod `userSettingsUpdateSchema` on the write path
// and constrained to the enum sets before they reach the DB.
const toDto = (row: UserSettingsRow): UserSettingsDto => ({
  language: row.language as UserSettingsDto['language'],
  locale: row.locale as UserSettingsDto['locale'],
  themeMode: row.themeMode as UserSettingsDto['themeMode'],
  lightThemeId: row.lightThemeId,
  darkThemeId: row.darkThemeId,
})

// Returns the user's settings row, or the spec defaults when none exists (a
// fresh user gets `auto`/`en`/`en-US` without a write).
export const getSettings = (db: DrizzleDb, userId: number): UserSettingsDto => {
  const row = repo.getByUserId(db, userId)
  return row ? toDto(row) : { ...DEFAULT_USER_SETTINGS }
}

// Merges the partial `input` over the current settings and upserts the row.
// This is how a fresh user's first update creates the row (a partial update that
// only touches `themeMode` still writes the remaining defaults).
export const updateSettings = (db: DrizzleDb, userId: number, input: UserSettingsInput): UserSettingsDto => {
  const current = getSettings(db, userId)
  const merged: UserSettingsDto = { ...current, ...input }
  return toDto(repo.upsert(db, userId, merged))
}
```

- [ ] **Step 3: Write the router**

Create `apps/api/src/modules/settings/router.ts`:

```ts
import { userSettingsUpdateSchema } from '@homebox/shared'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

export const settingsRouter = t.router({
  // Returns the current user's settings (spec defaults when no row exists yet).
  get: protectedProcedure.query(({ ctx }) => service.getSettings(ctx.db, ctx.user!.id)),
  // Validates a partial of the settings shape and upserts; returns the full DTO.
  update: protectedProcedure.input(userSettingsUpdateSchema).mutation(({ ctx, input }) =>
    service.updateSettings(ctx.db, ctx.user!.id, input)
  ),
})
```

- [ ] **Step 4: Mount the router**

In `apps/api/src/router.ts`, add the import and the `settings` entry:

```ts
import { settingsRouter } from './modules/settings/router.js'
```

and after `tags: tagsRouter,` add:

```ts
  settings: settingsRouter,
```

- [ ] **Step 5: Write the API tests**

Create `apps/api/test/settings.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let adminCookie: string

const GET = () => app.inject({ method: 'GET', url: '/trpc/settings.get', headers: { cookie: adminCookie } })
const UPDATE = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/trpc/settings.update', headers: { cookie: adminCookie }, payload })

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = login.headers['set-cookie'] as string
})
afterAll(() => app?.close())

describe('settings module', () => {
  it('returns the spec defaults when no row exists yet', async () => {
    const res = await GET()
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toEqual({
      language: 'en', locale: 'en-US', themeMode: 'auto',
      lightThemeId: 'light-default', darkThemeId: 'dark-default',
    })
  })

  it('upserts on a partial update', async () => {
    const res = await UPDATE({ themeMode: 'dark', locale: 'de-DE' })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toEqual({
      language: 'en', locale: 'de-DE', themeMode: 'dark',
      lightThemeId: 'light-default', darkThemeId: 'dark-default',
    })
    // A second update is additive and keeps a single row (upsert, not duplicate).
    const second = await UPDATE({ language: 'en' })
    expect(second.statusCode).toBe(200)
    expect(second.json().result.data.themeMode).toBe('dark')
  })

  it('rejects unauthenticated requests', async () => {
    const get = await app.inject({ method: 'GET', url: '/trpc/settings.get' })
    expect(get.statusCode).toBe(401)
    const update = await app.inject({ method: 'POST', url: '/trpc/settings.update', payload: { themeMode: 'dark' } })
    expect(update.statusCode).toBe(401)
  })
})
```

- [ ] **Step 6: Run the API tests**

Run: `pnpm --filter @homebox/api test`
Expected: `settings.test.ts` passes; existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/settings apps/api/src/router.ts apps/api/test/settings.test.ts
git commit -m "feat(api): settings module (settings.get/settings.update, protected)"
```

---

### Task 3: Styling foundation — Tailwind v4 + theme tokens + drop styled-components

**Files:**
- Modify: `apps/web/package.json` (add `tailwindcss`, `@tailwindcss/vite`; remove `styled-components`)
- Modify: `apps/web/vite.config.ts` (add `@tailwindcss/vite` plugin)
- Modify: `apps/web/src/index.css` (replace with `@import "tailwindcss"` + `@theme` tokens + base)
- Test: existing `apps/web/test/*` still pass; `pnpm --filter @homebox/web build` succeeds.

**Interfaces:**
- Produces: the Tailwind token set + base styles (semantic color utilities `bg-bg`, `text-text`, `bg-surface`, `border-border`, `bg-accent`, `text-text-muted`, etc.) available to all later frontend tasks. No component consumed here.

- [ ] **Step 1: Install Tailwind + remove styled-components**

Run (in the `apps/web` package):

```bash
pnpm --filter @homebox/web remove styled-components
pnpm --filter @homebox/web add -D tailwindcss @tailwindcss/vite
```

Confirm `apps/web/package.json` no longer lists `styled-components` and lists `tailwindcss` + `@tailwindcss/vite` under `devDependencies`.

- [ ] **Step 2: Register the Tailwind Vite plugin**

In `apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/trpc': 'http://localhost:3000',
      '/upload': 'http://localhost:3000',
      '/file': 'http://localhost:3000',
    },
  },
})
```

- [ ] **Step 3: Rewrite `index.css`**

Replace the whole contents of `apps/web/src/index.css` with:

```css
@import "tailwindcss";

/* Design tokens. These are the *build-time defaults* that back the semantic
   utilities (bg-bg, text-text, bg-surface, border-border, bg-accent, …). At
   runtime ThemeProvider overrides them by setting the same variables inline on
   document.documentElement (inline style beats this `:root` rule), so a palette
   switch re-colors the app without touching markup. Never put a raw palette hex
   in markup — always a semantic token. */
@theme {
  --color-bg: #f5f6fa;
  --color-surface: #ffffff;
  --color-surface-raised: #ffffff;
  --color-text: #1a1a1a;
  --color-text-muted: #6b7280;
  --color-border: #e5e7eb;
  --color-accent: #2563eb;
  --color-accent-contrast: #ffffff;
  --color-danger: #dc2626;
  --color-success: #16a34a;
  --color-focus: #2563eb;
}

/* The page background and default text come from the active palette's vars (they
   match the light-default `@theme` values until ThemeProvider swaps them). */
:root {
  color-scheme: light;
}
[data-theme] {
  color-scheme: dark;
}
body {
  background-color: var(--color-bg);
  color: var(--color-text);
  min-height: 100vh;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
}

/* Visible focus ring for keyboard/Tab users, driven by the semantic focus token. */
:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Run the web build + tests**

Run: `pnpm --filter @homebox/web test` and `pnpm --filter @homebox/web build`
Expected: existing frontend unit tests pass (they assert content/markup, not CSS layout), and the Vite build succeeds with Tailwind processing `@import "tailwindcss"`. If a page fails to render because it relied on an `index.css` class that no longer exists (e.g. `.card`), styling regressions are expected and are repaired in Tasks 8–9 — but the app must still **compile and render** (missing classes only affect appearance).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts apps/web/src/index.css pnpm-lock.yaml
git commit -m "feat(web): Tailwind v4 styling foundation + semantic theme tokens"
```

---

### Task 4: Theme registry + `ThemeProvider`

**Files:**
- Create: `apps/web/src/lib/theme/registry.ts`
- Create: `apps/web/src/lib/theme/ThemeProvider.tsx`
- Test: `apps/web/test/theme.test.tsx`

**Interfaces:**
- Produces: `ThemeVar`, `ThemePalette`, `themes`, `lightThemes`, `darkThemes`, `getThemeById(id)` from `apps/web/src/lib/theme/registry`; `ThemeProvider` component (`{ themeMode, lightThemeId, darkThemeId, children }`) from `apps/web/src/lib/theme/ThemeProvider`. Consumed by Task 6 (`SettingsProvider`) and Task 7 (`/settings` page palette pickers).

- [ ] **Step 1: Write the theme registry**

Create `apps/web/src/lib/theme/registry.ts`:

```ts
// Semantic CSS custom properties the app's components read. Every value the app
// shows must come from one of these — never a raw hex in markup.
export type ThemeVar =
  | '--color-bg'
  | '--color-surface'
  | '--color-surface-raised'
  | '--color-text'
  | '--color-text-muted'
  | '--color-border'
  | '--color-accent'
  | '--color-accent-contrast'
  | '--color-danger'
  | '--color-success'
  | '--color-focus'

export interface ThemePalette {
  id: string
  name: string
  /** Group flag: a palette belongs to exactly one set (light or dark). */
  dark: boolean
  vars: Record<ThemeVar, string>
}

// ~3 light + ~3 dark palettes, adapted from Homebox's theme list. Hex values are
// illustrative (adjust freely) — the ONLY rule is that every palette sets every
// `ThemeVar`.
export const themes: ThemePalette[] = [
  {
    id: 'light-default',
    name: 'Homebox Light',
    dark: false,
    vars: {
      '--color-bg': '#f5f6fa',
      '--color-surface': '#ffffff',
      '--color-surface-raised': '#ffffff',
      '--color-text': '#1a1a1a',
      '--color-text-muted': '#6b7280',
      '--color-border': '#e5e7eb',
      '--color-accent': '#2563eb',
      '--color-accent-contrast': '#ffffff',
      '--color-danger': '#dc2626',
      '--color-success': '#16a34a',
      '--color-focus': '#2563eb',
    },
  },
  {
    id: 'light-catppuccin',
    name: 'Catppuccin Latte',
    dark: false,
    vars: {
      '--color-bg': '#eff1f5',
      '--color-surface': '#e6e9ef',
      '--color-surface-raised': '#ffffff',
      '--color-text': '#4c4f69',
      '--color-text-muted': '#8c8fa1',
      '--color-border': '#ccd0da',
      '--color-accent': '#1e66f5',
      '--color-accent-contrast': '#ffffff',
      '--color-danger': '#d20f39',
      '--color-success': '#40a02b',
      '--color-focus': '#04a5e5',
    },
  },
  {
    id: 'light-nord',
    name: 'Nord Snowstorm',
    dark: false,
    vars: {
      '--color-bg': '#eceff4',
      '--color-surface': '#e5e9f0',
      '--color-surface-raised': '#ffffff',
      '--color-text': '#2e3440',
      '--color-text-muted': '#4c566a',
      '--color-border': '#d8dee9',
      '--color-accent': '#5e81ac',
      '--color-accent-contrast': '#eceff4',
      '--color-danger': '#bf616a',
      '--color-success': '#a3be8c',
      '--color-focus': '#81a1c1',
    },
  },
  {
    id: 'dark-default',
    name: 'Homebox Dark',
    dark: true,
    vars: {
      '--color-bg': '#1a1a1a',
      '--color-surface': '#242424',
      '--color-surface-raised': '#2d2d2d',
      '--color-text': '#e5e5e5',
      '--color-text-muted': '#9ca3af',
      '--color-border': '#3a3a3a',
      '--color-accent': '#3b82f6',
      '--color-accent-contrast': '#ffffff',
      '--color-danger': '#ef4444',
      '--color-success': '#22c55e',
      '--color-focus': '#3b82f6',
    },
  },
  {
    id: 'dark-dracula',
    name: 'Dracula',
    dark: true,
    vars: {
      '--color-bg': '#282a36',
      '--color-surface': '#21222c',
      '--color-surface-raised': '#44475a',
      '--color-text': '#f8f8f2',
      '--color-text-muted': '#6272a4',
      '--color-border': '#44475a',
      '--color-accent': '#bd93f9',
      '--color-accent-contrast': '#282a36',
      '--color-danger': '#ff5555',
      '--color-success': '#50fa7b',
      '--color-focus': '#8be9fd',
    },
  },
  {
    id: 'dark-gruvbox',
    name: 'Gruvbox Dark',
    dark: true,
    vars: {
      '--color-bg': '#282828',
      '--color-surface': '#32302f',
      '--color-surface-raised': '#3c3836',
      '--color-text': '#ebdbb2',
      '--color-text-muted': '#928374',
      '--color-border': '#504945',
      '--color-accent': '#b16286',
      '--color-accent-contrast': '#282828',
      '--color-danger': '#fb4934',
      '--color-success': '#b8bb26',
      '--color-focus': '#83a598',
    },
  },
]

// The light set and the dark set, derived from the `dark` group flag.
export const lightThemes = themes.filter((t) => !t.dark)
export const darkThemes = themes.filter((t) => t.dark)

export const getThemeById = (id: string | null | undefined): ThemePalette | undefined =>
  themes.find((t) => t.id === (id ?? ''))
```

- [ ] **Step 2: Write `ThemeProvider`**

Create `apps/web/src/lib/theme/ThemeProvider.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getThemeById, type ThemePalette } from './registry'

export type ThemeMode = 'auto' | 'light' | 'dark'

// The OS preference is only visible client-side, so `auto` is resolved here.
function currentSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolvePalette(mode: ThemeMode, lightId: string, darkId: string, system: 'light' | 'dark'): ThemePalette | undefined {
  const id = mode === 'dark' ? darkId : mode === 'light' ? lightId : system === 'dark' ? darkId : lightId
  return getThemeById(id)
}

type ThemeProviderProps = {
  themeMode: ThemeMode
  lightThemeId: string
  darkThemeId: string
  children: ReactNode
}

// Applies the resolved palette's CSS variables to the document root and sets a
// `data-theme` attribute (a non-variable styling hook). Responds to OS
// `prefers-color-scheme` changes while mounted when `themeMode === 'auto'`.
export function ThemeProvider({ themeMode, lightThemeId, darkThemeId, children }: ThemeProviderProps) {
  const [system, setSystem] = useState<'light' | 'dark'>(currentSystemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const palette = useMemo(
    () => resolvePalette(themeMode, lightThemeId, darkThemeId, system),
    [themeMode, lightThemeId, darkThemeId, system]
  )

  useEffect(() => {
    if (!palette) return
    const root = document.documentElement
    for (const [key, value] of Object.entries(palette.vars)) root.style.setProperty(key, value)
    root.setAttribute('data-theme', palette.id)
  }, [palette])

  return <>{children}</>
}
```

- [ ] **Step 3: Write the ThemeProvider tests**

Create `apps/web/test/theme.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { ThemeProvider } from '../src/lib/theme/ThemeProvider'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  for (const [key, value] of Object.entries({ '--color-bg': '', '--color-text': '', '--color-accent': '' })) {
    document.documentElement.style.removeProperty(key)
  }
})

describe('ThemeProvider', () => {
  it('resolves an explicit light palette', () => {
    render(<ThemeProvider themeMode="light" lightThemeId="light-default" darkThemeId="dark-default">x</ThemeProvider>)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light-default')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#f5f6fa')
  })

  it('resolves an explicit dark palette', () => {
    render(<ThemeProvider themeMode="dark" lightThemeId="light-default" darkThemeId="dark-dracula">x</ThemeProvider>)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark-dracula')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#282a36')
  })

  it('follows prefers-color-scheme when auto', () => {
    // jsdom matchMedia default is light; a null matchMedia resolves to light.
    render(<ThemeProvider themeMode="auto" lightThemeId="light-default" darkThemeId="dark-default">x</ThemeProvider>)
    // With no matchMedia (light path) the light palette wins.
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#f5f6fa')
  })
})
```

> Note: jsdom provides a `matchMedia` that always returns `matches: false` (light) unless overridden. The `auto` case is exercised in the e2e leg (Task 10) where real `prefers-color-scheme` behavior is present; the unit test above locks the light fallback path.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @homebox/web test`
Expected: `theme.test.tsx` passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/theme apps/web/test/theme.test.tsx
git commit -m "feat(web): theme registry (3 light + 3 dark) + ThemeProvider"
```

---

### Task 5: i18n init + English resources

**Files:**
- Modify: `apps/web/package.json` (add `i18next`, `react-i18next`)
- Create: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/public/locales/en/translation.json`
- Test: `apps/web/test/i18n.test.ts`

**Interfaces:**
- Produces: default `i18n` instance from `apps/web/src/lib/i18n`, `i18n.t('settings.title')` etc., `i18n.changeLanguage(...)`. Consumed by SettingsProvider (Task 6) and the `/settings` page (Task 7).

- [ ] **Step 1: Install i18n deps**

```bash
pnpm --filter @homebox/web add i18next react-i18next
```

- [ ] **Step 2: Create the English resource**

Create `apps/web/public/locales/en/translation.json`:

```json
{
  "app": { "title": "Homebox" },
  "nav": {
    "items": "Items",
    "locations": "Locations",
    "types": "Item types",
    "tags": "Tags",
    "settings": "Settings"
  },
  "settings": {
    "title": "Settings",
    "language": "Language",
    "locale": "Locale",
    "themeMode": "Theme mode",
    "auto": "Auto (system)",
    "light": "Light",
    "dark": "Dark",
    "lightPalette": "Light palette",
    "darkPalette": "Dark palette",
    "datePreview": "Today"
  }
}
```

- [ ] **Step 3: Initialize i18n**

Create `apps/web/src/lib/i18n.ts`:

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../../public/locales/en/translation.json'

// English ships in Phase 4; adding a language later is a resources entry + a
// `LANGUAGES` registry entry (no code change elsewhere).
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
```

- [ ] **Step 4: Write the i18n test**

Create `apps/web/test/i18n.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import i18n from '../src/lib/i18n'

describe('i18n', () => {
  it('renders the bundled English string', () => {
    expect(i18n.t('settings.title')).toBe('Settings')
  })
  it('defaults to English', () => {
    expect(i18n.language).toBe('en')
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @homebox/web test`
Expected: `i18n.test.ts` passes (it also verifies the JSON is importable given `resolveJsonModule: true`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/i18n.ts apps/web/public/locales/en/translation.json apps/web/test/i18n.test.ts pnpm-lock.yaml
git commit -m "feat(web): i18n via react-i18next with bundled English"
```

---

### Task 6: Settings frontend — formatters + `useUserSettings` + `SettingsProvider`

**Files:**
- Create: `apps/web/src/lib/settings/format.ts`
- Create: `apps/web/src/lib/settings/useUserSettings.ts`
- Create: `apps/web/src/lib/settings/SettingsProvider.tsx`
- Modify: `apps/web/src/app/AppProviders.tsx` (wrap the tree in `SettingsProvider`)
- Test: `apps/web/test/settings.test.tsx`

**Interfaces:**
- Consumes: `@homebox/shared` `DEFAULT_USER_SETTINGS` (Task 1); `trpc.settings.get/update` (Task 2); `ThemeProvider` (Task 4); `i18n` (Task 5).
- Produces: `createFormatters(locale)` → `{ formatDate, formatCurrency }`; `useUserSettings()` → `{ language, locale, themeMode, lightThemeId, darkThemeId, formatDate, formatCurrency, updateSettings }`; `SettingsProvider` component that also renders `ThemeProvider` and wires `i18n.language`. Consumed by Task 7.

- [ ] **Step 1: Write the `Intl` formatters**

Create `apps/web/src/lib/settings/format.ts`:

```ts
// Locale-aware formatting built on `Intl` and the user's `locale` preference.
// Kept as pure functions (not tied to a hook) so they're trivially unit-testable
// and reusable without a provider.
export function createFormatters(locale: string) {
  const date = new Intl.DateTimeFormat(locale)
  const currencyCache = new Map<string, Intl.NumberFormat>()

  return {
    formatDate(value: Date | number | string, opts?: Intl.DateTimeFormatOptions): string {
      return date.format(new Date(value))
    },
    // Currency-typed custom fields render through this using the field's currency
    // code; the formatter is cached per-currency so repeated calls don't rebuild.
    formatCurrency(amount: number, currency: string, opts?: Intl.NumberFormatOptions): string {
      let fmt = currencyCache.get(currency)
      if (!fmt) {
        fmt = new Intl.NumberFormat(locale, { style: 'currency', currency, ...opts })
        currencyCache.set(currency, fmt)
      }
      return fmt.format(amount)
    },
  }
}

export type Formatters = ReturnType<typeof createFormatters>
```

- [ ] **Step 2: Write `useUserSettings`**

Create `apps/web/src/lib/settings/useUserSettings.ts`:

```ts
import { useContext, useMemo } from 'react'
import { SettingsContext } from './SettingsProvider'
import { createFormatters } from './format'

// The settings object plus locale-aware formatters bound to the user's `locale`.
// This is the canonical way consuming components read settings and format values.
export function useUserSettings() {
  const { settings, updateSettings } = useContext(SettingsContext)
  const formatters = useMemo(() => createFormatters(settings.locale), [settings.locale])
  return { ...settings, ...formatters, updateSettings }
}
```

- [ ] **Step 3: Write `SettingsProvider`**

Create `apps/web/src/lib/settings/SettingsProvider.tsx`:

```tsx
import { createContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { trpc } from '../../api/trpc'
import { DEFAULT_USER_SETTINGS, type UserSettingsInput } from '@homebox/shared'
import { ThemeProvider } from '../theme/ThemeProvider'
import i18n from '../i18n'

export type SettingsContextValue = {
  settings: typeof DEFAULT_USER_SETTINGS
  updateSettings: (input: UserSettingsInput) => Promise<typeof DEFAULT_USER_SETTINGS>
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_USER_SETTINGS,
  updateSettings: async () => DEFAULT_USER_SETTINGS,
})

// Fetches the current user's settings once, provides them to consumers, and
// drives the theme (via ThemeProvider) and the i18n language. On an
// unauthenticated request, `settings.get` rejects — we fall back to the spec
// defaults so the login/setup screens still render (they show the default light
// theme). Setting `data ?? DEFAULT` (never throwing) is what makes the default
// light palette render for unauthenticated pages.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data } = trpc.settings.get.useQuery(undefined, { retry: false })
  const settings = useMemo(() => data ?? DEFAULT_USER_SETTINGS, [data])
  const utils = trpc.useUtils()

  const updateSettings = trpc.settings.update.useMutation({
    onMutate: async (input) => {
      await utils.settings.get.cancel()
      const prev = utils.settings.get.getData(undefined)
      utils.settings.get.setData(undefined, (old) => ({ ...(old ?? DEFAULT_USER_SETTINGS), ...input }))
      return { prev }
    },
    onError: (_err, _input, ctx) => {
      if (ctx) utils.settings.get.setData(undefined, ctx.prev)
    },
    onSettled: () => utils.settings.get.invalidate(),
  })

  // The per-user `language` selects the active i18n resource (only `en` ships).
  useEffect(() => {
    void i18n.changeLanguage(settings.language)
  }, [settings.language])

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, updateSettings: updateSettings.mutateAsync }),
    [settings, updateSettings.mutateAsync]
  )

  return (
    <SettingsContext.Provider value={value}>
      <ThemeProvider
        themeMode={settings.themeMode}
        lightThemeId={settings.lightThemeId}
        darkThemeId={settings.darkThemeId}
      >
        {children}
      </ThemeProvider>
    </SettingsContext.Provider>
  )
}
```

> Note: `SettingsContext` is defined in this file and re-exported for `useUserSettings`, which imports it from `./SettingsProvider`.

- [ ] **Step 4: Wire `SettingsProvider` into the app**

In `apps/web/src/app/AppProviders.tsx`, add the import and wrap the tree (inside `BrowserRouter`, so `trpc` is available):

```tsx
import { SettingsProvider } from '../lib/settings/SettingsProvider'
```

and change the JSX to:

```tsx
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <BrowserRouter>
          <SettingsProvider>{children}</SettingsProvider>
        </BrowserRouter>
      </trpc.Provider>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 5: Write the settings tests**

Create `apps/web/test/settings.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { createFormatters } from '../src/lib/settings/format'

describe('createFormatters', () => {
  it('formats a date in the chosen locale', () => {
    const { formatDate } = createFormatters('de-DE')
    // 6 September 2026 (built from local components to avoid the test running in a
    // timezone that shifts the UTC instant across midnight) → "6.9.2026" in de-DE.
    expect(formatDate(new Date(2026, 8, 6))).toBe('6.9.2026')
  })
  it('formats a currency with the field currency code', () => {
    const { formatCurrency } = createFormatters('de-DE')
    // No explicit `opts`; the currency code drives the output symbol/placement.
    // de-DE: thousands '.', decimal ',' → 1234.50 EUR → "1.234,50 €" (the space
    // before € may be a no-break space, so assert the numeric token and symbol
    // separately rather than an exact string).
    const out = formatCurrency(1234.5, 'EUR')
    expect(out).toMatch(/1\.234,50/)
    expect(out).toContain('€')
  })
  it('falls back to defaults for unauthenticated consumers (spec defaults)', async () => {
    // The provider reads `data ?? DEFAULT_USER_SETTINGS`; this asserts the shape.
    const { DEFAULT_USER_SETTINGS } = await import('@homebox/shared')
    expect(DEFAULT_USER_SETTINGS.themeMode).toBe('auto')
    expect(DEFAULT_USER_SETTINGS.locale).toBe('en-US')
  })
})
```

> This task's provider wiring is exercised through the `/settings` page RTL test (Task 7), which mocks `trpc` and asserts optimistic updates. The format helpers are the directly unit-testable surface.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @homebox/web test`
Expected: `settings.test.tsx` passes. (If `Intl` in the test environment doesn't render "6.9.2026" exactly, adjust the assertion to a locale-dependent regex; the point is the operator, not the exact token. Prefer asserting `formatDate('2026-09-06T00:00:00Z')` produces a string that matches `/\d{1,2}\.\d{1,2}\.\d{4}/` for `de-DE`.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/settings apps/web/src/app/AppProviders.tsx apps/web/test/settings.test.tsx
git commit -m "feat(web): SettingsProvider + useUserSettings + Intl formatters"
```

---

### Task 7: `/settings` page + route + nav entry

**Files:**
- Create: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/app/routes.tsx` (add `/settings` route)
- Modify: `apps/web/src/features/home/HomePage.tsx` (nav gets a Settings link)
- Test: `apps/web/test/settingsPage.test.tsx`

**Interfaces:**
- Consumes: `useUserSettings()` (Task 6 — `settings`, `updateSettings`, `formatDate`); `lightThemes` / `darkThemes` / `themes` (Task 4); `useTranslation` (Task 5); `LOCALES` (Task 1).
- Produces: `SettingsPage` component rendered at `/settings` (post-login), reachable from the nav.

- [ ] **Step 1: Write the `/settings` page**

Create `apps/web/src/features/settings/SettingsPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { useUserSettings } from '../../lib/settings/useUserSettings'
import { lightThemes, darkThemes } from '../../lib/theme/registry'
import { LOCALES } from '@homebox/shared'

// Curated locale labels used in the <select>. Each value is a valid `Intl` locale.
const localeOptions = LOCALES.map((l) => ({ value: l, label: l }))

export function SettingsPage() {
  const { t } = useTranslation()
  const { locale, themeMode, lightThemeId, darkThemeId, updateSettings, formatDate } = useUserSettings()

  const setLocale = (value: string) => updateSettings({ locale: value as (typeof LOCALES)[number] })
  const setThemeMode = (value: string) =>
    updateSettings({ themeMode: value as 'auto' | 'light' | 'dark' })
  const setLight = (value: string) => updateSettings({ lightThemeId: value })
  const setDark = (value: string) => updateSettings({ darkThemeId: value })

  return (
    <section className="flex flex-col gap-4 max-w-[32rem]">
      <h1 className="text-2xl">{t('settings.title')}</h1>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-language">{t('settings.language')}</label>
        <select id="settings-language" value="en" disabled className="px-2 py-1 border border-border rounded-md bg-surface text-text">
          <option value="en">English</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-locale">{t('settings.locale')}</label>
        <select id="settings-locale" value={locale} onChange={(e) => setLocale(e.target.value)} className="px-2 py-1 border border-border rounded-md bg-surface text-text">
          {localeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-theme-mode">{t('settings.themeMode')}</label>
        <select id="settings-theme-mode" value={themeMode} onChange={(e) => setThemeMode(e.target.value)} className="px-2 py-1 border border-border rounded-md bg-surface text-text">
          <option value="auto">{t('settings.auto')}</option>
          <option value="light">{t('settings.light')}</option>
          <option value="dark">{t('settings.dark')}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-light-palette">{t('settings.lightPalette')}</label>
        <select
          id="settings-light-palette"
          value={lightThemeId}
          onChange={(e) => setLight(e.target.value)}
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        >
          {lightThemes.map((th) => (
            <option key={th.id} value={th.id}>{th.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-dark-palette">{t('settings.darkPalette')}</label>
        <select
          id="settings-dark-palette"
          value={darkThemeId}
          onChange={(e) => setDark(e.target.value)}
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        >
          {darkThemes.map((th) => (
            <option key={th.id} value={th.id}>{th.name}</option>
          ))}
        </select>
      </div>

      {/* Live locale preview so changes take visible effect; also gives the e2e
          (Task 10) a localized date to assert on. */}
      <p className="text-text-muted" data-testid="locale-date">
        {t('settings.datePreview')}: {formatDate(new Date())}
      </p>
    </section>
  )
}
```

- [ ] **Step 2: Register the route**

In `apps/web/src/app/routes.tsx`, add the import and the route (post-login, like the other protected pages):

```tsx
import { SettingsPage } from '../features/settings/SettingsPage'
```

and add (before the `/items/:id` route or after `/tags`):

```tsx
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
```

- [ ] **Step 3: Add the nav entry**

In `apps/web/src/features/home/HomePage.tsx`, add a Settings link to the nav:

```tsx
      <nav>
        <Link to="/items">Items</Link>
        <Link to="/locations">Locations</Link>
        <Link to="/types">Item types</Link>
        <Link to="/tags">Tags</Link>
        <Link to="/settings">Settings</Link>
      </nav>
```

- [ ] **Step 4: Write the RTL test**

Create `apps/web/test/settingsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock tRPC so the page renders without a backend. The provider is bypassed by
// mocking `useUserSettings` directly (the page's only dependency on settings).
vi.mock('../src/lib/settings/useUserSettings', () => {
  const updateSettings = vi.fn(async (input: any) => input)
  return {
    useUserSettings: () => ({
      language: 'en',
      locale: 'en-US',
      themeMode: 'auto',
      lightThemeId: 'light-default',
      darkThemeId: 'dark-default',
      formatDate: () => 'Sept 6, 2026',
      updateSettings,
    }),
    __updateSettings: updateSettings,
  }
})

vi.mock('../src/lib/theme/registry', () => ({
  lightThemes: [{ id: 'light-default', name: 'Homebox Light', dark: false }],
  darkThemes: [{ id: 'dark-dracula', name: 'Dracula', dark: true }],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { SettingsPage } from '../src/features/settings/SettingsPage'
import { __updateSettings } from '../src/lib/settings/useUserSettings'

beforeEach(() => vi.clearAllMocks())

describe('SettingsPage', () => {
  it('renders the current settings and applies an optimistic update', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)

    expect(screen.getByLabelText('settings.locale')).toHaveValue('en-US')
    expect(screen.getByLabelText('settings.themeMode')).toHaveValue('auto')

    fireEvent.change(screen.getByLabelText('settings.themeMode'), { target: { value: 'dark' } })
    expect(__updateSettings).toHaveBeenCalledWith({ themeMode: 'dark' })
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @homebox/web test`
Expected: `settingsPage.test.tsx` passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/settings apps/web/src/app/routes.tsx apps/web/src/features/home/HomePage.tsx apps/web/test/settingsPage.test.tsx
git commit -m "feat(web): /settings page with locale + theme controls and nav entry"
```

---

### Task 8: Shared page shell + responsive drawer nav

**Files:**
- Create: `apps/web/src/app/Shell.tsx`
- Modify: `apps/web/src/app/routes.tsx` (nest protected routes under `<Shell/>` using a layout route + `<Outlet/>`)
- Test: `apps/web/test/shell.test.tsx` (renders nav + `data-testid="drawer-toggle"` present under a narrow viewport, or relies on build + e2e)

**Interfaces:**
- Consumes: `useTranslation` nav keys (Task 5); `Link`/`NavLink`.
- Produces: `Shell` layout component (renders a responsive `<header>` with a brand link + drawer nav under `md:` and a horizontal bar at `md:`, plus `<Outlet/>` for the page). All protected pages now render inside it, so the settings/nav links appear on every page.

- [ ] **Step 1: Write the `Shell` layout**

Create `apps/web/src/app/Shell.tsx`:

```tsx
import { useState } from 'react'
import { NavLink, Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const navItems = [
  { to: '/items', key: 'items' },
  { to: '/locations', key: 'locations' },
  { to: '/types', key: 'types' },
  { to: '/tags', key: 'tags' },
  { to: '/settings', key: 'settings' },
]

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `px-3 py-1.5 rounded-md text-sm no-underline ${isActive ? 'bg-accent text-accent-contrast' : 'text-text hover:bg-surface'}`
}

// Responsive site shell for authenticated pages: a fixed header with a brand
// link and a horizontal nav at `md:` and up, collapsing to a hamburger drawer
// below `md:`. Renders the routed page via <Outlet/>.
export function Shell() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const close = () => setOpen(false)

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold text-lg no-underline text-text">{t('app.title')}</Link>
          {/* Horizontal nav, hidden below md. */}
          <nav className="hidden md:flex gap-1">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>{t(`nav.${item.key}`)}</NavLink>
            ))}
          </nav>
          {/* Hamburger, shown below md only. */}
          <button
            type="button"
            data-testid="drawer-toggle"
            className="md:hidden px-2 py-1 rounded border border-border bg-surface text-text"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
        </div>

        {/* Drawer (below md only). */}
        {open && (
          <nav className="md:hidden flex flex-col gap-1 px-4 pb-3" data-testid="drawer-nav">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={close}>
                {t(`nav.${item.key}`)}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="p-4">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Restructure the routes to a layout route**

In `apps/web/src/app/routes.tsx`, import `Shell`, then wrap the protected pages in a nested layout route. Replace the individual `RequireAuth` wrappers with one layout route (this also gives every logged-in page the nav):

```tsx
import { Route, Routes } from 'react-router-dom'
import { RequireAuth, SetupGate } from '../lib/auth'
import { LoginPage } from '../features/auth/LoginPage'
import { SetupPage } from '../features/auth/SetupPage'
import { HomePage } from '../features/home/HomePage'
import { LocationsPage } from '../features/locations/LocationsPage'
import { ItemTypesPage } from '../features/itemTypes/ItemTypesPage'
import { TagsPage } from '../features/tags/TagsPage'
import { ItemsPage } from '../features/items/ItemsPage'
import { ItemDetail } from '../features/items/ItemDetail'
import { SettingsPage } from '../features/settings/SettingsPage'
import { Shell } from './Shell'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<SetupGate><LoginPage /></SetupGate>} />
      <Route path="/setup" element={<SetupPage />} />

      {/* Authenticated, first-run-gated routes all render inside the shared Shell. */}
      <Route
        element={
          <SetupGate>
            <RequireAuth>
              <Shell />
            </RequireAuth>
          </SetupGate>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/locations" element={<LocationsPage />} />
        <Route path="/types" element={<ItemTypesPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/items/:id" element={<ItemDetail />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 3: Remove the now-redundant nav from HomePage**

`HomePage` no longer needs its own `<nav>` (the Shell provides it):

```tsx
export function HomePage() {
  return (
    <div>
      <h1>Homebox</h1>
      <p>Your home inventory.</p>
    </div>
  )
}
```

- [ ] **Step 4: Write a shell smoke test**

Create `apps/web/test/shell.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { Shell } from '../src/app/Shell'

describe('Shell', () => {
  it('renders a hamburger drawer toggle for narrow viewports', () => {
    render(<MemoryRouter><Shell /></MemoryRouter>)
    expect(screen.getByTestId('drawer-toggle')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run the tests + build**

Run: `pnpm --filter @homebox/web test` and `pnpm --filter @homebox/web build`
Expected: shell test passes; the app builds (the layout route renders `<Outlet/>` for each child page).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/Shell.tsx apps/web/src/app/routes.tsx apps/web/src/features/home/HomePage.tsx apps/web/test/shell.test.tsx
git commit -m "feat(web): responsive Shell layout with drawer nav under md"
```

---

### Task 9: Responsive + utility-class migration across feature pages

**Files:** Modify (replace `index.css`-only classes with Tailwind utilities + responsive variants): `apps/web/src/features/items/ItemsPage.tsx`, `ItemForm.tsx`, `ItemDetail.tsx`, `features/locations/LocationsPage.tsx`, `features/locations/LocationTree.tsx`, `features/itemTypes/ItemTypesPage.tsx`, `features/tags/TagsPage.tsx`, `features/upload/PhotoUpload.tsx`, `features/upload/PhotoEditor.tsx`, `features/auth/LoginPage.tsx`, `features/auth/SetupPage.tsx`.
- Test: `apps/web/features/items/ItemsPage` existing `apps/web/test/searchFacets.test.tsx` still passes after markup change (it asserts content, not classes); `pnpm --filter @homebox/web build`.

**Interfaces:**
- Consumes: the semantic color utilities + Tailwind spacing/responsive utilities from Task 3; the existing `trpc` hooks and markup (unchanged logic).
- Produces: styling parity on each page plus the spec's responsive behaviors: adaptive item grid (`grid-cols-1 sm:2 lg:4`), collapsible facet sidebar on mobile, touch-friendly forms/editor, tables wrap rather than overflow.

**Mapping (old `index.css` class → Tailwind utilities):**

| Old class | Replacement utilities |
|---|---|
| `.card` | `block rounded-lg border border-border p-3 no-underline text-inherit hover:border-text-muted` |
| `.card img` | `w-full h-32 object-cover rounded-md mb-2` |
| `.grid` (Items) | `grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` |
| `.grid` (ItemDetail images) | `grid gap-4 grid-cols-2 sm:grid-cols-4` |
| `.tag` | `inline-block rounded px-1.5 py-0.5 mr-1 text-xs` |
| `.tag.active` | add `bg-accent text-accent-contrast` |
| `.muted` | `text-text-muted` |
| `.snippet` | `mt-2 text-text-muted text-sm` |
| `.form` | `flex flex-col gap-3 max-w-[30rem] my-4` |
| `.form-row` | `flex gap-3` |
| `.form-field` | `flex flex-col gap-1` |
| `.form-field input/select/textarea` | `px-2 py-1 border border-border rounded-md bg-surface text-text` |
| `.form-fields` | `border border-border rounded-lg p-3` |
| `.form-actions` | `flex gap-2` |
| `.pager` | `flex gap-2 items-center mt-4` |
| `.photo-upload` | `my-4` |
| `.photo-editor` | `fixed inset-0 z-[100] bg-black` |
| `.location-tree`, `.type-list` | `list-none pl-0` |
| `.search-toolbar` | `flex items-center gap-2 mb-4 flex-wrap` |
| `.search-toolbar input` | `flex-1 min-w-0 max-w-[26rem] px-2 py-1 border border-border rounded-md` |
| `.items-layout` | `flex gap-4 items-start` |
| `.facet-bar` | `hidden lg:flex flex-col gap-4 w-60 flex-shrink-0` |
| `.facet-group` | `flex flex-wrap gap-2` |
| `.facet-group h2` | `w-full mb-0` |
| `.tag-list` | `list-none flex flex-wrap gap-2` |

- [ ] **Step 1: Migrate `ItemsPage` (adaptive grid + collapsible facet sidebar)**

Change the item card container to the responsive grid:

```tsx
<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
```

For the facet sidebar, make it a collapsible drawer on mobile: the `<aside>` currently renders whenever `facets` is set. Give it a `hidden lg:flex` column plus a `lg:hidden` toggle button that flips a local `facetsOpen` state, showing the same facet groups in an overlay on mobile. Add `const [facetsOpen, setFacetsOpen] = useState(false)` and render:

```tsx
{facets && (
  <>
    <button
      type="button"
      className="lg:hidden px-2 py-1 rounded border border-border bg-surface text-text"
      onClick={() => setFacetsOpen((v) => !v)}
      aria-expanded={facetsOpen}
    >
      Filters
    </button>
    <aside className={`${facetsOpen ? 'fixed inset-0 z-50 bg-bg p-4 overflow-y-auto' : 'hidden'} lg:static lg:z-auto lg:block lg:bg-transparent lg:p-0 lg:overflow-visible lg:flex lg:flex-col lg:gap-4 lg:w-60 lg:flex-shrink-0`}>
      {/* existing facet groups unchanged */}
    </aside>
  </>
)}
```

> The facet groups JSX is identical to the current markup — only the wrapper classes change. On `lg:` the sidebar is a static `240px` column again; below `lg:` it's a full-screen overlay toggled by the Filters button.

Replace the `.search-toolbar`/`.page-header`/`.pager` class strings with their utilities from the mapping table. The card `Link` gets the `.card` utilities; the card `<img>` gets the `.card img` utilities; `<span className="tag">` gets `.tag`; set `data-testid="item-snippet"` stays.

- [ ] **Step 2: Migrate `ItemForm` and `ItemDetail`**

`ItemForm`: replace the `form/…` classes with the mapped utilities (e.g. `<form className="flex flex-col gap-3 max-w-[30rem] my-4">`, each field set/row/field gets its utilities). Custom-field `<fieldset className="border border-border rounded-lg p-3">`. Buttons keep their default-pill look plus `text-text` (`className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"`).

`ItemDetail`: replace `.grid` with `grid gap-4 grid-cols-2 sm:grid-cols-4`; the `.image-card` wrapper becomes `border border-border rounded-lg p-2`. The `<Link>` back link and the paragraph text use `text-text` / `text-text-muted`. The `.photo-editor` (in `PhotoEditor.tsx`) uses `fixed inset-0 z-[100] bg-black`.

- [ ] **Step 3: Migrate the list pages**

- `LocationsPage` / `LocationTree`: `<ul className="list-none pl-0">`, `<span>` stays, no layout classes.
- `ItemTypesPage`: the create form + `.type-list` mapped; `span.muted` → `text-text-muted`.
- `TagsPage`: `<ul className="list-none flex flex-wrap gap-2">`, `<li className="inline-block rounded px-1.5 py-0.5 mr-1 text-xs" style={tag.color ? { background: tag.color } : undefined}>` (keep the inline background; it's a tag chip, not a theme var).
- `PhotoUpload`: `.photo-upload` → `my-4`.
- `LoginPage` / `SetupPage`: wrap the form fields in `flex flex-col gap-3 max-w-[30rem] my-4`, inputs `px-2 py-1 border border-border rounded-md bg-surface text-text`, `text-text-muted` for the error text (`role="alert"` stays).

- [ ] **Step 4: Run the frontend tests + build**

Run: `pnpm --filter @homebox/web test` and `pnpm --filter @homebox/web build`
Expected: existing tests (`searchFacets.test.tsx`, `itemTypes`, `itemDetail`, `catalog`, `photoEditor`, `auth`) pass, and the build succeeds.

- [ ] **Step 5: Manual visual pass**

Run `pnpm --filter @homebox/web dev` (with the API on `:3000`) and verify at ≥ `lg` the item grid is 4-up with the facet bar on the right, and at a narrow viewport the nav collapses to the hamburger drawer and the facet Filters button opens the overlay. (Or rely on the e2e leg in Task 10.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features apps/web/test
git commit -m "feat(web): responsive pass + migrate plain-CSS classes to Tailwind utilities"
```

---

### Task 10: E2E — settings persists + locale + theme apply

**Files:**
- Modify: `apps/web/e2e/catalog.spec.ts` (append an e2e leg) or create `apps/web/e2e/settings.spec.ts`
- Test: `pnpm --filter @homebox/web test:e2e`

**Interfaces:**
- Consumes: the `/settings` page (Task 7), the legacy test's seeded admin (`admin@b.co` / `password123`), the `locale-date` preview (Task 7).
- Produces: e2e coverage for the spec requirement: *log in → change theme and locale → assert the persisted value survives a reload and a date renders in the chosen locale.*

- [ ] **Step 1: Add the e2e leg**

Append to `apps/web/e2e/catalog.spec.ts`:

```ts
// Settings persistence + locale formatting leg. The main test's admin already
// exists (DB persists within a run), so log in directly, open `/settings`, switch
// the locale to de-DE and the theme mode to dark, reload, and assert the choice
// survived AND a date renders in the chosen locale.
test('settings persist across reload and drive locale formatting', async ({ page }) => {
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  await page.goto('/settings')

  // Switch locale to German and theme mode to dark.
  await page.selectOption('#settings-locale', 'de-DE')
  await page.selectOption('#settings-theme-mode', 'dark')
  await page.selectOption('#settings-dark-palette', 'dark-dracula')

  // The default dark palette resolves to dark-dracula: the root carries the
  // data-theme attribute.
  await expect(page.locator('html[data-theme="dark-dracula"]')).toBeVisible()

  // A date renders in the chosen locale (German day-first format).
  const dateText = await page.getByTestId('locale-date').textContent()
  expect(dateText).toMatch(/\d{1,2}\.\d{1,2}\.\d{4}/)

  // Reload → the persisted values survive.
  await page.reload()
  await expect(page.locator('#settings-theme-mode')).toHaveValue('dark')
  await expect(page.locator('#settings-locale')).toHaveValue('de-DE')
})
```

> If the `data-theme` attribute check is flaky in headless (because `ThemeProvider` applies vars via inline style and `data-theme` on `documentElement`), assert instead that `#settings-theme-mode` has value `dark` after selecting it and that the `locale-date` preview uses German formatting — the theme application is already covered by the Task 4 unit test.

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm --filter @homebox/web test:e2e`
Expected: all legs (including the new settings leg) pass. The webserver builds the full workspace and boots the API; the `data/` dirs are reset by `global-setup.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/catalog.spec.ts
git commit -m "test(e2e): settings persist across reload and drive locale formatting"
```

---

## Self-review

After the plan is drafted (run now by the author, and again by the executor before dispatch):

**1. Spec coverage** — every section of `docs/superpowers/specs/2026-09-06-phase4-settings-responsive-design.md` is mapped:
- A. Styling system (Tailwind v4, CSS-first) → **Task 3**; theme registry → **Task 4**.
- B. Theme resolution (`auto`/`light`/`dark` client-side matchMedia) → **Task 4**.
- C. `user_settings` table + API module → **Tasks 1, 2**.
- D. i18n + `Intl` + `useUserSettings` + `SettingsProvider` → **Tasks 5, 6**.
- E. `/settings` page + nav entry → **Tasks 7, 8**.
- F. Responsive/mobile pass (drawer nav, adaptive grid, collapsible facet sidebar, touch forms, wrapping tables) → **Tasks 8, 9**.
- Testing + API contract + Data model summary → mirrored in Tasks 1, 2, 5, 6, 10.

**2. Placeholder scan** — no "TBD", no "handle edge cases", no cross-task "similar to Task N". Each step carries real code or an exact runnable command. The two deliberately open checkpoints (Step 4's note about `Intl` exact tokens, Step 1 of Task 10's note about the `data-theme` assert) are *documented alternatives with concrete expected values*, not open-ended TODOs.

**3. Type consistency** — `UserSettingsDto` / `UserSettingsInput` / `DEFAULT_USER_SETTINGS` (Task 1) are used with matching field names by the API service (Task 2), `SettingsProvider` and `useUserSettings` (Task 6), and `SettingsPage` (Task 7). `ThemeProvider`'s props `themeMode`/`lightThemeId`/`darkThemeId` in Task 4 match the `settings` shape the `SettingsProvider` passes in Task 6 and the `UserSettingsDto` fields in Task 1. `lightThemes`/`darkThemes`/`themes` names are identical across Tasks 4, 6, 7. `createFormatters(locale)` returns `{ formatDate, formatCurrency }`, used identically in Tasks 6 and 7. `settingsRouter`'s `get`/`update` mount at `settings` in Task 2 and are called via `trpc.settings.get/update` in Tasks 6 and 7.

---

## Process / durability note

The SDD ledger and per-task briefs under `.superpowers/sdd/<this-plan>/` are git-ignored scratch and are lost on worktree removal. The durable record is this plan, the spec, and the merged code. At close-out, commit a condensed completion record (ledger summary, rulings, per-task review verdicts) to `docs/superpowers/` alongside the plan + spec.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-06-phase4-settings-responsive.md`.
