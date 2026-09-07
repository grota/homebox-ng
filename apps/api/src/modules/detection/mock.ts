import type { DetectionBox, DetectionProviderImpl } from './provider.js'
import { clampBox } from './coords.js'

// Deterministic provider for e2e and smoke tests, gated behind DETECTION_MOCK=1.
// Returns fixed boxes so the full unpack→draft→publish flow is reproducible.
export const MOCK_BOXES: DetectionBox[] = [
  { label: 'chair', confidence: 0.92, box: { x: 20, y: 20, width: 200, height: 150 } },
  { label: 'table', confidence: 0.87, box: { x: 260, y: 60, width: 240, height: 120 } },
]

// Clamp the fixed boxes to the passed bounds so the mock honors the seam's
// in-bounds guarantee (a box may extend past the real image dims). We build a
// fresh box each call so the shared MOCK_BOXES array is never mutated.
export const createMockProvider = (boxes: DetectionBox[] = MOCK_BOXES): DetectionProviderImpl => ({
  name: 'mock',
  async detectBoxes(_image, bounds) {
    return boxes.map((b) => ({ ...b, box: clampBox(b.box, bounds.width, bounds.height) }))
  },
})
