import { describe, it, expect, beforeEach } from 'vitest'
import { createOpenAIProvider } from '../src/modules/detection/openai'
import { DetectionProviderError } from '../src/modules/detection/errors'

const fakedClient = (_apiKey?: string) => ({
  chat: {
    completions: {
      create: async () => ({
        choices: [{
          message: { content: JSON.stringify({ detections: [{ label: 'chair', box: [5, 6, 40, 50], confidence: 0.8 }] }) },
        }],
      }),
    },
  },
})

const boxed = (box: number[]) => (_apiKey?: string) => ({
  chat: {
    completions: {
      create: async () => ({
        choices: [{
          message: { content: JSON.stringify({ detections: [{ label: 'chair', box, confidence: 0.8 }] }) },
        }],
      }),
    },
  },
})

describe('createOpenAIProvider', () => {
  beforeEach(() => { delete process.env.OPENAI_API_KEY })
  it('throws not-configured when the key is missing', async () => {
    const provider = createOpenAIProvider(() => ({}), { client: fakedClient as never })
    await expect(provider.detectBoxes(Buffer.from('a'), { width: 1000, height: 1000 })).rejects.toThrow(DetectionProviderError)
  })
  it('maps [x,y,w,h] pixels and clamps to bounds', async () => {
    process.env.OPENAI_API_KEY = 'k'
    const provider = createOpenAIProvider(() => ({ model: 'gpt-4o-mini' }), { client: fakedClient as never })
    const boxes = await provider.detectBoxes(Buffer.from('img'), { width: 1000, height: 1000 })
    expect(boxes[0]).toMatchObject({ label: 'chair', confidence: 0.8 })
    expect(boxes[0].box).toEqual({ x: 5, y: 6, width: 40, height: 50 })
  })
  it('clamps an out-of-range box to the passed image bounds', async () => {
    process.env.OPENAI_API_KEY = 'k'
    const provider = createOpenAIProvider(() => ({ model: 'gpt-4o-mini' }), { client: boxed([90, 90, 50, 50]) as never })
    const boxes = await provider.detectBoxes(Buffer.from('img'), { width: 100, height: 100 })
    expect(boxes[0].box).toEqual({ x: 90, y: 90, width: 10, height: 10 })
  })
})
