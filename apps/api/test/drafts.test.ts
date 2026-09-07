import { describe, it, expect } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { listDrafts, renameDraft, publishDraft, publishAll, discardDraft } from '../src/modules/drafts/service'
import { createItemsFromImage } from '../src/modules/unpack/service'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

// A real ≥100×100 PNG so `createItemsFromImage`'s `saveCrop` (which extracts
// on the actual decoded file) never overruns the image bounds. A 1×1 PNG
// collapses every box and throws.
const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer()

const fakeProvider = { name: 'fake', detectBoxes: async () => [{ label: 'cup', confidence: 1, box: { x: 5, y: 5, width: 50, height: 50 } }] }

const setup = () => {
  const db = createDb(':memory:'); runMigrations(db)
  db.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Draft Tester', 'draft@test.dev', 'x')").run()
  db.prepare("INSERT INTO item_types (id, name) VALUES (1, 'Type')").run()
  const dataDir = mkdtempSync(join(tmpdir(), 'drafts-test-'))
  return { db, dataDir }
}

describe('drafts lifecycle', () => {
  it('list returns only unpublished; publish hides it; rename; discard', async () => {
    const { db, dataDir } = setup()
    const path = join(dataDir, 's.png'); writeFileSync(path, png)
    const { drafts } = await createItemsFromImage({ db, dataDir, userId: 1, provider: fakeProvider }, { path, itemTypeId: 1 })
    const id = drafts[0].id
    expect(listDrafts(db)).toHaveLength(1)
    renameDraft(db, id, 'Renamed Cup')
    expect(listDrafts(db)[0].name).toBe('Renamed Cup')
    publishDraft(db, id)
    expect(listDrafts(db)).toHaveLength(0)
    // second draft for discard
    const path2 = join(dataDir, 's2.png'); writeFileSync(path2, png)
    const r2 = await createItemsFromImage({ db, dataDir, userId: 1, provider: fakeProvider }, { path: path2, itemTypeId: 1 })
    expect(discardDraft(db, r2.drafts[0].id, dataDir)).toBe(true)
    expect(listDrafts(db)).toHaveLength(0)
  })
  it('publishAll publishes all or selected', async () => {
    const { db, dataDir } = setup()
    const path = join(dataDir, 's.png'); writeFileSync(path, png)
    const a = await createItemsFromImage({ db, dataDir, userId: 1, provider: fakeProvider }, { path, itemTypeId: 1 })
    const b = await (async () => { const p = join(dataDir, 's2.png'); writeFileSync(p, png); return await createItemsFromImage({ db, dataDir, userId: 1, provider: fakeProvider }, { path: p, itemTypeId: 1 }) })()
    publishAll(db, [a.drafts[0].id])
    expect(listDrafts(db)).toHaveLength(1)
    publishAll(db, [b.drafts[0].id])
    expect(listDrafts(db)).toHaveLength(0)
  })
})
