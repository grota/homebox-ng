import { env, pipeline } from '@huggingface/transformers'
import { join } from 'node:path'

// Admin CLI for the local object-detection model. Reads DATA_DIR (directly from
// environment — NOT via loadEnv, which would require SESSION_SECRET) and points
// the transformers cache at DATA_DIR/models/detection/ so the model persists
// there. If the model is already cached it reports "ready"; otherwise it
// downloads on demand (progress printed), then reports the cache path. This is a
// first-run optimisation: the in-request path in local.ts still auto-downloads as
// a fallback, so this script is never load-bearing.
const dataDir = process.env.DATA_DIR ?? './data'
const model = process.env.DETECTION_MODEL ?? 'onnx-community/rfdetr_nano-ONNX'
const cacheDir = join(dataDir, 'models', 'detection')
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
