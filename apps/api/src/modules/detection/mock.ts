import type { DetectionBox, DetectionProvider } from './provider.js'

// Deterministic provider for e2e and smoke tests, gated behind DETECTION_MOCK=1.
// Returns fixed boxes so the full unpack→draft→publish flow is reproducible.
export const MOCK_BOXES: DetectionBox[] = [
  { label: 'chair', confidence: 0.92, box: { x: 20, y: 20, width: 200, height: 150 } },
  { label: 'table', confidence: 0.87, box: { x: 260, y: 60, width: 240, height: 120 } },
]

export const createMockProvider = (boxes: DetectionBox[] = MOCK_BOXES): DetectionProvider => ({
  name: 'mock',
  async detectBoxes(_image) { return boxes },
})
