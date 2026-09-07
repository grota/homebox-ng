import { describe, it, expect, beforeEach } from 'vitest'
import { createGoogleProvider } from '../src/modules/detection/google'
import { DetectionProviderError } from '../src/modules/detection/errors'

// Gemini box_2d is [ymin, xmin, ymax, xmax] normalized to 0-1000. The provider
// rescales it to actual pixels using the bounds passed over the seam — injected
// `genai` keeps the test off a real API/image.
const genai = () => ({
  models: {
    generateContent: async (_o: unknown) => ({ text: JSON.stringify({ detections: [{ label: 'lamp', box_2d: [200, 100, 600, 400], confidence: 0.9 }] }) }),
  },
})

describe('createGoogleProvider', () => {
  beforeEach(() => { delete process.env.GEMINI_API_KEY })
  it('throws not-configured when the key is missing', async () => {
    const provider = createGoogleProvider(() => ({}), { genai: genai as never })
    await expect(provider.detectBoxes(Buffer.from('a'), { width: 1000, height: 1000 })).rejects.toThrow(DetectionProviderError)
  })
  it('rescales box_2d [ymin,xmin,ymax,xmax]/1000 to pixel box via the passed bounds', async () => {
    process.env.GEMINI_API_KEY = 'k'
    const provider = createGoogleProvider(() => ({ model: 'gemini-2.5-flash' }), { genai: genai as never })
    const boxes = await provider.detectBoxes(Buffer.from('img'), { width: 1000, height: 1000 })
    expect(boxes[0]).toMatchObject({ label: 'lamp', confidence: 0.9 })
    // On a 1000x1000 canvas: ymin 200→y 200, xmin 100→x 100, w=(400-100)→300, h=(600-200)→400
    expect(boxes[0].box).toEqual({ x: 100, y: 200, width: 300, height: 400 })
  })
  it('scales using the passed bounds, not an internally measured dims', async () => {
    process.env.GEMINI_API_KEY = 'k'
    const provider = createGoogleProvider(() => ({ model: 'gemini-2.5-flash' }), { genai: genai as never })
    const boxes = await provider.detectBoxes(Buffer.from('img'), { width: 300, height: 300 })
    // Normalized 0-1000 scaled to a 300x300 image:
    // x=100/1000*300=30, y=200/1000*300=60, w=(400-100)/1000*300=90, h=(600-200)/1000*300=120.
    // The box is in-bounds relative to the passed bounds (30+90=120≤300, 60+120=180≤300).
    expect(boxes[0].box).toEqual({ x: 30, y: 60, width: 90, height: 120 })
  })
})
