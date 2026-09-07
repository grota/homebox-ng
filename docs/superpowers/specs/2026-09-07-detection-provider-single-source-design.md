# Detection provider single source of truth — design

> Source: architecture review candidate #4 ("one source of truth for detection providers") + the two final-review leftovers parked from candidate #3 (the `DetectionProvider` name collision; the `'mock' as never` dead cast).

## Problem

The detection-provider *name set* has a real single source — `DETECTION_PROVIDERS` in `packages/shared/src/settings.ts:43` (`['local','google','openai']`), which drives the `DetectionProvider` name type (line 44) and the settings zod enum (line 49). But two loose ends remain:

1. **Name collision.** `packages/shared` exports `DetectionProvider` (a *name* union), and `apps/api/src/modules/detection/provider.ts` exports `DetectionProvider` (a *provider object* interface with `detectBoxes`). Same symbol, two meanings.
2. **A dead `'mock' as never` cast.** `apps/api/test/unpack.test.ts:110` does `updateSettings(db, { detectionProvider: 'mock' as never })`. `'mock'` is not in `DETECTION_PROVIDERS` (it is deliberately a test/e2e fixture, not a user-settable provider), so the cast punches through the union. The line is **redundant**: in the mock-mode route suite, `beforeAll` sets `DETECTION_MOCK=1` (unpack.test.ts:79), `buildApp` → `registerDetectionProviders({ mock: true })` registers the mock provider under **every** `DETECTION_PROVIDERS` name (register.ts:27), so the default setting (`detectionProvider: 'google'`) already resolves to the mock provider. Deleting the line does not change the test's outcome and removes the cast with no API contract change.
3. **A duplicated user-facing list.** `apps/web/src/features/admin/AdminSettingsTab.tsx:59` hard-codes `['local','google','openai'] as DetectionProvider[]` instead of iterating `DETECTION_PROVIDERS` — the same three strings re-typed where the user chooses a provider.

## Decisions (confirmed by grilling, 2026-09-07)

1. **`mock` stays out of `DETECTION_PROVIDERS`.** It remains `['local','google','openai']`. Reasoning: `mock` must NOT be a real user-facing provider. If it were in the set, it would become a legal value of the settings zod enum → a user could select `detectionProvider: 'mock'` via the API (and the UI, if the list iterated the const), which is a leak of a test fixture into production. Keeping it out means a user can never select `mock` — not in the UI, not via the API (`instanceSettings.update` rejects it). `mock` stays a test/e2e fixture, registered only under `DETECTION_MOCK=1`, exactly as today.
2. **Delete the dead `'mock' as never` line** at `unpack.test.ts:110` (and its now-unused `updateSettings` import at line 7). The route suite's mock-mode fixture makes the default `'google'` resolve to mock, so no settings mutation is needed.
3. **Single-source the web radio** onto `DETECTION_PROVIDERS`. Since `mock` is not in the set, iterating the const shows exactly the three real providers — no filter needed.
4. **Resolve the name collision by renaming the api interface** `DetectionProvider` → `DetectionProviderImpl`. The shared `DetectionProvider` (name type) stays canonical. This is the collision's concrete form; api-side references to the provider-object type become `DetectionProviderImpl`.
5. **The interface `name` field stays `string`** — do NOT narrow it to the shared `DetectionProvider` union. A `DetectionProviderImpl` can legitimately be a provider outside the settings set (e.g. `mock`, whose name `'mock'` is not in the union). Narrowing would forbid `mock` from being registered as a provider. Single-source is instead enforced at the registration and UI layers (register.ts iterates `DETECTION_PROVIDERS` in mock mode; the web radio iterates `DETECTION_PROVIDERS`), not by constraining each implementation's `name` literal.
6. **Keep the `not-configured` guard** in `resolveDetectionProvider`. It is unreachable-after-this-change for any valid settings value (every `DETECTION_PROVIDERS` name is registered in both modes), but it is an invariant guard: it converts a would-be `undefined.detectBoxes` crash into a clean 500 with a message, and it is unit-covered at `resolve.test.ts`. The "additive not-configured→500 route test" final-review leftover stays parked (nothing to test for a branch that cannot fire through the running app).
7. **`DETECTION_MOCK=1` semantics unchanged** — register the mock provider under its own name and under every `DETECTION_PROVIDERS` name, so mock mode is self-sufficient regardless of the persisted setting.

## Slice

`packages/shared` (no change — the const stays as-is), `apps/api` source + tests, `apps/web` one file. No `packages/db` change (its column `enum` is decorative drizzle metadata that SQLite does not enforce; importing shared into db adds a new db→shared dependency + build-order coupling for a cosmetic hint — not justified).

| File | Change |
|------|--------|
| `apps/api/src/modules/detection/provider.ts` | rename interface `DetectionProvider` → `DetectionProviderImpl`; update registry `Map<string, DetectionProviderImpl>` + `register(p: DetectionProviderImpl)`; keep `name: string` |
| `apps/api/src/modules/detection/local.ts` | import + return type → `DetectionProviderImpl` |
| `apps/api/src/modules/detection/google.ts` | import + return type → `DetectionProviderImpl` |
| `apps/api/src/modules/detection/openai.ts` | import + return type → `DetectionProviderImpl` |
| `apps/api/src/modules/detection/mock.ts` | import `DetectionProviderImpl` (keep `DetectionBox`) + return type |
| `apps/api/src/modules/detection/resolve.ts` | import + return type → `DetectionProviderImpl` |
| `apps/api/src/modules/unpack/service.ts` | import + `UnpackContext.provider` → `DetectionProviderImpl` |
| `apps/api/test/detection/bounds.test.ts` | import `DetectionProviderImpl` (keep `DetectionBox`); `make: () => DetectionProviderImpl` |
| `apps/web/src/features/admin/AdminSettingsTab.tsx` | iterate `DETECTION_PROVIDERS` (value import) instead of the literal `['local','google','openai']`; keep `DetectionProvider` type for state |
| `apps/api/test/unpack.test.ts` | delete line 110 (`'mock' as never`) + the now-unused `updateSettings` import at line 7 |

## Non-goals

- Putting `mock` in `DETECTION_PROVIDERS` / making it user-selectable (this is the bug we are avoiding).
- Narrowing `DetectionProviderImpl.name` to the settings union (would forbid `mock`).
- Removing the `not-configured` guard in `resolveDetectionProvider` (kept as an invariant check).
- Changing `DETECTION_MOCK` semantics, `detection.test.ts`, `drafts.test.ts`, or the `detectionRegistry` shape.
- Making `packages/db` depend on `@homebox/shared`.
- The `not-configured` code-split (credential-missing vs name-not-registered) — pre-existing, parked.
