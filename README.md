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

- **Node 26** — what development and the release image both use, and they have to agree:
  `better-sqlite3` is a native addon compiled against whichever Node installed it.
- **pnpm 9.15.0** — pinned via `packageManager`. `corepack` no longer ships with Node 26, so install
  it the way CI and the Dockerfile do:
  `npm i -g "$(node -p 'require("./package.json").packageManager')"`.
- A **C++ toolchain** — `python3`, `make`, `g++` — for `pnpm install`. This is not optional and it
  is not specific to the local detection provider: `better-sqlite3` ships no install script and
  bundles its prebuilds, but it *does* carry a `binding.gyp`, so pnpm runs `node-gyp rebuild` on
  every install, on Node 22 as much as 26. Without it the install fails with `gyp ERR! find Python`.
  (`--ignore-scripts` gets past the install and leaves a `better-sqlite3` that cannot load.)

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
the seed is idempotent by name, so a re-run only adds what is missing. Both servers' output streams into
the current shell, each line tagged `[api]` or `[web]` (full logs stay in `.dev/api.log` and
`.dev/web.log`). Ctrl-C stops the streaming only — the stack keeps running, so end it with `pnpm stop`.

It refuses to start when `:3000` or `:5173` is already held — a half-started stack is worse than none,
because the API dies on `EADDRINUSE` while Vite quietly moves to `:5174`, leaving the printed URLs
pointing at whatever held the port first. Move the ports with `PORT=… WEB_PORT=… pnpm dev`.

### 7. Or: a branch that lives in a git worktree

A branch checked out in a `git worktree` is **not** in your main checkout — that one still shows
`main` until you merge. Run the stack from the worktree's own directory:

```bash
cd .claude/worktrees/<name>
PORT=3200 WEB_PORT=5273 pnpm dev     # then browse :5273
```

Pick any two free ports; `pnpm dev` takes `PORT`/`WEB_PORT` and Vite's proxy follows `PORT`, so the
API and the SPA stay pointed at each other. **Avoid `3100`** — that is the Playwright suite's default
`E2E_PORT`, so putting the dev API there blocks `pnpm test:e2e`. `3200` + `5273` collide with no
default here, and both stacks can run at once (the e2e alongside them with `E2E_PORT=3300`). Check a
port with `ss -ltnpH 'sport = :3200'` — no output means free.

`pnpm build` is **not** needed for this: `pnpm dev` builds the API and its workspace dependencies
itself. Root `pnpm build` is only for the built stack of step 4.

A worktree has its own `data/` (gitignored), so its stack seeds its own database and uploads —
trashing items, unpacking photos and the rest cannot touch your real inventory.

The first `pnpm install` in a fresh worktree needs `--ignore-scripts` (see step 1), and the workspace
packages must be built before anything typechecks — `pnpm dev` does that, but a bare `pnpm test` or
`tsc` will not.

### First run

A fresh install has no users, so the app routes to `/setup` — create the first admin there. The
`requiresSetup` query returns `setupRequired` until an admin exists.

## Running from the Docker image

One image, one process, one volume: the API serves `/trpc`, the uploads, and the built SPA. Design
and the measurements behind it: `docs/superpowers/specs/2026-09-16-docker-packaging-design.md`.

```bash
mkdir -p /srv/homebox-ng/data
sudo chown -R 1000:1000 /srv/homebox-ng/data     # see below, this one matters

docker run -d \
  --name homebox-ng \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /srv/homebox-ng/data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/grota/homebox-ng:latest
```

Open <http://localhost:3000>; the first visit routes to `/setup`.

### `/data` must be writable by uid 1000

The container runs as uid/gid **1000** — the Node image's `node` user — so a bind mount has to be
owned by it. Get this wrong and the container exits at startup naming the uid, the path and the
`chown`, instead of failing later with an `SQLITE_CANTOPEN` that points nowhere near the cause.

Everything persistent lives under `/data`: the SQLite database, uploads, stored backups, and the
detection model's cache. Back up that one directory and you have everything.

### Configuration

`SESSION_SECRET` is required; the rest have defaults. Pass the detection keys the same way if you
use those providers.

| Variable | Image default |
|---|---|
| `SESSION_SECRET` | *(required — no default)* |
| `PORT` | `3000` |
| `DATA_DIR` | `/data` |
| `DATABASE_PATH` | `/data/homebox.db` |
| `LOG_LEVEL` | `info` |

`GEMINI_API_KEY`, `OPENAI_API_KEY`, `MAX_UPLOAD_MB` and `DETECTION_MODEL` behave as in
[Environment variables](#environment-variables).

### Logs

The server logs through pino at `LOG_LEVEL`, defaulting to `info`: one line per request in, one per
request out, plus a startup banner. The output is JSON, so `jq` works on it as well as your eyes.

```bash
docker logs -f homebox-ng                        # follow
docker logs --timestamps --since 10m homebox-ng  # the last ten minutes, with times
```

| `LOG_LEVEL` | What appears |
|---|---|
| `info` *(default)* | Request lines + the banner |
| `warn` | Neither — warnings and errors only |
| `error` | Errors only |
| `debug` | `info`, plus Fastify's own internals |
| `silent` | Nothing at all — what this image did before it had a logger |

An unknown value fails the boot and names the real ones (`Unknown LOG_LEVEL "verbose". Use one of:
fatal, error, warn, info, debug, trace, silent.`), and an empty one counts as unset, so a compose
file's `LOG_LEVEL: ${LOG_LEVEL}` with nothing behind it still starts.

Two things that surprise people:

- **The `HEALTHCHECK` is two of those lines every 30 seconds** — `incoming request` and `request
  completed` for `/health`, about 5,800 a day and all identical. That is the healthcheck working.
  `LOG_LEVEL=warn` turns it off.
- **The detection model's download is not wired to the logger.** The first detection after a fresh
  `/data` fetches the model with no output while it does, so silence there means a download in
  progress rather than a hang.

Nothing secret reaches the log: request lines carry method, URL, host and peer address but never
headers — verified at `debug` with a `Cookie` and an `Authorization` header on the wire.

### Pulling the image

The GHCR package is private, like the repository, so the first pull needs a token with
`read:packages`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u grota --password-stdin
```

### The detection model is not in the image

It is downloaded on first use into `/data/models/detection` and cached there, so it is fetched once
per data directory and survives every image upgrade — including one that changes `DETECTION_MODEL`.
The first detection needs outbound network access; after that it does not.

There is deliberately no warm-up step for the container: the `pnpm detection:model` CLI runs through
`tsx`, which is a devDependency and is not in the runtime image. The in-request download is the
supported path, and it is why a skipped warm-up is never fatal.

### Upgrading, and pinning

Migrations run automatically on boot, so an upgrade is a pull and a restart:

```bash
docker pull ghcr.io/grota/homebox-ng:latest
```

Every release is tagged `vX.Y.Z` as well as `latest`, and `/health` reports the version it was built
from, so you can pin a tag and still tell what is running:

```bash
curl -s localhost:3000/health     # {"ok":true,"version":"v1.2.3"}
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_SECRET` | **required** | Signs session cookies |
| `PORT` | `3000` | API/SPA listen port |
| `LOG_LEVEL` | `info` | pino level — `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent` |
| `DATABASE_PATH` | `./data/homebox.db` | SQLite file |
| `DATA_DIR` | `./data` (repo root) | Uploads, stored backups (`backups/`) + model cache root |
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
| `pnpm dev` | root | build + seed + API `:3000` + Vite `:5173`, streaming both logs (`PORT`/`WEB_PORT` to move them) |
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
