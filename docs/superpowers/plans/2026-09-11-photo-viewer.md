# Photo Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every photo thumbnail in the app opens the full photo in a full-viewport overlay — fitted to the viewport first, 1:1 on click, drag to pan, wheel/pinch to zoom, arrow keys to pan, a navigator when the image overflows, and a click on the backdrop to dismiss.

**Architecture:** `Modal` gains `size?: 'md' | 'full'` whose default renders today's box byte-identically, so the dialog behaviour stays pinned where it is tested. The zoom/pan arithmetic moves into a pure module (`src/ui/zoom.ts`) with a plain function interface and its own unit tests — it is the only real logic in the feature, and none of it needs React. `PhotoViewer` is a `ui/` primitive composing `Modal size="full"`, and three call sites mount it: the item detail card, the drafts row, and the catalog card.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4 (CSS-first config), tRPC v11, Vitest 4 + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-11-photo-viewer-and-bulk-discard-design.md` §2 and §3
**Decision record:** `docs/adr/0002-modal-full-viewport-variant.md`

## Global Constraints

- **No new dependency.** There is no zoom/pan/lightbox library in `apps/web/package.json` or the lockfile and none is being added. Wheel, pinch, drag, and the navigator are hand-rolled on pointer events, `WheelEvent` and `getBoundingClientRect`.
- **The existing tests pass with no assertion edited.** Adding tests is expected. `apps/web/test/modal.test.tsx` in particular must pass **unmodified** — those five tests are the evidence that `size` defaulted to `'md'`; if the full-variant work shifts the default box, they fail.
  - **One exception, and it is a deletion, not an edit:** `apps/web/test/itemDetail.test.tsx:118-124` asserts the per-photo `View` anchor, which the spec removes. Its subject is going away, so the test goes with it (Task 7), and two tests for the thumbnail that replaces it are added. No other existing assertion is touched.
- **`Modal`'s `size="md"` behaviour is unchanged**, class string included — the `md` branch emits the exact string the primitive emits today.
- **Real element semantics and accessible names.** The image is an `<img>` with alt text; every new control is a real `<button>` or `<a>` with an accessible name; no interactive element is nested inside another (which is why the catalog card splits rather than nesting a button in the anchor).
- **No new colour tokens.** Surfaces use the existing semantic tokens; the one thing that cannot (`the navigator's outline`) is painted colour-agnostically instead.
- **Every command runs from the repo root.**

## File Structure

**Create:**
- `apps/web/src/ui/zoom.ts` — the pure zoom/pan geometry
- `apps/web/src/ui/PhotoViewer.tsx` — the viewer, plus its navigator
- `apps/web/test/zoom.test.ts`
- `apps/web/test/photoViewer.test.tsx`

**Modify:**
- `apps/web/src/ui/Modal.tsx` — the `size` variant (Task 1)
- `apps/web/src/ui/index.ts` — export `PhotoViewer` (Task 3)
- `apps/web/src/features/items/ItemDetail.tsx` — thumbnail opens the viewer; the `View` anchor goes (Task 7)
- `apps/web/src/features/drafts/DraftsPage.tsx` — row thumbnail opens the viewer (Task 8)
- `apps/web/src/features/items/ItemsPage.tsx` — the card splits into an image button and a name link (Task 9)
- `apps/web/test/modal.test.tsx`, `itemDetail.test.tsx`, `drafts.test.tsx`, `catalog.test.tsx` — new tests (Tasks 1, 7, 8, 9)
- `apps/web/e2e/00-catalog.spec.ts` — one real-browser leg (Task 10)

---

### Task 1: `Modal` gains `size`

**Files:**
- Modify: `apps/web/src/ui/Modal.tsx:4-9,25-26`
- Test: `apps/web/test/modal.test.tsx` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `Modal({ open, onOpenChange, title, size?: 'md' | 'full', children })`. The default is `'md'`. `size="full"` is consumed by `PhotoViewer` in Task 3.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('Modal', ...)` block in `apps/web/test/modal.test.tsx` (after the last test, before the closing `})`):

```tsx
  // The viewer's surface: edge to edge, no box chrome, and `overflow-hidden`
  // rather than `overflow-auto` — a pan surface must not scroll (ADR-0002).
  it('renders the full size as a bare full-viewport surface', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Photo" size="full">
        <p>Photo</p>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Photo' })
    expect(dialog).toHaveClass('fixed', 'inset-0', 'overflow-hidden')
    expect(dialog.className).not.toMatch(/rounded-lg|border-border|max-h-\[92vh\]|overflow-auto|w-\[min/)
  })

  // The default is the contract ADR-0002 bought: every existing Modal keeps the
  // box it has always rendered. `size` is omitted here on purpose — passing
  // `size="md"` would test the branch, not the default.
  it('defaults to the medium box', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Photo">
        <p>Photo</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Photo' })).toHaveClass(
      'w-[min(92vw,64rem)]',
      'max-h-[92vh]',
      'overflow-auto',
      'rounded-lg',
      'border-border',
      'p-4',
    )
  })
```

Do not change any line above them.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @homebox/web test modal
```

Expected: FAIL, 1 failure — `expect(element).toHaveClass("inset-0")` for the full size, because the prop is ignored and the `md` box renders for both. The default-box test passes already, which is its whole job: it pins the behaviour the change must not disturb. (Vitest does not typecheck, so the not-yet-existing prop is not what stops it.)

- [ ] **Step 3: Give `Modal` the two boxes**

In `apps/web/src/ui/Modal.tsx`, replace the `ModalProps` type:

```tsx
// The two geometries Modal serves. `md` is the box this primitive has always
// rendered, kept as one string so the default cannot drift; `full` is the
// viewer's — edge to edge, no radius/border/padding, and `overflow-hidden`
// rather than `overflow-auto` because a pan surface must not scroll (ADR-0002).
const boxes = {
  md: 'fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[min(92vw,64rem)] max-h-[92vh] overflow-auto rounded-lg border border-border bg-surface p-4 shadow-lg',
  full: 'fixed inset-0 z-[101] overflow-hidden',
} as const

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  // `keyof typeof boxes` is exactly `'md' | 'full'` and cannot drift from the
  // table above.
  size?: keyof typeof boxes
  children: ReactNode
}
```

Then change the signature and the Content className:

```tsx
export function Modal({ open, onOpenChange, title, size = 'md', children }: ModalProps) {
```

and, on `<Dialog.Content>`:

```tsx
          className={boxes[size]}
```

Delete the old inline `className` string. `full` deliberately carries no background of its own: the viewer's container is the backdrop it paints, and the overlay behind a full-viewport content is invisible anyway.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/web test modal
```

Expected: PASS, 7 tests — the 5 that were already there, unmodified, plus the 2 new ones.

- [ ] **Step 5: Confirm nothing else that uses `Modal` moved**

```bash
pnpm --filter @homebox/web test && pnpm -r typecheck
```

Expected: PASS, all suites; typecheck clean. `PhotoEditor` is the only other consumer and it passes no `size`, so it renders the `md` string it rendered before.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/Modal.tsx apps/web/test/modal.test.tsx
git commit -m "feat(web): add a full-viewport size to Modal"
```

---

### Task 2: The zoom/pan geometry, as a pure module

This is the whole of the feature's logic: fit-vs-natural, pan clamping, zoom-about-a-point, and the visible-region rectangle the navigator outlines. It lives outside React because none of it needs a component to be tested.

**Files:**
- Create: `apps/web/src/ui/zoom.ts`
- Test: `apps/web/test/zoom.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all from `../src/ui/zoom`:
  - types `Size = { width: number; height: number }`, `Point = { x: number; y: number }`, `Transform = { scale: number; x: number; y: number }`, `Rect = { x, y, width, height }`
  - `KEY_PAN_STEP: number` — viewport pixels per arrow-key press
  - `fitScale(natural: Size, viewport: Size): number`
  - `initialView(natural: Size, viewport: Size): Transform`
  - `panBy(natural: Size, viewport: Size, t: Transform, dx: number, dy: number): Transform`
  - `zoomAt(natural: Size, viewport: Size, t: Transform, factor: number, at: Point): Transform`
  - `toggleZoom(natural: Size, viewport: Size, t: Transform): Transform`
  - `overflows(natural: Size, viewport: Size, scale: number): boolean`
  - `visibleRect(natural: Size, viewport: Size, t: Transform): Rect`
  - `centerOn(natural: Size, viewport: Size, t: Transform, at: Point): Transform`
  - `containedRect(natural: Size, box: Size): Rect`

The coordinate system, fixed here and used by every function: the image is drawn at `natural * scale` pixels with its top-left corner at `(t.x, t.y)` in viewport pixels — CSS `translate(t.x, t.y) scale(t.scale)` with `transform-origin: 0 0`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/zoom.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  centerOn,
  containedRect,
  fitScale,
  initialView,
  overflows,
  panBy,
  toggleZoom,
  visibleRect,
  zoomAt,
} from '../src/ui/zoom'

const LARGE = { width: 4000, height: 3000 }
const SMALL = { width: 400, height: 300 }
const VIEWPORT = { width: 800, height: 600 }
const EXTREME = { width: 4000, height: 100 }

type Box = { x: number; y: number; width: number; height: number }

// Field-by-field: the fit and centring arithmetic legitimately lands one ULP
// away from the round number (800 / 0.2 is not exactly 4000).
const expectBox = (actual: Box, expected: Box) => {
  expect(actual.x).toBeCloseTo(expected.x)
  expect(actual.y).toBeCloseTo(expected.y)
  expect(actual.width).toBeCloseTo(expected.width)
  expect(actual.height).toBeCloseTo(expected.height)
}

describe('fitScale', () => {
  it('is the tighter of the two axes for an image larger than the viewport', () => {
    expect(fitScale(LARGE, VIEWPORT)).toBeCloseTo(0.2)
  })

  it('never upscales an image that already fits', () => {
    expect(fitScale(SMALL, VIEWPORT)).toBe(1)
  })

  it('satisfies the narrower axis for an extreme aspect ratio', () => {
    // A panorama fits to a thin strip. That is the specified opening view, not a
    // bug: see the spec's "To validate in use".
    expect(fitScale(EXTREME, VIEWPORT)).toBeCloseTo(0.2)
  })

  it('returns 1 rather than dividing by zero for an unmeasured image', () => {
    expect(fitScale({ width: 0, height: 0 }, VIEWPORT)).toBe(1)
  })
})

describe('initialView', () => {
  it('fits and centres an image larger than the viewport', () => {
    const t = initialView(LARGE, VIEWPORT)
    expect(t.scale).toBeCloseTo(0.2)
    expect(t.x).toBeCloseTo(0)
    expect(t.y).toBeCloseTo(0)
  })

  it('centres an image that fits at natural size', () => {
    const t = initialView(SMALL, VIEWPORT)
    expect(t.scale).toBe(1)
    expect(t.x).toBeCloseTo(200)
    expect(t.y).toBeCloseTo(150)
  })

  it('letterboxes an axis the fitted image does not fill', () => {
    const t = initialView(EXTREME, VIEWPORT)
    expect(t.scale).toBeCloseTo(0.2)
    expect(t.y).toBeCloseTo((600 - 20) / 2)
  })
})

describe('toggleZoom', () => {
  it('goes from fit to 1:1 and back', () => {
    const fit = initialView(LARGE, VIEWPORT)
    const full = toggleZoom(LARGE, VIEWPORT, fit)
    expect(full.scale).toBe(1)
    expect(full.x).toBeCloseTo((800 - 4000) / 2)
    expect(toggleZoom(LARGE, VIEWPORT, full)).toEqual(fit)
  })

  it('is a no-op when the image already fits, because there is no second state', () => {
    const natural = initialView(SMALL, VIEWPORT)
    expect(toggleZoom(SMALL, VIEWPORT, natural)).toEqual(natural)
  })
})

describe('panBy', () => {
  it('moves the image by the drag delta', () => {
    const t = toggleZoom(LARGE, VIEWPORT, initialView(LARGE, VIEWPORT))
    const panned = panBy(LARGE, VIEWPORT, t, 100, 50)
    expect(panned.x).toBeCloseTo(t.x + 100)
    expect(panned.y).toBeCloseTo(t.y + 50)
  })

  it('stops at the edge rather than letting the image leave the viewport', () => {
    const t = toggleZoom(LARGE, VIEWPORT, initialView(LARGE, VIEWPORT))
    // A drag 10× the image width must land on the clamp, not at 10000px.
    expect(panBy(LARGE, VIEWPORT, t, 10000, 0).x).toBeCloseTo(0)
    expect(panBy(LARGE, VIEWPORT, t, -10000, 0).x).toBeCloseTo(800 - 4000)
  })

  it('pins an axis the image does not fill instead of sliding it', () => {
    const t = initialView(SMALL, VIEWPORT)
    expect(panBy(SMALL, VIEWPORT, t, 50, 50)).toEqual(t)
  })
})

describe('zoomAt', () => {
  const at = { x: 400, y: 300 }

  it('keeps the image point under the pointer fixed', () => {
    const t = initialView(LARGE, VIEWPORT)
    const zoomed = zoomAt(LARGE, VIEWPORT, t, 1.5, at)
    expect(zoomed.scale).toBeCloseTo(0.3)
    expect((at.x - zoomed.x) / zoomed.scale).toBeCloseTo((at.x - t.x) / t.scale)
    expect((at.y - zoomed.y) / zoomed.scale).toBeCloseTo((at.y - t.y) / t.scale)
  })

  it('never zooms out past fit', () => {
    const t = initialView(LARGE, VIEWPORT)
    expect(zoomAt(LARGE, VIEWPORT, t, 0.1, at).scale).toBeCloseTo(0.2)
  })

  it('never zooms in past 1:1 — the same no-upscaling rule as the initial view', () => {
    const t = initialView(LARGE, VIEWPORT)
    expect(zoomAt(LARGE, VIEWPORT, t, 100, at).scale).toBe(1)
  })
})

describe('overflows', () => {
  it('is false at fit, which is what keeps the navigator hidden', () => {
    expect(overflows(LARGE, VIEWPORT, fitScale(LARGE, VIEWPORT))).toBe(false)
  })

  it('is true at 1:1 for an image larger than the viewport', () => {
    expect(overflows(LARGE, VIEWPORT, 1)).toBe(true)
  })

  it('stays false for an image that fits at any scale it can reach', () => {
    expect(overflows(SMALL, VIEWPORT, 1)).toBe(false)
  })
})

describe('visibleRect', () => {
  it('is the whole image at fit', () => {
    expectBox(visibleRect(LARGE, VIEWPORT, initialView(LARGE, VIEWPORT)), {
      x: 0,
      y: 0,
      width: 4000,
      height: 3000,
    })
  })

  it('is the viewport-sized window into the image at 1:1', () => {
    const t = toggleZoom(LARGE, VIEWPORT, initialView(LARGE, VIEWPORT))
    expectBox(visibleRect(LARGE, VIEWPORT, t), { x: 1600, y: 1200, width: 800, height: 600 })
  })

  it('never exceeds the image on an axis it does not fill', () => {
    const t = toggleZoom(EXTREME, VIEWPORT, initialView(EXTREME, VIEWPORT))
    // 4000×100 at 1:1 is 4000px wide and 100px tall: all of it is visible
    // vertically, so the outline must cover the full height, not overhang it.
    expectBox(visibleRect(EXTREME, VIEWPORT, t), { x: 1600, y: 0, width: 800, height: 100 })
  })
})

describe('centerOn', () => {
  it('centres the view on a fraction of the image', () => {
    const t = toggleZoom(LARGE, VIEWPORT, initialView(LARGE, VIEWPORT))
    // The far right edge, vertically centred: clamps at the right edge.
    expectBox(
      { ...centerOn(LARGE, VIEWPORT, t, { x: 1, y: 0.5 }), width: 0, height: 0 },
      { x: -3200, y: -1200, width: 0, height: 0 },
    )
  })

  it('centres an axis the image does not fill', () => {
    const t = initialView(SMALL, VIEWPORT)
    expect(centerOn(SMALL, VIEWPORT, t, { x: 0.5, y: 0.5 })).toEqual(t)
  })
})

describe('containedRect', () => {
  it('fits the whole image into the box and centres the short axis', () => {
    expectBox(containedRect(LARGE, { width: 120, height: 120 }), {
      x: 0,
      y: 15,
      width: 120,
      height: 90,
    })
  })

  it('upscales a small image — a navigator should fill its corner', () => {
    expectBox(containedRect({ width: 100, height: 100 }, { width: 120, height: 120 }), {
      x: 0,
      y: 0,
      width: 120,
      height: 120,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test zoom
```

Expected: FAIL — `Failed to resolve import "../src/ui/zoom"`.

- [ ] **Step 3: Write the module**

Create `apps/web/src/ui/zoom.ts`:

```ts
// The viewer's zoom/pan arithmetic. It lives here rather than in the component
// because it is the only real logic in the feature and none of it needs React.
//
// One coordinate system throughout: the image is drawn at `natural * scale`
// pixels with its top-left corner at `(x, y)` in *viewport* pixels — i.e. CSS
// `translate(x, y) scale(scale)` with `transform-origin: 0 0`. `natural` and
// `viewport` are measured in the browser (the API sends no dimensions, and the
// ones it stores are pre-EXIF-rotation), so every function takes them as
// arguments rather than reading anything global.

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
export type Transform = { scale: number; x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

// How far one arrow-key press pans, in viewport pixels.
export const KEY_PAN_STEP = 48

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

// The scale at which the whole image is visible: the tighter of the two axes,
// and never above 1. The cap is what collapses the spec's two-row initial-zoom
// table into one formula — an image larger than the viewport yields < 1 (fit),
// one that already fits yields exactly 1 (natural size, never upscaled, because
// enlarging a small photo only shows blur).
export function fitScale(natural: Size, viewport: Size): number {
  if (natural.width <= 0 || natural.height <= 0) return 1
  return Math.min(1, viewport.width / natural.width, viewport.height / natural.height)
}

// `scale`-sized content, centred in the viewport.
const centered = (natural: Size, viewport: Size, scale: number): Transform => ({
  scale,
  x: (viewport.width - natural.width * scale) / 2,
  y: (viewport.height - natural.height * scale) / 2,
})

export const initialView = (natural: Size, viewport: Size): Transform =>
  centered(natural, viewport, fitScale(natural, viewport))

// Keep the image from being dragged out of the viewport: an axis the image
// overflows is clamped so no gap opens at either edge; an axis it fits stays
// pinned centred.
const clampAxis = (offset: number, drawn: number, extent: number): number =>
  drawn <= extent ? (extent - drawn) / 2 : clamp(offset, extent - drawn, 0)

const clampOffset = (natural: Size, viewport: Size, transform: Transform): Transform => ({
  scale: transform.scale,
  x: clampAxis(transform.x, natural.width * transform.scale, viewport.width),
  y: clampAxis(transform.y, natural.height * transform.scale, viewport.height),
})

export const panBy = (
  natural: Size,
  viewport: Size,
  transform: Transform,
  dx: number,
  dy: number,
): Transform =>
  clampOffset(natural, viewport, { scale: transform.scale, x: transform.x + dx, y: transform.y + dy })

// Zoom by `factor` about a viewport point, so whatever is under the pointer (or
// between two fingers) stays there. The scale is bounded by the two ends the
// spec defines: never below fit, never above 1:1 — the same no-upscaling rule
// the initial view follows.
export const zoomAt = (
  natural: Size,
  viewport: Size,
  transform: Transform,
  factor: number,
  at: Point,
): Transform => {
  const scale = clamp(transform.scale * factor, fitScale(natural, viewport), 1)
  const ratio = scale / transform.scale
  return clampOffset(natural, viewport, {
    scale,
    x: at.x - ratio * (at.x - transform.x),
    y: at.y - ratio * (at.y - transform.y),
  })
}

// Click-to-toggle between the two states the spec names. `scale < 1` can only
// mean "currently fitted" — 1:1 is the ceiling — so the branch needs no epsilon.
// When the image already fits, `fitScale` is 1, the branch is not taken, and
// this returns the same centred 1:1 view it was given: the specified no-op.
export const toggleZoom = (natural: Size, viewport: Size, transform: Transform): Transform =>
  centered(natural, viewport, transform.scale < 1 ? 1 : fitScale(natural, viewport))

// True when the image is bigger than the viewport at this scale — the condition
// for showing the navigator, and false at fit by construction.
export const overflows = (natural: Size, viewport: Size, scale: number): boolean =>
  natural.width * scale > viewport.width || natural.height * scale > viewport.height

// The part of the image on screen, in natural image pixels — the navigator's own
// units. Clamped to the image, because an axis the image does not fill is
// entirely visible and the outline should say so rather than overhang.
export const visibleRect = (natural: Size, viewport: Size, transform: Transform): Rect => {
  const width = Math.min(natural.width, viewport.width / transform.scale)
  const height = Math.min(natural.height, viewport.height / transform.scale)
  return {
    width,
    height,
    x: clamp(-transform.x / transform.scale, 0, natural.width - width),
    y: clamp(-transform.y / transform.scale, 0, natural.height - height),
  }
}

// Centre the view on a point given as a fraction of the image. The navigator
// reports its pointer position that way, so it needs no image maths of its own.
export const centerOn = (
  natural: Size,
  viewport: Size,
  transform: Transform,
  at: Point,
): Transform =>
  clampOffset(natural, viewport, {
    scale: transform.scale,
    x: viewport.width / 2 - at.x * natural.width * transform.scale,
    y: viewport.height / 2 - at.y * natural.height * transform.scale,
  })

// Where the whole image sits inside a fixed-size box when it is contained:
// fitted (upscaling allowed — a navigator's job is to fill its corner) and
// centred. The navigator's own `viewBox` does this for the picture; this is for
// turning a pointer position on it back into an image coordinate.
export const containedRect = (natural: Size, box: Size): Rect => {
  const scale = Math.min(box.width / natural.width, box.height / natural.height)
  const width = natural.width * scale
  const height = natural.height * scale
  return { width, height, x: (box.width - width) / 2, y: (box.height - height) / 2 }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @homebox/web test zoom
```

Expected: PASS, 25 tests in `zoom.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/zoom.ts apps/web/test/zoom.test.ts
git commit -m "feat(web): add pure zoom/pan geometry module for the photo viewer"
```

---

### Task 3: `PhotoViewer`, opening at fit-or-natural

**Files:**
- Create: `apps/web/src/ui/PhotoViewer.tsx`
- Modify: `apps/web/src/ui/index.ts`
- Test: `apps/web/test/photoViewer.test.tsx`

**Interfaces:**
- Consumes: `Modal` with `size="full"` (Task 1); `fitScale`, `initialView`, `Transform`, `Size` from `./zoom` (Task 2); `Button`, `buttonClasses` from `./Button`; `cn` from `./cn`.
- Produces: `PhotoViewer({ src, alt, onClose })` — `src` is the full-size rendition (`editedPath ?? originalPath`), `alt` is the item or draft name, and it doubles as the dialog's accessible name. Mounted conditionally by the call site, like `PhotoEditor`. The container carries `data-testid="photo-viewer"` (the tests need to measure it; jsdom lays nothing out).

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/photoViewer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PhotoViewer } from '../src/ui/PhotoViewer'

const VIEWPORT = { width: 800, height: 600 }
const LARGE = { width: 4000, height: 3000 }
const SMALL = { width: 400, height: 300 }
const SRC = '/file/uploads/edited/e.png'

const box = (width: number, height: number) => () => ({
  x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}),
})

// jsdom lays nothing out and never loads an image, so the two facts the viewer
// reads off the DOM — the container's box and the image's intrinsic size — are
// supplied here. Nothing else is stubbed: the geometry runs for real.
function openViewer(natural = LARGE) {
  const onClose = vi.fn()
  render(<PhotoViewer src={SRC} alt="Lamp" onClose={onClose} />)
  const container = screen.getByTestId('photo-viewer')
  container.getBoundingClientRect = box(VIEWPORT.width, VIEWPORT.height)
  const image = screen.getByRole('img', { name: 'Lamp' })
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: natural.width })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: natural.height })
  fireEvent.load(image)
  return { onClose, container, image }
}

// Parsed rather than string-compared: the centring arithmetic legitimately lands
// on values like -5.7e-14.
function transformOf(element: HTMLElement) {
  const match = element.style.transform.match(
    /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/,
  )
  if (!match) throw new Error(`unparseable transform: ${element.style.transform}`)
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) }
}

const expectTransform = (element: HTMLElement, expected: { x: number; y: number; scale: number }) => {
  const actual = transformOf(element)
  expect(actual.x).toBeCloseTo(expected.x)
  expect(actual.y).toBeCloseTo(expected.y)
  expect(actual.scale).toBeCloseTo(expected.scale)
}

describe('PhotoViewer initial zoom', () => {
  it('fits an image larger than the viewport', () => {
    const { image } = openViewer(LARGE)
    expectTransform(image, { scale: 0.2, x: 0, y: 0 })
  })

  it('shows an image that already fits at natural size, centred and never upscaled', () => {
    const { image } = openViewer(SMALL)
    expectTransform(image, { scale: 1, x: 200, y: 150 })
  })

  it('shows a loading frame until the image has loaded, never a wrong-zoom flash', () => {
    render(<PhotoViewer src={SRC} alt="Lamp" onClose={vi.fn()} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Lamp' })).toHaveClass('invisible')
    expect(screen.getByRole('img', { name: 'Lamp' }).style.transform).toBe('')
  })
})

describe('PhotoViewer chrome', () => {
  it('closes on the close button, which is always visible', () => {
    const { onClose } = openViewer(LARGE)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens the rendition in a new tab from the Open original link', () => {
    openViewer(LARGE)
    const link = screen.getByRole('link', { name: 'Open original' })
    expect(link).toHaveAttribute('href', SRC)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  // Escape comes from Modal, but the wiring from its `onOpenChange` to this
  // component's `onClose` is ours, and nothing else would catch it going missing.
  it('closes on Escape', async () => {
    const { onClose } = openViewer(LARGE)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test photoViewer
```

Expected: FAIL — `Failed to resolve import "../src/ui/PhotoViewer"`.

- [ ] **Step 3: Write the viewer**

Create `apps/web/src/ui/PhotoViewer.tsx`. Task 4 and Task 5 add the gesture handlers and Task 6 the navigator; this is the whole file they extend, so the pieces they need (`apply`) are already here.

```tsx
import { useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { Button, buttonClasses } from './Button'
import { cn } from './cn'
import { Modal } from './Modal'
import { initialView, type Size, type Transform } from './zoom'

type Scene = { natural: Size; viewport: Size; transform: Transform }

type PhotoViewerProps = {
  /** The full-size rendition — `editedPath ?? originalPath`. */
  src: string
  /** The item or draft name: the image's alt text and the dialog's name. */
  alt: string
  onClose: () => void
}

// Full-screen photo viewer. It composes `Modal size="full"` for the focus trap,
// Escape handling and focus restore (ADR-0002), and owns everything else: the
// fit/zoom maths, the gestures, and the dismissal rule — Radix has no overlay to
// fire an outside-click on when the dialog fills the viewport.
export function PhotoViewer({ src, alt, onClose }: PhotoViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [scene, setScene] = useState<Scene | null>(null)

  const measure = () => containerRef.current?.getBoundingClientRect()

  // The image's own dimensions are the only trustworthy source: the API sends
  // none, and the ones it stores are pre-EXIF-rotation. So the zoom is decided
  // here, on `load`, and the frame before it is a loading state — never a
  // wrong-zoom flash.
  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    const box = measure()
    if (!box || box.width <= 0 || box.height <= 0) return
    if (!img.naturalWidth || !img.naturalHeight) return
    const natural = { width: img.naturalWidth, height: img.naturalHeight }
    const viewport = { width: box.width, height: box.height }
    setScene({ natural, viewport, transform: initialView(natural, viewport) })
  }

  // Every gesture ends in a new transform for the current scene, and nothing
  // before `load` has one.
  const apply = (next: (current: Scene) => Transform) =>
    setScene((current) => (current ? { ...current, transform: next(current) } : current))

  return (
    <Modal open onOpenChange={(next) => { if (!next) onClose() }} title={alt} size="full">
      {/* The backdrop is this element, and the dismissal rule is a positive check
          on it — see Task 4. `bg-black/90` is painted here rather than on the
          dialog because a full-viewport content hides the dialog's own overlay. */}
      <div
        ref={containerRef}
        data-testid="photo-viewer"
        className="relative h-full w-full touch-none overflow-hidden bg-black/90"
      >
        {scene ? null : (
          <p className="absolute inset-0 grid place-items-center text-sm text-white/70">Loading…</p>
        )}
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={onLoad}
          // Preflight caps every <img> at `max-width: 100%`, which would defeat
          // the natural-size maths; `max-w-none` restores the intrinsic box, and
          // the explicit width/height make the drawn size exactly `natural`
          // before the transform scales it.
          className={cn('absolute left-0 top-0 max-w-none select-none', scene ? '' : 'invisible')}
          style={
            scene
              ? {
                  width: scene.natural.width,
                  height: scene.natural.height,
                  transform: `translate(${scene.transform.x}px, ${scene.transform.y}px) scale(${scene.transform.scale})`,
                  transformOrigin: '0 0',
                }
              : undefined
          }
        />
        {/* An <a>, not a <Button> — it opens the file in a new tab, which a
            <button> cannot. This is the capability the photo card's "View" anchor
            had, moved inside the viewer. */}
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonClasses(), 'absolute left-3 top-3 no-underline')}
        >
          Open original
        </a>
        <Button className="absolute right-3 top-3" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: Extend the barrel**

Append to `apps/web/src/ui/index.ts`:

```ts
export { PhotoViewer } from './PhotoViewer'
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @homebox/web test photoViewer
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Confirm the existing suite is untouched**

```bash
pnpm --filter @homebox/web test && pnpm -r typecheck
```

Expected: PASS, no existing test edited; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/PhotoViewer.tsx apps/web/src/ui/index.ts apps/web/test/photoViewer.test.tsx
git commit -m "feat(web): add PhotoViewer opening at fit or natural size"
```

---

### Task 4: The dismissal rule, click-to-toggle, and drag-is-not-a-click

**Files:**
- Modify: `apps/web/src/ui/PhotoViewer.tsx`
- Test: `apps/web/test/photoViewer.test.tsx` (append)

**Interfaces:**
- Consumes: `panBy`, `toggleZoom` from `./zoom` (Task 2); the `apply` helper and the container/image refs from Task 3.
- Produces: the gesture state the later tasks extend — `drag`, plus the `onPointerDown` / `onPointerMove` / `onPointerUp` / `onPointerCancel` handlers. Task 5 adds a `pointers` map alongside them.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/photoViewer.test.tsx`:

```tsx
// A pointer-down and -up in the same spot, which is the only thing the viewer
// counts as a click.
const click = (element: Element, at = { clientX: 0, clientY: 0 }) => {
  fireEvent.pointerDown(element, { pointerId: 1, ...at })
  fireEvent.pointerUp(element, { pointerId: 1, ...at })
}

describe('PhotoViewer dismissal', () => {
  it('closes when the backdrop itself is clicked', () => {
    const { container, onClose } = openViewer(LARGE)
    click(container)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when a drag ends on the backdrop', () => {
    const { container, onClose } = openViewer(LARGE)
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 100, clientY: 100, buttons: 1 })
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 100, clientY: 100 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('toggles fit and 1:1 when the image is clicked', () => {
    const { image } = openViewer(LARGE)
    click(image)
    expectTransform(image, { scale: 1, x: -1600, y: -1200 })
    click(image)
    expectTransform(image, { scale: 0.2, x: 0, y: 0 })
  })

  it('does nothing when the image already fits, because there is no second state', () => {
    const { image } = openViewer(SMALL)
    click(image)
    expectTransform(image, { scale: 1, x: 200, y: 150 })
  })
})

describe('PhotoViewer pan', () => {
  it('pans by the drag delta', () => {
    const { container, image } = openViewer(LARGE)
    click(image) // 1:1, where there is something off-screen to pan to
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 500, clientY: 350, buttons: 1 })
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 500, clientY: 350 })
    expectTransform(image, { scale: 1, x: -1500, y: -1150 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @homebox/web test photoViewer
```

Expected: FAIL, 3 failures. `Number of calls: 0` for the backdrop click (nothing is wired to a pointer, so nothing closes), and `expected 0.2 to be close to 1` for the toggle and the pan — the transform never leaves the fitted view. The two negative tests (a drag does not close, a fitting image does not toggle) pass vacuously, which is what Step 4 exists to stop being true.

- [ ] **Step 3: Add the gesture state and handlers**

In `apps/web/src/ui/PhotoViewer.tsx`, extend the imports:

```tsx
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react'
import { initialView, panBy, toggleZoom, type Size, type Transform } from './zoom'
```

Add the threshold above the component:

```tsx
// A pointer that moved less than this many pixels between down and up was a
// click, not a drag. Without it a pan that happens to end on the backdrop would
// dismiss the viewer.
const DRAG_THRESHOLD = 4
```

Add the ref inside the component, next to `scene`:

```tsx
  // The pointer-down that may still turn out to be a click: where it started,
  // whether it has moved past the threshold, and what it landed on.
  const drag = useRef<{ x: number; y: number; moved: boolean; on: EventTarget | null } | null>(null)
```

Add the handlers after `apply`:

```tsx
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { target } = event
    // Only the image and the backdrop itself are gesture surfaces. The chrome —
    // close button, navigator, open-original — is neither, which is what makes
    // `drag.on` provably one of exactly two elements.
    if (target !== containerRef.current && target !== imageRef.current) return
    drag.current = { x: event.clientX, y: event.clientY, moved: false, on: target }
    // jsdom does not implement pointer capture; the drag still works without it,
    // it just stops tracking once the pointer leaves the element.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    // Below the threshold this could still turn out to be a click, so nothing
    // moves yet.
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    start.moved = true
    start.x = event.clientX
    start.y = event.clientY
    apply((current) => panBy(current.natural, current.viewport, current.transform, dx, dy))
  }

  const onPointerUp = () => {
    const start = drag.current
    drag.current = null
    // A drag is not a click: a pan that happens to end on the backdrop must not
    // dismiss the viewer.
    if (!start || start.moved) return
    // The whole dismissal rule, in one line: the backdrop closes, the image
    // toggles. `start.on` is one of those two and nothing else, because
    // `onPointerDown` refuses every other target.
    if (start.on === containerRef.current) onClose()
    else apply((current) => toggleZoom(current.natural, current.viewport, current.transform))
  }

  const onPointerCancel = () => {
    drag.current = null
  }
```

And wire them onto the container, replacing its opening tag:

```tsx
      <div
        ref={containerRef}
        data-testid="photo-viewer"
        className="relative h-full w-full touch-none overflow-hidden bg-black/90"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/web test photoViewer
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/PhotoViewer.tsx apps/web/test/photoViewer.test.tsx
git commit -m "feat(web): add the photo viewer's dismissal rule, click toggle and pan"
```

---

### Task 5: Wheel, pinch and arrow-key pan

**Files:**
- Modify: `apps/web/src/ui/PhotoViewer.tsx`
- Test: `apps/web/test/photoViewer.test.tsx` (append)

**Interfaces:**
- Consumes: `zoomAt`, `KEY_PAN_STEP` from `./zoom` (Task 2); the gesture state from Task 4.
- Produces: `onWheel`, `onKeyDown`, and the two-pointer `pointers`/`pinch` refs Task 6 does not touch.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/photoViewer.test.tsx`:

```tsx
describe('PhotoViewer zoom and keyboard pan', () => {
  it('pans with the arrow keys, so the feature works without a pointer', () => {
    const { container, image } = openViewer(LARGE)
    click(image) // 1:1, where panning has somewhere to go
    fireEvent.keyDown(container, { key: 'ArrowRight' })
    expectTransform(image, { scale: 1, x: -1600 - 48, y: -1200 })
    fireEvent.keyDown(container, { key: 'ArrowDown' })
    expectTransform(image, { scale: 1, x: -1648, y: -1200 - 48 })
  })

  it('ignores keys it does not pan with', () => {
    const { container, image } = openViewer(LARGE)
    click(image)
    fireEvent.keyDown(container, { key: 'a' })
    expectTransform(image, { scale: 1, x: -1600, y: -1200 })
  })

  it('zooms about the pointer on wheel', () => {
    const { container, image } = openViewer(LARGE)
    fireEvent.wheel(container, { clientX: 400, clientY: 300, deltaY: -100 })
    // exp(100 / 400): exponential, so the gesture is scale-free — the same swipe
    // changes the zoom by the same factor at any magnification. A wheel notch
    // (deltaY -100) is one step of exactly that.
    const scale = 0.2 * Math.exp(0.25)
    expectTransform(image, { scale, x: 400 - (scale / 0.2) * 400, y: 300 - (scale / 0.2) * 300 })
  })

  it('zooms on a two-finger pinch', () => {
    const { container, image } = openViewer(LARGE)
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerDown(container, { pointerId: 2, clientX: 500, clientY: 300 })
    // Fingers 200px apart move to 300px: a factor of 1.5 about their midpoint.
    fireEvent.pointerMove(container, { pointerId: 2, clientX: 600, clientY: 300 })
    expectTransform(image, { scale: 0.3, x: -225, y: -150 })
  })

  it('does not treat the second finger of a pinch as a click', () => {
    const { container, onClose } = openViewer(LARGE)
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerDown(container, { pointerId: 2, clientX: 500, clientY: 300 })
    fireEvent.pointerUp(container, { pointerId: 2, clientX: 500, clientY: 300 })
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 300, clientY: 300 })
    expect(onClose).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @homebox/web test photoViewer
```

Expected: FAIL, 4 failures — `expected -1600 to be close to -1648` for the arrow keys, `expected 0.2 to be close to 0.2568…` for the wheel, and `expected 0.2 to be close to 0.3` for the pinch, because nothing is listening for any of the three. The "ignores keys it does not pan with" test passes already: doing nothing is what it wants.

- [ ] **Step 3: Add the wheel, pinch and keyboard handling**

In `apps/web/src/ui/PhotoViewer.tsx`, extend the imports:

```tsx
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent, WheelEvent } from 'react'
import {
  KEY_PAN_STEP,
  initialView,
  panBy,
  toggleZoom,
  zoomAt,
  type Point,
  type Size,
  type Transform,
} from './zoom'
```

Add above the component, next to `DRAG_THRESHOLD`:

```tsx
// Arrow keys move the *view*, so the image travels the other way: ArrowRight
// reveals what is off-screen to the right.
const ARROW_PAN: Record<string, Point> = {
  ArrowLeft: { x: KEY_PAN_STEP, y: 0 },
  ArrowRight: { x: -KEY_PAN_STEP, y: 0 },
  ArrowUp: { x: 0, y: KEY_PAN_STEP },
  ArrowDown: { x: 0, y: -KEY_PAN_STEP },
}

// The distance between the two fingers of a pinch.
const spread = (pointers: Map<number, Point>): number => {
  const [a, b] = [...pointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}
```

Add the two refs next to `drag`:

```tsx
  // Every finger currently down, for the two-finger pinch, and the spread they
  // had on the previous move.
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<number | null>(null)
```

Replace `onPointerDown` with the version that knows about a second finger:

```tsx
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { target } = event
    // Only the image and the backdrop itself are gesture surfaces. The chrome —
    // close button, navigator, open-original — is neither, which is what makes
    // `drag.on` provably one of exactly two elements.
    if (target !== containerRef.current && target !== imageRef.current) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      // A second finger means a pinch, and ends the pan — and any click the
      // first finger might still have become.
      drag.current = null
      pinch.current = spread(pointers.current)
      return
    }
    drag.current = { x: event.clientX, y: event.clientY, moved: false, on: target }
    // jsdom does not implement pointer capture; the drag still works without it,
    // it just stops tracking once the pointer leaves the element.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
```

Replace `onPointerMove` with the pinch-aware version:

```tsx
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (pointers.current.size === 2 && pinch.current != null) {
      const next = spread(pointers.current)
      const [a, b] = [...pointers.current.values()]
      const box = measure()
      const at = box
        ? { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top }
        : { x: 0, y: 0 }
      const factor = next / pinch.current
      pinch.current = next
      apply((current) => zoomAt(current.natural, current.viewport, current.transform, factor, at))
      return
    }
    const start = drag.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    // Below the threshold this could still turn out to be a click, so nothing
    // moves yet.
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    start.moved = true
    start.x = event.clientX
    start.y = event.clientY
    apply((current) => panBy(current.natural, current.viewport, current.transform, dx, dy))
  }
```

Replace `onPointerUp` and `onPointerCancel` with the versions that track fingers:

```tsx
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const start = drag.current
    drag.current = null
    // A drag is not a click: a pan that happens to end on the backdrop must not
    // dismiss the viewer.
    if (!start || start.moved) return
    // The whole dismissal rule, in one line: the backdrop closes, the image
    // toggles. `start.on` is one of those two and nothing else, because
    // `onPointerDown` refuses every other target.
    if (start.on === containerRef.current) onClose()
    else apply((current) => toggleZoom(current.natural, current.viewport, current.transform))
  }

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    pinch.current = null
    drag.current = null
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const box = measure()
    if (!box) return
    const at = { x: event.clientX - box.left, y: event.clientY - box.top }
    // Exponential, so the gesture is scale-free: the same swipe changes the zoom
    // by the same factor at any magnification, and scrolling up zooms in.
    apply((current) =>
      zoomAt(current.natural, current.viewport, current.transform, Math.exp(-event.deltaY / 400), at),
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = ARROW_PAN[event.key]
    if (!delta) return
    // Inside the dialog the arrow keys are ours: there is nothing else for them
    // to scroll, and the focus trap guarantees focus is already in here.
    event.preventDefault()
    apply((current) => panBy(current.natural, current.viewport, current.transform, delta.x, delta.y))
  }
```

Wire the three onto the container, adding to the handler list:

```tsx
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
```

The keyboard handler sits on the container rather than on a focusable child so it catches the events bubbling from whichever control Radix has focused inside the dialog.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/web test photoViewer
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/PhotoViewer.tsx apps/web/test/photoViewer.test.tsx
git commit -m "feat(web): add wheel, pinch and keyboard pan to the photo viewer"
```

---

### Task 6: The navigator

**Files:**
- Modify: `apps/web/src/ui/PhotoViewer.tsx`
- Test: `apps/web/test/photoViewer.test.tsx` (append)

**Interfaces:**
- Consumes: `containedRect`, `overflows`, `visibleRect`, `centerOn` from `./zoom` (Task 2); the `scene` state from Task 3.
- Produces: the private `PhotoNavigator`, rendered only when `overflows` is true. It is not exported and not in the barrel: the viewer is the only consumer.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/photoViewer.test.tsx`:

```tsx
describe('PhotoViewer navigator', () => {
  it('is absent while the whole image is visible', () => {
    openViewer(LARGE)
    // At fit there is nothing off-screen, so a navigator would be a second copy
    // of an image with nothing to navigate.
    expect(screen.queryByRole('img', { name: 'Photo navigator' })).not.toBeInTheDocument()
  })

  it('appears once the image overflows the viewport', () => {
    const { image } = openViewer(LARGE)
    click(image)
    expect(screen.getByRole('img', { name: 'Photo navigator' })).toBeInTheDocument()
  })

  it('stays absent for an image that cannot be zoomed past the viewport', () => {
    const { image } = openViewer(SMALL)
    click(image)
    expect(screen.queryByRole('img', { name: 'Photo navigator' })).not.toBeInTheDocument()
  })

  // The dismissal rule is a positive check on the backdrop element, not a
  // negative "the target is not the image". This is the test that tells them
  // apart: the navigator is neither the image nor the backdrop, so under the
  // negative rule the pointer sequence below would arm a click and dismiss the
  // viewer on the release.
  it('jumps the view when clicked, and does not dismiss the viewer', () => {
    const { image, onClose } = openViewer(LARGE)
    click(image)
    const navigator = screen.getByRole('img', { name: 'Photo navigator' })
    navigator.getBoundingClientRect = box(120, 120)
    // The 4000×3000 image is contained as 120×90 in a 120×120 box, 15px down, so
    // (120, 60) is the image's right edge at half its height.
    fireEvent.pointerDown(navigator, { pointerId: 1, clientX: 120, clientY: 60 })
    fireEvent.pointerUp(navigator, { pointerId: 1, clientX: 120, clientY: 60 })
    expectTransform(image, { scale: 1, x: -3200, y: -1200 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('jumps the view when dragged inside it', () => {
    const { image, onClose } = openViewer(LARGE)
    click(image)
    const navigator = screen.getByRole('img', { name: 'Photo navigator' })
    navigator.getBoundingClientRect = box(120, 120)
    fireEvent.pointerDown(navigator, { pointerId: 1, clientX: 60, clientY: 60 })
    fireEvent.pointerMove(navigator, { pointerId: 1, clientX: 120, clientY: 60, buttons: 1 })
    fireEvent.pointerUp(navigator, { pointerId: 1, clientX: 120, clientY: 60 })
    expectTransform(image, { scale: 1, x: -3200, y: -1200 })
    expect(onClose).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @homebox/web test photoViewer
```

Expected: FAIL, 3 failures. `Unable to find an accessible element with the role "img" and name "Photo navigator"` for the two jump tests and the overflow test; the two absence tests pass by accident, because nothing renders a navigator yet.

- [ ] **Step 3: Write the navigator and render it**

In `apps/web/src/ui/PhotoViewer.tsx`, extend the imports:

```tsx
import {
  KEY_PAN_STEP,
  centerOn,
  containedRect,
  initialView,
  overflows,
  panBy,
  toggleZoom,
  visibleRect,
  zoomAt,
  type Point,
  type Size,
  type Transform,
} from './zoom'
```

Add the component below `PhotoViewer`:

```tsx
// The navigator: the whole image in the corner with the visible region outlined,
// click or drag to jump the view.
//
// The picture is an SVG whose viewBox *is* the image, so `preserveAspectRatio`
// does the containing for free and the outline is drawn in image pixels — no
// measurement and no scaling maths of its own. `containedRect` is needed only to
// turn a pointer position back into an image coordinate.
function PhotoNavigator({
  src,
  natural,
  viewport,
  transform,
  onJump,
}: {
  src: string
  natural: Size
  viewport: Size
  transform: Transform
  onJump: (at: Point) => void
}) {
  const region = visibleRect(natural, viewport, transform)

  const jump = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const contained = containedRect(natural, { width: rect.width, height: rect.height })
    if (!contained.width || !contained.height) return
    onJump({
      x: (event.clientX - rect.left - contained.x) / contained.width,
      y: (event.clientY - rect.top - contained.y) / contained.height,
    })
  }

  return (
    <svg
      viewBox={`0 0 ${natural.width} ${natural.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Photo navigator"
      // Smaller and more transparent on a narrow viewport, per the spec — never
      // absent, because on a phone it is the only way to orient inside a photo.
      className="absolute bottom-3 right-3 h-20 w-20 touch-none rounded border border-white/30 bg-black/40 opacity-60 sm:h-32 sm:w-32 sm:opacity-90"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId)
        jump(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) jump(event)
      }}
    >
      <image href={src} width={natural.width} height={natural.height} />
      {/* Two strokes, white under black. The outline sits over a photo of
          arbitrary colour, so no token can supply it and a single colour would
          vanish on the half of the images that match it. */}
      <rect
        x={region.x}
        y={region.y}
        width={region.width}
        height={region.height}
        fill="none"
        stroke="white"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={region.x}
        y={region.y}
        width={region.width}
        height={region.height}
        fill="none"
        stroke="black"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
```

Render it inside the container, after the close button:

```tsx
        {scene && overflows(scene.natural, scene.viewport, scene.transform.scale) ? (
          <PhotoNavigator
            src={src}
            natural={scene.natural}
            viewport={scene.viewport}
            transform={scene.transform}
            onJump={(at) =>
              apply((current) => centerOn(current.natural, current.viewport, current.transform, at))
            }
          />
        ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/web test photoViewer
```

Expected: PASS, 21 tests.

- [ ] **Step 5: Confirm the whole suite is still green**

```bash
pnpm --filter @homebox/web test && pnpm -r typecheck
```

Expected: PASS; typecheck clean. No existing assertion edited.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/PhotoViewer.tsx apps/web/test/photoViewer.test.tsx
git commit -m "feat(web): add the photo viewer's navigator"
```

---

### Task 7: `ItemDetail` — the thumbnail opens the viewer, and the `View` anchor goes

Per the spec, the per-photo `View` anchor is removed and its one unique capability (opening the file in a new tab, which is how you save or share it) moves into the viewer as "Open original". That takes the photo card from six controls to five.

**Files:**
- Modify: `apps/web/src/features/items/ItemDetail.tsx:4,89-132,137`
- Test: `apps/web/test/itemDetail.test.tsx:69-71,118-124`

**Interfaces:**
- Consumes: `PhotoViewer` from `../../ui` (Task 3).
- Produces: no new interfaces.

- [ ] **Step 1: Replace the `View` test with tests for the thumbnail that replaces it**

In `apps/web/test/itemDetail.test.tsx` there are three edits. First, the Testing Library import gains `within`:

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
```

Second, delete the now-dead line 70, `import { buttonClasses } from '../src/ui'` — the test below was its only user.

Third, delete the test at lines 118-124 — `renders the photo View link with the shared button classes plus no-underline`. Its subject, the `View` anchor, is what this task removes, so the test goes with it. In its place, append inside `describe('item detail photos', ...)`:

```tsx
  // The thumbnail used to be inert; the View anchor's job (seeing the full photo)
  // is now its job, and the anchor's other job (opening the file) moved inside
  // the viewer as "Open original".
  it('opens the viewer on the edited rendition from a photo thumbnail', () => {
    renderDetail()
    fireEvent.click(screen.getAllByRole('button', { name: 'View photo of Lamp' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Lamp' })
    expect(within(dialog).getByRole('img', { name: 'Lamp' })).toHaveAttribute(
      'src',
      '/file/uploads/edited/e.png',
    )
  })

  it('falls back to the original rendition when the image has no edit', () => {
    renderDetail()
    // Image 11 is the one with `editedPath: null`.
    fireEvent.click(screen.getAllByRole('button', { name: 'View photo of Lamp' })[1])
    const dialog = screen.getByRole('dialog', { name: 'Lamp' })
    expect(within(dialog).getByRole('img', { name: 'Lamp' })).toHaveAttribute(
      'src',
      '/file/uploads/originals/b.png',
    )
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test itemDetail
```

Expected: FAIL — 2 failures, `Unable to find an accessible element with the role "button" and name "View photo of Lamp"`. The other 6 tests in the file pass.

- [ ] **Step 3: Replace the photo card's thumbnail and drop the `View` anchor**

In `apps/web/src/features/items/ItemDetail.tsx`, change the import:

```tsx
import { Badge, Button, Card, PageHeader, PhotoViewer } from '../../ui'
```

Add the state next to `editingImage`:

```tsx
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null)
```

Replace the `<img>` at line 92 with the button that opens the viewer, and delete the `View` anchor (lines 108-119):

```tsx
            <button
              type="button"
              aria-label={`View photo of ${item.name}`}
              onClick={() =>
                setViewing({ src: '/file/' + (img.editedPath ?? img.originalPath), alt: item.name })
              }
              className="block w-full cursor-zoom-in p-0"
            >
              <img src={'/file/' + img.thumbPath} alt="" className="w-full h-32 object-cover rounded-md" />
            </button>
```

`alt=""` is deliberate: the button carries the accessible name, and a redundant alt would make a screen reader read the item name twice. The `src` is `editedPath ?? originalPath` — the same rendition the grid thumbnail shows and the same href the removed anchor used.

Finally, mount the viewer next to `PhotoEditor`:

```tsx
      {viewing && (
        <PhotoViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/web test itemDetail
```

Expected: PASS, 8 tests — 6 pre-existing (unchanged), the deleted one gone, 2 new.

- [ ] **Step 5: Check nothing else referred to the anchor**

```bash
grep -rn "'View'\|>View<" apps/web/src apps/web/test apps/web/e2e
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/items/ItemDetail.tsx apps/web/test/itemDetail.test.tsx
git commit -m "feat(web): open the photo viewer from the item detail thumbnail"
```

---

### Task 8: `DraftsPage` — the row thumbnail opens the viewer

**Files:**
- Modify: `apps/web/src/features/drafts/DraftsPage.tsx:5,44-61`
- Test: `apps/web/test/drafts.test.tsx` (append)

**Interfaces:**
- Consumes: `PhotoViewer` from `../../ui` (Task 3).
- Produces: no new interfaces.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/drafts.test.tsx`, inside `describe('drafts page', ...)`, and replace its Testing Library import with one that also brings in `fireEvent` and `within`:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
```

```tsx
  it('opens the photo viewer from a row thumbnail', () => {
    draftData = [
      {
        id: 1,
        name: 'Draft Lamp',
        images: [{ id: 10, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true }],
      },
    ]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View photo of Draft Lamp' }))
    const dialog = screen.getByRole('dialog', { name: 'Draft Lamp' })
    // The thumbnail is a 400px upscale of the original, so the viewer shows the
    // original, not the thumbnail.
    expect(within(dialog).getByRole('img', { name: 'Draft Lamp' })).toHaveAttribute(
      'src',
      '/file/uploads/originals/a.png',
    )
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test drafts
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "View photo of Draft Lamp"`. The 2 pre-existing tests pass.

- [ ] **Step 3: Make the row thumbnail a button**

In `apps/web/src/features/drafts/DraftsPage.tsx`, change the import:

```tsx
import { Button, Card, Input, PhotoViewer } from '../../ui'
```

Add the state next to `selected`:

```tsx
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null)
```

Replace the `data.map` body so the row's image is a button. The `find(isPrimary) ?? images[0]` pick happens once per row now, so the thumbnail and the full-size rendition cannot disagree about which image they are describing:

```tsx
        {data.map((d) => {
          const photo = d.images.find((i) => i.isPrimary) ?? d.images[0]
          return (
            <li key={d.id}>
              <Card className="flex items-center gap-3">
                <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                {photo && (
                  <button
                    type="button"
                    aria-label={`View photo of ${d.name}`}
                    onClick={() =>
                      setViewing({
                        src: '/file/' + (photo.editedPath ?? photo.originalPath),
                        alt: d.name,
                      })
                    }
                    className="shrink-0 cursor-zoom-in p-0"
                  >
                    <img src={`/file/${photo.thumbPath}`} className="w-16 h-16 object-cover rounded" alt="" />
                  </button>
                )}
                <Input
                  className="flex-1"
                  defaultValue={d.name}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== d.name) void update.mutateAsync({ id: d.id, name: e.target.value.trim() }) }}
                />
                <Button onClick={() => void publish.mutateAsync({ id: d.id })}>{t('drafts.publish')}</Button>
                <Button variant="danger" onClick={() => void discard.mutateAsync({ id: d.id })}>{t('drafts.discard')}</Button>
              </Card>
            </li>
          )
        })}
```

The `photo &&` guard is new and deliberate: a draft with no images previously rendered `src="/file/undefined"`.

Mount the viewer at the end of the page's root `<div>`, after the `<ul>`:

```tsx
      {viewing && (
        <PhotoViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/web test drafts
```

Expected: PASS, 3 tests — 2 pre-existing, unmodified, plus the new one.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/drafts/DraftsPage.tsx apps/web/test/drafts.test.tsx
git commit -m "feat(web): open the photo viewer from a draft row thumbnail"
```

---

### Task 9: `ItemsPage` — the card splits

On `/items` the whole card is a `<Link>`, so the image would have two jobs. The card splits: the image becomes a button that opens the viewer, and the item *name* becomes the link. Both are siblings with unambiguous accessible names — nesting a button inside an anchor would be invalid HTML and ambiguous to assistive tech. **This is the one place the feature changes an existing interaction**, and the spec records it as provisional, to be judged against the running app rather than argued further on paper.

**Files:**
- Modify: `apps/web/src/features/items/ItemsPage.tsx:4,36-37,270-287`
- Test: `apps/web/test/catalog.test.tsx` (append)

**Interfaces:**
- Consumes: `PhotoViewer` from `../../ui` (Task 3).
- Produces: no new interfaces.

- [ ] **Step 1: Write the failing test**

Append to `describe('catalog pages', ...)` in `apps/web/test/catalog.test.tsx`:

```tsx
  // The card used to be one <Link> wrapping everything. It now splits: the photo
  // opens the viewer, the name navigates. Both are siblings with unambiguous
  // names — an interactive element inside an anchor is invalid HTML.
  it('opens the viewer from the card photo and links the name to the item', () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    expect(screen.getByRole('link', { name: 'Lamp' })).toHaveAttribute('href', '/items/1')
    fireEvent.click(screen.getByRole('button', { name: 'View photo of Lamp' }))
    const dialog = screen.getByRole('dialog', { name: 'Lamp' })
    expect(within(dialog).getByRole('img', { name: 'Lamp' })).toHaveAttribute(
      'src',
      '/file/uploads/originals/a.png',
    )
  })
```

Add `within` to the Testing Library import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test catalog
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "View photo of Lamp"`. The 2 pre-existing tests pass.

- [ ] **Step 3: Split the card**

In `apps/web/src/features/items/ItemsPage.tsx`, change the import:

```tsx
import { Badge, Button, Card, Field, hoverScrim, Input, PageHeader, PhotoViewer } from '../../ui'
```

Add the state next to `showForm`:

```tsx
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null)
```

Replace the card body:

```tsx
            {items.map((item) => (
              <Card key={item.id} padding="none" className="overflow-hidden hover:border-text-muted">
                <div className="p-3">
                  {item.images?.[0]?.thumbPath ? (
                    <button
                      type="button"
                      aria-label={`View photo of ${item.name}`}
                      onClick={() =>
                        setViewing({
                          src: '/file/' + (item.images[0].editedPath ?? item.images[0].originalPath),
                          alt: item.name,
                        })
                      }
                      className="block w-full cursor-zoom-in p-0 mb-2"
                    >
                      <img src={'/file/' + item.images[0].thumbPath} alt="" className="w-full h-32 object-cover rounded-md" />
                    </button>
                  ) : null}
                  <Link to={`/items/${item.id}`} className="no-underline text-inherit">
                    <h2 className="mt-0">{item.name}</h2>
                  </Link>
                  <p>{item.location?.name}</p>
                  <p>{item.type?.name}</p>
                  {item.tags.map((tag) => (
                    <Badge key={tag.id} color={tag.color} className="mr-1">{tag.name}</Badge>
                  ))}
                  {q.trim() && item.snippet ? (
                    <p className="mt-2 text-text-muted text-sm" data-testid="item-snippet">{item.snippet}</p>
                  ) : null}
                </div>
              </Card>
            ))}
```

The `<h2>` stays an `<h2>` inside the link, so `00-catalog.spec.ts`'s `getByRole('heading', { name: 'Lamp' })` and its `a:has-text("Lamp")` click still match. The `data-testid="item-snippet"` and the item grid classes are unchanged.

Mount the viewer before the closing `</section>` of the return:

```tsx
      {viewing && (
        <PhotoViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />
      )}
    </section>
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/web test catalog && pnpm --filter @homebox/web test searchFacets
```

Expected: PASS — 3 tests in `catalog.test.tsx`, and `searchFacets.test.tsx` unchanged, since the facet chips and the snippet are untouched.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
pnpm --filter @homebox/web test && pnpm -r typecheck
```

Expected: PASS, all suites; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/items/ItemsPage.tsx apps/web/test/catalog.test.tsx
git commit -m "feat(web): split the catalog card into a photo button and a name link"
```

---

### Task 10: Verify in a real browser, then across the workspace

jsdom never loads an image and lays nothing out, so the tests stub exactly the two things this feature reads from the DOM. That is the right trade for the geometry, but it means the tests cannot prove the real DOM agrees with the stubs: whether `onLoad` fires after the container has a box, whether `max-w-none` really defeats Preflight, whether the backdrop point is reachable. One Playwright leg covers that gap; the rest of the e2e run is the regression check for the card split.

**Files:**
- Modify: `apps/web/e2e/00-catalog.spec.ts` (append)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Append the browser leg**

Append to the end of `apps/web/e2e/00-catalog.spec.ts`. It has to come after the test that uploads the lamp photo, which is why it goes last:

```ts
// The viewer in a real browser. jsdom never loads an image and measures nothing,
// so the intrinsic-size read, the fit decision and the backdrop hit test are all
// stubbed in the unit tests; this is the leg that fails if the real DOM
// disagrees with those stubs.
test('opens the photo viewer from a catalog card and closes on the backdrop', async ({ page }) => {
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  await page.goto('/items')
  await page.getByRole('button', { name: 'View photo of Lamp', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'Lamp', exact: true })
  await expect(dialog).toBeVisible()
  // The thumbnail is a 400px upscale of a 1×1 source, so the rendition the card
  // hands the viewer has to be the original: it must paint at all.
  await expect(dialog.getByRole('img', { name: 'Lamp', exact: true })).toBeVisible()

  // A 1×1 PNG at 1:1 is one pixel at the centre, so there is backdrop everywhere
  // else — including the very corner, which the Open original link (top-left) and
  // the navigator (bottom-right) do not occupy.
  await page.mouse.click(4, 4)
  await expect(dialog).not.toBeVisible()
})
```

- [ ] **Step 2: Run the e2e suite**

```bash
pnpm --filter @homebox/web test:e2e
```

Expected: PASS. The run builds the workspace and serves the built app on port 3100, so nothing needs to be stopped first. If Playwright cannot run in this environment, say so explicitly rather than reporting success.

- [ ] **Step 3: Run the whole verification set**

```bash
pnpm --filter @homebox/web test && pnpm -r typecheck && pnpm --filter @homebox/web build
```

Expected: PASS, every suite; typecheck clean; build succeeds.

- [ ] **Step 4: CHECKPOINT — look at it in the browser**

With `pnpm --filter @homebox/web dev` running, open `/items`, `/items/:id` and `/drafts` and check each call site:

- A photo larger than the viewport opens **fitted**; clicking it goes to 1:1 and the navigator appears; dragging inside the navigator moves the view; clicking the navigator does **not** dismiss; clicking the backdrop does.
- A photo smaller than the viewport opens at 1:1 centred and clicking it does nothing (clicking the backdrop still closes).
- Escape closes and focus returns to the thumbnail that opened it.
- Arrow keys pan; Tab reaches Close and Open original.
- Resize the window narrow: the navigator shrinks and fades but does not disappear.

Then judge the two decisions the spec left provisional, and say which way they fell:
- **the `/items` card split** — is losing the one-click card for two explicit targets a net loss in normal use?
- **fit-first for extreme aspect ratios** — find a panorama or a very tall photo and check whether the opening view is useful or a useless sliver.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/00-catalog.spec.ts
git commit -m "test(web): cover the photo viewer's open and backdrop-dismiss in a browser"
```

---

## Deferred (not in this plan)

- **Bulk draft discard.** The other half of the spec, with its own plan; nothing here touches `drafts/router.ts`, `drafts/service.ts` or the toolbar.
- **Re-fitting on window resize.** The viewport is measured once, on `load`. A resize after that leaves the transform where it was. A `resize` listener that re-fit would throw away the user's zoom mid-gesture, and a correct one needs a "has the user touched it yet" flag; add it when resizing with a photo open turns out to matter.
- **Zoom past 1:1.** The scale is capped at 1:1 by the same no-upscaling rule the initial view follows, so pixel-peeping is not possible. Add a `MAX_SCALE` constant next to `fitScale` if that is wanted.
- **Announcing zoom and pan to screen readers.** There is no `aria-live` region, so a screen-reader user gets no feedback from the arrow keys beyond the image moving. Add one if the viewer is used non-visually.
- **A closer look at `/file/*`.** No cache headers and no range support, so a large original re-downloads on every open and cannot be progressively rendered. Worth fixing, but the viewer does not need it to work.
