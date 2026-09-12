import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { images, itemsFts } from '@homebox/db'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let db: ReturnType<typeof createDb>
let dataDir: string
let cookie: string

// Every call below is a mutation, so they share this POST helper.
const post = async (path: string, payload: unknown) =>
  (await app.inject({ method: 'POST', url: `/trpc/${path}`, headers: { cookie }, payload })).json()?.result?.data

const get = async (path: string) =>
  (await app.inject({ method: 'GET', url: `/trpc/${path}`, headers: { cookie } })).json()?.result?.data

const createLocation = (payload: { name: string; parentId: number | null }) => post('locations.create', payload)

const exists = (path: string) => access(path).then(() => true, () => false)

// The image unlink is deliberately fire-and-forget (the DB is already consistent
// when it runs), so give it a bounded moment rather than asserting on a race.
const waitForRemoval = async (path: string): Promise<boolean> => {
  for (let i = 0; i < 50; i++) {
    if (!(await exists(path))) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  dataDir = await mkdtemp(join(tmpdir(), 'homebox-locations-'))
  db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db, dataDir }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  cookie = login.headers['set-cookie'] as string
})
afterAll(async () => {
  await app?.close()
  await rm(dataDir, { recursive: true, force: true })
})

describe('locations module', () => {
  it('creates nested locations', async () => {
    const parent = await createLocation({ name: 'Home', parentId: null })
    expect(parent.id).toBeTruthy()
    const child = await createLocation({ name: 'Garage', parentId: parent.id })
    expect(child.parentId).toBe(parent.id)
  })

  // The delete is deep rather than guarded: it takes the whole subtree AND the
  // items living in it (with their images/custom fields/tag links), in one call.
  // The FK on `locations.parent_id` has no ON DELETE action, so this also pins
  // the children-before-parents ordering — a wrong order throws a FK violation.
  it('deep-deletes the subtree, the items in it, and their search rows', async () => {
    const type = await post('itemTypes.create', { name: 'DeepType', fields: [] })
    const root = await createLocation({ name: 'DeepRoot', parentId: null })
    const mid = await createLocation({ name: 'DeepMid', parentId: root.id })
    const leaf = await createLocation({ name: 'DeepLeaf', parentId: mid.id })
    const doomed = await post('items.create', { name: 'DoomedWidget', itemTypeId: type.id, locationId: leaf.id, quantity: 1 })
    // Same type, outside the subtree: must survive untouched.
    const kept = await post('items.create', { name: 'KeptWidget', itemTypeId: type.id, locationId: null, quantity: 1 })

    const del = await app.inject({ method: 'POST', url: '/trpc/locations.delete', headers: { cookie }, payload: { id: root.id } })
    expect(del.statusCode).toBe(200)
    // 3 locations (root + mid + leaf), 1 item — the counts the UI reports back.
    expect(del.json()?.result?.data).toEqual({ ok: true, locations: 3, items: 1 })

    // No location of the subtree is left in the tree.
    const treeNames = JSON.stringify(await get('locations.list'))
    for (const name of ['DeepRoot', 'DeepMid', 'DeepLeaf']) expect(treeNames).not.toContain(name)

    // The item inside the subtree is gone; the one outside it is not.
    const gone = await app.inject({ method: 'GET', url: `/trpc/items.get?input=${encodeURIComponent(JSON.stringify({ id: doomed.id }))}`, headers: { cookie } })
    expect(gone.json()?.error?.data?.code).toBe('NOT_FOUND')
    const survivor = await get(`items.get?input=${encodeURIComponent(JSON.stringify({ id: kept.id }))}`)
    expect(survivor?.name).toBe('KeptWidget')

    // The deleted item left no row behind in the FTS index. Asserted against the
    // table directly: `runFtsSearch` joins `items`, so a stale row would be
    // invisible to a search and a search-level check could not see it.
    const indexed = db.select({ itemId: itemsFts.itemId }).from(itemsFts).all().map((r) => r.itemId)
    expect(indexed).not.toContain(doomed.id)
    expect(indexed).toContain(kept.id)
  })

  it('deleting a leaf location removes only that location', async () => {
    const root = await createLocation({ name: 'SoloRoot', parentId: null })
    const leaf = await createLocation({ name: 'SoloLeaf', parentId: root.id })
    const del = await app.inject({ method: 'POST', url: '/trpc/locations.delete', headers: { cookie }, payload: { id: leaf.id } })
    expect(del.json()?.result?.data).toEqual({ ok: true, locations: 1, items: 0 })
    const treeNames = JSON.stringify(await get('locations.list'))
    expect(treeNames).toContain('SoloRoot')
    expect(treeNames).not.toContain('SoloLeaf')
  })

  // Deleting an item cascades its `images` rows away, so the files they name
  // would be orphaned on disk unless their paths are read first and unlinked.
  it('removes the image files of the items it deletes', async () => {
    const type = await post('itemTypes.create', { name: 'PhotoType', fields: [] })
    const root = await createLocation({ name: 'PhotoRoot', parentId: null })
    const item = await post('items.create', { name: 'Camera', itemTypeId: type.id, locationId: root.id, quantity: 1 })

    // Paths are stored relative to `dataDir`, like the real upload path writes
    // them, so the files have to live under the app's data directory.
    const rel = {
      original: join('uploads', 'originals', 'loc-test.png'),
      edited: join('uploads', 'edited', 'loc-test.png'),
      thumb: join('uploads', 'thumbs', 'loc-test.png'),
    }
    for (const path of Object.values(rel)) {
      await mkdir(join(dataDir, path, '..'), { recursive: true })
      await writeFile(join(dataDir, path), 'bytes')
    }
    db.insert(images)
      .values({ itemId: item.id, originalPath: rel.original, editedPath: rel.edited, thumbPath: rel.thumb, isPrimary: true })
      .run()

    // Assert they are really on disk first, so the removal check below cannot
    // pass just because nothing was ever written.
    for (const path of Object.values(rel)) {
      expect(await exists(join(dataDir, path))).toBe(true)
    }

    const del = await app.inject({ method: 'POST', url: '/trpc/locations.delete', headers: { cookie }, payload: { id: root.id } })
    expect(del.json()?.result?.data).toEqual({ ok: true, locations: 1, items: 1 })

    for (const path of Object.values(rel)) {
      expect(await waitForRemoval(join(dataDir, path))).toBe(true)
    }
  })
})
