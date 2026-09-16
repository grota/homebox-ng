# syntax=docker/dockerfile:1.7

# The release image: one process serving the API and the built SPA, over a single
# `/data` volume. Design and evidence: `docs/superpowers/specs/2026-09-16-docker-packaging-design.md`.
#
# Two things here look like mistakes and are not. Both are explained where they
# happen, and the first is an ADR:
#
#   * The runtime stage keeps the *workspace layout* (`apps/api/dist` beside
#     `apps/web/dist`) instead of flattening with `pnpm deploy`. See ADR-0007.
#   * The runtime stage runs `pnpm install` rather than copying `node_modules`
#     from the builder, because the builder's tree also contains typescript,
#     vite, vitest and playwright.
#
# The `# syntax` line above must stay on line 1 — that is the only position Docker
# reads it in, and anywhere else it is ignored in silence, leaving the built-in
# frontend to run the file. That is how a `sharing=locked` cache mount first
# shipped here as a no-op.

# ── The pnpm store cache mount is SHARED BETWEEN TWO CONCURRENT STAGES ──────────
#
# BuildKit runs independent stages in parallel, and the builder and runtime stages
# are independent until the `COPY --from=builder` near the end. Both run
# `pnpm install` against the same cache mount. Two concurrent installs writing one
# content-addressable store is a data race, and it fails like this:
#
#     ERR_PNPM_ENOENT  ENOENT: no such file or directory, copyfile
#     '/pnpm/store/v3/files/01/daeb…' -> '…/formdata-polyfill_tmp_832/formdata.min.js'
#
# a store file the index still promises, gone. Measured on the first release run
# (gh run 35147094867): both installs started at 0.09s elapsed and the builder's
# died 43s later. It does not reproduce locally, where the stages happen to
# serialise — which is exactly why it reached CI.
#
# `sharing=locked` makes BuildKit take a per-cache-id lock for as long as a step
# has the mount, so the two installs take turns instead of racing. The store is
# still shared, so the second install copies from cache rather than re-downloading.
# Removing the lock, or giving the stages separate ids, are both worse: the first
# restores the race, the second throws away the reuse.

# ─── builder ────────────────────────────────────────────────────────────────────
FROM node:26-bookworm-slim AS builder

# A glibc base is not a preference: `onnxruntime-node` (under
# @huggingface/transformers, and therefore a hard runtime dependency) publishes no
# musl build and needs `ld-linux-x86-64.so.2` and `libc.so.6`. On Alpine it fails
# to dlopen. `sharp` and `argon2` would be fine on musl; this one package decides.
#
# Node 26 rather than an LTS because the version must match development and, more
# strictly, must match whatever compiles `better-sqlite3` — see the runtime stage.

# `corepack` is gone from Node 26's distribution, so pnpm comes from npm — and the
# version is read from `packageManager` rather than written out here, so there is
# one place to change it.
#
# `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` is load-bearing, not tidiness: that
# package's postinstall downloads ~343 MB of CUDA providers on every Linux/x64
# install, needs the network to do it, and fails the install when it cannot.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    ONNXRUNTIME_NODE_INSTALL_CUDA=skip

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

# `better-sqlite3` has no install script and bundles every prebuild, yet pnpm
# auto-runs `node-gyp rebuild` purely because its `binding.gyp` is present. So the
# C toolchain is required on Node 22 as much as 26, and `--ignore-scripts` is not
# an escape — that produces a clean install whose `better-sqlite3` cannot load.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked \
    set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends python3 make g++; \
    npm i -g "$(node -p 'require("./package.json").packageManager')"; \
    pnpm install --frozen-lockfile

COPY . .

# The tag, baked in at build time. `VITE_APP_VERSION` must be in the environment
# when Vite runs, which is why it is set here rather than in the runtime stage.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION

# `-r` walks the workspace in dependency order, which matters: `apps/web` resolves
# its tRPC types through `@homebox/api`'s built `dist/`, so the API must build
# first. Turbo would also work; this needs no config.
RUN pnpm -r build

# ─── runtime ────────────────────────────────────────────────────────────────────
FROM node:26-bookworm-slim AS runtime

# Re-declared here because a build argument does not cross a stage boundary. The
# builder's copy feeds `VITE_APP_VERSION` into the SPA at compile time; this one is
# what the running API reports from `/health`, and without it every release would
# claim to be `dev`.
ARG APP_VERSION=dev

# Same major as the builder, and that is a hard constraint rather than a
# preference: `better-sqlite3` is a native addon compiled against whatever Node
# installed it. Building on 26 and running on 22 is not available.
ENV APP_VERSION=$APP_VERSION \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    ONNXRUNTIME_NODE_INSTALL_CUDA=skip \
    NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DATABASE_PATH=/data/homebox.db

WORKDIR /app

# Manifests only. `apps/web` is deliberately absent: the runtime never runs the
# SPA, so installing its dependencies would ship React, Radix, Konva and
# filerobot-image-editor to serve a folder of static files. Leaving the manifest
# out also leaves those 70 packages out of the frozen-lockfile install, which
# still resolves cleanly — verified, not assumed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

# The toolchain appears again because `better-sqlite3` compiles in whichever stage
# installs it. It is purged in the same layer, so it never reaches a layer of its
# own and the published image has none of it.
#
# The two prunes in the middle trim platform payloads this single-arch glibc image
# can never load: `onnxruntime-node` also ships darwin, win32 and linux/arm64
# (208 MB, ~133 MB of it darwin + win32), and `sharp` resolves its libvips by libc,
# so the musl copies are dead here too (~35 MB).
#
# They run *here*, not in a RUN of their own, and that placement is the whole
# trick: a file deleted in a later layer is still in the earlier one, still
# downloaded on `docker pull`, and still counted in the image. Deleting it in the
# layer that created it is the only version that shrinks anything. Measured — a
# separate prune RUN left the image at exactly the same size.
#
# The guards are the second half. A silent upstream re-layout would leave the
# image merely fatter with nothing to say so; this fails the build instead, and
# already has: a `-maxdepth` one level short found nothing and stopped the build
# rather than shipping quietly.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked \
    set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends python3 make g++; \
    npm i -g "$(node -p 'require("./package.json").packageManager')"; \
    pnpm install --prod --frozen-lockfile; \
    pnpm store prune; \
    \
    for base in node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v3; do \
        [ -d "$base/linux/x64" ] || { echo "FATAL: onnxruntime-node's linux/x64 payload is not where this prune expects it — revisit" >&2; exit 1; }; \
        rm -rf "$base/linux/arm64" "$base/darwin" "$base/win32"; \
    done; \
    ls -d node_modules/.pnpm/@img+sharp-linux-x64@* >/dev/null || { echo "FATAL: @img/sharp-linux-x64 is missing — revisit this prune" >&2; exit 1; }; \
    rm -rf node_modules/.pnpm/@img+*musl*; \
    \
    apt-get purge -y --auto-remove python3 make g++; \
    rm -rf /var/lib/apt/lists/* /root/.npm

# The three build outputs, in the places the app's own relative paths expect:
#   apps/api/dist  → resolves the SPA at ../../web/dist
#   packages/db    → resolves migrations at ../drizzle
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/apps/web/dist apps/web/dist
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/db/drizzle packages/db/drizzle
COPY --from=builder /app/packages/shared/dist packages/shared/dist

# uid/gid 1000 — which is what the `node` user already is, and what `grota` is on
# both the development machine and the target. A `./data:/data` bind mount created
# by the owner is therefore writable with no `useradd` and no PUID.
RUN mkdir -p /data && chown node:node /data
USER node

VOLUME /data
EXPOSE 3000

# `node` rather than `curl`, because the slim image ships neither curl nor wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
