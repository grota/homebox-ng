import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

// A **bulk edit**: one write applied to every item in a selection. Two things have
// to hold, and neither is obvious from the happy path.
//
// First, it must touch exactly what it says. Tag edits add and remove named tags
// rather than replacing the set (the trap `tags.assign` sets: replace-semantics
// would delete every tag the user did not mention), and a field edit sets one field
// without clearing the item's others.
//
// Second, the **count pin** (ADR-0010, generalising ADR-0003): the request carries
// the counts the user was shown, and the server re-derives them before writing. A
// refusal writes nothing at all.

let app: ReturnType<typeof buildApp>
let adminCookie: string
let db: ReturnType<typeof createDb>

const query = (proc: string, input?: unknown) => {
  const suffix = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${proc}${suffix}`, headers: { cookie: adminCookie } })
}
const mutate = (proc: string, input: unknown) =>
  app.inject({
    method: 'POST',
    url: `/trpc/${proc}`,
    // Absent for `auth.setup`/`auth.login`, which run before there is a session —
    // an explicit `undefined` is not an absent header, and fastify rejects it.
    headers: adminCookie ? { cookie: adminCookie } : undefined,
    payload: input,
  })

const summary = async (ids: number[]) => {
  const res = await query('items.selectionSummary', { ids })
  expect(res.statusCode).toBe(200)
  return res.json()?.result?.data
}

let typeA: number
let typeB: number
let home: number
let garage: number
let shed: number
let fragile: number
let bulky: number
let sizeField: number
let noteField: number
let items: Record<string, { id: number }> = {}

const seedLocation = async (name: string, parentId: number | null): Promise<number> => {
  const res = await mutate('locations.create', { name, parentId })
  return res.json()?.result?.data?.id
}
// `itemTypes.create` returns the type with its fields, ids included — so the field
// ids come straight from it rather than a second read.
const seedType = async (name: string, fields: { name: string; fieldType: string }[]) => {
  const res = await mutate('itemTypes.create', { name, fields })
  return res.json()?.result?.data as { id: number; fields: { id: number; name: string }[] }
}
const seedTag = async (name: string): Promise<number> => {
  const res = await mutate('tags.create', { name })
  return res.json()?.result?.data?.id
}
const seedItem = async (name: string, locationId: number | null, itemTypeId: number, fieldValues: { fieldId: number; value: string }[] = [], tagIds: number[] = []) => {
  const res = await mutate('items.create', { name, description: '', itemTypeId, locationId, quantity: 1, fieldValues })
  const created = res.json()?.result?.data
  items[name] = created
  if (tagIds.length) await mutate('tags.assign', { itemId: created.id, tagIds })
  return created
}

// Read an item back, for the assertions that care about what was left alone.
const read = async (id: number) => (await query('items.get', { id })).json()?.result?.data

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  db = createDb(':memory:')
  runMigrations(db)
  app = buildApp({ db })
  await app.ready()

  await mutate('auth.setup', { name: 'Admin', email: 'admin@b.co', password: 'password123' })
  const login = await mutate('auth.login', { email: 'admin@b.co', password: 'password123' })
  adminCookie = login.headers['set-cookie'] as string

  const lighting = await seedType('Lighting', [{ name: 'Size', fieldType: 'text' }, { name: 'Note', fieldType: 'text' }])
  typeA = lighting.id
  sizeField = lighting.fields[0].id
  noteField = lighting.fields[1].id
  typeB = (await seedType('Furniture', [{ name: 'Weight', fieldType: 'number' }])).id
  home = await seedLocation('home', null)
  garage = await seedLocation('garage', home)
  shed = await seedLocation('shed', null)
  fragile = await seedTag('fragile')
  bulky = await seedTag('bulky')

  await seedItem('lamp', garage, typeA, [{ fieldId: sizeField, value: 'large' }, { fieldId: noteField, value: 'brass' }], [fragile])
  await seedItem('wire', garage, typeA, [{ fieldId: sizeField, value: 'small' }], [fragile])
  await seedItem('chair', home, typeB, [], [bulky])
  // A draft, which is not a catalog item: a bulk edit must not touch it.
  const draft = await seedItem('a draft', garage, typeA, [], [])
  db.run(sql`UPDATE items SET published = 0 WHERE id = ${draft.id}`)
})
afterAll(() => app?.close())

const ids = () => [items.lamp.id, items.wire.id, items.chair.id]

describe('the selection summary', () => {
  it('reports what the selection holds, per property', async () => {
    const found = await summary(ids())

    expect(found.total).toBe(3)
    expect(found.locations).toEqual(
      expect.arrayContaining([
        { id: garage, name: 'garage', count: 2 },
        { id: home, name: 'home', count: 1 },
      ]),
    )
    expect(found.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fragile, name: 'fragile', count: 2 }),
        expect.objectContaining({ id: bulky, name: 'bulky', count: 1 }),
      ]),
    )
  })

  // The fields are only offered when they are the same fields for everything
  // selected: a field belongs to exactly one type, so a selection spanning two of
  // them has no shared field to show.
  it('offers fields only when the selection is one type', async () => {
    const mixed = await summary(ids())
    expect(mixed.types.length).toBe(2)
    expect(mixed.fields).toEqual([])

    const single = await summary([items.lamp.id, items.wire.id])
    expect(single.types).toEqual([{ id: typeA, name: 'Lighting', count: 2 }])
    // The distribution of each field's values, including the empty one.
    expect(single.fields).toEqual([
      expect.objectContaining({
        fieldId: sizeField,
        fieldName: 'Size',
        values: expect.arrayContaining([{ value: 'large', count: 1 }, { value: 'small', count: 1 }]),
      }),
      expect.objectContaining({
        fieldId: noteField,
        values: [{ value: 'brass', count: 1 }, { value: null, count: 1 }],
      }),
    ])
  })

  it('counts only catalog items, whatever it is handed', async () => {
    const draftId = items['a draft'].id

    expect((await summary([...ids(), draftId])).total).toBe(3)
  })
})

describe('a bulk edit', () => {
  it('moves every selected item, and only those', async () => {
    const res = await mutate('items.bulkUpdate', {
      ids: ids(),
      location: { set: shed },
      acknowledgedItemCount: 3,
      acknowledgedOverwriteCounts: { location: 3 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()?.result?.data).toEqual({ updated: 3 })
    expect((await read(items.lamp.id)).locationId).toBe(shed)
    // The draft was not in the selection, and is not touched.
    expect((await read(items['a draft'].id)).locationId).toBe(garage)
  })

  // The trap `tags.assign` sets: its semantics are replace-the-set, so a bulk edit
  // shaped like it would silently delete every tag nobody mentioned.
  it('adds tags without disturbing the ones it was not asked about', async () => {
    await mutate('items.bulkUpdate', {
      ids: ids(),
      tags: { add: [bulky] },
      acknowledgedItemCount: 3,
      // Two of the three lack `bulky`; the chair already has it.
      acknowledgedOverwriteCounts: { 'tags.add': 2 },
    })

    const lamp = await read(items.lamp.id)
    expect(lamp.tags.map((t: { id: number }) => t.id).sort()).toEqual([fragile, bulky].sort())
  })

  it('removes only the named tags', async () => {
    await mutate('items.bulkUpdate', {
      ids: ids(),
      tags: { remove: [fragile] },
      acknowledgedItemCount: 3,
      acknowledgedOverwriteCounts: { 'tags.remove': 2 },
    })

    const lamp = await read(items.lamp.id)
    expect(lamp.tags.map((t: { id: number }) => t.id)).toEqual([bulky])
  })

  it('sets one field and leaves the item\'s other values alone', async () => {
    const res = await mutate('items.bulkUpdate', {
      ids: [items.lamp.id],
      fieldValues: [{ fieldId: sizeField, value: 'huge' }],
      acknowledgedItemCount: 1,
      acknowledgedOverwriteCounts: { [`field:${sizeField}`]: 1 },
    })

    expect(res.statusCode).toBe(200)
    const lamp = await read(items.lamp.id)
    const value = (fieldId: number) => lamp.customFields.find((f: { fieldId: number }) => f.fieldId === fieldId)?.value
    expect(value(sizeField)).toBe('huge')
    // Not cleared: a bulk field edit is not `items.update`'s whole-set replacement.
    expect(value(noteField)).toBe('brass')
  })

  it('clears a field when asked for null', async () => {
    await mutate('items.bulkUpdate', {
      ids: [items.lamp.id],
      fieldValues: [{ fieldId: noteField, value: null }],
      acknowledgedItemCount: 1,
      acknowledgedOverwriteCounts: { [`field:${noteField}`]: 1 },
    })

    const lamp = await read(items.lamp.id)
    expect(lamp.customFields.find((f: { fieldId: number }) => f.fieldId === noteField)?.value ?? null).toBeNull()
  })

  it('rejects an empty selection rather than reading it as everything', async () => {
    const res = await mutate('items.bulkUpdate', {
      ids: [],
      location: { set: shed },
      acknowledgedItemCount: 0,
    })

    expect(res.statusCode).toBe(400)
  })

  it('reports the number it changed', async () => {
    const res = await mutate('items.bulkUpdate', {
      ids: [...ids(), items['a draft'].id],
      location: { set: home },
      acknowledgedItemCount: 3,
      // All three are in the shed by now, so all three move.
      acknowledgedOverwriteCounts: { location: 3 },
    })

    // Three of the four ids are catalog items; the draft is not one, and the count
    // says what actually happened.
    expect(res.json()?.result?.data).toEqual({ updated: 3 })
  })
})

describe('the count pin', () => {
  const before = async () => (await read(items.wire.id)).locationId

  it('refuses when the target count moved, and writes nothing', async () => {
    const was = await before()

    const res = await mutate('items.bulkUpdate', {
      ids: ids(),
      location: { set: shed },
      // The modal said two, and there are three.
      acknowledgedItemCount: 2,
      acknowledgedOverwriteCounts: { location: 3 },
    })

    expect(res.statusCode).toBe(409)
    // The refusal is the point: nothing was written.
    expect(await before()).toBe(was)
  })

  it('refuses when a property\'s overwrite count moved, and writes nothing', async () => {
    const was = await before()

    const res = await mutate('items.bulkUpdate', {
      ids: ids(),
      location: { set: shed },
      acknowledgedItemCount: 3,
      // The modal said one item's location would change; three would.
      acknowledgedOverwriteCounts: { location: 1 },
    })

    expect(res.statusCode).toBe(409)
    expect(await before()).toBe(was)
  })

  // The refusal has to be recomputed against live data, not trusted from the
  // request: a selection that changed while the modal was open is exactly the case
  // this exists for.
  it('recomputes the overwrite count rather than trusting the request', async () => {
    // An item already in the target location does not count as an overwrite.
    const res = await mutate('items.bulkUpdate', {
      ids: [items.lamp.id],
      location: { set: (await read(items.lamp.id)).locationId },
      acknowledgedItemCount: 1,
      acknowledgedOverwriteCounts: { location: 0 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()?.result?.data).toEqual({ updated: 1 })
  })
})

describe('the search index follows a bulk edit', () => {
  // The FTS blob carries the location path, so a bulk move that did not reindex
  // would leave search pointing at the old place — invisible without asking.
  it('finds the items under their new location', async () => {
    await mutate('items.bulkUpdate', {
      ids: [items.chair.id],
      location: { set: garage },
      acknowledgedItemCount: 1,
      acknowledgedOverwriteCounts: { location: 1 },
    })

    const res = await query('items.list', { search: 'garage' })
    const found = res.json()?.result?.data?.items.map((i: { id: number }) => i.id)

    expect(found).toContain(items.chair.id)
  })
})
