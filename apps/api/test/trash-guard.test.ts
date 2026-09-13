import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/server'
import { createDb, runMigrations, users, items as itemsTable } from '@homebox/db'
import * as repo from '../src/modules/items/repo'
import * as itemTypesRepo from '../src/modules/itemTypes/repo'
import { rebuildFTS } from '../src/modules/items/fts'

// The trash guard, asserted at every query that reads `items` (ADR-0004).
//
// This file exists because the guard is threaded through ~6 sites and the one
// that matters most is invisible from the obvious one: `buildWhere` covers the
// catalog and facets, but `computeBlob`/`rebuildFTS` decide whether the admin's
// "rebuild search index" repair hands every trashed item back to search. A test
// that only checked `items.list` would pass with that bug in place.

let app: ReturnType<typeof buildApp>
let adminCookie: string
let db: ReturnType<typeof createDb>

let typeId: number
let fieldId: number
let keptId: number
let trashedId: number

const list = (input: unknown) => {
  const url = `/trpc/items.list?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url, headers: { cookie: adminCookie }, contentType: 'application/json' })
}

// Trash a row the way the trash service will, but without depending on it: this
// test is about what the *guard* hides, not about how a row gets trashed.
const trash = (id: number) => db.update(itemsTable).set({ trashedAt: new Date() }).where(eq(itemsTable.id, id)).run()

const createItem = async (payload: Record<string, unknown>) => {
  const res = await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload })
  return res.json()?.result?.data
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  db = createDb(':memory:')
  runMigrations(db)
  app = buildApp({ db })
  await app.ready()

  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = login.headers['set-cookie'] as string

  const typeRes = await app.inject({
    method: 'POST',
    url: '/trpc/itemTypes.create',
    headers: { cookie: adminCookie },
    payload: { name: 'Lighting', fields: [{ name: 'wattage', fieldType: 'text', sortOrder: 0 }] },
  })
  const type = typeRes.json()?.result?.data
  typeId = type.id
  fieldId = type.fields[0].id

  const adminId = db.select({ id: users.id }).from(users).limit(1).get()!.id
  // Two identical-shaped items, one word apart, so every assertion below is
  // "the trashed one is gone" rather than "nothing matched".
  const kept = await createItem({ name: 'Brass Lantern', description: 'a lantern', itemTypeId: typeId, locationId: null, quantity: 1, fieldValues: [{ fieldId, value: '60' }] })
  const doomed = await createItem({ name: 'Brass Sconce', description: 'a sconce', itemTypeId: typeId, locationId: null, quantity: 1, fieldValues: [{ fieldId, value: '40' }] })
  keptId = kept.id
  trashedId = doomed.id
  expect(adminId).toBeGreaterThan(0)

  trash(trashedId)
})
afterAll(() => app?.close())

describe('trash guard', () => {
  it('keeps the row, so it can still be restored', () => {
    const row = repo.getItem(db, trashedId)
    expect(row).toBeDefined()
    expect(row?.trashedAt).toBeInstanceOf(Date)
  })

  it('hides a trashed item from the catalog list and its totals', async () => {
    const data = (await list({})).json()?.result?.data
    expect(data.total).toBe(1)
    expect(data.items.map((i: { id: number }) => i.id)).toEqual([keptId])
  })

  it('hides it from search, and from the snippet-bearing FTS path', async () => {
    const data = (await list({ search: 'sconce' })).json()?.result?.data
    expect(data.total).toBe(0)
    expect(data.items).toEqual([])

    // The kept item is still findable, so the empty result above is the guard
    // and not a broken query.
    const kept = (await list({ search: 'lantern' })).json()?.result?.data
    expect(kept.items[0].id).toBe(keptId)
    expect(kept.items[0].snippet.toLowerCase()).toContain('lantern')
  })

  it('hides it from every facet count', async () => {
    // Unfiltered: the type facet counts the catalog, so it must read 1, not 2.
    const all = (await list({})).json()?.result?.data
    const typeFacet = all.facets.types.find((f: { id: number }) => f.id === typeId)
    expect(typeFacet.count).toBe(1)

    // And a search that matches *both* items by name ('Brass Lantern' and
    // 'Brass Sconce'): the facet must count the one visible match, not two.
    const searched = (await list({ search: 'brass' })).json()?.result?.data
    const searchedFacet = searched.facets.types.find((f: { id: number }) => f.id === typeId)
    expect(searchedFacet.count).toBe(1)
    expect(searched.total).toBe(1)
  })

  it('hides it from the drafts list as well', async () => {
    // A trashed *draft* is in neither list. `listDraftItems` does not compose
    // through `buildWhere`, so it carries its own guard.
    const draft = repo.createItem(db, {
      name: 'Draft Thing',
      description: '',
      quantity: 1,
      unit: null,
      itemTypeId: typeId,
      locationId: null,
      createdBy: db.select({ id: users.id }).from(users).limit(1).get()!.id,
      published: false,
      fieldValues: [],
    })
    expect(repo.listDraftItems(db).map((r) => r.id)).toContain(draft.id)
    trash(draft.id)
    expect(repo.listDraftItems(db).map((r) => r.id)).not.toContain(draft.id)
  })

  it('does not count it towards the type population or its field-value usage', async () => {
    // Two items exist of this type; one is trashed.
    expect(itemTypesRepo.countPublishedItemsOfType(db, typeId)).toBe(1)
    expect(itemTypesRepo.listNonEmptyValues(db, fieldId).map((r) => r.itemId)).toEqual([keptId])
  })

  it('refuses to serve it as an item detail', async () => {
    const res = await app.inject({ method: 'GET', url: `/trpc/items.get?input=${encodeURIComponent(JSON.stringify({ id: trashedId }))}`, headers: { cookie: adminCookie } })
    expect(res.json()?.error?.data?.code).toBe('NOT_FOUND')

    const ok = await app.inject({ method: 'GET', url: `/trpc/items.get?input=${encodeURIComponent(JSON.stringify({ id: keptId }))}`, headers: { cookie: adminCookie } })
    expect(ok.json()?.result?.data?.id).toBe(keptId)
  })

  // The defect this whole file is aimed at: a repair that re-indexes every row
  // regardless of visibility silently returns trashed items to search results.
  it('does not resurrect it when the search index is rebuilt', async () => {
    rebuildFTS(db)
    const data = (await list({ search: 'sconce' })).json()?.result?.data
    expect(data.items).toEqual([])
    expect(data.total).toBe(0)
  })
})
