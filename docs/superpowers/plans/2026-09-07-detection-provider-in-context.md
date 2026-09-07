# Detection provider in context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `createItemsFromImage` reaching into process-global registry state. Carry the resolved `DetectionProvider` in `ctx` so the seam is the interface (a test double is just an adapter injected in `ctx`), and the module stops reading settings / reaching the registry / throwing `not-configured`. A single `resolveDetectionProvider(db)` helper owns that wiring for both production callers.

**Architecture:** `createItemsFromImage(ctx, { path, itemTypeId })` where `ctx = { db, dataDir, userId, provider }`. The module is now a pure pipeline — it does NOT read `getSettings`, reach `detectionRegistry`, or throw `DetectionProviderError`. Callers (`route.ts`, `router.ts`) call `resolveDetectionProvider(db)` to get the configured provider and pass it in `ctx`. Unit tests inject a fake provider directly in `ctx` — no global mutation, no `updateSettings('fake' as never)`, no `'fake' as never`.

**Spec:** `docs/superpowers/specs/2026-09-07-detection-provider-in-context-design.md`

## Global Constraints

- Monorepo build order `shared → db → api → web`; this change is `apps/api` source + `apps/api` tests only — no shared/db/web edits.
- `UnpackContext = { db; dataDir; userId; provider: DetectionProvider }`. `UnpackSource`/`UnpackResult` unchanged.
- The module imports NO registry/getSettings/DetectionProviderError anymore; it imports only `type DetectionProvider`.
- New `resolveDetectionProvider(db): DetectionProvider` in `apps/api/src/modules/detection/resolve.ts` (settings → registry → `not-configured`). Every production caller uses it.
- The global `detectionRegistry` survives (register at startup, read inside `resolveDetectionProvider`). `test/detection.test.ts` unchanged. `not-configured` HTTP status unchanged (uncaught → 500, as today).
- Scope is #3 only: do NOT touch `packages/shared`, `packages/db`, or the `as never` casts in the route tests.
- Tests must pass: `pnpm --filter @homebox/api test` (Vitest). Commit messages end `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `apps/api/src/modules/detection/resolve.ts` | create | `resolveDetectionProvider(db)` — `getSettings(db).detectionProvider` → `detectionRegistry.get` → `DetectionProviderError('not-configured')` fallback |
| `apps/api/src/modules/unpack/service.ts` | modify | add `provider` to `UnpackContext`; delete settings/registry/not-configured block + those imports (keep `type DetectionProvider`) |
| `apps/api/src/modules/unpack/route.ts` | modify | call `resolveDetectionProvider(db)`, pass `provider` in `ctx` |
| `apps/api/src/modules/unpack/router.ts` | modify | call `resolveDetectionProvider(ctx.db)`, pass `provider` in `ctx` |
| `apps/api/test/unpack.test.ts` | modify | inject `provider` in `ctx`; drop registry import + global mutate + `updateSettings('fake' as never)` from unit `seed` |
| `apps/api/test/drafts.test.ts` | modify | inject `provider` in `ctx`; drop registry import + global mutate + `updateSettings` |
| `apps/api/test/detection/resolve.test.ts` | create | unit case: configured → provider; unregistered → `not-configured` |

## Rulings on spec gaps (binding — conflicts in the plan/text resolve against these)

1. **`resolveDetectionProvider` lives in a new `detection/resolve.ts`**, not `provider.ts` — the wiring helper is a distinct concern from the interface/registry singleton. It imports `getSettings` (instanceSettings/service) → no cycle (nothing in instanceSettings imports detection).
2. **`not-configured` stays where the wiring is.** Callers call `resolveDetectionProvider` INSIDE their existing `try` (route.ts:49-55 / router.ts:21-29), so a `DetectionProviderError` propagates to the same 500 as today — the routes only translate `UnpackError`.
3. **Real enum names, no casts, in the resolve test.** Use `detectionRegistry.register({ name: 'google', ... })` + `updateSettings({ detectionProvider: 'google' })` for the happy path and `detectionRegistry.clear()` + `{ detectionProvider: 'local' }` for the not-configured path. Neither needs `as never` (both are valid enum values). The mocked/unregistered names in the module unit tests keep `'fake' as never` only where the route/HTTP suite still needs it.
4. **`drafts.test.ts` drops its `updateSettings` import** (only used for the removed seed line); `unpack.test.ts` KEEPS it (the route suite at line 114 uses `'mock' as never`).

---

## Tasks

### Task 1 — Plumb `ctx.provider` + `resolveDetectionProvider` + callers + existing tests

**Files:** detection/resolve.ts (new), unpack/service.ts, unpack/route.ts, unpack/router.ts, test/unpack.test.ts, test/drafts.test.ts.

**Do:**
- Create `apps/api/src/modules/detection/resolve.ts` exporting:
  ```ts
  import type { DrizzleDb } from '@homebox/db'
  import { getSettings } from '../instanceSettings/service.js'
  import { detectionRegistry } from './provider.js'
  import { DetectionProviderError } from './errors.js'
  import type { DetectionProvider } from './provider.js'

  export const resolveDetectionProvider = (db: DrizzleDb): DetectionProvider => {
    const { detectionProvider } = getSettings(db)
    const provider = detectionRegistry.get(detectionProvider)
    if (!provider) throw new DetectionProviderError('not-configured', `no detection provider named '${detectionProvider}'`)
    return provider
  }
  ```
- `service.ts`: change `UnpackContext` to add `provider: DetectionProvider`; in `createItemsFromImage` destructure `{ db, dataDir, userId, provider }` and delete the settings/registry/not-configured block (the `getSettings` + `detectionRegistry.get` + `if (!provider) throw` lines). Imports: remove `getSettings`, `detectionRegistry`, `DetectionProviderError`; add `import type { DetectionProvider } from '../detection/provider.js'` (keep `Metadata`, `DrizzleDb`, `UnpackError`, `createItem`, `insertImage`, sharp).
- `route.ts`: add `import { resolveDetectionProvider } from '../detection/resolve.js'`; inside the request handler's try, before the `createItemsFromImage` call, `const provider = resolveDetectionProvider(db)` and pass `provider` in the ctx object (keep the `UnpackError` → 400 catch; leave `DetectionProviderError` uncaught → 500).
- `router.ts`: add the same import; inside the mutation try, `const provider = resolveDetectionProvider(ctx.db)` and pass `provider` in the ctx object.
- `test/unpack.test.ts`: remove the `detectionRegistry` import; add a `const noBoxProvider = { name: 'fake', detectBoxes: async () => [] }`; in the unit `describe` beforeEach, drop the two registry lines (keep `dataDir = mkdtempSync(...)`); drop the `updateSettings(... 'fake' as never)` line from the unit `seed` (keep the import — the route suite uses it); in the 3 unit `createItemsFromImage` calls pass `provider: fakeProvider` (or `provider: noBoxProvider` in the no-box test, removing its `detectionRegistry.clear()/register(...)` lines).
- `test/drafts.test.ts`: remove the `detectionRegistry` import AND the `updateSettings` import; add a module-level `const fakeProvider = { name: 'fake', detectBoxes: async () => [{ label: 'cup', confidence: 1, box: { x: 5, y: 5, width: 50, height: 50 } }] }`; in `setup()` drop both registry lines and the `updateSettings(...)` line; in the 4 `createItemsFromImage` calls pass `provider: fakeProvider`.

**Acceptance:** `pnpm --filter @homebox/api test` green; no `detectionRegistry` import remains in `unpack/service.ts`, `unpack.test.ts`, or `drafts.test.ts`; every `createItemsFromImage` call site passes `provider`; `tsc` clean.

- [ ]

### Task 2 — Cover `resolveDetectionProvider`

**Files:** test/detection/resolve.test.ts.

**Do:** Create a Vitest file (`apps/api/test/detection/resolve.test.ts`) with a no-registry-mutation, cast-free unit case:
- Happy path: `detectionRegistry.clear(); detectionRegistry.register({ name: 'google', detectBoxes: async () => [] })`; `const db = createDb(':memory:'); runMigrations(db); updateSettings(db, { detectionProvider: 'google' })`; `expect(resolveDetectionProvider(db)).toBe(thatProvider)`.
- Not-configured: `detectionRegistry.clear()` (register nothing); fresh db + `updateSettings(db, { detectionProvider: 'local' })`; `await expect(resolveDetectionProvider(db)).rejects.toMatchObject({ code: 'not-configured' })` (or assert it throws `DetectionProviderError`).
- Use real enum names ('google'/'local') so no `as never` cast is needed. Import `detectionRegistry`, `resolveDetectionProvider`, `updateSettings`, `createDb`, `runMigrations`.

**Acceptance:** the new test passes as part of `pnpm --filter @homebox/api test`; no `as never` in the new file.

- [ ]
