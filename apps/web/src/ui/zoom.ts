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
//
// Compare scales rather than drawn pixels. The obvious form — `natural.width *
// scale > viewport.width` — multiplies after `fitScale` has already divided, and
// the product can round a hair *above* the viewport: 800×600 in a 411×600
// viewport fits at 411/800, yet `800 * (411/800)` is 411.00000000000006, so a
// strict `>` there calls a fully-visible image an overflow and renders the
// navigator over a photo that has none. `scale > fitScale` compares two floats
// that are equal at fit, so it is exactly the mathematical condition: `scale` is
// capped at 1, and `> min(a, b)` holds iff `> a` or `> b` — i.e. iff some axis
// really is drawn larger than the viewport. Do not "simplify" this back to the
// product form.
export const overflows = (natural: Size, viewport: Size, scale: number): boolean =>
  scale > fitScale(natural, viewport)

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
