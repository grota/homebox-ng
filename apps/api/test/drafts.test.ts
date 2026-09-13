import { describe, it, expect } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { listDrafts, renameDraft, publishDraft, publishAll, trashDraft, trashAll } from '../src/modules/drafts/service'
import { purgeItem, listTrash } from '../src/modules/trash/service'
import { createItemsFromImage } from '../src/modules/unpack/service'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getImagesForItem } from '../src/modules/images/repo'
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

// One draft per call: the fake provider reports exactly one detected box.
const makeDraft = async (ctx: ReturnType<typeof setup>, fileName: string): Promise<number> => {
  const path = join(ctx.dataDir, fileName)
  writeFileSync(path, png)
  const { drafts } = await createItemsFromImage({ ...ctx, userId: 1, provider: fakeProvider }, { path, itemTypeId: 1 })
  return drafts[0].id
}

describe('drafts lifecycle', () => {
  it('list returns only unpublished; publish hides it; rename; trash', async () => {
    const { db, dataDir } = setup()
    const path = join(dataDir, 's.png'); writeFileSync(path, png)
    const { drafts } = await createItemsFromImage({ db, dataDir, userId: 1, provider: fakeProvider }, { path, itemTypeId: 1 })
    const id = drafts[0].id
    expect(listDrafts(db).items).toHaveLength(1)
    renameDraft(db, id, 'Renamed Cup')
    expect(listDrafts(db).items[0].name).toBe('Renamed Cup')
    publishDraft(db, id)
    expect(listDrafts(db).items).toHaveLength(0)
    // second draft for discard
    const path2 = join(dataDir, 's2.png'); writeFileSync(path2, png)
    const r2 = await createItemsFromImage({ db, dataDir, userId: 1, provider: fakeProvider }, { path: path2, itemTypeId: 1 })
    trashDraft(db, r2.drafts[0].id)
    expect(listDrafts(db).items).toHaveLength(0)
  })
  it('publishAll publishes all or selected', async () => {
    const { db, dataDir } = setup()
    const path = join(dataDir, 's.png'); writeFileSync(path, png)
    const a = await createItemsFromImage({ db, dataDir, userId: 1, provider: fakeProvider }, { path, itemTypeId: 1 })
    const b = await (async () => { const p = join(dataDir, 's2.png'); writeFileSync(p, png); return await createItemsFromImage({ db, dataDir, userId: 1, provider: fakeProvider }, { path: p, itemTypeId: 1 }) })()
    publishAll(db, [a.drafts[0].id])
    expect(listDrafts(db).items).toHaveLength(1)
    publishAll(db, [b.drafts[0].id])
    expect(listDrafts(db).items).toHaveLength(0)
  })

  // The behaviour this replaced deleted the rows AND unlinked the files. It is
  // recoverable now, so the assertion is inverted: the files must still be there,
  // or "restore" would be a lie (ADR-0004).
  it('trashAll trashes exactly the named drafts and keeps their files', async () => {
    const ctx = setup()
    const { db, dataDir } = ctx
    const a = await makeDraft(ctx, 'a.png')
    const b = await makeDraft(ctx, 'b.png')
    const c = await makeDraft(ctx, 'c.png')
    const gone = getImagesForItem(db, a)[0]

    trashAll(db, [a, b])

    expect(listDrafts(db).items.map((d) => d.id)).toEqual([c])
    expect(existsSync(join(dataDir, gone.originalPath))).toBe(true)
    expect(existsSync(join(dataDir, getImagesForItem(db, c)[0].originalPath))).toBe(true)
    // Still rows, so they can come back.
    expect(listTrash(db).items.map((d) => d.id).sort()).toEqual([a, b].sort())
  })

  it('trashAll with no ids trashes every draft', async () => {
    const ctx = setup()
    const { db, dataDir } = ctx
    await makeDraft(ctx, 'a.png')
    await makeDraft(ctx, 'b.png')

    trashAll(db, undefined)

    expect(listDrafts(db).items).toHaveLength(0)
  })

  it('returns one page plus the unpaginated total', async () => {
    const ctx = setup()
    for (let i = 0; i < 25; i++) await makeDraft(ctx, `d${i}.png`)

    const first = listDrafts(ctx.db)
    expect(first.items).toHaveLength(20)
    expect(first.total).toBe(25)

    const second = listDrafts(ctx.db, 2)
    expect(second.items).toHaveLength(5)
    expect(second.total).toBe(25)
    // No row appears on both pages: the `id` tiebreak is what makes that true,
    // since every draft here shares a `createdAt` second.
    const overlap = second.items.filter((d) => first.items.some((f) => f.id === d.id))
    expect(overlap).toEqual([])
  })

  // The trap pagination sets, and the reason `listAllDraftIds` exists as a
  // separate function: "publish all" with no ids must mean every draft, and if it
  // read the *paginated* list it would silently mean "the first 20" — with no
  // error, no failing test, and 5 drafts left behind.
  it('publishAll with no ids publishes every draft, not just the first page', async () => {
    const ctx = setup()
    for (let i = 0; i < 25; i++) await makeDraft(ctx, `d${i}.png`)
    expect(listDrafts(ctx.db).total).toBe(25)

    publishAll(ctx.db, undefined)

    expect(listDrafts(ctx.db).total).toBe(0)
  })

  it('trashAll skips an id that no longer exists instead of aborting the batch', async () => {
    const ctx = setup()
    const { db, dataDir } = ctx
    const a = await makeDraft(ctx, 'a.png')
    const b = await makeDraft(ctx, 'b.png')
    // `a` has to be genuinely gone for this to exercise the skip: trashing it
    // would leave the row in place, and the batch would never see a missing id.
    purgeItem(db, a, dataDir)

    trashAll(db, [a, b])

    expect(listDrafts(db).items).toHaveLength(0)
  })
})
