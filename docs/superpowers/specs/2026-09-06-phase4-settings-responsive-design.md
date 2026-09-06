# HomeBox-BG — Phase 4: Per-User Settings + Responsive Design Spec

**Date:** 2026-09-06
**Status:** Draft for review
**Type:** Incremental design (extends `2026-09-04-homebox-bg-design.md`)

## Overview

Phase 4 delivers the app's personalization layer and its responsive stance, aligning the
built frontend with the styling system the original design spec prescribes. It introduces:

- A **styling system** on **Tailwind CSS v4** (CSS-first) to replace the hand-rolled CSS classes,
  plus a **CSS-variable theme registry** (light + dark palettes).
- **Per-user settings** — language, locale, and theme — persisted per user in a `user_settings`
  table and edited on a new `/settings` page.
- **i18n** via `react-i18next` (English bundled) and **locale-aware formatting** (`Intl`) for
  dates and currency-typed custom fields.
- A **responsive / mobile pass** across the existing features (drawer nav, adaptive grids,
  touch-friendly forms and editor).

This phase builds on the Phase 1-3 frontend, which is currently plain-CSS classes in
`apps/web/src/index.css` with no theme system, no i18n, and no framework CSS. The master spec
names Tailwind + react-i18next + CSS-variable theming as the frontend stack; this phase brings
the code in line with it.

## Scope

**In (Phase 4):**
- **Styling system:** add Tailwind v4 (`@tailwindcss/vite`), replace `index.css` utility classes
  with Tailwind utilities in markup, page by page. Remove the dead `styled-components` dependency
  (in `package.json` today, imported nowhere).
- **Theme registry:** a typed registry of named palettes (adapted from Homebox's theme list),
  each a set of CSS custom properties and an explicit dark-group flag. v1 ships ~3 light + ~3 dark.
- **Theme resolution:** `ThemeProvider` applies the active palette as CSS variables on the
  document root. `theme_mode` is `auto` | `light` | `dark`; `auto` follows `prefers-color-scheme`
  and resolves to the user's chosen light or dark palette. Resolution is **client-side** (the OS
  preference is not visible to the server).
- **Per-user settings** table `user_settings` + an API module `settings` (`settings.get`,
  `settings.update`), both authenticated, zod schemas in `packages/shared`.
- **i18n:** `react-i18next`, English bundled under `apps/web/public/locales/en/`.
- **Locale formatting:** `useUserSettings()` exposes `formatDate` / `formatCurrency` built on the
  user's `locale` via `Intl` (currency fields use the field's currency code).
- **`/settings` page:** language (single `en` option now), locale picker, theme mode, and
  per-mode light/dark palette selectors with live previews. A nav entry reveals it post-login.
- **Responsive pass:** drawer nav under `md:` breakpoint, adaptive item grid, collapsible facet
  sidebar on mobile, touch-friendly forms/editor, tables wrap rather than overflow.

**Out (deferred to later phases / non-goals):**
- Translation files beyond English (i18n architecture is ready; more languages added later
  without code changes).
- `instance_settings` (max upload size, detection provider) and backup/restore — these are
  **Phase 5** (admin settings).
- Unpack, drafts/publish lifecycle, and Docker packaging — **Phase 6**.
- Migration of the back-office admin pages (they arrive with Phase 5's admin settings).

## Current state (what this changes)

- `apps/web/src/index.css` — plain CSS: reset, `.card`, `.grid`, `.form`, `.tag`, `.facet-bar`,
  `.search-toolbar`, `.snippet`, etc. Fixed widths (`facet-bar: 240px`, `max-width: 26rem`),
  zero media queries. Hardcoded hex colors (`#fff`, `#1a1a1a`, `#ccc`).
- `apps/web/src/app/AppProviders.tsx` — `QueryClientProvider` → `trpc.Provider` → `BrowserRouter`.
  No theme or settings provider.
- `apps/web/src/app/routes.tsx` — `/`, `/login`, `/setup`, `/locations`, `/types`, `/tags`,
  `/items`, `/items/:id`. No `/settings`.
- `apps/web/src/features/` — `auth`, `home`, `items`, `itemTypes`, `locations`, `tags`, `upload`.
  No `settings`.
- `packages/db/src/schema.ts` — `users` (id, name, email, passwordHash, role, createdAt). No
  settings table or columns.
- `apps/web/package.json` — deps: react, react-dom, react-router-dom, react-query, trpc client,
  styled-components (unused), filerobot, konva. No `tailwindcss`, no `react-i18next`, no intl lib.

## Architecture

### A. Styling system — Tailwind v4 + theme registry

**Tailwind v4 (CSS-first).** Add `@tailwindcss/vite` to the Vite config. The root stylesheet
becomes:

```css
@import "tailwindcss";

@theme {
  /* design tokens referenced by utilities; many map to semantic CSS vars */
  --color-bg: var(--color-bg);
  --color-surface: var(--color-surface);
  /* … */
}
```

The existing `index.css` utility classes are replaced by Tailwind utilities in markup. Where a
recurring composite is genuinely reused (e.g. the item card, a form field row), extract it to a
small local component rather than a global class. Remove `styled-components`.

**Theme registry** (`apps/web/src/lib/theme/registry.ts`):

```ts
export type ThemeVar = '--color-bg' | '--color-surface' | '--color-surface-raised'
  | '--color-text' | '--color-text-muted' | '--color-border' | '--color-accent'
  | '--color-accent-contrast' | '--color-danger' | '--color-success' | '--color-focus';

export interface ThemePalette { id: string; name: string; dark: boolean; vars: Record<ThemeVar, string>; }

export const themes: ThemePalette[] = [ /* ~3 light, ~3 dark, adapted from Homebox */ ];
```

Rules:
- Each palette carries `dark: true | false` (an explicit group flag, per the master spec) — the
  light set and the dark set are derived from it; a palette belongs to exactly one set.
- Components consume **only** semantic vars (`--color-bg`, `--color-text`, `--color-accent`, …)
  — never raw palette hex values.
- `ThemeProvider` holds the resolved palette and applies it to `document.documentElement.style`
  plus a `data-theme` attribute (for any non-variable styling hooks).

### B. Theme resolution

`ThemeProvider` (`apps/web/src/lib/theme/ThemeProvider.tsx`) takes the user's `theme_mode`,
`light_theme_id`, `dark_theme_id` and the OS `prefers-color-scheme` (via a `matchMedia` listener):

- `light` → the palette whose `id === light_theme_id`.
- `dark` → the palette whose `id === dark_theme_id`.
- `auto` → follow `prefers-color-scheme`: `dark` → dark palette, otherwise light palette.

It responds to OS changes while mounted and re-applies. Resolving client-side is required because
`auto` depends on the OS, which the server cannot observe.

### C. Per-user settings — data + API

**Table `user_settings`** (camelCase Drizzle keys, snake_case SQL, matching existing tables):

```ts
export const userSettings = sqliteTable('user_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  language: text('language').notNull().default('en'),
  locale: text('locale').notNull().default('en-US'),
  themeMode: text('theme_mode', { enum: ['auto', 'light', 'dark'] }).notNull().default('auto'),
  lightThemeId: text('light_theme_id').notNull().default('light-default'),
  darkThemeId: text('dark_theme_id').notNull().default('dark-default'),
});
```

One row per user (`user_id` unique). `settings.get` returns the row, or **defaults** when none
exists (a fresh user gets `auto`, `en`, `en-US` without a write). `settings.update` upserts.

**API module** `apps/api/src/modules/settings/` (module, mirroring `tags`/`locations`):
- `settings.get` — `protectedProcedure`, returns `UserSettingsDto` (or defaults).
- `settings.update` — `protectedProcedure`, validates a partial `UserSettingsInput` and upserts.

Zod schemas live in `packages/shared/src/settings.ts` (`userSettingsSchema`,
`userSettingsUpdateSchema`), shared by client and server.

### D. i18n + Intl

- **i18n:** `react-i18next`. An `apps/web/src/lib/i18n.ts` init with the English resources bundled
  under `apps/web/public/locales/en/translation.json`, default `en`. The per-user `language` selects
  the active resource (only `en` ships; adding a language is a resource file + a registry entry).
- **Settings hook:** `useUserSettings()` (`apps/web/src/lib/settings/useUserSettings.ts`) returns
  `{ language, locale, themeMode, lightThemeId, darkThemeId }` and the helpers:

  ```ts
  formatDate(date: Date | number | string, opts?): string   // Intl.DateTimeFormat(locale)
  formatCurrency(amount: number, currency: string, opts?): string  // Intl.NumberFormat(locale, { style:'currency', currency })
  ```

  Currency-typed custom fields render through `formatCurrency` using the field's currency code.
- **Providers:** a `SettingsProvider` (`apps/web/src/lib/settings/SettingsProvider.tsx`) fetches
  `settings.get` once, provides the settings object and an `updateSettings` (mutation) setter,
  and wires `ThemeProvider` + `i18n.language`. Consumers use `useSettings()` / `useUserSettings()`.

### E. `/settings` page + navigation

New `apps/web/src/features/settings/SettingsPage.tsx`:
- **Language** — a single `en` option now.
- **Locale** — a curated list: `en-US`, `en-GB`, `bg-BG`, `de-DE`, `fr-FR`, `it-IT`.
- **Theme mode** — `auto` / `light` / `dark`.
- **Light palette** and **dark palette** selectors — each listing the palettes from the
  corresponding set, with a live preview.
- Changes call `settings.update` optimistically.

Add a `/settings` route (post-login) and a nav entry (a settings/gear link on the nav bar,
rendered inside `RequireAuth`).

### F. Responsive / mobile pass

Apply Tailwind breakpoints across the existing features:
- Top nav collapses to a **drawer** under `md:`.
- The items grid becomes `grid-cols-1 sm:2 lg:4` (was a fixed `minmax(200px, 1fr)`).
- The **facet sidebar** becomes a collapsible drawer on mobile (was a fixed `240px` column).
- Item forms, the photo editor wrapper, and detail views stay usable touch-first on narrow
  viewports; long tables wrap rather than overflow; hit areas are finger-friendly.

## API contract

- tRPC `settings` group, both `protectedProcedure`:
  - `settings.get` → `UserSettingsDto = { language: string; locale: string; themeMode: 'auto'|'light'|'dark'; lightThemeId: string; darkThemeId: string }`.
    Returns defaults when no row exists.
  - `settings.update` (input: partial of the above) → updated `UserSettingsDto` (upsert).
- No new raw Fastify routes; no files/backup endpoints in this phase.

## Data model summary

- New table **`user_settings`** with columns above (migration via drizzle-kit).
- No change to existing tables.

## Frontend file map

- Add: `apps/web/src/lib/theme/registry.ts`, `apps/web/src/lib/theme/ThemeProvider.tsx`,
  `apps/web/src/lib/settings/SettingsProvider.tsx`, `apps/web/src/lib/settings/useUserSettings.ts`,
  `apps/web/src/lib/i18n.ts`, `apps/web/public/locales/en/translation.json`,
  `apps/web/src/features/settings/SettingsPage.tsx`.
- Modify: `apps/web/src/index.css` (Tailwind import + tokens), `apps/web/vite.config.ts`
  (tailwind plugin), `apps/web/src/app/AppProviders.tsx` (SettingsProvider), `apps/web/src/app/routes.tsx`
  (`/settings`), shared nav (e.g. `HomePage` / a layout), existing feature pages (responsive + utility
  migration), `apps/web/package.json` (deps).
- DB/API: `packages/db/src/schema.ts` (+ migration), `packages/shared/src/settings.ts`,
  `apps/api/src/modules/settings/` (repo, service, router), router mount.

## Testing

- **Backend (Vitest):** `settings.get` returns defaults for a user with no row; `settings.update`
  upserts; both reject unauthenticated requests. Migration verified against a clean DB.
- **Frontend (Vitest + RTL):** `SettingsPage` renders current settings and applies updates
  optimistically; `ThemeProvider` resolves `light`/`dark`/`auto` (incl. `prefers-color-scheme`) to
  the correct palette; `formatDate`/`formatCurrency` honor the locale; i18n renders `en` strings.
- **E2E (Playwright):** log in → change theme and locale → assert the persisted value survives a
  reload and a date renders in the chosen locale.

## Process & durability

Per the Phase 3 lesson (`sdd-ledger-durability.md`), the Subagent-Driven Development **ledger,
task briefs, and review packages are git-ignored scratch** under `.superpowers/sdd/<plan>/` and are
**lost on worktree removal or `git clean -fdx`**. The durable record is the **spec** (this file),
the **implementation plan**, and the **merged code**. To keep the process record, this phase's
completion (ledger summary, rulings, per-task review verdicts) will be condensed and committed to
`docs/` at close-out, alongside the plan+spec that live there already. At minimum, the plan+spec+code
are committed; the process scratch is intentionally ephemeral.

## Non-goals / future work

- More languages (architecture ready).
- Admin `instance_settings`, backup/restore (Phase 5).
- Unpack/drafts, Docker (Phase 6).
- Any REST external API; multi-tenancy; per-user private catalogs.
