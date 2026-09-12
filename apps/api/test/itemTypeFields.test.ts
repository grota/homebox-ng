import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { items } from '@homebox/db'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
// Kept at module scope: one case inserts an unpublished item directly, because
// the only other way to make a draft is the unpack flow, which needs a provider.
let db: ReturnType<typeof createDb>
let cookie: string

const post = async (path: string, payload: unknown) =>
  (await app.inject({ method: 'POST', url: `/trpc/${path}`, headers: { cookie }, payload })).json()

const data = async (path: string, payload: unknown) => (await post(path, payload))?.result?.data
const code = async (path: string, payload: unknown) => (await post(path, payload))?.error?.data?.code

// `fieldValueUsage` and `itemTypes.list` are QUERIES, so they go over GET with the
// input as a JSON query param — and the param must be omitted entirely when there
// is none, or the server is asked to parse the string "undefined".
const getRaw = async (path: string, input?: unknown) =>
  (await app.inject({
    method: 'GET',
    url: `/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
    headers: { cookie },
  })).json()

const get = async (path: string, input?: unknown) => (await getRaw(path, input))?.result?.data
const getCode = async (path: string, input?: unknown) => (await getRaw(path, input))?.error?.data?.code

// An item type with two fields and one item holding a value for each.
const fixture = async (name: string, values: [string, string] = ['large', 'hello']) => {
  const type = await data('itemTypes.create', {
    name,
    fields: [
      { name: 'size', fieldType: 'text' },
      { name: 'note', fieldType: 'text' },
    ],
  })
  const item = await data('items.create', {
    name: `${name} item`,
    itemTypeId: type.id,
    locationId: null,
    quantity: 1,
    fieldValues: [
      { fieldId: type.fields[0].id, value: values[0] },
      { fieldId: type.fields[1].id, value: values[1] },
    ],
  })
  return { type, item, size: type.fields[0], note: type.fields[1] }
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  cookie = login.headers['set-cookie'] as string
})
afterAll(() => app?.close())

describe('the field diff is non-destructive', () => {
  // THE REGRESSION. `replaceTypeFields` deleted every field row and re-inserted
  // it, so the cascade from `item_custom_field_values.field_id` took every value
  // with it. A rename must now be an UPDATE of the same row.
  it('keeps stored values when a field is renamed', async () => {
    const { type, item, size } = await fixture('RenameType')
    await data('itemTypes.updateFields', { id: type.id, upserts: [{ id: size.id, name: 'size (cm)', fieldType: 'text' }], deletedIds: [] })
    const after = await get('items.get', { id: item.id })
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('large')
  })

  it('keeps stored values when a field is reordered and required flips', async () => {
    const { type, item, size, note } = await fixture('ReorderType')
    await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [
        { id: note.id, name: 'note', fieldType: 'text', sortOrder: 0 },
        { id: size.id, name: 'size', fieldType: 'text', sortOrder: 1, required: true },
      ],
      deletedIds: [],
    })
    const after = await get('items.get', { id: item.id })
    expect(after.customFields).toHaveLength(2)
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('large')
  })

  it('adds a field without touching the existing ones', async () => {
    const { type, item, size } = await fixture('AddType')
    const updated = await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [{ name: 'colour', fieldType: 'text' }],
      deletedIds: [],
    })
    expect(updated.fields).toHaveLength(3)
    const after = await get('items.get', { id: item.id })
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('large')
  })

  // An inline "save this row" sends one upsert. It must never mean "delete the rest".
  it('leaves sibling fields alone when one row is saved', async () => {
    const { type, size, note } = await fixture('SiblingType')
    const updated = await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [{ id: size.id, name: 'renamed', fieldType: 'text' }],
      deletedIds: [],
    })
    expect(updated.fields.map((f: { id: number }) => f.id).sort()).toEqual([size.id, note.id].sort())
  })

  it('rejects an upsert id and a deletedId from another type', async () => {
    const a = await fixture('ScopeA')
    const b = await fixture('ScopeB')
    expect(await code('itemTypes.updateFields', { id: a.type.id, upserts: [{ id: b.size.id, name: 'x', fieldType: 'text' }], deletedIds: [] })).toBe('BAD_REQUEST')
    expect(await code('itemTypes.updateFields', { id: a.type.id, upserts: [], deletedIds: [b.size.id] })).toBe('BAD_REQUEST')
  })

  // One field cannot be updated in place AND deleted by the same request: the
  // delete would remove the very row the update claims to keep, so the update
  // would silently hit zero rows. Nothing here is inferred — so this is refused
  // rather than resolved by letting one side win.
  it('rejects an id that is both upserted and deleted', async () => {
    const { type, size } = await fixture('UpsertAlsoDeleted')
    expect(await code('itemTypes.updateFields', {
      id: type.id,
      upserts: [{ id: size.id, name: 'renamed', fieldType: 'text' }],
      deletedIds: [size.id],
    })).toBe('BAD_REQUEST')
    // Refused before anything was written: both fields are still there.
    expect((await get('itemTypes.list')).find((t: { id: number }) => t.id === type.id).fields).toHaveLength(2)
  })
})

describe('deleting a field is acknowledged', () => {
  it('refuses without the acknowledgment while values exist', async () => {
    const { type, size } = await fixture('DeleteGate')
    expect(await code('itemTypes.updateFields', { id: type.id, upserts: [], deletedIds: [size.id] })).toBe('PRECONDITION_FAILED')
    // Nothing was written.
    expect((await get('itemTypes.list')).find((t: { id: number }) => t.id === type.id).fields).toHaveLength(2)
  })

  it('deletes the field and its values once acknowledged', async () => {
    const { type, item, size, note } = await fixture('DeleteOk')
    const res = await data('itemTypes.updateFields', { id: type.id, upserts: [], deletedIds: [size.id], acknowledgeValueLoss: true })
    expect(res.fields.map((f: { id: number }) => f.id)).toEqual([note.id])
    const after = await get('items.get', { id: item.id })
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)).toBeUndefined()
  })

  // A field nothing has a value for is not destructive, so it needs no flag.
  it('deletes a field with no values without an acknowledgment', async () => {
    const { type, note, item } = await fixture('DeleteEmpty', ['large', ''])
    const res = await data('itemTypes.updateFields', { id: type.id, upserts: [], deletedIds: [note.id] })
    expect(res.fields).toHaveLength(1)
    expect((await get('items.get', { id: item.id })).customFields).toHaveLength(1)
  })
})

describe('a retype is gated on the values it would strand', () => {
  it('allows a retype when every value fits, with no flag', async () => {
    const { type, size } = await fixture('RetypeClean', ['120', 'hello'])
    const res = await data('itemTypes.updateFields', { id: type.id, upserts: [{ id: size.id, name: 'size', fieldType: 'number' }], deletedIds: [] })
    expect(res.fields.find((f: { id: number }) => f.id === size.id).fieldType).toBe('number')
  })

  it('refuses a retype when a value does not fit', async () => {
    const { type, size } = await fixture('RetypeBlocked')
    expect(await code('itemTypes.updateFields', { id: type.id, upserts: [{ id: size.id, name: 'size', fieldType: 'number' }], deletedIds: [] })).toBe('PRECONDITION_FAILED')
  })

  // The dangerous case the spec calls out: `url` renders a real `type="url"`
  // input, so a surviving non-URL value would block the item form's submit.
  it('refuses a retype to url when a value is not a URL', async () => {
    const { type, size } = await fixture('RetypeUrl')
    expect(await code('itemTypes.updateFields', { id: type.id, upserts: [{ id: size.id, name: 'size', fieldType: 'url' }], deletedIds: [] })).toBe('PRECONDITION_FAILED')
  })

  it('clears the stranded values and retypes when acknowledged', async () => {
    const { type, item, size, note } = await fixture('RetypeClear')
    const res = await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [{ id: size.id, name: 'size', fieldType: 'number' }],
      deletedIds: [],
      clearIncompatible: true,
      acknowledgedValueCount: 1,
    })
    expect(res.fields.find((f: { id: number }) => f.id === size.id).fieldType).toBe('number')
    const after = await get('items.get', { id: item.id })
    // The stranded value is gone; the other field's value is untouched.
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)).toBeUndefined()
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === note.id)?.value).toBe('hello')
  })

  // The count pin: a value that appeared after the modal was opened must not be
  // destroyed unseen.
  it('refuses when the acknowledged count no longer matches, and writes nothing', async () => {
    const { type, item, size } = await fixture('RetypeStale', ['large', 'hello'])
    // A second item acquires a value for the same field after the count was taken.
    await data('items.create', { name: 'Stale second', itemTypeId: type.id, locationId: null, quantity: 1, fieldValues: [{ fieldId: size.id, value: 'huge' }] })

    expect(await code('itemTypes.updateFields', {
      id: type.id,
      upserts: [{ id: size.id, name: 'size', fieldType: 'number' }],
      deletedIds: [],
      clearIncompatible: true,
      acknowledgedValueCount: 1,
    })).toBe('CONFLICT')

    // Both values are still there, and the type is unchanged.
    expect((await get('items.get', { id: item.id })).customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('large')
    const types = await get('itemTypes.list', undefined)
    expect(types.find((t: { id: number }) => t.id === type.id).fields.find((f: { id: number }) => f.id === size.id).fieldType).toBe('text')
  })

  // Retyping two fields at once is fine while neither has a casualty — the
  // constraint is one field NEEDING A CLEAR, not one upsert.
  it('retypes two fields that strand nothing, with no flags', async () => {
    const { type, item, size, note } = await fixture('RetypeTwoClean', ['120', '42'])
    const res = await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [
        { id: size.id, name: 'size', fieldType: 'number' },
        { id: note.id, name: 'note', fieldType: 'number' },
      ],
      deletedIds: [],
    })
    expect(res.fields.map((f: { fieldType: string }) => f.fieldType)).toEqual(['number', 'number'])
    const after = await get('items.get', { id: item.id })
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('120')
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === note.id)?.value).toBe('42')
  })

  // Also fine: two retyped, one dirty. The single count describes the only field
  // that is losing anything, and the clean field's values must survive untouched.
  it('retypes two fields when only one strands values, counting that one', async () => {
    const { type, item, size, note } = await fixture('RetypeOneDirty', ['120', 'hello'])
    const res = await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [
        { id: size.id, name: 'size', fieldType: 'number' },
        { id: note.id, name: 'note', fieldType: 'number' },
      ],
      deletedIds: [],
      clearIncompatible: true,
      acknowledgedValueCount: 1,
    })
    expect(res.fields.map((f: { fieldType: string }) => f.fieldType)).toEqual(['number', 'number'])
    const after = await get('items.get', { id: item.id })
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('120')
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === note.id)).toBeUndefined()
  })

  // Two fields that both need clearing cannot be expressed: one count cannot
  // describe both, and a request-level total would let a client attest to the
  // values it was shown while clearing another field's unseen ones.
  it('refuses a request that would clear two fields at once', async () => {
    const { type, item, size, note } = await fixture('RetypeTwoDirty', ['large', 'hello'])
    expect(await code('itemTypes.updateFields', {
      id: type.id,
      upserts: [
        { id: size.id, name: 'size', fieldType: 'number' },
        { id: note.id, name: 'note', fieldType: 'number' },
      ],
      deletedIds: [],
      clearIncompatible: true,
      acknowledgedValueCount: 2,
    })).toBe('BAD_REQUEST')

    // Both values survive, and neither field was retyped.
    const after = await get('items.get', { id: item.id })
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('large')
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === note.id)?.value).toBe('hello')
    const types = await get('itemTypes.list', undefined)
    expect(types.find((t: { id: number }) => t.id === type.id).fields.map((f: { fieldType: string }) => f.fieldType)).toEqual(['text', 'text'])
  })
})

describe('fieldValueUsage', () => {
  it('counts only non-empty values, and lists the offenders with their values', async () => {
    const { type, size, note } = await fixture('UsageCount', ['large', ''])
    // The blank `note` must not be counted as data, nor offered as an offender.
    const all = await get('itemTypes.fieldValueUsage', { typeId: type.id, fieldId: size.id })
    expect(all.total).toBe(1)
    expect(all.items).toEqual([{ itemId: expect.any(Number), name: 'UsageCount item', value: 'large' }])

    const blank = await get('itemTypes.fieldValueUsage', { typeId: type.id, fieldId: note.id })
    expect(blank.total).toBe(0)
    expect(blank.items).toEqual([])
  })

  it('narrows to values that do not fit the given type', async () => {
    const { type, size } = await fixture('UsageFit', ['120', 'hello'])
    expect((await get('itemTypes.fieldValueUsage', { typeId: type.id, fieldId: size.id, fieldType: 'number' })).total).toBe(0)
  })

  it('reports published items missing a value, excluding drafts', async () => {
    const { type, size } = await fixture('UsageMissing', ['large', 'hello'])
    // A published item of the type that leaves the field blank…
    await data('items.create', { name: 'Blank item', itemTypeId: type.id, locationId: null, quantity: 1, fieldValues: [] })
    // …and a draft. Drafts come from the unpack flow, which needs a detection
    // provider, so it is inserted directly here.
    db.insert(items).values({ name: 'Draft item', description: '', quantity: 1, itemTypeId: type.id, locationId: null, createdBy: 1, published: false }).run()

    const usage = await get('itemTypes.fieldValueUsage', { typeId: type.id, fieldId: size.id })
    expect(usage.total).toBe(1) // only the one item that really holds a value
    expect(usage.missing).toBe(1) // the blank published item — the draft is not counted
  })

  it('rejects a field that does not belong to the type', async () => {
    const a = await fixture('UsageScopeA')
    const b = await fixture('UsageScopeB')
    expect(await getCode('itemTypes.fieldValueUsage', { typeId: a.type.id, fieldId: b.size.id })).toBe('BAD_REQUEST')
  })
})
