# Detection box-bounds invariant — design spec

**Date:** 2026-09-07 · **Branch:** `detection-in-bounds-guard` · **Supersedes:** Phase 6 plan constraint *"DetectionProvider interface is reused unchanged"* (`docs/superpowers/plans/2026-09-06-phase6-unpack-drafts-publish.md`).

## Problem

`DetectionProvider.detectBoxes(image)` declares no contract about coordinate space or bounds, yet the codebase depends on a box never driving `sharp.extract` out of the image. Today that invariant is enforced in two contradictory places and re-derived at the consumer:

- `google.ts` rescales normalized-to-1000 → real pixel dims **and** clamps (via its own `measure(image)`).
- `local.ts` / `openai.ts` clamp with `MAX_SAFE_INTEGER` — a **no-op**.
- `runUnpack` (`unpack/service.ts`) re-clamps on a **third** call site using its own `source.width/height`.

So no provider can be trusted on its own; the guarantee is split across the seam and the orchestrator, and tests named "clamps" only verify mapping, not the invariant.

## The decision (shared understanding, confirmed 2026-09-07)

1. **Contract.** `detectBoxes` *guarantees* every returned box lies within the decoded image bounds (pixel space, top-left origin). Providers enforce it; consumers trust it.

2. **Signature.** `detectBoxes(image: Buffer, bounds: { width: number; height: number })`. Bounds travel over the interface so the provider clamps against the **same dims the consumer consumes** (removes double-measurement and the drift risk between provider-measured dims and caller-used dims).

3. **`runUnpack`.** Delete the re-clamp line; keep the `.filter((b) => b.box.width > 0 && b.box.height > 0)` (0-area degenerate boxes still dropped — unrelated to clamping).

4. **`mock` provider.** Clamp its fixed boxes to the passed bounds so it honors the contract.

5. **Providers.**
   - `local.ts` / `openai.ts`: drop the `MAX_SAFE_INTEGER` no-op, clamp to the passed bounds.
   - `google.ts`: clamp to the passed bounds; remove its now-redundant internal `measure(image)` (the bounds now arrive over the interface).

6. **Tests.** Rewrite the provider tests that currently "claim" to clamp but don't, and add a focused test asserting the in-bounds invariant across providers — the test surface is the seam.

## What does NOT change

- `DetectionBox` shape stays `{ box: { x, y, width, height }, label, confidence }`.
- API keys read only from `process.env` (`GEMINI_API_KEY` / `OPENAI_API_KEY`), never from config or DB.
- The coordinate space for callers is unchanged (pixel boxes, top-left origin); they gain a guarantee, not a new format.
- `instance_settings.detectionProvider` values (`local`/`google`/`openai`/`mock`) are untouched.
