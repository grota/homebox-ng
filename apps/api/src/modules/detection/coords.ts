import type { DetectionBox } from './provider.js'

// Clamp a pixel box (top-left origin) to the decoded image bounds so a
// malformed/out-of-range box can never drive `sharp.extract` into a negative or
// overflowing crop. A fully-outside box degenerates to a 0-area box, which callers
// (runUnpack) filter out.
export const clampBox = (box: DetectionBox['box'], width: number, height: number): DetectionBox['box'] => {
  const x = Math.max(0, Math.min(width, Math.round(box.x)))
  const y = Math.max(0, Math.min(height, Math.round(box.y)))
  const x2 = Math.max(x, Math.min(width, Math.round(box.x + box.width)))
  const y2 = Math.max(y, Math.min(height, Math.round(box.y + box.height)))
  return { x, y, width: x2 - x, height: y2 - y }
}
