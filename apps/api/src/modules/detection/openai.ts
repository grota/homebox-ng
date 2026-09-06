import type { DetectionProvider } from './provider'
import { clampBox } from './coords'
import { DetectionProviderError } from './errors'
import type { ProviderConfig } from './local'
import { OpenAI } from 'openai'

const DEFAULT_MODEL = 'gpt-4o-mini'

type ContentLike = { content?: string }
type OpenAIClientLike = {
  chat: { completions: { create: (o: unknown) => Promise<{ choices: { message: ContentLike }[] }> } }
}

const SYSTEM_PROMPT = `You are an object detector. Given an image, return JSON of the form
{"detections":[{"label":"<class>","box":[x,y,width,height],"confidence":<0..1>}]}
where box is in pixels (top-left origin). Only include confident detections.`

export const createOpenAIProvider = (
  getConfig: () => ProviderConfig,
  deps: { client?: (apiKey: string) => OpenAIClientLike } = {},
): DetectionProvider => {
  const makeClient = deps.client ?? ((apiKey: string) => {
    return new OpenAI({ apiKey }) as unknown as OpenAIClientLike
  })

  return {
    name: 'openai',
    async detectBoxes(image) {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new DetectionProviderError('not-configured', 'OPENAI_API_KEY is not set')
      const cfg = getConfig()
      const model = cfg.model || DEFAULT_MODEL
      const base64 = image.toString('base64')
      let result: { detections?: { label: string; box: number[]; confidence: number }[] }
      try {
        const client = makeClient(apiKey)
        const res = await client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: [
              { type: 'text', text: 'Detect objects in this image.' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ] },
          ],
        })
        const content = res.choices[0]?.message?.content
        if (!content) throw new DetectionProviderError('api-error', 'OpenAI returned no content')
        result = JSON.parse(content) as typeof result
      } catch (err) {
        if (err instanceof DetectionProviderError) throw err
        throw new DetectionProviderError('api-error', `OpenAI request failed: ${(err as Error).message}`)
      }
      return (result.detections ?? []).map((d) => ({
        label: d.label,
        confidence: d.confidence,
        box: clampBox({ x: d.box[0], y: d.box[1], width: d.box[2], height: d.box[3] }, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      }))
    },
  }
}
