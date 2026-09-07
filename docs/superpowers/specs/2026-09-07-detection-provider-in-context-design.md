# Stop the detection registry being process-global — design

> Source: architecture review candidate #3 ("`in-process` · the seam is global mutable state, not the interface").

## Problem

`createItemsFromImage(ctx, source)` has an interface of `(ctx, source)` but reaches into **process-global mutable state** to get its provider:

```ts
// apps/api/src/modules/unpack/service.ts
const settings = getSettings(db)
const provider = detectionRegistry.get(settings.detectionProvider)
if (!provider) throw new DetectionProviderError('not-configured', ...)
```

So the unit tests mutate the global in `beforeEach` (`detectionRegistry.clear(); detectionRegistry.register(fakeProvider)` in `unpack.test.ts:22-23` and `drafts.test.ts:18-19`) and set `detectionProvider: 'fake' as never`. The seam under test is not the interface — it is global mutable state.

## Decisions (confirmed by grilling, 2026-09-07)

1. **Carry the resolved provider in `ctx` (`ctx.provider: DetectionProvider`).** This matches the review's "After" diagram (`runUnpack(ctx, source) → |ctx.provider| → DetectionProvider`) and makes `createItemsFromImage` a pure pipeline: it no longer reads settings, reaches the registry, or throws `not-configured`. Unit tests pass a fake provider directly in `ctx` — no global mutation, no `updateSettings`, no `'fake' as never`.
2. **A single `resolveDetectionProvider(db): DetectionProvider` helper owns the wiring.** It reads `getSettings(db).detectionProvider`, looks it up via `detectionRegistry`, and throws `DetectionProviderError('not-configured', ...)` when unknown. Both production callers (`route.ts`, `router.ts`) use it, so the `not-configured` error keeps one home (locality preserved) and is not duplicated.
3. **The global `detectionRegistry` survives as app-level DI.** `registerDetectionProviders` still populates it at startup; `resolveDetectionProvider` reads it. #3 only stops *the module and the unit tests* from reaching it. `test/detection.test.ts` (asserts registry contents) is unchanged.
4. **Scope is #3 only.** #4 (first-class `mock` in the provider enum + kill the `as never` casts across `packages/shared`/`packages/db`) is a separate phase and is NOT bundled here. The `'mock' as never` / `'fake' as never` casts remain for now.
5. **HTTP/e2e route tests are unaffected in spirit** — they keep using `buildApp` → `registerDetectionProviders` (DETECTION_MOCK=1); the route handlers now call `resolveDetectionProvider` first.

## Slice

`apps/api` source + `apps/api` tests only. No `packages/shared`, `packages/db`, or `apps/web` changes.

| File | Change |
|------|--------|
| `apps/api/src/modules/detection/resolve.ts` | **create** — `resolveDetectionProvider(db)` (settings → registry → `not-configured`) |
| `apps/api/src/modules/unpack/service.ts` | `UnpackContext` gains `provider: DetectionProvider`; drop the settings/registry/not-configured block and the `detectionRegistry` + `DetectionProviderError` imports |
| `apps/api/src/modules/unpack/route.ts` | call `resolveDetectionProvider(db)`, pass `provider` in `ctx` |
| `apps/api/src/modules/unpack/router.ts` | call `resolveDetectionProvider(ctx.db)`, pass `provider` in `ctx` |
| `apps/api/test/unpack.test.ts` | inject `provider` into `ctx`; drop the registry import + global mutation in `beforeEach` + the `updateSettings('fake' as never)` seed |
| `apps/api/test/drafts.test.ts` | inject `provider` into `ctx`; drop the registry import + global mutation |
| `apps/api/test/detection/test/…` | add a `resolveDetectionProvider` unit case (configured → provider; unknown → `not-configured`) |

## Non-goals

- Removing the global registry / moving to full DI container.
- Changing the `not-configured` HTTP status (remains an uncaught `DetectionProviderError` → 500, exactly as today).
- #4 — the provider-set single source of truth / `as never` deletion / `mock` first-class.
