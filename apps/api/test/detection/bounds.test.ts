import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createLocalProvider } from '../../src/modules/detection/local'
import { createOpenAIProvider } from '../../src/modules/detection/openai'
import { createGoogleProvider } from '../../src/modules/detection/google'
import { createMockProvider } from '../../src/modules/detection/mock'
import type { DetectionBox, DetectionProvider } from '../../src/modules/detection/provider'

// A known image size on which every provider must operate. Boxes are pixel
// space, top-left origin, and every returned box must lie fully inside these
// bounds — this is the seam's in-bounds guarantee.
const BOUNDS = { width: 300, height: 300 }

// The contract, stated once: every box honors the passed bounds.
const expectInBounds = (boxes: DetectionBox[], bounds = BOUNDS) => {
  expect(boxes.length).toBeGreaterThan(0)
  for (const { box } of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.width)
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.height)
  }
}

// === fakes: non-trivial in-bounds detections per provider ===

const localPipeline = async (_name: string, _model: string, _opts: unknown) =>
  async (_image: Buffer) => [
    { label: 'person', score: 0.95, box: { xmin: 10, ymin: 20, xmax: 110, ymax: 220 } },
  ]

const openaiClient = (_apiKey?: string) => ({
  chat: {
    completions: {
      create: async () => ({
        choices: [{ message: { content: JSON.stringify({ detections: [{ label: 'chair', box: [5, 6, 40, 50], confidence: 0.8 }] }) } }],
      }),
    },
  },
})

const googleGenai = () => ({
  models: {
    generateContent: async (_o: unknown) => ({ text: JSON.stringify({ detections: [{ label: 'lamp', box_2d: [200, 100, 600, 400], confidence: 0.9 }] }) }),
  },
})

// === fakes: deliberately over-wide detections per provider ===

const wideLocalPipeline = async (_name: string, _model: string, _opts: unknown) =>
  async (_image: Buffer) => [
    { label: 'wide', score: 1, box: { xmin: 250, ymin: 100, xmax: 350, ymax: 200 } },
  ]

// box [x, y, width, height] → x + width = 350 > 300
const wideOpenaiClient = (_apiKey?: string) => ({
  chat: {
    completions: {
      create: async () => ({
        choices: [{ message: { content: JSON.stringify({ detections: [{ label: 'wide', box: [250, 100, 100, 100], confidence: 1 }] }) } }],
      }),
    },
  },
})

// box_2d [ymin, xmin, ymax, xmax] normalized 0-1000 → ymax/xmax of 1250 scale to
// 375px on a 300px axis, overflowing the bounds.
const wideGoogleGenai = () => ({
  models: {
    generateContent: async (_o: unknown) => ({ text: JSON.stringify({ detections: [{ label: 'wide', box_2d: [0, 0, 1250, 1250], confidence: 1 }] }) }),
  },
})

describe('detection box in-bounds invariant (the seam contract)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'k'
    process.env.GEMINI_API_KEY = 'k'
  })
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.GEMINI_API_KEY
  })

  const inBounds: { name: string; make: () => DetectionProvider }[] = [
    { name: 'local', make: () => createLocalProvider(() => ({ model: 'rfdetr' }), { pipeline: localPipeline }) },
    { name: 'openai', make: () => createOpenAIProvider(() => ({ model: 'gpt-4o-mini' }), { client: openaiClient as never }) },
    { name: 'google', make: () => createGoogleProvider(() => ({ model: 'gemini-2.5-flash' }), { genai: googleGenai as never }) },
    { name: 'mock', make: () => createMockProvider() },
  ]

  it.each(inBounds)('$name returns only boxes inside the passed bounds', async ({ make }) => {
    const boxes = await make().detectBoxes(Buffer.from('x'), BOUNDS)
    expectInBounds(boxes)
  })

  const overWide: { name: string; make: () => DetectionProvider; clamped: DetectionBox['box'] }[] = [
    { name: 'local', make: () => createLocalProvider(() => ({ model: 'rfdetr' }), { pipeline: wideLocalPipeline }), clamped: { x: 250, y: 100, width: 50, height: 100 } },
    { name: 'openai', make: () => createOpenAIProvider(() => ({ model: 'gpt-4o-mini' }), { client: wideOpenaiClient as never }), clamped: { x: 250, y: 100, width: 50, height: 100 } },
    { name: 'google', make: () => createGoogleProvider(() => ({ model: 'gemini-2.5-flash' }), { genai: wideGoogleGenai as never }), clamped: { x: 0, y: 0, width: 300, height: 300 } },
    { name: 'mock', make: () => createMockProvider([{ label: 'wide', confidence: 1, box: { x: 250, y: 100, width: 100, height: 100 } }]), clamped: { x: 250, y: 100, width: 50, height: 100 } },
  ]

  it.each(overWide)('$name clamps an over-wide box to fit the passed bounds', async ({ make, clamped }) => {
    const boxes = await make().detectBoxes(Buffer.from('x'), BOUNDS)
    expect(boxes[0].box).toEqual(clamped)
    expectInBounds(boxes)
  })
})
