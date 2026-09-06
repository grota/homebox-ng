import { describe, it, expect, beforeEach } from 'vitest'
import { createGoogleProvider } from '../src/modules/detection/google'
import { DetectionProviderError } from '../src/modules/detection/errors'

// Gemini box_2d is [ymin, xmin, ymax, xmax] normalized to 0-1000. The provider
// rescales it to actual pixels using the decoded image dims — injected here so
// the test never touches a real image.
const measure = async () => ({ width: 1000, height: 1000 })
const genai = () => ({
  models: {
    generateContent: async (_o: unknown) => ({ text: JSON.stringify({ detections: [{ label: 'lamp', box_2d: [200, 100, 600, 400], confidence: 0.9 }] }) }),
  },
})

describe('createGoogleProvider', () => {
  beforeEach(() => { delete process.env.GEMINI_API_KEY })
  it('throws not-configured when the key is missing', async () => {
    const provider = createGoogleProvider(() => ({}), { genai: genai as never, measure: measure as never })
    await expect(provider.detectBoxes(Buffer.from('a'))).rejects.toThrow(DetectionProviderError)
  })
  it('rescales box_2d [ymin,xmin,ymax,xmax]/1000 to pixel box', async () => {
    process.env.GEMINI_API_KEY = 'k'
    const provider = createGoogleProvider(() => ({ model: 'gemini-2.5-flash' }), { genai: genai as never, measure: measure as never })
    const boxes = await provider.detectBoxes(Buffer.from('img'))
    expect(boxes[0]).toMatchObject({ label: 'lamp', confidence: 0.9 })
    // On a 1000x1000 canvas: ymin 200→y 200, xmin 100→x 100, w=(400-100)→300, h=(600-200)→400
    expect(boxes[0].box).toEqual({ x: 100, y: 200, width: 300, height: 400 })
  })
})
