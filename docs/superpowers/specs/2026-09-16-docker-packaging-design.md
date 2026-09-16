# Docker packaging — design

**Date:** 2026-09-16 · **Decisions:** ADR-0007
(`docs/adr/0007-image-preserves-the-workspace-layout.md`) · **Related:** the master spec's
`## Deployment` section (`2026-09-04-homebox-ng-design.md`), which this phase finally executes and
in two places deliberately declines; and the deferred question at
`2026-09-06-phase6-unpack-drafts-publish-design.md:247`.

*The `file:line` references were accurate when this was written. **The symbol names are the durable
anchor** — `buildApp`, `createLocalProvider`, `runMigrations`, `modelCacheDir` — and grepping for
one is how to read a citation that no longer lands. `CONTEXT.md` is the living glossary, and this
phase adds nothing to it: "image", "release" and "bind mount" are engineering vocabulary, not
domain vocabulary.*

## Problem

**The app has no artifact.** On 2026-09-04 the master spec committed to "single Docker image serving
the built SPA + the API". Docker was then assigned to Phase 6, excised from Phase 6 at spec time
("deferred to later phases / follow-on phases"), and never reassigned — no plan, no ADR, no issue,
no commit. Six phases later the only way to run this is `pnpm dev` from a checkout, and there are no
git tags at all (`git tag -l` is empty).

The target is not hypothetical. `ssh grota@home.lab` is a **MeLE C4** — Intel N100, `x86_64`, Arch
Linux, Docker 29.7.2 with Compose 5.5.0, user `grota` at uid 1000 — and it is already running the
upstream project this one forks (`ghcr.io/sysadminsmedia/homebox:latest`, healthy, 29 MB of data,
served at `homebox.home.lab`). This phase makes homebox-ng deployable; it does not touch that
machine, and it does not move that data.

## Facts this design rests on

Established by reading, measuring, or running — not assumed. Each one changed a decision.

- **One process serves everything.** `apps/api/src/index.ts:29` registers `@fastify/static` over the
  built SPA with an SPA fallback. There is no second web container, and SQLite via `better-sqlite3`
  means no database container. One image, one volume.
- **Migrations run at boot.** `index.ts:19-22` does `mkdirSync` → `createDb` → `runMigrations`. No
  separate migration step or entrypoint script is needed.
- **`node` is uid 1000, gid 1000** in both `node:26-*` and `node:22-*` slim images (verified). That
  matches `grota` on the laptop and on the MeLE, so non-root needs no `useradd`.
- **The server never sets the model cache directory.** `createLocalProvider` (`local.ts`) calls
  `pipeline(...)` bare. The measured default, printed from the installed package, is
  `<repo>/node_modules/.pnpm/@huggingface+transformers@3.8.1/.../transformers/.cache/` — *inside
  `node_modules`*. Only the CLI (`scripts/detection-model.ts:16-17`) sets `env.cacheDir`.
- **Four native modules**, all N-API: `sharp`, `argon2`, `better-sqlite3`, and `onnxruntime-node`
  (pulled in by `@huggingface/transformers`).
- **Alpine is impossible while `@huggingface/transformers` is a runtime dependency.**
  `onnxruntime-node@1.21.0` ships one Linux binary per arch with no musl variant; `readelf` shows it
  needs `ld-linux-x86-64.so.2` and `libc.so.6`, and it fails to dlopen in `node:22-alpine` with
  exactly that missing-file error. There is no source build to fall back on. `sharp` and `argon2`
  are fine on musl; this one package forces glibc.
- **`better-sqlite3` always compiles, on Node 22 as well as 26.** It has no `install` script and
  bundles every prebuild in its tarball, yet pnpm auto-runs `node-gyp rebuild` merely because a
  `binding.gyp` is present. Measured in a clean room:

  | | |
  |---|---|
  | `node:26-slim`, plain `pnpm install --prod` | fails — `gyp ERR! find Python` |
  | `node:22-slim`, plain `pnpm install --prod` | fails — the same |
  | `node:26-slim` + `python3 make g++` | exits 0, no gyp errors |
  | that install, run in a clean `node:26-slim` with no toolchain | `better-sqlite3`, `sharp`, `argon2`, `@huggingface/transformers` all load |

  So the toolchain is this repo, not Node 26 — and `--ignore-scripts`, which produces a clean install
  with no gyp, leaves `better-sqlite3` unable to load.
- **`onnxruntime-node`'s postinstall downloads ~343 MB of CUDA providers on every Linux/x64
  install.** Reproduced here: a `pnpm deploy` died fetching them with `DEPTH_ZERO_SELF_SIGNED_CERT`.
  `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` is load-bearing, not tidiness.
- **This pnpm is 9.15.0, and that matters.** `inject-workspace-packages` and `--legacy` do not exist
  before pnpm 10 (0 occurrences in 9.15.0's published bundle, 37 in 10.0.0). `pnpm deploy` prints
  "Experimental!" in its own help.
- **The pnpm store cache mount silently no-ops without `PNPM_HOME`.** Verified: with no `PNPM_HOME`
  the store is at `/root/.local/share/pnpm/store/v3`; with `PNPM_HOME=/pnpm` it is `/pnpm/store/v3`.
  A `--mount=type=cache,target=/pnpm/store` without the env var caches nothing and reports no error.
- **The repository is private** (`gh api` reports `"visibility":"PRIVATE"`), so the GHCR package it
  publishes will be private too, and pulling it on the MeLE needs a `docker login`.
- **The SPA's path is not relocatable.** See ADR-0007; it is the reason the image keeps the
  workspace layout instead of using `pnpm deploy`.

## Design

### 1. The image

Two stages, both `node:26-bookworm-slim`. Node 26 because the owner asked for one version
everywhere, and because `better-sqlite3` compiles against the builder's Node — so the runtime major
must match the builder's, and matching the laptop's is the only choice that satisfies both.

**Builder** installs the toolchain (`python3 make g++`), pnpm via corepack with
`PNPM_HOME=/pnpm`, `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`, then `pnpm install --frozen-lockfile` and
`pnpm -r build`.

**Runtime** repeats a production install (`pnpm install --prod --frozen-lockfile`) against the same
manifests, purging the toolchain in the same layer so it never reaches a layer, then copies
`apps/api/dist`, `apps/web/dist`, `packages/*/dist` and `packages/db/drizzle` from the builder.

Two consequences worth stating because they look like mistakes:

1. **The runtime stage installs instead of copying `node_modules` from the builder.** Copying the
   builder's tree would ship `typescript`, `vite`, `vitest` and `playwright` in the published image.
   The cost is a second install and a throwaway toolchain.
2. **The toolchain appears in both stages.** `better-sqlite3` compiles in whichever stage installs
   it. In the runtime stage it is removed in the same `RUN`, so the final image has neither.

Then: `USER node` (uid 1000), `ENV NODE_ENV=production DATA_DIR=/data DATABASE_PATH=/data/homebox.db`.
Absolute data paths sidestep `env.ts`'s workspace-root walk entirely — `resolveDataPath` honours
absolute values, so the walk stops mattering the moment the vars are set. `VOLUME /data` and
`EXPOSE 3000`. `CMD ["node", "dist/index.js"]` with `WORKDIR /app/apps/api`.

The **healthcheck uses `node`**, because slim images ship neither `curl` nor `wget` (verified).

**Pruning, and where the pruning happens.** `onnxruntime-node` is 208 MB because it carries
darwin, win32 and linux/arm64 payloads that can never load on a single-arch amd64 image; removing
them takes it to 43 MB. `sharp` resolves its libvips by libc, so its musl copies are dead too —
another ~35 MB.

Two things about this are not obvious and both were learned the hard way:

1. **The deletions belong in the same `RUN` as the install, not a `RUN` of their own.** A file
   deleted in a later layer is still present in the earlier one, still downloaded by `docker pull`,
   and still counted in the image. Pruning in a separate layer measured **exactly the same image
   size**; moving it into the install layer took the image from 933 MB to 723 MB. Nothing about the
   container's filesystem looked different either way — only the bytes shipped.
2. **The guards earn their keep.** A `-maxdepth` that was one level short found no payload at all;
   the guard stopped the build and named itself, rather than shipping a silently fatter image.

**Measured size: 723 MB** (`docker images`), 681 MB of actual content, over a 246 MB base. My
earlier estimate of 400–450 MB in this spec was wrong — it was built from a smaller subset of
`node_modules` than the runtime actually installs, and it did not account for `onnxruntime-web`
(90 MB, the wasm backend `local.ts` asks for) or for `typescript` arriving as a production
dependency (23 MB). The number above is the measured one.

### 2. The release pipeline

Two workflows, no local hooks.

- **`ci.yml`** — on push to `main` and manual dispatch: install, build, `pnpm test`. Not the e2e
  suite: it needs the built app, a minted database and `DETECTION_MOCK=1`, which is a CI project of
  its own and would let a release be blocked by reasons unrelated to it.
- **`release.yml`** — on tag `v*`: the same install, build and **test** steps, then build and push
  `ghcr.io/grota/homebox-ng:vX.Y.Z` and `:latest` with `permissions: packages: write`.

**The release workflow runs the tests rather than checking that `main` was green.** A pre-push hook
was considered and rejected: it lives in `.git/hooks` (uncommitted, lost on re-clone), `--no-verify`
walks past it, it needs network and `gh` auth at exactly the wrong moment, and "the latest run" has
to mean *that commit's* run — push two commits and the check silently validates a SHA nobody tested.
Running the tests inside the publishing workflow inverts the property: it stops mattering when the
tag is pushed or what colour `main` was, because a red commit cannot produce an image.

**The tag is the version.** There is nothing to synchronise: all four packages are `private: true`,
none is published, and the root `package.json` has no `version` field. Drift needs two things both
claiming to be the version, and there is one. The tag is passed as a build argument.

### 3. The model cache — a live bug, fixed here

`createLocalProvider` never sets `env.cacheDir`, so the model lands inside `node_modules`. Two
consequences, one of which is already happening on the laptop:

- **The documented warm-up does nothing.** `pnpm --filter @homebox/api detection:model` writes to
  `$DATA_DIR/models/detection`; the server reads `node_modules/.../.cache`. The CLI's own comment —
  "the CLI puts the cache exactly where the server looks for it" — is false, and the Phase 6 spec's
  "Model downloaded on first use into `DATA_DIR/models/detection/`" is false for the server path.
- **In a container the model would live in the image's writable layer**, re-downloaded on every
  recreate and broken outright under a read-only rootfs. This is what makes the fix a prerequisite:
  the volume story only holds if the cache is actually in `DATA_DIR`.

**The fix removes the drift rather than correcting it once.** A new
`apps/api/src/modules/detection/model.ts` exports `DEFAULT_MODEL` and
`modelCacheDir(dataDir)`, and both `local.ts` and `scripts/detection-model.ts` import them.
`DEFAULT_MODEL` is currently duplicated in those two files (`local.ts:8`,
`detection-model.ts:15`) — the same shape of duplication that produced this bug, so the
consolidation is the point.

`buildApp` already receives `dataDir` and already passes settings to
`registerDetectionProviders` (`server.ts:47`); it threads `dataDir` through to
`createLocalProvider`, which sets `env.cacheDir` inside its existing lazy import — not at startup,
which would defeat the lazy import's reason for existing (`local.ts:15-17`).

**Acceptance:** after one detection, `$DATA_DIR/models/detection/` contains the model, and the
warm-up CLI makes the first detection work with no network.

### 4. The volume, the uid, and the boot-time write check

One volume, `/data`, holding the database, uploads and the model cache — they are all already under
`DATA_DIR`, and the Phase 6 backup feature archives from the same place.

The container runs as uid 1000 (`USER node`), which is `grota` on both machines, so a
`./data:/data` bind mount created by the owner just works.

**A boot-time check makes the failure legible**, because the failure it prevents is the one
inherited from the install being replaced: `~/selfhost/homebox/data` is currently **root-owned**,
because upstream homebox runs as root. Copy that habit and uid 1000 cannot write its own data
directory. The symptoms are `SQLITE_CANTOPEN` or an `EACCES` during a model download — neither
names the cause.

In `index.ts`, immediately after the existing `mkdirSync`, the app asserts it can write both to
`DATA_DIR` and to `DATABASE_PATH`'s parent, and on failure throws naming the uid, the path and the
`chown` that fixes it. It lives in the app rather than an entrypoint script so it also fires for
non-Docker users — anyone who once ran `sudo pnpm dev` has the same directory.

### 5. The version

One `ARG APP_VERSION` (defaulted so a local build does not break), feeding two places:

- **`/health`** returns it — `server.ts:27` already exists and already sits behind the compose-level
  healthcheck, so "which build is running?" is one line away.
- **The SPA** gets it through a `VITE_`-prefixed build argument, which Vite bakes in at build time.
  It renders as a single line on the Settings page — out of the way, and already the "about this
  instance" surface. Unset (local `pnpm dev`) renders as `dev` rather than an empty string.

### 6. What this phase does not ship

- **No `docker-compose.yml`.** The master spec's `## Deployment` section specified one; this phase
  declines it, because the deployment is the owner's and a shipped compose file that cannot use
  `~/selfhost/compose-snippets/` would be a second, diverging source of truth. The README carries a
  `docker run` example and the volume, uid, `docker login` and warm-up notes instead.
- **No GitHub issue.** The phase lives in this spec and ADR-0007.
- **No touching the MeLE.** No SSH, no compose file written there, no change to the running upstream
  container.
- **No data migration.** homebox-ng cannot read upstream homebox's database (different schema) and
  has no importer. Bringing the inventory across is a separate problem with a separate failure mode.

## Testing

- **The `modelCacheDir` fix** — a unit test on the shared helper, plus an image-level acceptance
  check that a detection leaves the model under `/data`. The `env.cacheDir` assignment itself sits
  behind the lazy import, which unit tests already stub via `deps.pipeline`; asserting the real value
  inside the image is the honest place for it.
- **The boot-time write check** — a unit test that a read-only data directory produces the named
  error rather than a downstream `SQLITE_CANTOPEN`.
- **The Dockerfile** — done, and the evidence is in this spec rather than promised: the image
  builds, boots as uid 1000, creates its database in a bind-mounted `/data` owned by the same uid,
  answers `/health` with the tag it was built from, serves the SPA including the client-side-route
  fallback, and answers tRPC; all four native modules load and `sharp` encodes a PNG. The
  pruning guards are exercised by the build. A read-only `/data` fails fast with the uid and the
  `chown` in the message. **Not yet exercised:** a real detection inside the container, because the
  local model has never been run anywhere (see `Open, deliberately`).
- **The workflows** — the first tag push is the test. YAML cannot be exercised locally, and this is
  stated rather than pretended otherwise.
- **Layout parity** — already covered by the existing e2e suite, which runs the built API from this
  exact tree (`playwright.config.ts`'s `webServer`). A broken layout fails there before it fails on
  the MeLE.

## What does NOT change

- **Nothing about the app's behaviour.** No path changes; the model-cache fix only changes *where*
  the cache lives, not what is fetched or how detection works.
- **`scripts/dev.sh`, `pnpm dev` and the e2e suite.** Untouched; the image is an addition.
- **`CONTEXT.md`.** Docker terms are not domain terms.
- **The MeLE.** See §6.

## Open, deliberately

- **Whether `onnxruntime-node`'s native payload is needed at runtime at all.** `local.ts` asks for
  `device: 'wasm'`; if inference genuinely runs on the wasm backend, the native libraries may be
  dead weight worth another ~180 MB. Untested, and untestable cheaply right now: the owner has only
  ever driven the Gemini provider and has not run the local model once. The experiment is to strip
  the native libraries and run a real detection. Deferred rather than guessed.
- **Node 26's LTS date.** Node 26 is *Current* until October 2026. The image pins the `26` major and
  takes patch updates; revisit the pin once it is LTS.
- **Baking the model into the image.** Rejected now (it would grow the image by hundreds of MB and
  re-download whenever `DETECTION_MODEL` changes), but it is the right answer the day offline-first
  provisioning matters.
- **`diun` watches GHCR and will report every new tag.** Whether to pin `HOMEBOX_NG_VERSION` instead
  of tracking `latest` is the owner's call and is not decided here.
- **Upgrading to pnpm 10** would restore `pnpm deploy`'s escape hatches. Not needed for this design
  (see ADR-0007), but it is the prerequisite if that decision is ever revisited.
