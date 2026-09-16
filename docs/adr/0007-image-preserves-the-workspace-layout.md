# ADR-0007: The image preserves the workspace layout; `pnpm deploy` is not used

**Status:** Accepted (2026-09-16). Answers the packaging half of the deployment
question deferred in `docs/superpowers/specs/2026-09-06-phase6-unpack-drafts-publish-design.md`.
Full design: `docs/superpowers/specs/2026-09-16-docker-packaging-design.md`.

## Context

The API is not relocatable. Two modules resolve a path by walking up from their
own location:

- `apps/api/src/index.ts:12` — `join(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')`
  resolves the built SPA. From `apps/api/{src,dist}/` that is `apps/web/dist`.
- `packages/db/src/migrate.ts:9` — `path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')`
  resolves the migrations folder. From `packages/db/dist/` that is `packages/db/drizzle`.

Both are the correct ESM idiom (`__dirname` does not exist in ESM) and both
work identically under `tsx` from `src/` and under `node` from `dist/`, which is
what the comment at `index.ts:9-11` is about. They are also an implicit contract
between packages that nothing type-checks: move `apps/web` and the failure is a
startup error naming a directory, with nothing pointing at the layout.

The obvious Dockerfile for a pnpm monorepo uses `pnpm deploy`, which exists to
solve exactly this shape of problem — one workspace package, self-contained,
with `workspace:*` dependencies materialised. Not using it needs a reason.

### The trap in the obvious answer

`pnpm deploy` produces a *flat* package: the API's entrypoint lands at
`<target>/dist/index.js`, not `<target>/apps/api/dist/index.js`. The SPA walk
`../../web/dist` then resolves to `<target>/../web/dist` — outside the deployed
tree. `@fastify/static` throws at registration on a root that does not exist, so
the container exits immediately with an `ENOENT` naming a path that appears
nowhere in the Dockerfile and never existed on the host. Nothing in the error
mentions `pnpm deploy`, the layout, or the coupling that broke.

That failure is survivable — the SPA could be copied to where the walk lands, or
the path made configurable. What makes it worth an ADR is that the same command
has three further costs, measured rather than assumed on 2026-09-16:

- **It re-runs lifecycle scripts in the target directory.** Observed:
  `sharp@0.34.5/node_modules/sharp install: sharp: Please add node-gyp to your dependencies`,
  failing the deploy outright. The build stage there had no `node-gyp`.
- **It copies sources and tests.** The deployed tree was 624 MB and contained
  `src/`, `test/`, `tsconfig.json` and `tsconfig.tsbuildinfo` alongside `dist/`.
- **It is not settled.** `pnpm deploy --help` on the pinned pnpm 9.15.0 prints
  **"Experimental!"**. `inject-workspace-packages` and `--legacy` — the escape
  hatches documented for the cases where it misbehaves — **do not exist before
  pnpm 10** (0 occurrences in 9.15.0's published bundle; 37 in 10.0.0). Adopting
  it here would mean adopting it with no way out short of a pnpm major upgrade.

## Decision

**The runtime image keeps the workspace's shape, and `pnpm install --prod`
populates it. `pnpm deploy` is not used.**

The runtime tree is:

```
/app/node_modules
/app/apps/api/dist        # node dist/index.js
/app/apps/web/dist        # resolved by ../../web/dist from apps/api/dist
/app/packages/db/{dist,drizzle}
/app/packages/shared/dist
```

1. **Production runs the layout development runs.** This is the reason, and it
   is not about `pnpm deploy`'s mechanics. `scripts/dev.sh` runs the built API
   from this exact tree, and so does the Playwright `webServer`. A flattened
   layout would mean production is the *only* place that layout is ever
   exercised, and nothing tests it.
2. **No code changes to accommodate the image.** The relative walks stay as they
   are, because the paths they compute remain correct.
3. **The layout is preserved by construction, not by remapping.** Nothing has to
   be moved into place afterwards, so there is no remapping step to get wrong.

## Consequences

### Alternatives rejected

- **`pnpm deploy`, with the SPA copied to `<target>/../web/dist`.** Fixes the
  symptom by encoding the deploy tool's directory shape into the Dockerfile. It
  leaves the lifecycle-script re-run, the 624 MB tree and the pre-`pnpm 10`
  escape-hatch problem untouched.
- **`pnpm deploy` plus a `WEB_DIST` environment override** so the SPA can live
  anywhere. This is the honest fix and it would work. Rejected because a knob
  nobody sets is an invitation for someone to set it and break the SPA in a way
  no test covers. If the app ever genuinely needs to be relocatable, this is the
  escape hatch, and it should arrive with a test that respects it.
- **Making `@homebox/web` a workspace dependency of the API** and resolving the
  bundle through its export map, which would remove the path walk entirely.
  Impossible as the graph stands: `apps/web` already depends on `@homebox/api`
  (its tRPC types resolve through the API's built `dist/`, see `CLAUDE.md`), so
  the reverse edge is a cycle and would break turbo's build ordering. Worth
  recording because it is the first thing a reader will think of.

### Accepted costs

- **The two couplings stay implicit.** TypeScript cannot check them and the
  TypeScript build will not catch a move. What catches it is the e2e suite, which
  runs the built API from this layout with a real browser — a broken layout fails
  locally, before it fails on the MeLE.
- **The image carries the SPA's build output although only the API process
  runs.** A few MB, and the price of one container serving both.
- **Moving `apps/web` or `packages/db/drizzle` becomes a breaking change for the
  runtime**, not a refactor. That was already true for `pnpm dev`; the image
  makes it true for anyone running the published artifact.

### When to revisit

- **If `pnpm deploy` leaves Experimental** (pnpm 10+ with
  `inject-workspace-packages`), re-measure the size and script-re-run costs. It
  still has to answer the layout-parity argument in `Decision.1` before it is
  worth adopting.
- **If a second consumer of the SPA appears** — a CDN, a separate web container,
  anything that means the bundle is no longer the API's sibling — the path stops
  being fixed, `WEB_DIST` earns its place, and this ADR is superseded.

## Related

- `docs/superpowers/specs/2026-09-16-docker-packaging-design.md` — the design
  this decision serves.
- `docs/superpowers/specs/2026-09-04-homebox-ng-design.md` — the master spec's
  `## Deployment` section, which specified a `docker-compose.yml` in the repo;
  the packaging spec declines to ship one, and records why.
- `docs/superpowers/specs/2026-09-06-phase6-unpack-drafts-publish-design.md` —
  named Docker as Phase 6, then deferred it out of that phase. This is the phase
  it was deferred to.
