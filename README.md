# homebox-ng

A self-hosted, household-shared inventory manager — a Homebox-inspired rebuild with a type-safe
monorepo. Catalog items, photos, locations, types and tags; non-destructive photo editing; full-text
search with faceted filters; instance + per-user settings; backup/restore; and an **unpack → drafts →
publish** flow that runs object detection on a photo and splits it into proposed draft items.

Everything is one deployable unit: a single Fastify server serves both the tRPC API and the built
SPA, over one SQLite database.

## What it does

- **Shared catalog** — every user sees every item; items, locations, item types + custom fields, tags.
- **Photos** — upload, thumbnail generation, and a **non-destructive editor** (crop/rotate/resize);
  the original is always preserved.
- **Search** — FTS5 full-text search with ranked results plus facet filters (location, type, tags),
  URL-param state.
- **Settings** — instance-wide admin settings (locale, detection provider, upload ceiling) and
  per-user preferences (locale, theme).
- **Backup / restore** — full DB + uploads snapshot with a preview-then-confirm restore.
- **Unpack → drafts → publish** — upload a photo to a chosen item type; object detection produces
  cropped draft items (`published=false`), which you rename, discard, and publish into the catalog.
- **Auth** — argon2id password hashing, httpOnly session cookies; first run walks through `/setup`.

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm + Turborepo |
| Frontend | React 19 + Vite, tRPC v11 + TanStack Query, Tailwind CSS v4, react-i18next, konva |
| Backend | Node + Fastify, tRPC, Drizzle ORM + SQLite (better-sqlite3), FTS5, sharp |
| Detection | transformers.js (local), OpenAI vision, Google Gemini, mock (`DETECTION_MOCK=1`) |
| Auth | argon2id + httpOnly session cookie |
| Tests | Vitest (unit), Playwright (e2e, chromium) |

## Repository layout

```
apps/
  api/      @homebox/api        Fastify + tRPC server; serves /trpc + the built SPA
  web/      @homebox/web        React SPA (Vite), routes, features, e2e specs
packages/
  db/       @homebox/db         Drizzle schema + migrations (SQLite)
  shared/   @homebox/shared     types & schemas shared between api and web
```

Build order is `shared → db → api → web` (web also runs a `vite build`). Consumers import from the
built `dist/`, so **build before you run**.

## Prerequisites

- **Node 20+** (LTS recommended)
- **pnpm 9.15.0** — pinned via `packageManager`; `corepack enable pnpm` if you don't have it.
- For the **local (transformers.js) detection provider**, a C++ toolchain for native builds
  (node-gyp). The `google`/`openai`/`mock` providers need no native build.

## Getting started (developer)

### 1. Install

```bash
pnpm install
```

> **Native-build caveat:** the local provider pulls `onnxruntime-node` (and `sharp`) which run
> native postinstall builds. On a machine without the toolchain, use
> `ONNXRUNTIME_NODE_INSTALL_CUDA=skip pnpm install --ignore-scripts` to skip the native build — the
> app still builds and runs; only the **local** detection provider needs the binaries (the other
> providers, including the mock, are unaffected).

### 2. Configure env

```bash
cp .env.example .env
```

At minimum set `SESSION_SECRET` to a long random string.

The API loads the repo-root `.env` automatically on boot (`loadEnv` → `loadDotEnv`),
so you don't have to `export` the vars. Two things to know:

- **Shell vars win.** Variables already set in your environment take precedence over `.env`
  (the e2e suite relies on this to inject `DATABASE_PATH`/`SESSION_SECRET`/…).
- **Relative data paths resolve against the repo root.** `start` runs with `apps/api` as its working
  directory, so resolving them against the cwd would be surprising: `DATA_DIR=./data` and
  `DATABASE_PATH=./data/homebox.db` mean `<repo root>/data` and `<repo root>/data/homebox.db`, from
  any package. An absolute value is used as given.

### 3. Build

```bash
pnpm build
```

### 4. Run (API + built SPA, single process)

```bash
pnpm --filter @homebox/api start   # serves /trpc + the SPA at http://localhost:3000
```

### 5. Frontend development with HMR

Keep the API running on `:3000`, then in a second terminal:

```bash
pnpm --filter @homebox/web dev     # Vite on :5173, proxies /trpc /upload /file to :3000
```

Open `http://localhost:5173`. The API still needs to be built for its types; rebuild `shared`/`db`/`api`
together (`pnpm build`) whenever you change code those packages export.

### 6. Or: the whole stack, up and down

```bash
pnpm dev     # build shared/db/api, seed, then API :3000 + Vite :5173 in the background
pnpm stop    # stop both
```

`pnpm dev` runs steps 3–5 for you, including the rebuild that step 5 warns about. It seeds on every run;
the seed is idempotent by name, so a re-run only adds what is missing. Logs land in `.dev/api.log` and
`.dev/web.log`.

It refuses to start when `:3000` or `:5173` is already held — a half-started stack is worse than none,
because the API dies on `EADDRINUSE` while Vite quietly moves to `:5174`, leaving the printed URLs
pointing at whatever held the port first. Move the ports with `PORT=… WEB_PORT=… pnpm dev`.

### First run

A fresh install has no users, so the app routes to `/setup` — create the first admin there. The
`requiresSetup` query returns `setupRequired` until an admin exists.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_SECRET` | **required** | Signs session cookies |
| `PORT` | `3000` | API/SPA listen port |
| `DATABASE_PATH` | `./data/homebox.db` | SQLite file |
| `DATA_DIR` | `./data` (repo root) | Uploads + model cache root |
| `DETECTION_MOCK` | (unset) | `1` registers the deterministic mock detection provider |
| `GEMINI_API_KEY` | (unset) | Enables the `google` detection provider |
| `OPENAI_API_KEY` | (unset) | Enables the `openai` detection provider |
| `MAX_UPLOAD_MB` | `100` | Hard upload ceiling (MB) |
| `DETECTION_MODEL` | `onnx-community/rfdetr_nano-ONNX` | Model id for the local provider / `detection:model` CLI |

Detection provider choice is a persisted **instance setting** (admin → Settings), default `google`.
API keys are read only from the environment and are never stored in or returned to the browser.

## Detection providers

- **`local`** — transformers.js (`@huggingface/transformers`), runs in-process. Downloads the model
  to `$DATA_DIR/models/detection` on first use.
- **`google`** — Google Gemini vision. Needs `GEMINI_API_KEY`.
- **`openai`** — OpenAI vision. Needs `OPENAI_API_KEY`.
- **`mock`** — deterministic boxes (a chair + a table) for tests. Enabled by `DETECTION_MOCK=1`.

To pre-download the default local model:

```bash
pnpm --filter @homebox/api detection:model
```

## Testing

```bash
pnpm test                          # all workspace unit suites (turbo run test)
pnpm --filter @homebox/api test    # api unit tests (Vitest)
pnpm --filter @homebox/web test    # web unit tests (Vitest)
pnpm --filter @homebox/web test:e2e   # Playwright end-to-end
```

The e2e suite boots the **built** API (`pnpm -r build && pnpm --filter @homebox/api start`) with
`DETECTION_MOCK=1` and a database of its own: the config mints a fresh temp directory per run and
points `DATABASE_PATH`/`DATA_DIR` inside it, so nothing survives the run and there is no stale
database to wipe. All spec files share that one database and run serially (`workers: 1`):

```bash
pnpm --filter @homebox/web test:e2e
```

## Scripts reference

| Command | Where | What |
|---|---|---|
| `pnpm build` | root | `turbo run build` (shared → db → api → web) |
| `pnpm test` | root | `turbo run test` (all unit suites) |
| `pnpm dev` | root | build + seed + API `:3000` + Vite `:5173`, backgrounded (`PORT`/`WEB_PORT` to move them) |
| `pnpm stop` | root | stop the stack `pnpm dev` started |
| `pnpm --filter @homebox/api start` | api | `node dist/index.js` (serve API + SPA) |
| `pnpm --filter @homebox/web dev` | web | Vite dev server (:5173, proxies to :3000) |
| `pnpm --filter @homebox/api detection:model` | api | Pre-download the local detection model |

## Migrations

Schema lives in `packages/db/src/schema.ts`; migrations are committed under `packages/db/drizzle/`.
They **run automatically on boot** (`runMigrations(db)` in `apps/api/src/index.ts`). To generate a
new one after a schema change:

```bash
pnpm --filter @homebox/db exec drizzle-kit generate
```

## Notes

- The git remote is `origin` (GitHub, `grota/homebox-ng`), which is also where issues and specs
  live — see `docs/agents/issue-tracker.md`.
- `apps/web` and `apps/api` are ESM (`"type":"module"`); relative imports in `src` use `.js`
  specifiers. The built API (`node dist/index.js`) rejects extensionless relative imports, which is
  why the packages build with `tsc -b` and imports are written with extensions.
