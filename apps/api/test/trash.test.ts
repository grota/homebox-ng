import { describe, it, expect } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { listTrash, trashItem, restoreItem, purgeItem, purgeAll } from '../src/modules/trash/service'
import { listDrafts } from '../src/modules/drafts/service'
import { listDraftItems, createItem as repoCreateItem, getItem } from '../src/modules/items/repo'
import { createItemsFromImage } from '../src/modules/unpack/service'
import { getImagesForItem } from '../src/modules/images/repo'

const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer()
const fakeProvider = { name: 'fake', detectBoxes: async () => [{ label: 'cup', confidence: 1, box: { x: 5, y: 5, width: 50, height: 50 } }] }

const setup = () => {
  const db = createDb(':memory:')
  runMigrations(db)
  db.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'T', 't@t.dev', 'x')").run()
  db.prepare("INSERT INTO item_types (id, name) VALUES (1, 'Type')").run()
  return { db, dataDir: mkdtempSync(join(tmpdir(), 'trash-test-')) }
}

const makeDraft = async (ctx: ReturnType<typeof setup>, fileName: string): Promise<number> => {
  const path = join(ctx.dataDir, fileName)
  writeFileSync(path, png)
  const { drafts } = await createItemsFromImage({ ...ctx, userId: 1, provider: fakeProvider }, { path, itemTypeId: 1 })
  return drafts[0].id
}

const makeCatalogItem = (ctx: ReturnType<typeof setup>, name: string): number =>
  repoCreateItem(ctx.db, {
    name,
    description: '',
    quantity: 1,
    unit: null,
    itemTypeId: 1,
    locationId: null,
    createdBy: 1,
    published: true,
    fieldValues: [],
  }).id

describe('trash lifecycle', () => {
  it('takes a draft out of the drafts list and puts it in the trash', async () => {
    const ctx = setup()
    const id = await makeDraft(ctx, 'a.png')
    expect(listDrafts(ctx.db)).toHaveLength(1)

    trashItem(ctx.db, id)

    expect(listDrafts(ctx.db)).toHaveLength(0)
    const trash = listTrash(ctx.db)
    expect(trash.map((t) => t.id)).toEqual([id])
    // The label the trash page uses to say what kind of thing this is.
    expect(trash[0].published).toBe(false)
    expect(trash[0].trashedAt).toBeInstanceOf(Date)
  })

  it('restores a draft to the drafts page', async () => {
    const ctx = setup()
    const id = await makeDraft(ctx, 'a.png')
    trashItem(ctx.db, id)
    restoreItem(ctx.db, id)

    expect(listTrash(ctx.db)).toHaveLength(0)
    expect(listDrafts(ctx.db).map((d) => d.id)).toEqual([id])
  })

  // The whole reason `published` is never touched by the trash: it is what tells
  // a draft from a catalog item, so it is what makes restore return a thing to
  // where it came from rather than to the drafts page.
  it('restores a catalog item to the catalog, not to the drafts', () => {
    const ctx = setup()
    const id = makeCatalogItem(ctx, 'Kettle')

    trashItem(ctx.db, id)
    expect(getItem(ctx.db, id)?.trashedAt).toBeInstanceOf(Date)

    const restored = restoreItem(ctx.db, id)
    expect(restored.published).toBe(true)
    expect(listDrafts(ctx.db)).toHaveLength(0)
    expect(listDraftItems(ctx.db)).toHaveLength(0)
  })

  it('refuses to restore something that is not in the trash', async () => {
    const ctx = setup()
    const id = await makeDraft(ctx, 'a.png')
    expect(() => restoreItem(ctx.db, id)).toThrowError(/not in the trash/)
  })

  it('purges the row and its files, and only then', async () => {
    const ctx = setup()
    const id = await makeDraft(ctx, 'a.png')
    const image = getImagesForItem(ctx.db, id)[0]
    trashItem(ctx.db, id)

    // Trashing keeps every file: this is what makes restore honest.
    expect(existsSync(join(ctx.dataDir, image.originalPath))).toBe(true)
    expect(existsSync(join(ctx.dataDir, image.thumbPath))).toBe(true)

    purgeItem(ctx.db, id, ctx.dataDir)

    expect(getItem(ctx.db, id)).toBeUndefined()
    expect(listTrash(ctx.db)).toHaveLength(0)
    // Best-effort unlinks are not awaited, so poll rather than race them.
    await expect.poll(() => existsSync(join(ctx.dataDir, image.originalPath))).toBe(false)
    await expect.poll(() => existsSync(join(ctx.dataDir, image.thumbPath))).toBe(false)
  })

  it('purgeAll with no ids empties the trash', async () => {
    const ctx = setup()
    const a = await makeDraft(ctx, 'a.png')
    const b = makeCatalogItem(ctx, 'Kettle')
    trashItem(ctx.db, a)
    trashItem(ctx.db, b)

    purgeAll(ctx.db, undefined, ctx.dataDir)

    expect(listTrash(ctx.db)).toHaveLength(0)
    expect(getItem(ctx.db, a)).toBeUndefined()
    expect(getItem(ctx.db, b)).toBeUndefined()
  })

  it('purgeAll skips an id that no longer exists instead of aborting the batch', async () => {
    const ctx = setup()
    const a = await makeDraft(ctx, 'a.png')
    const b = await makeDraft(ctx, 'b.png')
    trashItem(ctx.db, a)
    trashItem(ctx.db, b)
    purgeItem(ctx.db, a, ctx.dataDir)

    purgeAll(ctx.db, [a, b], ctx.dataDir)

    expect(listTrash(ctx.db)).toHaveLength(0)
  })

  it('purges a selected subset and leaves the rest', async () => {
    const ctx = setup()
    const a = await makeDraft(ctx, 'a.png')
    const b = await makeDraft(ctx, 'b.png')
    trashItem(ctx.db, a)
    trashItem(ctx.db, b)

    purgeAll(ctx.db, [a], ctx.dataDir)

    expect(listTrash(ctx.db).map((t) => t.id)).toEqual([b])
  })
})
