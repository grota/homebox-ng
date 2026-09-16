import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalProvider, pointModelCacheAt } from '../src/modules/detection/local'
import { modelCacheDir } from '../src/modules/detection/model'
import type { DetectionBox } from '../src/modules/detection/provider'

const fakePipeline = async (_name: string, _model: string, _opts: unknown) =>
  async (_image: Buffer) => [
    { label: 'person', score: 0.95, box: { xmin: 10, ymin: 20, xmax: 110, ymax: 220 } },
  ]

describe('createLocalProvider', () => {
  it('maps transformers {xmin,ymin,xmax,ymax} to pixel boxes and clamps to bounds', async () => {
    const provider = createLocalProvider(() => ({ model: 'rfdetr' }), { pipeline: fakePipeline })
    const boxes = await provider.detectBoxes(Buffer.from('img'), { width: 1000, height: 1000 })
    expect(boxes[0]).toMatchObject({ label: 'person', confidence: 0.95 })
    expect(boxes[0].box).toEqual({ x: 10, y: 20, width: 100, height: 200 })
  })
  it('clamps an oversized box to the passed image bounds', async () => {
    const provider = createLocalProvider(() => ({ model: 'rfdetr' }), {
      pipeline: async () => async () => [
        { label: 'x', score: 1, box: { xmin: 0, ymin: 0, xmax: 500, ymax: 500 } },
      ],
    })
    // Bounds arrive over the seam; a 500×500 box on a 100×100 image is clamped
    // in-bounds rather than left as the provider's raw coords.
    const boxes = await provider.detectBoxes(Buffer.from('img'), { width: 100, height: 100 })
    expect(boxes[0].box).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })
})

// The bug this pins, reported as "the warm-up CLI does nothing": the server never
// set `env.cacheDir`, so transformers.js used its own default — a `.cache/` inside
// the package directory in `node_modules`. The CLI, which *did* set it, warmed
// DATA_DIR/models/detection, which the server never read: two downloads, and
// nothing shared between them.
//
// Importing the real module is the point. Asserting `modelCacheDir()` alone would
// have passed the whole time the bug was live.
describe('pointModelCacheAt', () => {
  it('points the transformers cache at DATA_DIR, not at node_modules', async () => {
    const { env } = await import('@huggingface/transformers')
    const before = env.cacheDir
    const dataDir = mkdtempSync(join(tmpdir(), 'hbng-model-'))
    try {
      await pointModelCacheAt(dataDir)
      // transformers.js normalises to a trailing slash; compare on the directory.
      expect(env.cacheDir.replace(/\/+$/, '')).toBe(modelCacheDir(dataDir))
      expect(env.cacheDir).not.toContain('node_modules')
    } finally {
      env.cacheDir = before
    }
  })
})
