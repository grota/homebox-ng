import { describe, it, expect } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { buildApp } from '../src/server'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { listTrash, trashItem, trashItems, restoreItem, purgeItem, purgeAll } from '../src/modules/trash/service'
import { listDrafts } from '../src/modules/drafts/service'
import { createItem as repoCreateItem, getItem } from '../src/modules/items/repo'
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
  const { drafts } = await createItemsFromImage({ ...ctx, userId: 1, provider: fakeProvider }, { image: readFileSync(path), itemTypeId: 1 })
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
    expect(listDrafts(ctx.db).items).toHaveLength(1)

    trashItem(ctx.db, id)

    expect(listDrafts(ctx.db).items).toHaveLength(0)
    const trash = listTrash(ctx.db).items
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

    expect(listTrash(ctx.db).items).toHaveLength(0)
    expect(listDrafts(ctx.db).items.map((d) => d.id)).toEqual([id])
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
    // `published` is the whole difference, so the drafts list must stay empty.
    expect(listDrafts(ctx.db).items).toHaveLength(0)
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
    expect(listTrash(ctx.db).items).toHaveLength(0)
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

    expect(listTrash(ctx.db).items).toHaveLength(0)
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

    expect(listTrash(ctx.db).items).toHaveLength(0)
  })

  it('purges a selected subset and leaves the rest', async () => {
    const ctx = setup()
    const a = await makeDraft(ctx, 'a.png')
    const b = await makeDraft(ctx, 'b.png')
    trashItem(ctx.db, a)
    trashItem(ctx.db, b)

    purgeAll(ctx.db, [a], ctx.dataDir)

    expect(listTrash(ctx.db).items.map((t) => t.id)).toEqual([b])
  })

  // The catalog's selection trashes in one call. Nothing is thrown for a row that
  // is already where this is putting it — a re-trash would restamp `trashedAt` and
  // move the item up the trash page, and a row that is gone would abort the batch.
  it('trashes a whole selection, skipping what is already trashed or gone', () => {
    const ctx = setup()
    const a = makeCatalogItem(ctx, 'Kettle')
    const b = makeCatalogItem(ctx, 'Toaster')
    const c = makeCatalogItem(ctx, 'Blender')
    const trashed = makeCatalogItem(ctx, 'Gone')
    trashItem(ctx.db, b)
    const before = getItem(ctx.db, b)!.trashedAt

    trashItems(ctx.db, [a, b, c, trashed])
    purgeItem(ctx.db, trashed, ctx.dataDir)
    trashItems(ctx.db, [trashed])

    expect(listTrash(ctx.db).items.map((t) => t.id).sort()).toEqual([a, b, c].sort())
    expect(getItem(ctx.db, b)!.trashedAt).toEqual(before)
  })
})

// The HTTP surface, which the unit tests above do not touch: the procedures are
// wired, the write path records a timestamp the page can render, and
// `trash.list` returns the paginated envelope the page reads.
describe('trash over tRPC', () => {
  it('trashes items one at a time and as a selection, lists them, and restores them', async () => {
    process.env.SESSION_SECRET = 'test-secret'
    const db = createDb(':memory:')
    runMigrations(db)
    const app = buildApp({ db })
    await app.ready()
    try {
      await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'A', email: 'a@a.co', password: 'password123' } })
      const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'a@a.co', password: 'password123' } })
      const cookie = login.headers['set-cookie'] as string

      const type = (await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie }, payload: { name: 'T', fields: [] } })).json().result.data
      const item = (await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie }, payload: { name: 'Kettle', itemTypeId: type.id, locationId: null, quantity: 1 } })).json().result.data

      const trashed = await app.inject({ method: 'POST', url: '/trpc/items.trash', headers: { cookie }, payload: { id: item.id } })
      expect(trashed.statusCode).toBe(200)

      const listUrl = `/trpc/trash.list?input=${encodeURIComponent(JSON.stringify({ page: 1, pageSize: 20 }))}`
      const listed = await app.inject({ method: 'GET', url: listUrl, headers: { cookie } })
      expect(listed.statusCode).toBe(200)
      const body = listed.json().result.data
      expect(body.total).toBe(1)
      expect(body.items.map((i: { name: string }) => i.name)).toEqual(['Kettle'])
      expect(body.items[0].published).toBe(true)
      expect(body.items[0].trashedAt).toBeTruthy()

      const restored = await app.inject({ method: 'POST', url: '/trpc/trash.restore', headers: { cookie }, payload: { id: item.id } })
      expect(restored.statusCode).toBe(200)
      const after = (await app.inject({ method: 'GET', url: listUrl, headers: { cookie } })).json().result.data
      expect(after.total).toBe(0)

      // The bulk form the catalog's selection uses: many ids in one call, and an
      // empty selection refused rather than read as "everything".
      const second = (await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie }, payload: { name: 'Toaster', itemTypeId: type.id, locationId: null, quantity: 1 } })).json().result.data
      const bulk = await app.inject({ method: 'POST', url: '/trpc/items.trashMany', headers: { cookie }, payload: { ids: [item.id, second.id] } })
      expect(bulk.statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: listUrl, headers: { cookie } })).json().result.data.total).toBe(2)

      const empty = await app.inject({ method: 'POST', url: '/trpc/items.trashMany', headers: { cookie }, payload: { ids: [] } })
      expect(empty.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})
