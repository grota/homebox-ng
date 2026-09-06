import sharp from 'sharp'
import type { DetectionProvider } from './provider'
import { clampBox } from './coords'
import { DetectionProviderError } from './errors'
import type { ProviderConfig } from './local'
import { GoogleGenAI } from '@google/genai'

const DEFAULT_MODEL = 'gemini-2.5-flash'

type GenAILike = { models: { generateContent: (o: unknown) => Promise<{ text?: string }> } }
type Result = { detections?: { label: string; box_2d: [number, number, number, number]; confidence: number }[] }

const PROMPT = `You are an object detector. Return JSON of the form
{"detections":[{"label":"<class>","box_2d":[ymin,xmin,ymax,xmax],"confidence":<0..1>}]}
box_2d values are normalized to 0-1000. Only include confident detections.`

export const createGoogleProvider = (
  getConfig: () => ProviderConfig,
  deps: { genai?: (apiKey: string) => GenAILike; measure?: (buffer: Buffer) => Promise<{ width: number; height: number }> } = {},
): DetectionProvider => {
  const makeGenai = deps.genai ?? ((apiKey: string) => {
    return new GoogleGenAI({ apiKey }) as unknown as GenAILike
  })
  const measure = deps.measure ?? (async (buffer: Buffer) => {
    const meta = await sharp(buffer).metadata()
    return { width: meta.width ?? 0, height: meta.height ?? 0 }
  })

  return {
    name: 'google',
    async detectBoxes(image) {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) throw new DetectionProviderError('not-configured', 'GEMINI_API_KEY is not set')
      const cfg = getConfig()
      const model = cfg.model || DEFAULT_MODEL
      const base64 = image.toString('base64')
      let text: string | undefined
      try {
        const client = makeGenai(apiKey)
        const res = await client.models.generateContent({
          model,
          contents: [{ parts: [
            { text: PROMPT },
            { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          ] }],
          config: { responseMimeType: 'application/json' },
        })
        text = res.text
      } catch (err) {
        throw new DetectionProviderError('api-error', `Gemini request failed: ${(err as Error).message}`)
      }
      if (!text) throw new DetectionProviderError('api-error', 'Gemini returned no content')
      const result = JSON.parse(text) as Result
      // Gemini's box_2d is normalized 0-1000; scale to the decoded pixel dims and
      // clamp so the box is real, in-bounds pixels. This keeps the
      // DetectionProvider interface unchanged — no consumer ever sees a
      // normalized space, per the spec's "normalized to pixels at the boundary".
      const { width, height } = await measure(image)
      return (result.detections ?? []).map((d) => {
        const [ymin, xmin, ymax, xmax] = d.box_2d
        return {
          label: d.label,
          confidence: d.confidence,
          box: clampBox({
            x: (xmin / 1000) * width,
            y: (ymin / 1000) * height,
            width: ((xmax - xmin) / 1000) * width,
            height: ((ymax - ymin) / 1000) * height,
          }, width, height),
        }
      })
    },
  }
}
