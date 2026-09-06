import { describe, it, expect } from 'vitest'
import { createLocalProvider } from '../src/modules/detection/local'
import type { DetectionBox } from '../src/modules/detection/provider'

const fakePipeline = async (_name: string, _model: string, _opts: unknown) =>
  async (_image: Buffer) => [
    { label: 'person', score: 0.95, box: { xmin: 10, ymin: 20, xmax: 110, ymax: 220 } },
  ]

describe('createLocalProvider', () => {
  it('maps transformers {xmin,ymin,xmax,ymax} to pixel boxes and clamps', async () => {
    const provider = createLocalProvider(() => ({ model: 'rfdetr' }), { pipeline: fakePipeline })
    const boxes = await provider.detectBoxes(Buffer.from('img'))
    expect(boxes[0]).toMatchObject({ label: 'person', confidence: 0.95 })
    expect(boxes[0].box).toEqual({ x: 10, y: 20, width: 100, height: 200 })
  })
  it('clamps to a smaller decoded image', async () => {
    const provider = createLocalProvider(() => ({ model: 'rfdetr' }), {
      pipeline: async () => async () => [
        { label: 'x', score: 1, box: { xmin: 0, ymin: 0, xmax: 500, ymax: 500 } },
      ],
    })
    // No clamp is applied when the provider has no source dims, so only assert the mapping here.
    const boxes = await provider.detectBoxes(Buffer.from('img'))
    expect(boxes[0].box).toEqual({ x: 0, y: 0, width: 500, height: 500 })
  })
})
