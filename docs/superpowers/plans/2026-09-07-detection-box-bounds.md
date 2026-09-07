# Detection box-bounds invariant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push the "a detected box is always in-bounds" invariant behind the `DetectionProvider` seam, so consumers trust the result instead of re-clamping. Change the interface to accept image bounds, make every provider (and `mock`) enforce them, and drop the consumer-side re-clamp.

**Architecture:** `detectBoxes(image, { width, height })` coordinates the width/height space the box is expressed in and guarantees each returned box is within it. `runUnpack` passes `source.width/height` and stops re-clamping. Real providers clamp to the passed bounds; `mock` clamps its fixed boxes.

**Spec:** `docs/superpowers/specs/2026-09-07-detection-box-bounds-design.md`

## Global Constraints

- **This spec supersedes** the Phase 6 plan constraint *"DetectionProvider interface is reused unchanged"*. The signature change is the point of the refactor.
- Monorepo build order `shared → db → api → web`; this change is `apps/api`-source + `apps/api` tests only — no shared/db/web edits.
- `DetectionBox` shape unchanged: `{ box: { x, y, width, height }, label, confidence }`.
- API keys read only from `process.env` (`GEMINI_API_KEY` / `OPENAI_API_KEY`), never from config or DB.
- No change to `instance_settings.detectionProvider` values or their meaning.
- Tests must pass: `pnpm --filter @homebox/api test` (Vitest). Commit messages end `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `apps/api/src/modules/detection/provider.ts` | modify | `detectBoxes(image, bounds)` signature; document the in-bounds guarantee |
| `apps/api/src/modules/detection/local.ts` | modify | clamp to `bounds` (drop `MAX_SAFE_INTEGER`) |
| `apps/api/src/modules/detection/openai.ts` | modify | clamp to `bounds` (drop `MAX_SAFE_INTEGER`) |
| `apps/api/src/modules/detection/google.ts` | modify | clamp to `bounds`; remove internal `measure` |
| `apps/api/src/modules/detection/mock.ts` | modify | clamp fixed boxes to `bounds` |
| `apps/api/src/modules/unpack/service.ts` | modify | pass bounds; delete re-clamp; keep `.filter` |
| `apps/api/test/localProvider.test.ts` | modify | new signature; assert in-bounds |
| `apps/api/test/openaiProvider.test.ts` | modify | new signature; assert in-bounds |
| `apps/api/test/googleProvider.test.ts` | modify | new signature; assert in-bounds |
| `apps/api/test/unpack.test.ts` | modify | new signature in fakes |
| `apps/api/test/drafts.test.ts` | modify | new signature in fake |
| `apps/api/test/detection/bounds.test.ts` | create | cross-provider in-bounds invariant test |

## Rulings on spec gaps (binding — conflicts in the plan/text resolve against these)

1. **Interface change supersedes Phase 6.** The old plan mandated the interface stay `detectBoxes(image: Buffer)`. That constraint is intentionally reversed; consumers and tests migrate with the signature.
2. **`bounds` is required, not optional.** The in-bounds guarantee is meaningless without the space to clamp against. No optionality or overloads.
3. **Zero-width/height (degenerate) boxes are dropped by the consumer.** A box fully outside the image clamps to a 0-area box at the edge; that is still "in-bounds," but `runUnpack` keeps `.filter((b) => b.box.width > 0 && b.box.height > 0)` so it never becomes a crop.

---

## Tasks

### Task 1 — Migrate the detection seam and its consumers

**Files:** provider.ts, local.ts, openai.ts, google.ts, mock.ts, unpack/service.ts, and the affected tests (localProvider, openaiProvider, googleProvider, unpack, drafts).

**Do:**
- Change `DetectionProvider.detectBoxes(image: Buffer, bounds: { width: number; height: number }): Promise<DetectionBox[]>` and add a comment documenting the in-bounds guarantee.
- `local.ts`/`openai.ts`: clamp to `bounds.width/height` (remove the `MAX_SAFE_INTEGER` no-op).
- `google.ts`: clamp to `bounds`; delete the now-redundant `measure` dependency and its `sharp` metadata call.
- `mock.ts`: clamp its fixed boxes to `bounds`.
- `unpack/service.ts`: pass `{ width: source.width, height: source.height }` to `detectBoxes`; delete the `.map(... clampBox ...)` re-clamp; keep `.filter((b) => b.box.width > 0 && b.box.height > 0)`.
- Update every test that calls `detectBoxes` so it compiles and asserts the new behavior. For the provider tests that previously verified "no clamp," invert them to assert the box is in-bounds relative to the passed bounds.

**Acceptance:** `pnpm --filter @homebox/api test` green; the detection + unpack suites pass; no `MAX_SAFE_INTEGER` clamp remains.

- [ ]

### Task 2 — Prove the invariant at the seam

**Files:** new `apps/api/test/detection/bounds.test.ts`.

**Do:** Add a focused test that, for each provider (local, openai, google, mock) with a known image size, asserts every returned box has `x >= 0 && y >= 0 && x + width <= b.width && y + height <= b.height`. This is the "interface is the test surface" proof — the contract, tested through the interface.

**Acceptance:** the new test passes and runs as part of `pnpm --filter @homebox/api test`.

- [ ]
