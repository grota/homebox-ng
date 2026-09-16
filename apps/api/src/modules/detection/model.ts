import { join } from 'node:path'

// The object-detection model the local provider runs, and where transformers.js
// keeps it.
//
// Both constants live here rather than beside their callers because they were
// duplicated once already, and the copy that drifted was the one that mattered:
// the CLI set `env.cacheDir` to DATA_DIR while the server never set it at all, so
// `pnpm detection:model` warmed a directory the server never read and the model
// was downloaded twice. Two call sites reading one definition cannot drift.

/** The model, unless `DETECTION_MODEL` overrides it. */
export const DEFAULT_MODEL = 'onnx-community/rfdetr_nano-ONNX'

/**
 * Where the model is cached, given the data directory.
 *
 * It goes under DATA_DIR, not beside the code, so that it is
 * `docker run -v …:/data` that carries it: a cache inside `node_modules` is
 * re-downloaded on every container recreate and is gone entirely under a
 * read-only rootfs.
 */
export const modelCacheDir = (dataDir: string): string => join(dataDir, 'models', 'detection')
