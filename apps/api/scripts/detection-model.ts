import { env, pipeline } from '@huggingface/transformers'
import { DEFAULT_DATA_DIR, resolveDataPath } from '../src/env.js'
import { DEFAULT_MODEL, modelCacheDir } from '../src/modules/detection/model.js'

// Admin CLI for the local object-detection model. Reads DATA_DIR (directly from
// environment — NOT via loadEnv, which would require SESSION_SECRET) and points
// the transformers cache at DATA_DIR/models/detection/ so the model persists
// there. A relative DATA_DIR resolves against the workspace root here too.
//
// The cache directory and the model name come from `detection/model.ts`, which
// the server's local provider reads as well. They used to be written out here and
// *not* in the server, so this script warmed a directory nothing read — the two
// must stay one definition. If the model is already cached it reports "ready";
// otherwise it downloads on demand (progress printed), then reports the cache
// path. This remains a first-run optimisation: the in-request path in local.ts
// auto-downloads as a fallback, so this script is never load-bearing.
const dataDir = resolveDataPath(process.env.DATA_DIR ?? DEFAULT_DATA_DIR)
const model = process.env.DETECTION_MODEL ?? DEFAULT_MODEL
const cacheDir = modelCacheDir(dataDir)
env.cacheDir = cacheDir

const main = async () => {
  const started = Date.now()
  process.stdout.write(`Checking object-detection model '${model}'…\n`)
  try {
    await pipeline('object-detection', model, {
      dtype: 'q8',
      progress_callback: (p: unknown) => {
        if (p && typeof p === 'object' && 'status' in p && p.status === 'progress') process.stdout.write('.')
        else if (p && typeof p === 'object' && 'status' in p) process.stdout.write(`\n[${String(p.status)}]`)
      },
    })
    process.stdout.write(`\nModel '${model}' is ready (${Date.now() - started}ms). Cache: ${cacheDir}\n`)
    process.exit(0)
  } catch (err) {
    process.stderr.write(`Model '${model}' could not be loaded/downloaded: ${(err as Error).message}\n`)
    process.exit(1)
  }
}
void main()
