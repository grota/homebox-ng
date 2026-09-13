// The pure half of the manual-unpack modal: every place a coordinate is turned
// into another coordinate, or a box is forced to be legal. Kept out of the
// component so it can be tested directly — the alternative is a suite that has
// to stub `getBoundingClientRect` and a transform matrix to say anything at all,
// and a bug in here is silent: the boxes look right on screen and crop the wrong
// region.

export type Size = { width: number; height: number }
export type Box = { x: number; y: number; width: number; height: number }
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Smallest rectangle this UI will produce, in image pixels. An accidental click
 *  with no drag must not become a draft. */
export const MIN_SIZE = 8

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * A pointer position in *image* pixels.
 *
 * The overlay is authored in image-pixel coordinates and is given the same
 * transform as the image, so the element it is measured against is the image
 * itself at display scale. Deriving that scale from the measured rectangle —
 * rather than passing the transform in — is what makes this one multiplication,
 * and means a wrong transform can move the picture but not the rectangles.
 */
export const toImagePoint = (
  client: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  natural: Size,
): { x: number; y: number } => ({
  x: ((client.x - rect.left) * natural.width) / rect.width,
  y: ((client.y - rect.top) * natural.height) / rect.height,
})

/**
 * A drag's two corners as a legal box: right way up and inside the image.
 *
 * It does NOT enforce the minimum, and that is deliberate — it reports the drag
 * honestly so `isDrawable` can reject a stray click. A function that silently
 * grew every box to `MIN_SIZE` would make every click a rectangle, and the check
 * downstream would be dead code that always passed.
 */
export const boxFromCorners = (a: { x: number; y: number }, b: { x: number; y: number }, natural: Size): Box => {
  const x1 = clamp(Math.min(a.x, b.x), 0, natural.width)
  const y1 = clamp(Math.min(a.y, b.y), 0, natural.height)
  const x2 = clamp(Math.max(a.x, b.x), 0, natural.width)
  const y2 = clamp(Math.max(a.y, b.y), 0, natural.height)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/** True when a drag produced something worth keeping. Checked before the box is
 *  committed, so a stray click never becomes a row the user then has to delete. */
export const isDrawable = (box: Box, min = MIN_SIZE) => box.width >= min && box.height >= min

/** Move a whole rectangle, keeping it inside the image. */
export const moveBox = (box: Box, dx: number, dy: number, natural: Size): Box => ({
  x: clamp(box.x + dx, 0, natural.width - box.width),
  y: clamp(box.y + dy, 0, natural.height - box.height),
  width: box.width,
  height: box.height,
})

/**
 * Drag one edge or corner. The opposite edge is the anchor and never moves, so
 * resizing cannot make the box drift; the dragged edge clamps to the image and
 * the minimum is then enforced by pushing it back off the anchor.
 */
export const resizeBox = (start: Box, handle: Handle, dx: number, dy: number, natural: Size, min = MIN_SIZE): Box => {
  let x1 = start.x
  let y1 = start.y
  let x2 = start.x + start.width
  let y2 = start.y + start.height

  if (handle.includes('w')) x1 = start.x + dx
  if (handle.includes('e')) x2 = start.x + start.width + dx
  if (handle.includes('n')) y1 = start.y + dy
  if (handle.includes('s')) y2 = start.y + start.height + dy

  x1 = clamp(x1, 0, natural.width)
  y1 = clamp(y1, 0, natural.height)
  x2 = clamp(x2, 0, natural.width)
  y2 = clamp(y2, 0, natural.height)

  // The anchor is whichever edge did not move; push the dragged one back out.
  if (x2 - x1 < min) {
    if (handle.includes('w')) x1 = Math.max(0, x2 - min)
    else x2 = Math.min(natural.width, x1 + min)
  }
  if (y2 - y1 < min) {
    if (handle.includes('n')) y1 = Math.max(0, y2 - min)
    else y2 = Math.min(natural.height, y1 + min)
  }

  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}
