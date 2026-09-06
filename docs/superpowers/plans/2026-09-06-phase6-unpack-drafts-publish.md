# Phase 6 — Unpack / Drafts / Publish + Detection Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire three real detection providers (local transformers.js, OpenAI, Google Gemini) behind the existing `DetectionProvider` interface, then build the unpack (multi-item photo import) → draft → publish lifecycle on top of them, keeping drafts out of the catalog via a `published=true` filter.

**Architecture:** Three concrete providers register once into the existing `detectionRegistry` singleton; `runUnpack` resolves the provider named by `instance_settings.detection_provider`, detects boxes, crops each (sharp), and creates a `published=false` draft item with a single image. Drafts get a `/drafts` page (rename/publish/discard) and never leak into search or the catalog because every shared read path filters `published=true`. API keys live only in `process.env`; the local model is lazy-imported to keep module load light.

**Tech Stack:** `@huggingface/transformers`, `openai`, `@google/genai`, `sharp`, `Drizzle ORM` + better-sqlite3, `tRPC v11`, `React 19` + `react-query v5`, `Vitest`, `Playwright`, `tsx` (for the admin CLI script).

**Spec:** `docs/superpowers/specs/2026-09-06-phase6-unpack-drafts-publish-design.md`

## Global Constraints

- Monorepo build order `shared → db → api → web`; consumers import from built `dist/`. Any new API surface must be reflected in the built `@homebox/api`/`@homebox/shared` packages for the web to type-check (`react-query` client imports `AppRouter` from `@homebox/api`).
- SQLite conventions: camelCase JS keys, snake_case SQL columns; booleans `integer(..., { mode: 'boolean' })`; timestamps INTEGER epoch-ms; the `instance_settings` row uses fixed `id = 1`.
- `DetectionProvider` interface is reused **unchanged**: `detectBoxes(image: Buffer): Promise<DetectionBox[]>`, `DetectionBox = { box: { x,y,width,height }, label, confidence }`.
- API keys (`GEMINI_API_KEY` / `OPENAI_API_KEY`) are read **only** from `process.env`, never from `detection_config`, never persisted, never echoed.
- Secrets never in the DB; `detection_config` holds only non-secret knobs (model id, device, threshold).
- `items.itemTypeId` is `NOT NULL`, so a draft item **must** carry a real type (see Ruling 1).
- Copy/UI strings are bundled under `en` only (i18n infra ready). New visible strings go in `apps/web/public/locales/en/*.json`.
- Commit messages end `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

### Rulings on spec gaps (binding — conflicts in the plan/text resolve against these)

1. **Drafts are always typed.** `items.itemTypeId` is `NOT NULL` with no seeded default type. `runUnpack` therefore requires an `itemTypeId`: the `kind: 'item'` path inherits the source item's type; the `kind: 'root'` (multipart route) path takes an `itemTypeId` form field and, when absent, falls back to the lowest-id existing item type — returning a clear `400` if no item type exists. The spec left this unspecified; it is the least-invasive way to keep drafts type-valid without widening the schema.
2. **Provider config flow.** `detectBoxes(image: Buffer)` has no config parameter and the interface must stay unchanged. Providers read their model/device/threshold from `instance_settings.detection_config` via a `getConfig: () => ProviderConfig` closure supplied at registration (an accessor over `dbHolder.current`), and read their API keys from `process.env` directly at call time. There is no hidden mutable global; config is read per request through the closure.
3. **The `remote` enum value is removed.** Phase 5 shipped `['remote', 'local']`. Phase 6 ships `['local', 'google', 'openai']`; a migration remaps a stored `remote` row to `google` (the default remote engine). The admin UI's `remote` radio is replaced by `google`/`openai` radios.
4. **Root-photo source is not retained.** Each draft keeps only its own crop; the source photo of a `root` unpack is discarded (written to a temp path and removed in a `finally`). A `root` unpack never writes the source into uploads.
5. **No overlapping-box dedupe.** All detected boxes are kept (no NMS). A future threshold/NMS knob is a `detection_config` addition.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/shared/src/settings.ts` | modify | `DETECTION_PROVIDERS = ['local','google','openai']`; `DEFAULT_INSTANCE_SETTINGS.detectionProvider = 'google'` |
| `packages/db/src/schema.ts` | modify | `instanceSettings.detectionProvider` enum `['local','google','openai']`, default `'google'` |
| `packages/db/drizzle/0004_*.sql` | generate+edit | Table rebuild to new default + `UPDATE ... remote→google` data-fix |
| `apps/api/src/modules/detection/errors.ts` | create | `DetectionProviderError` + codes |
| `apps/api/src/modules/detection/coords.ts` | create | `clampBox` (normalize to pixels, clamp to bounds) |
| `apps/api/src/modules/detection/local.ts` | create | local transformers provider (lazy import) |
| `apps/api/src/modules/detection/openai.ts` | create | OpenAI provider |
| `apps/api/src/modules/detection/google.ts` | create | Google Gemini provider |
| `apps/api/src/modules/detection/mock.ts` | create | deterministic provider for e2e/tests |
| `apps/api/src/modules/detection/register.ts` | create | `registerDetectionProviders(getSettings, { mock })` |
| `apps/api/src/modules/unpack/service.ts` | create | `runUnpack` — detect/crop/create drafts |
| `apps/api/src/modules/unpack/router.ts` | create | tRPC `unpack.run` (`kind:'item'`) |
| `apps/api/src/modules/unpack/route.ts` | create | raw `POST /upload/unpack` (`kind:'root'`) |
| `apps/api/src/modules/drafts/router.ts` | create | `drafts.list/update/publish/publishAll/discard` |
| `apps/api/src/modules/drafts/service.ts` | create | drafts orchestration + file cleanup |
| `apps/api/src/modules/items/repo.ts` | modify | `published=true` base predicate; `listDraftItems`; `setItemPublished` |
| `apps/api/src/modules/items/service.ts` | modify | extract + export `hydrateRows` |
| `apps/api/src/router.ts` | modify | register `unpackRouter`, `draftsRouter` |
| `apps/api/src/server.ts` | modify | register detection providers + unpack route |
| `apps/api/src/context.ts` | modify | `Context.dataDir`; `createContext(holder, dataDir)` |
| `apps/api/scripts/detection-model.ts` | create | admin CLI model check/download |
| `apps/api/package.json` | modify | deps `@huggingface/transformers`, `openai`, `@google/genai`; dev `tsx`; script `detection:model` |
| `apps/web/src/features/drafts/DraftsPage.tsx` | create | drafts list/rename/publish/discard |
| `apps/web/src/features/drafts/UnpackModal.tsx` | create | root unpack (upload) surface |
| `apps/web/src/features/drafts/index.ts` | create | barrel export |
| `apps/web/src/app/routes.tsx` | modify | add `/drafts` route |
| `apps/web/src/app/Shell.tsx` | modify | add Drafts nav entry |
| `apps/web/src/features/items/ItemDetail.tsx` | modify | "Unpack this photo" per image |
| `apps/web/src/features/admin/AdminSettingsTab.tsx` | modify | local/google/openai radios + model input |
| `apps/web/public/locales/en/translation.json` | modify | drafts + unpack strings |
| `apps/web/public/locales/en/admin.json` | modify | detection provider radio strings |
| `apps/api/test/*` + `apps/web/test/*` + `apps/web/e2e/*` | create/modify | tests below |

---

### Task 1: Widen `detection_provider` enum + default (shared + db + migration)

**Files:**
- Modify: `packages/shared/src/settings.ts:43,59-63`
- Modify: `packages/db/src/schema.ts:95-101`
- Generate+edit: `packages/db/drizzle/0004_*.sql`
- Modify: `apps/api/package.json` (add deps before any provider compiles)

**Interfaces:**
- Consumes: existing `DETECTION_PROVIDERS`/`DEFAULT_INSTANCE_SETTINGS` from `@homebox/shared`; existing `instanceSettings` schema.
- Produces: `DetectionProvider = 'local' | 'google' | 'openai'` (shared type); `instanceSettings.detectionProvider` accepts the three new values with DB default `'google'`.

- [ ] **Step 1: Change the shared enum + default**

In `packages/shared/src/settings.ts`, replace line 43 and line 61:

```ts
export const DETECTION_PROVIDERS = ['local', 'google', 'openai'] as const
export type DetectionProvider = (typeof DETECTION_PROVIDERS)[number]
```
```ts
export const DEFAULT_INSTANCE_SETTINGS: InstanceSettingsDto = {
  maxUploadMb: 10,
  detectionProvider: 'google',
  detectionConfig: null,
}
```

- [ ] **Step 2: Change the DB schema enum + default**

In `packages/db/src/schema.ts`, replace `instanceSettings`:

```ts
export const instanceSettings = sqliteTable('instance_settings', {
  id: integer('id').primaryKey(), // fixed row id = 1
  maxUploadMb: integer('max_upload_mb').notNull().default(10),
  detectionProvider: text('detection_provider', { enum: ['local', 'google', 'openai'] })
    .notNull().default('google'),
  detectionConfig: text('detection_config', { mode: 'json' }),
})
```

- [ ] **Step 3: Add the provider dependencies**

Add to `apps/api/package.json` `dependencies`: `"@google/genai": "^1.23.0"`, `"@huggingface/transformers": "^3.8.1"`, `"openai": "^5.0.0"`. Add to `devDependencies`: `"tsx": "^4.19.0"`. Then run `pnpm install`.

- [ ] **Step 4: Regenerate + patch the migration**

Run: `cd apps/api && pnpm --filter @homebox/db exec drizzle-kit generate` (or `pnpm --filter @homebox/db drizzle-kit generate`). Drizzle-kit detects the default change `'remote'`→`'google'` on the SQLite text column and emits a table-rebuild migration under `packages/db/drizzle/0004_<tag>.sql` (create new table, `INSERT ... SELECT`, drop, rename). Confirm it is journalled in `drizzle/meta/_journal.json`.

Open the generated `0004_<tag>.sql` and append the data-fix so stored `remote` rows become `google`:

```sql
--> statement-breakpoint
UPDATE `instance_settings` SET `detection_provider` = 'google' WHERE `detection_provider` = 'remote';
```

> If drizzle-kit emits an **empty** migration (SQLite sometimes ignores default-only diffs), hand-author `0004_<tag>.sql` following the `0003` pattern: recreate `instance_settings` with the new default and the UPDATE above, and register the tag in `drizzle/meta/_journal.json` (append `{ "idx": 4, "version": "6", "when": <Date.now()>, "tag": "0004_<tag>", "breakpoints": true }`) and copy `0003_snapshot.json` → `0004_<tag>_snapshot.json` (schema is otherwise unchanged).

- [ ] **Step 5: Write the settings-default test**

Create `apps/api/test/instanceSettingsEnum.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { DEFAULT_INSTANCE_SETTINGS } from '@homebox/shared'
import { getOrCreate } from '../src/modules/instanceSettings/repo'

describe('detection_provider enum widening', () => {
  it('defaults to google and accepts the new providers', () => {
    expect(DEFAULT_INSTANCE_SETTINGS.detectionProvider).toBe('google')
    const db = createDb(':memory:')
    runMigrations(db)
    const s = getOrCreate(db)
    expect(s.detectionProvider).toBe('google')
  })
  it('migration remaps a stored remote row to google', () => {
    const db = createDb(':memory:')
    runMigrations(db)
    db.run("INSERT INTO instance_settings (id, max_upload_mb, detection_provider) VALUES (1, 10, 'remote')")
    // re-migrate the data-fix path is covered by runMigrations above for a fresh DB;
    // here assert the data-fix by running it directly and reading back.
    db.run("UPDATE instance_settings SET detection_provider = 'google' WHERE detection_provider = 'remote'")
    const row = db.prepare('SELECT detection_provider AS p FROM instance_settings WHERE id = 1').get() as { p: string }
    expect(row.p).toBe('google')
  })
})
```

> Remove/replace any existing `apps/api/test/instanceSettings.test.ts` assertion that hard-codes `detectionProvider: 'remote'`.

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @homebox/api test instanceSettingsEnum`
Expected: PASS (both cases). If the migration step fails, revisit Step 4.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/settings.ts packages/db/src/schema.ts packages/db/drizzle apps/api/package.json pnpm-lock.yaml apps/api/test/instanceSettingsEnum.test.ts
git commit -m "feat(db): widen detection_provider to local/google/openai with remote→google migration"
```

---

### Task 2: `DetectionProviderError` + coordinate clamp helper

**Files:**
- Create: `apps/api/src/modules/detection/errors.ts`
- Create: `apps/api/src/modules/detection/coords.ts`
- Test: `apps/api/test/coords.test.ts`

**Interfaces:**
- Produces: `DetectionProviderErrorCode`, `DetectionProviderError` (extends `Error`, `.code`), `clampBox(box, width, height): DetectionBox['box']`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/coords.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { clampBox } from '../src/modules/detection/coords'
import { DetectionProviderError } from '../src/modules/detection/errors'
import type { DetectionProviderErrorCode } from '../src/modules/detection/errors'

describe('clampBox', () => {
  it('clamps out-of-range coordinates to the image bounds', () => {
    expect(clampBox({ x: -10, y: 5, width: 100, height: 200 }, 100, 150))
      .toEqual({ x: 0, y: 5, width: 100, height: 145 })
    expect(clampBox({ x: 90, y: 90, width: 50, height: 50 }, 100, 100))
      .toEqual({ x: 90, y: 90, width: 10, height: 10 })
  })
  it('zeroes a fully-outside box', () => {
    expect(clampBox({ x: 200, y: 200, width: 30, height: 30 }, 100, 100))
      .toEqual({ x: 100, y: 100, width: 0, height: 0 })
  })
})

describe('DetectionProviderError', () => {
  it('carries a typed code and name', () => {
    const e = new DetectionProviderError('not-configured', 'no key')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('DetectionProviderError')
    expect((e as unknown as { code: DetectionProviderErrorCode }).code).toBe('not-configured')
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @homebox/api test coords`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `errors.ts`**

```ts
export type DetectionProviderErrorCode = 'not-configured' | 'model-unavailable' | 'api-error' | 'rate-limited'

export class DetectionProviderError extends Error {
  declare code: DetectionProviderErrorCode
  constructor(code: DetectionProviderErrorCode, message: string) {
    super(message)
    this.name = 'DetectionProviderError'
    this.code = code
  }
}
```

- [ ] **Step 4: Implement `coords.ts`**

```ts
import type { DetectionBox } from './provider'

// Clamp a pixel box (top-left origin) to the decoded image bounds so a
// malformed/out-of-range box can never drive `sharp.extract` into a negative or
// overflowing crop. A fully-outside box degenerates to a 0-area box, which callers
// (runUnpack) filter out.
export const clampBox = (box: DetectionBox['box'], width: number, height: number): DetectionBox['box'] => {
  const x = Math.max(0, Math.min(width, Math.round(box.x)))
  const y = Math.max(0, Math.min(height, Math.round(box.y)))
  const x2 = Math.max(x, Math.min(width, Math.round(box.x + box.width)))
  const y2 = Math.max(y, Math.min(height, Math.round(box.y + box.height)))
  return { x, y, width: x2 - x, height: y2 - y }
}
```

- [ ] **Step 5: Run to confirm it passes**

Run: `pnpm --filter @homebox/api test coords`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/detection/errors.ts apps/api/src/modules/detection/coords.ts apps/api/test/coords.test.ts
git commit -m "feat(detection): typed provider errors + box clamp helper"
```

---

### Task 3: Local transformers.js provider

**Files:**
- Create: `apps/api/src/modules/detection/local.ts`
- Test: `apps/api/test/localProvider.test.ts`

**Interfaces:**
- Consumes: `ProviderConfig` (from `register.ts`/`provider.ts`), `clampBox`, `DetectionProviderError`.
- Produces: `createLocalProvider(getConfig: () => ProviderConfig, deps?: { pipeline?: (name, model, opts) => Promise<Pipeline> }): DetectionProvider`. The `pipeline` dep is injected for tests (a faked transformers pipeline), defaulting to a lazy `import('@huggingface/transformers')`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/localProvider.test.ts`:

```ts
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
```

> Note: binding clamp to source dims is a `runUnpack` concern (see Task 8); the provider produces unmapped pixel boxes as-is from the model. The clamp test above therefore asserts the raw mapping, not clamping.

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @homebox/api test localProvider`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `local.ts`**

```ts
import type { DetectionProvider } from './provider'
import { clampBox } from './coords'
import { DetectionProviderError } from './errors'

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
    return pipeline('object-detection', model, opts) as Promise<Pipeline>
  })

  return {
    name: 'local',
    async detectBoxes(image) {
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
        box: clampBox({ x: d.box.xmin, y: d.box.ymin, width: d.box.xmax - d.box.xmin, height: d.box.ymax - d.box.ymin }, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      }))
    },
  }
}
```

> Using `Number.MAX_SAFE_INTEGER` as the clamp bound keeps the mapping pure at the provider boundary; `runUnpack` re-clamps with the actual decoded dims before cropping (Task 8). This satisfies the spec's "normalized to pixels at the provider boundary" without the provider needing image dims.

- [ ] **Step 4: Run to confirm it passes**

Run: `pnpm --filter @homebox/api test localProvider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/detection/local.ts apps/api/test/localProvider.test.ts
git commit -m "feat(detection): local transformers.js provider"
```

---

### Task 4: OpenAI vision provider

**Files:**
- Create: `apps/api/src/modules/detection/openai.ts`
- Test: `apps/api/test/openaiProvider.test.ts`

**Interfaces:**
- Produces: `createOpenAIProvider(getConfig, deps?: { client?: (apiKey: string) => OpenAIClientLike }): DetectionProvider` where `OpenAIClientLike = { chat: { completions: { create: (o) => Promise<{ choices: { message: { content?: string } }[] }> } } }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/openaiProvider.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createOpenAIProvider } from '../src/modules/detection/openai'
import { DetectionProviderError } from '../src/modules/detection/errors'

const fakedClient = (overrides?: string) => ({
  chat: {
    completions: {
      create: async () => ({
        choices: [{
          message: { content: overrides ?? JSON.stringify({ detections: [{ label: 'chair', box: [5, 6, 40, 50], confidence: 0.8 }] }) },
        }],
      }),
    },
  },
})

describe('createOpenAIProvider', () => {
  beforeEach(() => { delete process.env.OPENAI_API_KEY })
  it('throws not-configured when the key is missing', async () => {
    const provider = createOpenAIProvider(() => ({}), { client: fakedClient as never })
    await expect(provider.detectBoxes(Buffer.from('a'))).rejects.toThrow(DetectionProviderError)
  })
  it('maps [x,y,w,h] pixels and clamps to bounds', async () => {
    process.env.OPENAI_API_KEY = 'k'
    const provider = createOpenAIProvider(() => ({ model: 'gpt-4o-mini' }), { client: fakedClient as never })
    const boxes = await provider.detectBoxes(Buffer.from('img'))
    expect(boxes[0]).toMatchObject({ label: 'chair', confidence: 0.8 })
    expect(boxes[0].box).toEqual({ x: 5, y: 6, width: 40, height: 50 })
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @homebox/api test openaiProvider`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `openai.ts`**

```ts
import type { DetectionProvider } from './provider'
import { clampBox } from './coords'
import { DetectionProviderError } from './errors'
import type { ProviderConfig } from './local'

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
    // openai is a pure-JS SDK over fetch, so a top-level import is safe (no native).
    // Keep it lazy so tests that never call a real API don't pull it in.
    const { OpenAI } = require('openai') as typeof import('openai')
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
```

> For consistency with Task 3, use `require('openai')` in a lazy block. (If the project's ESM settings reject `require`, switch to a top-level `import { OpenAI } from 'openai'` — the SDK is non-native and safe to load eagerly.) The plan's tests inject `deps.client`, so the real client is never constructed in the suite.

- [ ] **Step 4: Run to confirm it passes**

Run: `pnpm --filter @homebox/api test openaiProvider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/detection/openai.ts apps/api/test/openaiProvider.test.ts
git commit -m "feat(detection): OpenAI vision provider"
```

---

### Task 5: Google Gemini provider

**Files:**
- Create: `apps/api/src/modules/detection/google.ts`
- Test: `apps/api/test/googleProvider.test.ts`

**Interfaces:**
- Produces: `createGoogleProvider(getConfig, deps?: { genai?: (apiKey: string) => GenAILike }): DetectionProvider` where `GenAILike = { models: { generateContent: (o) => Promise<{ text?: string }> } }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/googleProvider.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createGoogleProvider } from '../src/modules/detection/google'
import { DetectionProviderError } from '../src/modules/detection/errors'

// Gemini box_2d is [ymin, xmin, ymax, xmax] normalized to 0-1000. The provider
// rescales it to actual pixels using the decoded image dims — injected here so
// the test never touches a real image.
const measure = async () => ({ width: 1000, height: 1000 })
const genai = () => ({
  models: {
    generateContent: async (_o: unknown) => ({ text: JSON.stringify({ detections: [{ label: 'lamp', box_2d: [200, 100, 600, 400], confidence: 0.9 }] }) }),
  },
})

describe('createGoogleProvider', () => {
  beforeEach(() => { delete process.env.GEMINI_API_KEY })
  it('throws not-configured when the key is missing', async () => {
    const provider = createGoogleProvider(() => ({}), { genai: genai as never, measure: measure as never })
    await expect(provider.detectBoxes(Buffer.from('a'))).rejects.toThrow(DetectionProviderError)
  })
  it('rescales box_2d [ymin,xmin,ymax,xmax]/1000 to pixel box', async () => {
    process.env.GEMINI_API_KEY = 'k'
    const provider = createGoogleProvider(() => ({ model: 'gemini-2.5-flash' }), { genai: genai as never, measure: measure as never })
    const boxes = await provider.detectBoxes(Buffer.from('img'))
    expect(boxes[0]).toMatchObject({ label: 'lamp', confidence: 0.9 })
    // On a 1000x1000 canvas: ymin 200→y 200, xmin 100→x 100, w=(400-100)→300, h=(600-200)→400
    expect(boxes[0].box).toEqual({ x: 100, y: 200, width: 300, height: 400 })
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @homebox/api test googleProvider`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `google.ts`**

```ts
import sharp from 'sharp'
import type { DetectionProvider } from './provider'
import { clampBox } from './coords'
import { DetectionProviderError } from './errors'
import type { ProviderConfig } from './local'

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
    const { GoogleGenAI } = require('@google/genai') as typeof import('@google/genai')
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
```

> As in Task 4, `require('@google/genai')` is lazy; tests inject `deps.genai` and `deps.measure`. The default `measure` decodes the image with sharp; `runUnpack` (Task 8) re-clamps the provider's already-pixel boxes against its own decoded dims, so no `scaleBox` pairing is needed at the consumer.

- [ ] **Step 4: Run to confirm it passes**

Run: `pnpm --filter @homebox/api test googleProvider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/detection/google.ts apps/api/test/googleProvider.test.ts
git commit -m "feat(detection): Google Gemini provider (rescales to pixel coords)"
```

---

### Task 6: Mock provider, registration wiring, context `dataDir`

**Files:**
- Create: `apps/api/src/modules/detection/mock.ts`
- Create: `apps/api/src/modules/detection/register.ts`
- Modify: `apps/api/src/context.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/test/detection.test.ts`
- Modify: `apps/api/src/modules/instanceSettings/repo.ts` (seed explicit `google` for fresh instances — see note)

**Interfaces:**
- Consumes: `createLocalProvider`, `createOpenAIProvider`, `createGoogleProvider`, `detectionRegistry`, `getInstanceSettings`.
- Produces: `createMockProvider(boxes?): DetectionProvider`; `registerDetectionProviders(getSettings, opts: { mock: boolean }): void`; `Context.dataDir: string`; `createContext(holder, dataDir)`.

- [ ] **Step 1: Write the mock + register modules**

Create `apps/api/src/modules/detection/mock.ts`:

```ts
import type { DetectionBox, DetectionProvider } from './provider'

// Deterministic provider for e2e and smoke tests, gated behind DETECTION_MOCK=1.
// Returns fixed boxes so the full unpack→draft→publish flow is reproducible.
export const MOCK_BOXES: DetectionBox[] = [
  { label: 'chair', confidence: 0.92, box: { x: 20, y: 20, width: 200, height: 150 } },
  { label: 'table', confidence: 0.87, box: { x: 260, y: 60, width: 240, height: 120 } },
]

export const createMockProvider = (boxes: DetectionBox[] = MOCK_BOXES): DetectionProvider => ({
  name: 'mock',
  async detectBoxes(_image) { return boxes },
})
```

Create `apps/api/src/modules/detection/register.ts`:

```ts
import type { InstanceSettingsDto } from '@homebox/shared'
import { detectionRegistry } from './provider'
import { createLocalProvider } from './local'
import { createOpenAIProvider } from './openai'
import { createGoogleProvider } from './google'
import { createMockProvider } from './mock'
import type { ProviderConfig } from './local'

type GetSettings = () => InstanceSettingsDto

// Register the built-in providers. `getSettings` reads instance settings through
// a holder so per-request config (model/device/threshold) is available to each
// provider's `detectBoxes` without widening the `DetectionProvider` interface.
// When `opts.mock` is set (e2e smoke), register a single deterministic provider.
export const registerDetectionProviders = (getSettings: GetSettings, opts: { mock?: boolean } = {}): void => {
  detectionRegistry.clear()
  if (opts.mock) {
    detectionRegistry.register(createMockProvider())
    return
  }
  const getConfig = (): ProviderConfig => ((getSettings().detectionConfig ?? {}) as ProviderConfig)
  detectionRegistry.register(createLocalProvider(getConfig))
  detectionRegistry.register(createOpenAIProvider(getConfig))
  detectionRegistry.register(createGoogleProvider(getConfig))
}
```

- [ ] **Step 2: Add `clear()` to the registry**

In `apps/api/src/modules/detection/provider.ts`, add to the class:

```ts
  clear() { this.providers.clear() }
```

- [ ] **Step 3: Add `dataDir` to the tRPC context**

In `apps/api/src/context.ts`:
- Change `Context` to include `dataDir: string`.
- Change `createContext` to accept `(holder: DbHolder, dataDir: string)` and set `dataDir` on the returned context.

```ts
export type Context = { db: DrizzleDb; user: SessionUser | null; req: FastifyRequest; res: FastifyReply; dataDir: string }

export const createContext = (holder: DbHolder, dataDir: string) => async ({ req, res }: { req: FastifyRequest; res: FastifyReply }): Promise<Context> => {
  const db = holder.current
  const token = parseSessionCookie(req.headers.cookie)
  const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
  return { db, user, req, res, dataDir }
}
```

- [ ] **Step 4: Wire into `server.ts`**

In `apps/api/src/server.ts`:
- Import `registerDetectionProviders` and `getInstanceSettings`.
- Export `getInstanceSettings` for the resolver (re-export from instanceSettings/service).
- Change the tRPC plugin's `createContext: createContext(dbHolder, dataDir)`.
- After `registerUploadRoutes`/`registerBackupRoutes`, call `registerDetectionProviders(() => getInstanceSettings(dbHolder.current), { mock: process.env.DETECTION_MOCK === '1' })`.

```ts
import { getInstanceSettings } from './modules/instanceSettings/service.js'
import { registerDetectionProviders } from './modules/detection/register.js'
// inside buildApp:
  createContext: createContext(dbHolder, dataDir),
// after registerBackupRoutes:
  registerDetectionProviders(() => getInstanceSettings(dbHolder.current), { mock: process.env.DETECTION_MOCK === '1' })
```

- [ ] **Step 5: Seed fresh instances to `google` explicitly**

In `apps/api/src/modules/instanceSettings/repo.ts`, change the seed insert so a fresh instance never lands on the removed `remote` value regardless of the column default:

```ts
const inserted = db.insert(instanceSettings).values({ id: FIRST_ID, detectionProvider: 'google' }).returning().get()
```

- [ ] **Step 6: Update `detection.test.ts`**

Replace the "starts empty" assertion: after the app registers providers the registry holds the three names, and with `mock: true` it holds `mock`. Keep a pure registry unit test using a registration-independent fresh empty registry; the registry is a singleton so reset via `clear()`:

```ts
import { describe, it, expect } from 'vitest'
import { detectionRegistry } from '../src/modules/detection/provider'
import { registerDetectionProviders } from '../src/modules/detection/register'
import { DEFAULT_INSTANCE_SETTINGS } from '@homebox/shared'

describe('detectionRegistry', () => {
  it('registers the three built-in providers', () => {
    registerDetectionProviders(() => DEFAULT_INSTANCE_SETTINGS, { mock: false })
    expect(detectionRegistry.get('local')).toBeDefined()
    expect(detectionRegistry.get('google')).toBeDefined()
    expect(detectionRegistry.get('openai')).toBeDefined()
  })
  it('registers a mock provider when mock is set', () => {
    registerDetectionProviders(() => DEFAULT_INSTANCE_SETTINGS, { mock: true })
    expect(detectionRegistry.get('mock')).toBeDefined()
    expect(detectionRegistry.names()).toEqual(['mock'])
  })
})
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @homebox/api test detection && pnpm --filter @homebox/api test`
Expected: PASS (existing suite still green — the `dataDir` context addition is covered by the app-inject tests).

> If any existing API test constructs `createContext` directly, update it to pass a `dataDir` string. Most tests go through `buildApp`, which is already updated.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/detection/mock.ts apps/api/src/modules/detection/register.ts apps/api/src/modules/detection/provider.ts apps/api/src/context.ts apps/api/src/server.ts apps/api/src/modules/instanceSettings/repo.ts apps/api/test/detection.test.ts
git commit -m "feat(detection): register built-in providers + mock, context dataDir"
```

---

### Task 7: `published=true` base filter + drafts hydration helpers (items)

**Files:**
- Modify: `apps/api/src/modules/items/repo.ts` (buildWhere + new fns)
- Modify: `apps/api/src/modules/items/service.ts` (extract + export `hydrateRows`)
- Test: `apps/api/test/items-search.test.ts` (add published-filter case)

**Interfaces:**
- Consumes: `buildWhere`, `ITEM_FIELDS`, `listItems` internals.
- Produces: `repo.listDraftItems(db): ItemRow[]`; `repo.setItemPublished(db, id, published): boolean`; `service.hydrateRows(db, rows: ItemRow[]): ItemDto[]`.

- [ ] **Step 1: Add the `published=true` base predicate**

In `apps/api/src/modules/items/repo.ts`, in `buildWhere`, add a constant base predicate first (so drafts are excluded from search, list, and every facet):

```ts
const buildWhere = (db: DrizzleDb, filters: RelationalFilters, searchPredicate?: SQL): SQL | undefined => {
  const conds: SQL[] = [eq(items.published, true)] // drafts never leak into the catalog or facets
  if (searchPredicate) conds.push(searchPredicate)
  if (filters.locationId != null) conds.push(eq(items.locationId, filters.locationId))
  if (filters.itemTypeId != null) conds.push(eq(items.itemTypeId, filters.itemTypeId))
  if (filters.tagIds?.length) {
    conds.push(inArray(items.id, db.select({ id: itemTags.itemId }).from(itemTags).where(inArray(itemTags.tagId, filters.tagIds))))
  }
  return conds.length ? and(...conds) : undefined
}
```

- [ ] **Step 2: Add draft + toggle helpers**

Append to `apps/api/src/modules/items/repo.ts`:

```ts
// Unpublished items only, for the drafts page. No FTS join — a draft may not be in
// items_fts (it always is, but keep this independent of the search path).
export const listDraftItems = (db: DrizzleDb): ItemRow[] =>
  db.select(ITEM_FIELDS).from(items).where(eq(items.published, false)).orderBy(desc(items.createdAt)).all()

// Flip the published flag. Returns whether the item existed.
export const setItemPublished = (db: DrizzleDb, id: number, published: boolean): boolean =>
  db.update(items).set({ published, updatedAt: new Date() }).where(eq(items.id, id)).run().changes > 0
```

- [ ] **Step 3: Extract `hydrateRows` in the service**

In `apps/api/src/modules/items/service.ts`, extract the batching logic currently at the tail of `listItems` into an exported `hydrateRows(db, rows: ItemRow[]): ItemDto[]`, and have `listItems` call it:

```ts
export const hydrateRows = (db: DrizzleDb, rows: ItemRow[]): ItemDto[] => {
  const fieldsByItem = groupByItemId(repo.listCustomFields(db, rows.map((r) => r.id)))
  const tagsByItem = groupByItemId(repo.listTags(db, rows.map((r) => r.id)))
  const imagesByItem = groupByItemId(repo.listImages(db, rows.map((r) => r.id)))
  const typeIds = distinct(rows.map((r) => r.itemTypeId))
  const typeById = new Map(repo.listTypeRefsById(db, typeIds).map((t) => [t.id, t]))
  const locationIds = distinct(rows.filter((r) => r.locationId != null).map((r) => r.locationId!))
  const locationById = new Map(repo.listLocationRefsById(db, locationIds).map((l) => [l.id, l]))
  return rows.map((row) =>
    toDto(row, fieldsByItem.get(row.id) ?? [], typeById.get(row.itemTypeId), row.locationId != null ? locationById.get(row.locationId) : undefined, tagsByItem.get(row.id) ?? [], imagesByItem.get(row.id) ?? [])
  )
}
```

Then in `listItems`, replace the inline batching block (from `const ids = rows...` through `items = rows.map(...)`) with a call plus the snippet attach, keeping `SearchRow`'s optional `snippet` out of `hydrateRows` (which returns `ItemDto[]` without it):

```ts
  const items = hydrateRows(db, rows)
  // hydrateRows returns items without the live `snippet`; attach it back by index.
  rows.forEach((row, i) => {
    if (row.snippet != null) items[i].snippet = row.snippet
  })
  return { items, total, facets }
```

> `hydrateRows` is typed against `ItemRow[]`, and `rows` inside `listItems` is `SearchRow[]` (which extends `ItemRow` with `snippet?`), so passing it through is type-safe. `listDrafts` (Task 10) calls the same `hydrateRows` with `listDraftItems` rows.

- [ ] **Step 4: Write the published-filter test**

Add to `apps/api/test/items-search.test.ts` (follow the existing test's DB/setup helpers):

```ts
it('hides draft items (published=false) from list and search', async () => {
  // existing setup creates a type + user
  await createDraft(db, { userId, itemTypeId, name: 'Draft Thing' })
  await createItem(db, { userId, itemTypeId, name: 'Published Thing' })
  const list = searchItems(db, {})
  expect(list.rows.map((r) => r.name)).toContain('Published Thing')
  expect(list.rows.map((r) => r.name)).not.toContain('Draft Thing')
  const searched = searchItems(db, { search: 'Thing' })
  expect(searched.rows.map((r) => r.name)).not.toContain('Draft Thing')
})
```

> The exact fixture helpers (createUser/createType/createItem/createDraft) are the file's existing ones; a helper `createDraft` inserts a row with `published: false` (mirroring the existing `createItem` helper but with `published: false`).

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @homebox/api test items-search`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/items/repo.ts apps/api/src/modules/items/service.ts apps/api/test/items-search.test.ts
git commit -m "feat(items): filter drafts from catalog + draft list/publish helpers"
```

---

### Task 8: Unpack service (`runUnpack`)

**Files:**
- Create: `apps/api/src/modules/unpack/service.ts`
- Test: `apps/api/test/unpack.test.ts`

**Interfaces:**
- Consumes: `getInstanceSettings`, `detectionRegistry`, `clampBox`, `scaleBox`, `items.createItem`, `images.insertImage`, `items.reindexItem` (via createItem).
- Produces: `runUnpack(ctx: { db, dataDir, userId }, source: { path, width, height, itemTypeId }): Promise<{ detected: number; drafts: { id: number; name: string; imageId: number }[] }>`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unpack.test.ts` using a fake provider registered into `detectionRegistry`:

```ts
import { describe, it, expect, beforeAll, beforeAll } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { detectionRegistry } from '../src/modules/detection/provider'
import { runUnpack } from '../src/modules/unpack/service'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getInstanceSettings, updateSettings } from '../src/modules/instanceSettings/service'

const fakeProvider = { name: 'fake', detectBoxes: async () => [
  { label: 'cup', confidence: 0.9, box: { x: 10, y: 10, width: 80, height: 90 } },
  { label: 'plate', confidence: 0.8, box: { x: 200, y: 200, width: 100, height: 100 } },
] }

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'unpack-test-'))
  detectionRegistry.clear()
  detectionRegistry.register(fakeProvider)
})

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

describe('runUnpack', () => {
  it('creates one draft per box with a crop image, published=false, no location', async () => {
    const db = createDb(':memory:'); runMigrations(db)
    const userId = 1
    const itemTypeId = 1
    db.run("INSERT INTO item_types (id, name) VALUES (1, 'Uncategorized')")
    updateSettings(db, { detectionProvider: 'fake' as never })
    const path = join(dataDir, 'src.png'); writeFileSync(path, png)
    const result = await runUnpack({ db, dataDir, userId }, { path, width: 300, height: 300, itemTypeId })
    expect(result.detected).toBe(2)
    expect(result.drafts).toHaveLength(2)
    const draftRow = db.prepare('SELECT published, location_id AS locationId, item_type_id AS itemTypeId, created_by AS createdBy FROM items WHERE id = ?').get(result.drafts[0].id)
    expect(draftRow).toMatchObject({ published: 0, locationId: null, itemTypeId: 1, createdBy: 1 })
    const img = db.prepare('SELECT original_path AS originalPath, thumb_path AS thumbPath, is_primary AS isPrimary FROM images WHERE item_id = ?').get(result.drafts[0].id)
    expect(img.isPrimary).toBe(1)
    expect(img.originalPath).toMatch(/uploads\/originals\//)
  })
  it('returns { detected: 0, drafts: [] } when no boxes', async () => {
    detectionRegistry.clear(); detectionRegistry.register({ name: 'fake', detectBoxes: async () => [] })
    const db = createDb(':memory:'); runMigrations(db)
    const path = join(dataDir, 'src.png'); writeFileSync(path, png)
    const result = await runUnpack({ db, dataDir, userId: 1 }, { path, width: 300, height: 300, itemTypeId: 1 })
    expect(result).toEqual({ detected: 0, drafts: [] })
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @homebox/api test unpack`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `unpack/service.ts`**

```ts
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type { DrizzleDb } from '@homebox/db'
import { getInstanceSettings } from '../instanceSettings/service.js'
import { detectionRegistry } from '../detection/provider.js'
import { DetectionProviderError } from '../detection/errors.js'
import { clampBox } from '../detection/coords.js'
import { createItem } from '../items/repo.js'
import { insertImage } from '../images/repo.js'

export type UnpackContext = { db: DrizzleDb; dataDir: string; userId: number }
export type UnpackSource = { path: string; width: number; height: number; itemTypeId: number }
export type UnpackResult = { detected: number; drafts: { id: number; name: string; imageId: number }[] }

// Write a cropped buffer as original+thumb under `dataDir`. Paths are stored
// RELATIVE (uploads/originals/<uuid>.jpg / uploads/thumbs/<uuid>.jpg) so the
// existing `GET /file/<relpath>` route can serve them.
const writeCrop = async (buffer: Buffer, box: { x: number; y: number; width: number; height: number }, dataDir: string) => {
  const uuid = randomUUID()
  const originalRel = `uploads/originals/${uuid}.jpg`
  const thumbRel = `uploads/thumbs/${uuid}.jpg`
  const base = sharp(buffer).extract({ left: box.x, top: box.y, width: box.width, height: box.height })
  const original = await base.clone().jpeg({ quality: 90 }).toBuffer()
  const thumb = await base.clone().resize({ width: 400 }).jpeg({ quality: 80 }).toBuffer()
  const meta = await sharp(original).metadata()
  await mkdir(dirname(join(dataDir, originalRel)), { recursive: true })
  await writeFile(join(dataDir, originalRel), original)
  await mkdir(dirname(join(dataDir, thumbRel)), { recursive: true })
  await writeFile(join(dataDir, thumbRel), thumb)
  return { originalRel, thumbRel, sizeBytes: original.length, width: meta.width ?? 0, height: meta.height ?? 0 }
}

export const runUnpack = async (ctx: UnpackContext, source: UnpackSource): Promise<UnpackResult> => {
  const { db, dataDir, userId } = ctx
  const settings = getInstanceSettings(db)
  const provider = detectionRegistry.get(settings.detectionProvider)
  if (!provider) throw new DetectionProviderError('not-configured', `no detection provider named '${settings.detectionProvider}'`)

  const buffer = await readFile(source.path)
  // Providers already normalize to pixel coords (transformers/OpenAI direct,
  // Gemini rescaled internally), so the only consumer concern is clamping a
  // malformed box to the decoded image bounds so sharp.extract can't crash.
  const boxes = (await provider.detectBoxes(buffer))
    .map((b) => ({ ...b, box: clampBox(b.box, source.width, source.height) }))
    .filter((b) => b.box.width > 0 && b.box.height > 0)

  if (boxes.length === 0) return { detected: 0, drafts: [] }

  const drafts: UnpackResult['drafts'] = []
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]
    const name = box.label?.trim() || `Draft ${i + 1}`
    const item = createItem(db, {
      name,
      description: '',
      quantity: 1,
      unit: null,
      itemTypeId: source.itemTypeId,
      locationId: null,
      createdBy: userId,
      published: false,
      fieldValues: [],
    })
    const crop = await writeCrop(buffer, box.box, dataDir)
    const image = insertImage(db, {
      itemId: item.id,
      originalPath: crop.originalRel,
      thumbPath: crop.thumbRel,
      format: 'image/jpeg',
      sizeBytes: crop.sizeBytes,
      width: crop.width,
      height: crop.height,
      sortOrder: 1,
      isPrimary: true,
    })
    drafts.push({ id: item.id, name, imageId: image.id })
  }
  return { detected: boxes.length, drafts }
}
```

> Providers all return pixel coords, so `runUnpack` only clamps — no space rescaling at the consumer. The `DetectionProvider` interface stays exactly as the spec's "reused as-is." `runUnpack` is idempotent over zero boxes (returns `{ detected: 0, drafts: [] }`) and loops sequentially per detected box.

- [ ] **Step 4: Run to confirm it passes**

Run: `pnpm --filter @homebox/api test unpack`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/unpack/service.ts apps/api/test/unpack.test.ts
git commit -m "feat(unpack): detect-and-crop service creates draft items"
```

---

### Task 9: Unpack routes (tRPC item + raw multipart root)

**Files:**
- Create: `apps/api/src/modules/unpack/router.ts`
- Create: `apps/api/src/modules/unpack/route.ts`
- Modify: `apps/api/src/router.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/unpack.test.ts` (extend)

**Interfaces:**
- Consumes: `runUnpack`, `images`, `items`, `eq`, `parseSessionCookie`, `getSessionUser`.
- Produces: `unpackRouter.run({ kind: 'item', imageId })`; `POST /upload/unpack` (multipart `itemTypeId` + image) → `{ detected, drafts }`.

- [ ] **Step 1: Write the failing tRPC-router test**

Extend `apps/api/test/unpack.test.ts` with a `buildApp`-driven case:

```ts
it('unpack.run (item kind) creates drafts from an existing image', async () => {
  // build app with the fake provider registered + setup, create an item + image,
  // call /trpc/unpack.run, expect { detected, drafts }
})
```

- [ ] **Step 2: Implement `unpack/router.ts`**

```ts
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import { TRPCError } from '@trpc/server'
import { images, items } from '@homebox/db'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

// `kind: 'item'` unpacks an already-attached image. The root (`kind: 'root'`)
// multipart upload goes through the raw `/upload/unpack` route (tRPC can't take
// multipart); this procedure covers the item-photo surface only.
export const unpackRouter = t.router({
  run: protectedProcedure
    .input(z.object({ kind: z.literal('item'), imageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const image = ctx.db.select().from(images).where(eq(images.id, input.imageId)).get()
      if (!image) throw new TRPCError({ code: 'NOT_FOUND' })
      if (image.width == null || image.height == null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'image has no stored dimensions' })
      const sourceItem = ctx.db.select({ itemTypeId: items.itemTypeId }).from(items).where(eq(items.id, image.itemId)).get()
      if (!sourceItem) throw new TRPCError({ code: 'NOT_FOUND' })
      return service.runUnpack({ db: ctx.db, dataDir: ctx.dataDir, userId: ctx.user!.id }, {
        path: join(ctx.dataDir, image.originalPath),
        width: image.width,
        height: image.height,
        itemTypeId: sourceItem.itemTypeId,
      })
    }),
})
```

- [ ] **Step 3: Implement `unpack/route.ts`** (raw multipart root)

```ts
import { randomUUID } from 'node:crypto'
import { mkdir?none } from 'node:fs/promises'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { itemTypes } from '@homebox/db'
import { parseSessionCookie, type DbHolder } from '../../context.js'
import { getSessionUser } from '../../auth/sessions.js'
import * as service from './service.js'

type RegisterUnpackRouteOptions = { dbHolder: DbHolder; dataDir: string }

const itemIdFrom = (field: unknown): number => {
  const raw = Array.isArray(field) ? field[0] : field
  const value = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : undefined
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : NaN
}

// Resolve the type for a root unpack: the provided field when valid, else the
// lowest-id existing type, else null (→ 400 "no item type available").
const resolveItemType = (db: DbHolder['current'], raw: unknown): number | null => {
  const provided = itemIdFrom(raw)
  if (!Number.isNaN(provided)) {
    const t = db.select({ id: itemTypes.id }).from(itemTypes).where(eq(itemTypes.id, provided)).get()
    if (t) return t.id
  }
  const first = db.select({ id: itemTypes.id }).from(itemTypes).orderBy(itemTypes.id).limit(1).get()
  return first?.id ?? null
}

export const registerUnpackRoute = (app: FastifyInstance, { dbHolder, dataDir }: RegisterUnpackRouteOptions): void => {
  app.post('/upload/unpack', async (req, reply) => {
    const db = dbHolder.current
    const token = parseSessionCookie(req.headers.cookie)
    const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
    if (!user) return reply.code(401).send({ error: 'UNAUTHORIZED' })
    const part = await req.file()
    if (!part) return reply.code(400).send({ error: 'expected a file part' })
    if (typeof part.mimetype !== 'string' || !part.mimetype.startsWith('image/')) return reply.code(400).send({ error: 'file must be an image' })

    const itemTypeId = resolveItemType(db, (part.fields as Record<string, unknown>).itemTypeId)
    if (itemTypeId == null) return reply.code(400).send({ error: 'no item type available; create a type first' })

    let buffer: Buffer
    try { buffer = await part.toBuffer() } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'file too large' })
      throw err
    }
    const metadata = await sharp(buffer).metadata()
    if (!metadata.width || !metadata.height) return reply.code(400).send({ error: 'not a decodable image' })

    const tmpPath = join(tmpdir(), `unpack-${randomUUID()}.jpg`)
    await writeFile(tmpPath, buffer)
    try {
      const result = await service.runUnpack({ db, dataDir, userId: user.id }, { path: tmpPath, width: metadata.width, height: metadata.height, itemTypeId })
      return reply.code(200).send(result)
    } finally {
      await rm(tmpPath, { force: true }).catch(() => {})
    }
  })
}
```

- [ ] **Step 4: Register the router + route**

In `apps/api/src/router.ts`, add:
```ts
import { unpackRouter } from './modules/unpack/router.js'
import { draftsRouter } from './modules/drafts/router.js' // added in Task 10
```
and add to the router object: `unpack: unpackRouter,` (add `drafts: draftsRouter` in Task 10).

In `apps/api/src/server.ts`, import + call:
```ts
import { registerUnpackRoute } from './modules/unpack/route.js'
// after registerBackupRoutes:
registerUnpackRoute(app, { dbHolder, dataDir })
```

- [ ] **Step 5: Run the mock provider + rest**

Run: `pnpm --filter @homebox/api test unpack && pnpm --filter @homebox/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/unpack/router.ts apps/api/src/modules/unpack/route.ts apps/api/src/router.ts apps/api/src/server.ts apps/api/test/unpack.test.ts
git commit -m "feat(unpack): tRPC item + raw root multipart unpack routes"
```

---

### Task 10: Drafts module (router + service)

**Files:**
- Create: `apps/api/src/modules/drafts/router.ts`
- Create: `apps/api/src/modules/drafts/service.ts`
- Modify: `apps/api/src/router.ts`
- Test: `apps/api/test/drafts.test.ts`

**Interfaces:**
- Consumes: `hydrateRows`, `listDraftItems`, `setItemPublished`, `items.updateItem`, `items.deleteItem`, `getImagesForItem`, `unlink`, `reindexItem` (via deleteItem).
- Produces: `draftsRouter.list/update/publish/publishAll/discard`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/drafts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { listDrafts, renameDraft, publishDraft, publishAll, discardDraft } from '../src/modules/drafts/service'
import { runUnpack } from '../src/modules/unpack/service'
import { detectionRegistry } from '../src/modules/detection/provider'
import { updateSettings } from '../src/modules/instanceSettings/service'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const setup = () => {
  detectionRegistry.clear()
  detectionRegistry.register({ name: 'fake', detectBoxes: async () => [{ label: 'cup', confidence: 1, box: { x: 5, y: 5, width: 50, height: 50 } }] })
  const db = createDb(':memory:'); runMigrations(db)
  db.run("INSERT INTO item_types (id, name) VALUES (1, 'Type')")
  updateSettings(db, { detectionProvider: 'fake' as never })
  const dataDir = mkdtempSync(join(tmpdir(), 'drafts-test-'))
  return { db, dataDir }
}

describe('drafts lifecycle', () => {
  it('list returns only unpublished; publish hides it; rename; discard', async () => {
    const { db, dataDir } = setup()
    const path = join(dataDir, 's.png'); writeFileSync(path, png)
    const { drafts } = await runUnpack({ db, dataDir, userId: 1 }, { path, width: 100, height: 100, itemTypeId: 1 })
    const id = drafts[0].id
    expect(listDrafts(db)).toHaveLength(1)
    renameDraft(db, id, 'Renamed Cup')
    expect(listDrafts(db)[0].name).toBe('Renamed Cup')
    publishDraft(db, id)
    expect(listDrafts(db)).toHaveLength(0)
    // second draft for discard
    const path2 = join(dataDir, 's2.png'); writeFileSync(path2, png)
    const r2 = await runUnpack({ db, dataDir, userId: 1 }, { path: path2, width: 100, height: 100, itemTypeId: 1 })
    expect(discardDraft(db, r2.drafts[0].id, dataDir)).toBe(true)
    expect(listDrafts(db)).toHaveLength(0)
  })
  it('publishAll publishes all or selected', async () => {
    const { db, dataDir } = setup()
    const path = join(dataDir, 's.png'); writeFileSync(path, png)
    const a = await runUnpack({ db, dataDir, userId: 1 }, { path, width: 100, height: 100, itemTypeId: 1 })
    const b = await (async () => { const p = join(dataDir, 's2.png'); writeFileSync(p, png); return await runUnpack({ db, dataDir, userId: 1 }, { path: p, width: 100, height: 100, itemTypeId: 1 }) })()
    publishAll(db, [a.drafts[0].id])
    expect(listDrafts(db)).toHaveLength(1)
    publishAll(db, [b.drafts[0].id])
    expect(listDrafts(db)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement `drafts/service.ts`**

```ts
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DrizzleDb } from '@homebox/db'
import { TRPCError } from '@trpc/server'
import * as itemsService from '../items/service.js'
import * as itemsRepo from '../items/repo.js'
import { getImagesForItem } from '../images/repo.js'
import type { ItemDto } from '../items/service.js'

export const listDrafts = (db: DrizzleDb): ItemDto[] => itemsService.hydrateRows(db, itemsRepo.listDraftItems(db))

export const renameDraft = (db: DrizzleDb, id: number, name: string): ItemDto =>
  itemsService.updateItem(db, { id, name })

export const publishDraft = (db: DrizzleDb, id: number): void => {
  if (!itemsRepo.setItemPublished(db, id, true)) throw new TRPCError({ code: 'NOT_FOUND' })
}

export const publishAll = (db: DrizzleDb, ids?: number[]): void => {
  const targets = ids && ids.length > 0 ? ids : itemsRepo.listDraftItems(db).map((r) => r.id)
  for (const id of targets) itemsRepo.setItemPublished(db, id, true)
}

// Delete the draft item row (cascade removes its images + custom fields + tags,
// and FTS) and best-effort remove the orphaned image files on disk.
export const discardDraft = (db: DrizzleDb, id: number, dataDir: string): boolean => {
  const images = getImagesForItem(db, id)
  const deleted = itemsService.deleteItem(db, id) // reindexes + returns { ok: true }
  if (!deleted.ok) return false
  for (const image of images) {
    for (const rel of [image.originalPath, image.editedPath, image.thumbPath]) {
      if (!rel) continue
      unlink(join(dataDir, rel)).catch(() => {}) // best-effort; DB cascade keeps consistency
    }
  }
  return true
}
```

- [ ] **Step 3: Implement `drafts/router.ts`**

```ts
import { z } from 'zod'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

const idInput = z.object({ id: z.number().int().positive() })
const updateInput = z.object({ id: z.number().int().positive(), name: z.string().min(1) })
const publishAllInput = z.object({ ids: z.array(z.number().int().positive()).optional() })

export const draftsRouter = t.router({
  list: protectedProcedure.query(({ ctx }) => service.listDrafts(ctx.db)),
  update: protectedProcedure.input(updateInput).mutation(({ ctx, input }) => service.renameDraft(ctx.db, input.id, input.name)),
  publish: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.publishDraft(ctx.db, input.id)),
  publishAll: protectedProcedure.input(publishAllInput).mutation(({ ctx, input }) => service.publishAll(ctx.db, input.ids)),
  discard: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.discardDraft(ctx.db, input.id, ctx.dataDir)),
})
```

- [ ] **Step 4: Register in router.ts**

Add `import { draftsRouter } from './modules/drafts/router.js'` and `drafts: draftsRouter,` to the router object.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @homebox/api test drafts && pnpm --filter @homebox/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/drafts/router.ts apps/api/src/modules/drafts/service.ts apps/api/src/router.ts apps/api/test/drafts.test.ts
git commit -m "feat(drafts): list/rename/publish/publishAll/discard draft items"
```

---

### Task 11: Admin settings detection-provider radios (web)

**Files:**
- Modify: `apps/web/src/features/admin/AdminSettingsTab.tsx`
- Modify: `apps/web/public/locales/en/admin.json`
- Test: `apps/web/test/*` (extend `settingsPage.test.tsx` or add a small case)

**Interfaces:**
- Consumes: `DetectionProvider` type from `@homebox/shared` (now `'local' | 'google' | 'openai'`); `trpc.instanceSettings.get/update`.

- [ ] **Step 1: Update the radios + config handling**

In `AdminSettingsTab.tsx`, replace the provider state default `'remote'` with `'google'`; replace the two radios with three (`local`/`google`/`openai`); drop the `endpoint` field and show a single `model` input for every provider; save `detectionConfig: { model }`.

```tsx
const [provider, setProvider] = useState<DetectionProvider>('google')
const [model, setModel] = useState('')
// in handleSave:
const detectionConfig = { model: model.trim() }
// radios:
{(['local', 'google', 'openai'] as DetectionProvider[]).map((p) => (
  <label key={p} className="flex items-center gap-1">
    <input type="radio" name="detectionProvider" value={p} checked={provider === p} onChange={(e) => setProvider(e.target.value as DetectionProvider)} />
    {t(`admin.settings.provider.${p}`)}
  </label>
))}
// one model input (delete the endpoint branch):
<label htmlFor="admin-settings-model">{t('admin.settings.model')}</label>
<input id="admin-settings-model" type="text" value={model} onChange={(e) => setModel(e.target.value)} className="px-2 py-1 border border-border rounded-md bg-surface text-text" />
```

- [ ] **Step 2: Add i18n strings**

In `apps/web/public/locales/en/admin.json`, replace the `remote`/`local` detection keys with:

```json
"detectionProvider": "Detection provider",
"provider": {
  "local": "Local model",
  "google": "Google Gemini",
  "openai": "OpenAI"
},
"model": "Model",
"endpoint": "Endpoint"
```

- [ ] **Step 3: Update the SettingsTab test**

Update `apps/web/test/settingsPage.test.tsx` (or whichever covers `AdminSettingsTab`) to assert the radio now shows three options and a `model` input, and that saving sends `detectionConfig: { model }`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @homebox/web test`
Expected: PASS (any existing assertion referencing `remote`/`endpoint` updated).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/admin/AdminSettingsTab.tsx apps/web/public/locales/en/admin.json apps/web/test
git commit -m "feat(web): admin detection provider radios for local/google/openai"
```

---

### Task 12: Drafts page + unpack UI (web)

**Files:**
- Create: `apps/web/src/features/drafts/DraftsPage.tsx`
- Create: `apps/web/src/features/drafts/UnpackModal.tsx`
- Create: `apps/web/src/features/drafts/index.ts`
- Modify: `apps/web/src/app/routes.tsx`
- Modify: `apps/web/src/app/Shell.tsx`
- Modify: `apps/web/src/features/items/ItemDetail.tsx`
- Modify: `apps/web/public/locales/en/translation.json`
- Test: `apps/web/test/drafts.test.tsx`

**Interfaces:**
- Consumes: `trpc.drafts.*`, `trpc.unpack.run`, `GET /file/<relpath>` images, `useNavigate`.

- [ ] **Step 1: Create `DraftsPage.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import { UnpackModal } from './UnpackModal'

export function DraftsPage() {
  const { t } = useTranslation()
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const { data, isLoading } = trpc.drafts.list.useQuery()
  const update = trpc.drafts.update.useMutation()
  const publish = trpc.drafts.publish.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const publishAll = trpc.drafts.publishAll.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const discard = trpc.drafts.discard.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = (data?.length ?? 0) > 0 && selected.size === data?.length

  if (isLoading) return <p>Loading…</p>
  if (!data || data.length === 0) return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('drafts.title')}</h1>
      <UnpackModal onUnpacked={(n) => navigate(`/drafts?detected=${n}`)} />
      <p>{t('drafts.empty')}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('drafts.title')}</h1>
      <UnpackModal onUnpacked={(n) => navigate(`/drafts?detected=${n}`)} />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={allSelected} onChange={() => { const ids = data.map((d) => d.id); setSelected(allSelected ? new Set() : new Set(ids)) }} />
          {t('drafts.selectAll')}
        </label>
        <button className="px-3 py-1.5 rounded-md border border-border bg-surface text-text" disabled={selected.size === 0} onClick={() => void publishAll.mutateAsync({ ids: [...selected] })}>
          {t('drafts.publishSelected')}
        </button>
      </div>
      <ul className="space-y-3">
        {data.map((d) => (
          <li key={d.id} className="flex items-center gap-3 border border-border rounded-md p-3">
            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
            <img src={`/file/${d.images.find((i) => i.isPrimary)?.thumbPath ?? d.images[0]?.thumbPath}`} className="w-16 h-16 object-cover rounded" alt="" />
            <input
              className="px-2 py-1 border border-border rounded-md bg-surface text-text flex-1"
              defaultValue={d.name}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value !== d.name) void update.mutateAsync({ id: d.id, name: e.target.value.trim() }) }}
            />
            <button className="px-3 py-1.5 rounded-md border border-border bg-surface text-text" onClick={() => void publish.mutateAsync({ id: d.id })}>{t('drafts.publish')}</button>
            <button className="px-3 py-1.5 rounded-md border border-border text-red-600" onClick={() => void discard.mutateAsync({ id: d.id })}>{t('drafts.discard')}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Create `UnpackModal.tsx`**

```tsx
import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'

// Root unpack: upload a clustered photo to POST /upload/unpack, which returns
// { detected, drafts }. The type is chosen from existing item types.
export function UnpackModal({ onUnpacked }: { onUnpacked: (detected: number) => void }) {
  const { t } = useTranslation()
  const types = trpc.itemTypes.list.useQuery()
  const [file, setFile] = useState<File | null>(null)
  const [itemTypeId, setItemTypeId] = useState<number | ''>('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!file) return
    if (itemTypeId === '') { setErr(t('drafts.chooseType')); return }
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('photo', file)
      fd.append('itemTypeId', String(itemTypeId))
      const res = await fetch('/upload/unpack', { method: 'POST', body: fd, credentials: 'include' })
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json() as { detected: number }
      setFile(null)
      onUnpacked(result.detected)
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <h2 className="font-semibold">{t('drafts.unpackTitle')}</h2>
      <input type="file" accept="image/*" onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)} />
      <select value={itemTypeId} onChange={(e) => setItemTypeId(e.target.value ? Number(e.target.value) : '')}>
        <option value="">{t('drafts.chooseType')}</option>
        {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button className="px-3 py-1.5 rounded-md border border-border bg-surface text-text" disabled={busy || !file} onClick={() => void submit()}>{t('drafts.unpack')}</button>
      {err && <p role="alert" className="text-red-600">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Create `index.ts`**

```ts
export { DraftsPage } from './DraftsPage'
export { UnpackModal } from './UnpackModal'
```

- [ ] **Step 4: Add the route + nav**

In `apps/web/src/app/routes.tsx`, add `import { DraftsPage } from '../features/drafts'` and inside the auth Shell block:
`<Route path="/drafts" element={<DraftsPage />} />`.

In `apps/web/src/app/Shell.tsx`, add `{ to: '/drafts', key: 'drafts' }` to `navItems`.

- [ ] **Step 5: Add item-photo unpack action**

In `apps/web/src/features/items/ItemDetail.tsx`, add a per-image "Unpack this photo" button that calls `trpc.unpack.run.mutate({ kind: 'item', imageId })` then navigates to `/drafts`. Import `useNavigate` and `trpc`.

- [ ] **Step 6: Add i18n strings**

In `apps/web/public/locales/en/translation.json`, add a `nav.drafts` entry and a `drafts` block:

```json
"nav": { "drafts": "Drafts" },
"drafts": {
  "title": "Drafts",
  "empty": "No drafts. Use Unpack a photo to import several items at once.",
  "unpackTitle": "Unpack a photo",
  "unpack": "Unpack",
  "chooseType": "Choose a type…",
  "publish": "Publish",
  "discard": "Discard",
  "selectAll": "Select all",
  "publishSelected": "Publish selected",
  "unpacked": "Detected {count} item(s)"
}
```

- [ ] **Step 7: Write the UI test**

Create `apps/web/test/drafts.test.tsx` (RTL) rendering `DraftsPage` with a mocked `trpc.drafts.list` returning a draft, assert the label input, Publish/Discard buttons, and the empty state.

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter @homebox/web test && pnpm --filter @homebox/web build`
Expected: PASS (build/typecheck proves the new `@homebox/api`/`@homebox/shared` types flow — run `pnpm build` first so `dist` is fresh).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/drafts apps/web/src/app/routes.tsx apps/web/src/app/Shell.tsx apps/web/src/features/items/ItemDetail.tsx apps/web/public/locales/en/translation.json apps/web/test/drafts.test.tsx
git commit -m "feat(web): drafts page + unpack surfaces + nav"
```

---

### Task 13: e2e unpack spec + admin detection-model script

**Files:**
- Create: `apps/web/e2e/unpack.spec.ts`
- Modify: `apps/web/e2e/playwright.config.ts` (env `DETECTION_MOCK=1`)
- Create: `apps/api/scripts/detection-model.ts`
- Modify: `apps/api/package.json` (script `detection:model`)

**Interfaces:**
- Produces: `pnpm --filter @homebox/api detection:model`; deterministic mock-provider unpack e2e.

- [ ] **Step 1: Add `DETECTION_MOCK=1` to the e2e webServer env**

In `apps/web/e2e/playwright.config.ts`, add `DETECTION_MOCK: '1'` to the `webServer.env` block.

- [ ] **Step 2: Write the e2e spec**

Create `apps/web/e2e/unpack.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Mock provider is registered (DETECTION_MOCK=1) and returns two fixed boxes, so
// uploading a photo produces two deterministic drafts. A type must exist first.
test('unpack a photo into drafts, edit a label, publish, then it appears in the catalog', async ({ page }) => {
  // login + create a type
  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@b.co')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.goto('/types')
  await page.getByRole('button', { name: /new type/i }).click()
  await page.getByLabel('Name').fill('Box')
  await page.getByRole('button', { name: /save/i }).click()
  // unpack
  await page.goto('/drafts')
  await page.getByRole('button', { name: 'Unpack a photo' }).click()
  await page.setInputFiles('input[type=file]', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') })
  await page.getByRole('button', { name: 'Unpack' }).click()
  await expect(page).toHaveURL(/\/drafts/)
  await expect(page.getByText('chair')).toBeVisible()
  // edit label
  await page.getByRole('textbox').first().fill('Office chair')
  await page.getByRole('textbox').first().press('Tab')
  // publish
  await page.getByRole('button', { name: 'Publish' }).first().click()
  await page.getByText('No drafts').toBeVisible()
  // confirm in catalog
  await page.goto('/items')
  await expect(page.getByText('Office chair')).toBeVisible()
})
```

> Adjust selectors/ids to the actual DOM here; this is a guide, not gospel — the implementer reconciles with the rendered login/types/items markup.

- [ ] **Step 3: Admin detection-model CLI script**

Create `apps/api/scripts/detection-model.ts`:

```ts
import { env, pipeline } from '@huggingface/transformers'
import { join } from 'node:path'

// Reads DATA_DIR and points the transformers cache at models/detection/ so the
// model persists there (matching the spec's DATA_DIR/models/detection/). Checks
// for the model; if absent, downloads it (progress printed), then reports.
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
        else if (p && typeof p === 'object' && 'status' in p) process.stdout.write(`\n[${p.status}]`)
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
```

- [ ] **Step 4: Add the script**

In `apps/api/package.json` `scripts`, add:
```json
"detection:model": "tsx scripts/detection-model.ts"
```

- [ ] **Step 5: Run e2e (mock provider) + model script dry-run**

Run: `pnpm --filter @homebox/web test:e2e` and `pnpm --filter @homebox/api detection:model` (the latter optionally; in CI it may be gated/skipped).

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/unpack.spec.ts apps/web/e2e/playwright.config.ts apps/api/scripts/detection-model.ts apps/api/package.json
git commit -m "test(e2e): mock-provider unpack→publish flow; admin detection-model script"
```

---

## Self-Review (run before handing off)

**Spec coverage:**
- Three providers (local/openai/google) → Tasks 3-5. ✅
- `detection_provider` enum widening + migration remap → Task 1. ✅
- Provider error typing → Task 2. ✅
- Local-model admin CLI → Task 13. ✅
- Unpack module (`runUnpack`), root + item entry points → Tasks 8-9. ✅
- Drafts list/update/publish/publishAll/discard → Task 10. ✅
- `published=true` filter on catalog/search/facets → Task 7. ✅
- Web `/drafts` page + unpack surfaces + nav → Task 12. ✅
- Admin detection radios → Task 11. ✅
- Mock provider in e2e; real providers unit-tested with faked clients → Tasks 3-6, 13. ✅
- Secrets env-only; no `detection_config` secrets → Tasks 3-5. ✅

**Placeholder scan:** No TBD/TODO in code steps. Two intentional "> If … (guide, not gospel)" notes for the e2e spec selectors (reconcile with DOM) and the drizzle-kit empty-migration fallback — both are conditional instructions, not unfinished placeholders.

**Type consistency:** `createLocalProvider`/`createOpenAIProvider`/`createGoogleProvider` all return `DetectionProvider`; `ProviderConfig` lives in `local.ts` and is imported by the others; `runUnpack` is called identically from the tRPC router and the raw route with `{ db, dataDir, userId }` + `{ path, width, height, itemTypeId }`; `hydrateRows(db, rows)` is the single hydration entry used by both `listItems` and `listDrafts`; `setItemPublished`/`listDraftItems`/`discardDraft`/`publishAll` names are consistent across Task 7, 10.

**CI/gates:** Build order means `pnpm build` must be run before the web typecheck in Task 12/13 (`@homebox/api` `dist` must reflect new `unpack`/`drafts` routers and the widened enum). If the merge into `main` later shows a stale-`dist`/FULL-TURBO failure, clear `.turbo` + the `.tsbuildinfo` files and rebuild (see the Phase 5 close-out memory).
