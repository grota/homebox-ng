# Detection provider single source of truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the `DetectionProvider` name collision (api interface → `DetectionProviderImpl`), single-source the web admin radio onto `DETECTION_PROVIDERS`, and delete the dead `'mock' as never` cast in the route test. `mock` stays out of `DETECTION_PROVIDERS` so it is never a user-selectable provider.

**Architecture:** `packages/shared` keeps `DETECTION_PROVIDERS = ['local','google','openai']` as the single source for the settings-legal set. The api's provider-object interface is renamed `DetectionProviderImpl` so the shared name-type and the api interface no longer collide. The web radio iterates the shared const (no mock, no literal). The route test's redundant `'mock' as never` settings mutation is deleted because mock-mode already routes the default `'google'` to the mock provider.

**Spec:** `docs/superpowers/specs/2026-09-07-detection-provider-single-source-design.md`

## Global Constraints

- Monorepo build order `shared → db → api → web`. This change touches `apps/api` source + tests, and `apps/web` one file. `packages/shared` and `packages/db` are NOT changed.
- `DetectionProviderImpl` = the api provider-object type (`name: string` + `detectBoxes`). `DetectionProvider` (shared) = the name union and stays canonical. Keep `name: string` — do NOT narrow it to the union (would forbid `mock`).
- `mock` does NOT enter `DETECTION_PROVIDERS`; users (UI or API) must never be able to select it.
- The `detectionRegistry`, `registerDetectionProviders`, `DETECTION_MOCK` semantics, `detection.test.ts`, `drafts.test.ts`, and `resolve.test.ts` are unchanged.
- The `not-configured` guard in `resolveDetectionProvider` stays.
- Tests must pass: `pnpm --filter @homebox/api test` (Vitest), plus the web's TS build/typecheck for the web task. Commit messages end `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `apps/api/src/modules/detection/provider.ts` | rename | interface `DetectionProvider` → `DetectionProviderImpl`; registry `Map<string, DetectionProviderImpl>` + `register(p: DetectionProviderImpl)`; `name` stays `string` |
| `apps/api/src/modules/detection/local.ts` | rename | `import type { DetectionProviderImpl }` + return type |
| `apps/api/src/modules/detection/google.ts` | rename | `import type { DetectionProviderImpl }` + return type |
| `apps/api/src/modules/detection/openai.ts` | rename | `import type { DetectionProviderImpl }` + return type |
| `apps/api/src/modules/detection/mock.ts` | rename | `import type { DetectionBox, DetectionProviderImpl }` + return type |
| `apps/api/src/modules/detection/resolve.ts` | rename | `import type { DetectionProviderImpl }` + return type |
| `apps/api/src/modules/unpack/service.ts` | rename | `import type { DetectionProviderImpl }` + `UnpackContext.provider` |
| `apps/api/test/detection/bounds.test.ts` | rename | `import { DetectionBox, DetectionProviderImpl }` + `make: () => DetectionProviderImpl` |
| `apps/web/src/features/admin/AdminSettingsTab.tsx` | modify | iterate `DETECTION_PROVIDERS` (value import) instead of literal `['local','google','openai']`; keep `DetectionProvider` type for state |
| `apps/api/test/unpack.test.ts` | modify | delete line 110 `updateSettings(db, { detectionProvider: 'mock' as never })` + the now-unused `updateSettings` import at line 7 |

## Rulings on spec gaps (binding — conflicts resolve against these)

1. **The `name` field is NOT narrowed.** `DetectionProviderImpl.name` stays `string`. A provider registered under a name outside the settings set (e.g. the `mock` provider's `'mock'`) must still be a valid `DetectionProviderImpl`; narrowing to the union would forbid it. Single-source is enforced at the registration + UI layers, not the impl `name` literal.
2. **`register.ts` needs no change.** Its "rejects 'mock'" comment is still accurate under the final design: `mock` stays out of `DETECTION_PROVIDERS`, so `instanceSettings.update` still rejects it, and mock-mode still registers the mock under every real name to be self-sufficient. Do not touch `register.ts`.
3. **`resolve.ts` and `resolve.test.ts` are unchanged in behavior.** Only the return-type name changes to `DetectionProviderImpl` in `resolve.ts`. The `not-configured` guard stays; the `resolve.test.ts` assertion keeps asserting it.
4. **Web acceptance is a typecheck/build, not the api test.** The web file change is TS-only; verify it by running the web package's typecheck or build (`pnpm --filter @homebox/web …`) or `tsc` in that package. The api Vitest suite does not cover `apps/web`.
5. **Deleting `'mock' as never` requires removing the `updateSettings` import.** After deleting line 110, `updateSettings` (imported at line 7) is used nowhere else in `unpack.test.ts` — the unit `createItemsFromImage` describe does not use it. Remove the import to keep the file clean and `tsc` green.

---

## Tasks

### Task 1 — Rename the api interface `DetectionProvider` → `DetectionProviderImpl`

**Files:** detection/provider.ts, detection/local.ts, detection/google.ts, detection/openai.ts, detection/mock.ts, detection/resolve.ts, unpack/service.ts, test/detection/bounds.test.ts.

**Do:**
- In `apps/api/src/modules/detection/provider.ts`: rename `export interface DetectionProvider` → `export interface DetectionProviderImpl`; update the registry `private providers = new Map<string, DetectionProvider>()` → `Map<string, DetectionProviderImpl>()` and `register(p: DetectionProvider)` → `register(p: DetectionProviderImpl)`. Leave `name: string` and `DetectionBox` unchanged.
- In `local.ts`/`google.ts`/`openai.ts`/`mock.ts`: change the `import type { DetectionProvider } from './provider.js'` to `import type { DetectionProviderImpl } from './provider.js'` (mock.ts keeps `DetectionBox` alongside), and change each factory's return type annotation `: DetectionProvider` → `: DetectionProviderImpl` (local.ts:13, google.ts:19, openai.ts:12/21, mock.ts:14).
- In `detection/resolve.ts`: `import type { DetectionProvider } from './provider.js'` → `DetectionProviderImpl`; return type `: DetectionProvider` → `: DetectionProviderImpl`.
- In `unpack/service.ts`: `import type { DetectionProvider } from '../detection/provider.js'` → `DetectionProviderImpl`; `UnpackContext.provider: DetectionProvider` → `DetectionProviderImpl`.
- In `test/detection/bounds.test.ts`: `import type { DetectionBox, DetectionProvider } from '../../src/modules/detection/provider'` → `DetectionProviderImpl`; change `make: () => DetectionProvider` (the two occurrences at :83 and :95) → `make: () => DetectionProviderImpl`.
- Do NOT touch the shared `DetectionProvider` name type, `errors.ts`, `register.ts`, `route.ts`/`router.ts` (they infer the return type and name no interface symbol), or any `DetectionProviderError`.

**Acceptance:** `pnpm --filter @homebox/api test` green; `tsc -b` in apps/api clean; no api file imports the provider-object interface under the name `DetectionProvider` anymore; a repo grep shows the only `DetectionProvider` (interface) references gone, replaced by `DetectionProviderImpl`, while `DetectionProviderError` and any shared-name-type usage remain untouched.

- [ ]

### Task 2 — Single-source the web admin radio onto `DETECTION_PROVIDERS`

**Files:** apps/web/src/features/admin/AdminSettingsTab.tsx.

**Do:**
- Add `import { DETECTION_PROVIDERS } from '@homebox/shared'` (a *value* import; keep the existing `import type { DetectionProvider } from '@homebox/shared'` for the state type — or combine as `import { DETECTION_PROVIDERS, type DetectionProvider } from '@homebox/shared'`).
- Replace the literal `{(['local', 'google', 'openai'] as DetectionProvider[]).map((p) => (` at line 59 with `{DETECTION_PROVIDERS.map((p) => (` (the const is `readonly ('local'|'google'|'openai')[]`, and `p` is already the union, so no cast is needed).
- Remove nothing else; `setProvider(e.target.value as DetectionProvider)` at line 66 stays.

**Acceptance:** the web package typechecks/builds; the radio shows exactly the three providers `local` / `google` / `openai` (no `mock`); no literal `['local','google','openai']` remains in the file.

- [ ]

### Task 3 — Delete the dead `'mock' as never` cast in the route test

**Files:** apps/api/test/unpack.test.ts.

**Do:**
- Delete line 110: `updateSettings(db, { detectionProvider: 'mock' as never })`.
- Delete the now-unused import at line 7: `import { updateSettings } from '../src/modules/instanceSettings/service'`. (Verified: `updateSettings` is used nowhere else in the file; the unit `createItemsFromImage` describe does not use it.)
- Leave the `beforeAll` mock-mode fixture (line 79 `process.env.DETECTION_MOCK = '1'`) unchanged — the default `'google'` resolves to the mock provider, so the route tests still yield `detected: 2` + `chair`/`table`.

**Acceptance:** `pnpm --filter @homebox/api test` green; `tsc -b` clean; a grep for `as never` / `'mock'` in `unpack.test.ts` finds neither; the `unpack.run (item kind)` test still passes `detected: 2`.

- [ ]
