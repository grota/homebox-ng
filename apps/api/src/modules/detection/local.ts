import type { DetectionProviderImpl } from './provider.js'
import { clampBox } from './coords.js'
import { DetectionProviderError } from './errors.js'
import { DEFAULT_MODEL, modelCacheDir } from './model.js'
import { DEFAULT_DATA_DIR } from '../../env.js'

export type ProviderConfig = { model?: string; device?: string; threshold?: number }
type Pipeline = (image: Buffer) => Promise<{ label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }[]>

/**
 * Point transformers.js at DATA_DIR, before anything is fetched.
 *
 * Exported as its own step so it can be asserted directly: this is the line whose
 * absence was the bug (see the comment inside `loadPipeline`), and the failure it
 * caused — a cache inside `node_modules` — is invisible until either the warm-up
 * CLI turns out to do nothing or a container re-downloads the model on every
 * recreate. Testing only `modelCacheDir` would not have caught it.
 *
 * The dynamic import is free the second time: the module is already loaded by the
 * pipeline call that follows.
 */
export const pointModelCacheAt = async (dataDir: string): Promise<void> => {
  const { env } = await import('@huggingface/transformers')
  env.cacheDir = modelCacheDir(dataDir)
}

export type LocalProviderDeps = {
  /** Injected in tests, so no unit test has to load onnxruntime. */
  pipeline?: (name: string, model: string, opts: Record<string, unknown>) => Promise<Pipeline>
  /** Where the model is cached. Defaults to the workspace-root data dir. */
  dataDir?: string
}

export const createLocalProvider = (
  getConfig: () => ProviderConfig,
  deps: LocalProviderDeps = {},
): DetectionProviderImpl => {
  const loadPipeline = deps.pipeline ?? (async (_name: string, model: string, opts: Record<string, unknown>) => {
    // Point the cache at DATA_DIR *before* the first fetch, and inside this lazy
    // path rather than at startup — setting it eagerly would pull the heavy native
    // module in on every boot, which is the thing the lazy import exists to avoid.
    //
    // Omitting this was a real bug with two faces. transformers.js defaults to a
    // `.cache/` inside its own directory in `node_modules`, so the model was
    // downloaded there instead of into the data directory: locally, the
    // `detection:model` CLI warmed a directory the server never read; in a
    // container, the model would have lived in the image's writable layer and been
    // re-downloaded on every recreate.
    await pointModelCacheAt(deps.dataDir ?? DEFAULT_DATA_DIR)

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
