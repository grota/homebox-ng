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

const createLocation = (payload: { name: string; parentId: number | null; description?: string | null }) => post('locations.create', payload)

const exists = (path: string) => access(path).then(() => true, () => false)

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

  // `description` rides the create path rather than arriving null: the form
  // sends it, so the round trip has to keep it.
  it('keeps a description through create and update', async () => {
    const loc = await createLocation({ name: 'Cellar', parentId: null, description: 'damp and dark' })
    expect(loc.description).toBe('damp and dark')
    const updated = await post('locations.update', { id: loc.id, description: null })
    expect(updated.description).toBeNull()
  })

  // The delete still takes the whole subtree of *locations*, and the FK on
  // `locations.parent_id` has no ON DELETE action, so this pins the
  // children-before-parents ordering — a wrong order throws a FK violation.
  //
  // What it no longer takes is the items. Those are detached instead (ADR-0004):
  // destroying a place is not a reason to destroy the things in it, and it used
  // to be the app's quietest way to lose a photo.
  it('deletes the subtree but keeps and detaches the items in it', async () => {
    const type = await post('itemTypes.create', { name: 'DeepType', fields: [] })
    const root = await createLocation({ name: 'DeepRoot', parentId: null })
    const mid = await createLocation({ name: 'DeepMid', parentId: root.id })
    const leaf = await createLocation({ name: 'DeepLeaf', parentId: mid.id })
    const orphaned = await post('items.create', { name: 'OrphanWidget', itemTypeId: type.id, locationId: leaf.id, quantity: 1 })
    // Same type, outside the subtree: must survive untouched.
    const kept = await post('items.create', { name: 'KeptWidget', itemTypeId: type.id, locationId: null, quantity: 1 })

    const del = await app.inject({ method: 'POST', url: '/trpc/locations.delete', headers: { cookie }, payload: { id: root.id } })
    expect(del.statusCode).toBe(200)
    // 3 locations (root + mid + leaf), 1 item DETACHED — the counts the UI reports.
    expect(del.json()?.result?.data).toEqual({ ok: true, locations: 3, items: 1 })

    // No location of the subtree is left in the tree.
    const treeNames = JSON.stringify(await get('locations.list'))
    for (const name of ['DeepRoot', 'DeepMid', 'DeepLeaf']) expect(treeNames).not.toContain(name)

    // Both items survive; the one that lived in the subtree has no location now.
    const survivor = await get(`items.get?input=${encodeURIComponent(JSON.stringify({ id: kept.id }))}`)
    expect(survivor?.name).toBe('KeptWidget')
    const detached = await get(`items.get?input=${encodeURIComponent(JSON.stringify({ id: orphaned.id }))}`)
    expect(detached?.name).toBe('OrphanWidget')
    expect(detached?.locationId).toBeNull()

    // The search blob encodes the full ancestor path, so a detach that forgot to
    // reindex would leave the item findable by the name of a place that no longer
    // exists. Asserted against the FTS table directly: `runFtsSearch` joins
    // `items`, so this text is not visible from a search-level check.
    const blob = db.select({ itemId: itemsFts.itemId, locationPath: itemsFts.locationPath }).from(itemsFts).all()
    const indexed = blob.map((r) => r.itemId)
    expect(indexed).toContain(orphaned.id)
    expect(indexed).toContain(kept.id)
    expect(blob.find((r) => r.itemId === orphaned.id)?.locationPath).toBe('')
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

  // This replaced a test asserting the files were REMOVED. Deleting a location
  // no longer touches the items in it, so their photos must still be there — and
  // this is the assertion that would catch a regression to the old deep delete,
  // which unlinked every file in the subtree.
  it('keeps the image files of the items it detaches', async () => {
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
      expect(await exists(join(dataDir, path))).toBe(true)
    }
  })
})
