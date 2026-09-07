import type { DetectionProvider } from './provider.js'
import { clampBox } from './coords.js'
import { DetectionProviderError } from './errors.js'

export type ProviderConfig = { model?: string; device?: string; threshold?: number }
type Pipeline = (image: Buffer) => Promise<{ label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }[]>

const DEFAULT_MODEL = 'onnx-community/rfdetr_nano-ONNX'

export const createLocalProvider = (
  getConfig: () => ProviderConfig,
  deps: { pipeline?: (name: string, model: string, opts: Record<string, unknown>) => Promise<Pipeline> } = {},
): DetectionProvider => {
  const loadPipeline = deps.pipeline ?? (async (_name: string, model: string, opts: Record<string, unknown>) => {
    // Lazy import: @huggingface/transformers drags onnxruntime-node which is
    // native and heavy; keep module load light and only load it on first use.
    const { pipeline } = await import('@huggingface/transformers')
    return pipeline('object-detection', model, opts) as unknown as Promise<Pipeline>
  })

  return {
    name: 'local',
    async detectBoxes(image, bounds) {
      const cfg = getConfig()
      const model = cfg.model || DEFAULT_MODEL
      let run: Pipeline
      try {
        run = await loadPipeline('object-detection', model, {
          device: cfg.device ?? 'wasm',
          dtype: 'q8',
        })
      } catch (err) {
        throw new DetectionProviderError('model-unavailable', `local detection model unavailable: ${(err as Error).message}. Run: pnpm --filter @homebox/api detection:model`)
      }
      const raw = await run(image)
      return raw.map((d) => ({
        label: d.label,
        confidence: d.score,
        box: clampBox({ x: d.box.xmin, y: d.box.ymin, width: d.box.xmax - d.box.xmin, height: d.box.ymax - d.box.ymin }, bounds.width, bounds.height),
      }))
    },
  }
}
