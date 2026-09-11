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
