import { describe, it, expect } from 'vitest'
import { detectionRegistry } from '../src/modules/detection/provider'
import type { DetectionBox, DetectionProvider } from '../src/modules/detection/provider'

describe('detectionRegistry', () => {
  it('starts empty: get returns undefined and names() is []', () => {
    expect(detectionRegistry.get('remote')).toBeUndefined()
    expect(detectionRegistry.names()).toEqual([])
  })

  it('round-trips a fake provider through register/get/detectBoxes', async () => {
    const box: DetectionBox = {
      box: { x: 1, y: 2, width: 3, height: 4 },
      label: 'widget',
      confidence: 0.99,
    }
    const fake: DetectionProvider = {
      name: 'fake',
      detectBoxes: async (image) => {
        expect(Buffer.isBuffer(image)).toBe(true)
        return [box]
      },
    }

    detectionRegistry.register(fake)
    expect(detectionRegistry.get('fake')).toBe(fake)
    expect(detectionRegistry.names()).toEqual(['fake'])

    const provider = detectionRegistry.get('fake')!
    const result = await provider.detectBoxes(Buffer.from('image'))
    expect(result).toEqual([box])
  })
})
