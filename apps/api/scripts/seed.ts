import { mkdir } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import {
  createDb,
  runMigrations,
  users,
  locations,
  itemTypes,
  itemTypeFields,
  items,
  itemCustomFieldValues,
} from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { hashPassword } from '../src/auth/password.js'
import { rebuildFTS } from '../src/modules/items/fts.js'

// Dev fixtures for eyeballing the catalog and the item-type editor. Runs
// directly against the database — no Fastify, no SESSION_SECRET, and the
// environment is read the same way scripts/detection-model.ts reads it — and is
// idempotent by name, so re-running it neither duplicates the catalog nor fails.
//
// The item types are chosen to make the destructive paths REACHABLE BY HAND:
// `Probe texture` holds a "finish" field with values that are not numbers, so
// retyping it to `number` exercises the refusal and the offenders dialog, and
// an item leaves the required "width" blank so the "missing a value" warning
// has something to report.
const ADMIN = { name: 'Admin', email: 'a@a.com', password: 'aaaaaaaa' }

// These defaults are cwd-relative ON PURPOSE, and must not be "fixed" to resolve
// against the repo root. On this branch the agreement holds: `pnpm --filter
// @homebox/api seed` runs with `apps/api` as the cwd, and the API resolves its
// own relative defaults the same way, so both land on `apps/api/data/homebox.db`.
//
// The hazard is a sibling branch (not merged here) that resolves a relative
// `DATABASE_PATH`/`DATA_DIR` against the REPO ROOT. Once it lands, a bare
// `pnpm --filter @homebox/api seed` would populate `apps/api/data/homebox.db`
// while the server reads `<root>/data/homebox.db` — silently, seeding a database
// nothing serves. The owed reconciliation is to make BOTH ends resolve the same
// way in one commit (either both root-relative, or the script re-rooted to match
// the server); changing this line alone first would break today's agreement and
// is not the fix.
const dbPath = process.env.DATABASE_PATH ?? './data/homebox.db'
const dataDir = process.env.DATA_DIR ?? './data'

// `Home / Garage` etc. are paths, not names: Garage and Study hang off Home.
const LOCATIONS: { name: string; parent: string | null }[] = [
  { name: 'Home', parent: null },
  { name: 'Garage', parent: 'Home' },
  { name: 'Study', parent: 'Home' },
  { name: 'Shed', parent: null },
]

const TYPES = [
  {
    name: 'Probe texture',
    fields: [
      { name: 'finish', fieldType: 'text', required: false },
      { name: 'width', fieldType: 'number', required: true },
    ],
  },
  {
    name: 'Furniture',
    fields: [
      { name: 'material', fieldType: 'text', required: false },
      { name: 'price', fieldType: 'currency', required: false },
    ],
  },
  {
    name: 'Electronics',
    fields: [
      { name: 'serial', fieldType: 'text', required: false },
      { name: 'manual', fieldType: 'url', required: false },
    ],
  },
] as const

// `finish` is deliberately NOT numeric — retyping it to `number` must strand
// these. A blank (`''`, never NULL) models a field the user left empty.
const ITEMS: { name: string; type: string; location: string; values: Record<string, string> }[] = [
  { name: 'Oak workbench', type: 'Probe texture', location: 'Garage', values: { finish: 'matte', width: '1200' } },
  { name: 'Steel bracket', type: 'Probe texture', location: 'Shed', values: { finish: 'brushed steel', width: '80' } },
  { name: 'Sample swatch', type: 'Probe texture', location: 'Study', values: { finish: 'n/a', width: '' } },
  { name: 'Wall panel', type: 'Probe texture', location: 'Garage', values: { finish: 'satin', width: '600' } },
  { name: 'Dining table', type: 'Furniture', location: 'Home', values: { material: 'oak', price: '899.00' } },
  { name: 'Bookshelf', type: 'Furniture', location: 'Study', values: { material: 'pine', price: '149.50' } },
  { name: 'Desk lamp', type: 'Furniture', location: 'Study', values: { material: 'brass', price: '79.99' } },
  {
    name: 'Multimeter',
    type: 'Electronics',
    location: 'Garage',
    values: { serial: 'FLK-87V-0042', manual: 'https://example.com/manuals/fluke-87v.pdf' },
  },
  {
    name: 'Oscilloscope',
    type: 'Electronics',
    location: 'Shed',
    values: { serial: 'RIG-DS1054Z-1197', manual: 'https://example.com/manuals/ds1054z.pdf' },
  },
  {
    name: 'Bench supply',
    type: 'Electronics',
    location: 'Shed',
    values: { serial: '', manual: 'https://example.com/manuals/psu.pdf' },
  },
]

const created: string[] = []
const present: string[] = []

const seedLocations = (db: DrizzleDb): void => {
  const byName = new Map(db.select({ id: locations.id, name: locations.name }).from(locations).all().map((l) => [l.name, l.id]))
  for (const { name, parent } of LOCATIONS) {
    if (byName.has(name)) {
      present.push(`location  ${name}`)
      continue
    }
    const row = db
      .insert(locations)
      .values({ name, parentId: parent == null ? null : byName.get(parent) ?? null })
      .returning({ id: locations.id })
      .get()
    byName.set(name, row.id)
    created.push(`location  ${name}`)
  }
}

const seedTypes = (db: DrizzleDb): void => {
  for (const type of TYPES) {
    const existing = db.select({ id: itemTypes.id }).from(itemTypes).where(eq(itemTypes.name, type.name)).get()
    if (existing) {
      present.push(`type      ${type.name}`)
      continue
    }
    const row = db.insert(itemTypes).values({ name: type.name }).returning({ id: itemTypes.id }).get()
    for (const [i, field] of type.fields.entries()) {
      db.insert(itemTypeFields)
        .values({ itemTypeId: row.id, name: field.name, fieldType: field.fieldType, required: field.required, sortOrder: i })
        .run()
    }
    created.push(`type      ${type.name} (${type.fields.length} fields)`)
  }
}

// Only when the catalog is empty, so a re-run over an existing one cannot
// multiply the items. The FTS index is maintained at the application layer (see
// modules/items/fts.ts), so a direct insert leaves `items_fts` empty and every
// search would come back blank — rebuild it, but only when something landed.
const seedItems = (db: DrizzleDb): void => {
  const existing = db.select({ id: items.id }).from(items).all().length
  if (existing > 0) {
    present.push(`items     ${existing} already in the catalog`)
    return
  }
  const admin = db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN.email)).get()
  if (!admin) throw new Error(`the admin user ${ADMIN.email} must exist before seeding items`)

  const locationIds = new Map(db.select({ id: locations.id, name: locations.name }).from(locations).all().map((l) => [l.name, l.id]))
  const typeIds = new Map(db.select({ id: itemTypes.id, name: itemTypes.name }).from(itemTypes).all().map((t) => [t.name, t.id]))
  const fieldsByType = new Map<number, { id: number; name: string }[]>()
  for (const f of db.select({ id: itemTypeFields.id, itemTypeId: itemTypeFields.itemTypeId, name: itemTypeFields.name }).from(itemTypeFields).all()) {
    fieldsByType.set(f.itemTypeId, [...(fieldsByType.get(f.itemTypeId) ?? []), { id: f.id, name: f.name }])
  }

  db.transaction((tx) => {
    for (const item of ITEMS) {
      const typeId = typeIds.get(item.type)
      const locationId = locationIds.get(item.location)
      if (typeId === undefined || locationId === undefined)
        throw new Error(`item '${item.name}' names an unknown type ('${item.type}') or location ('${item.location}')`)
      const row = tx
        .insert(items)
        .values({
          name: item.name,
          description: '',
          quantity: 1,
          unit: null,
          itemTypeId: typeId,
          locationId,
          createdBy: admin.id,
          published: true,
        })
        .returning({ id: items.id })
        .get()
      // One row per item per field, blank included as '' — a missing row and an
      // empty one read the same in the item form.
      for (const field of fieldsByType.get(typeId) ?? []) {
        tx.insert(itemCustomFieldValues)
          .values({ itemId: row.id, fieldId: field.id, value: item.values[field.name] ?? '' })
          .run()
      }
    }
  })

  created.push(`items     ${ITEMS.length} across ${TYPES.length} types`)
  rebuildFTS(db)
  created.push('search    items_fts rebuilt')
}

const main = async () => {
  await mkdir(dataDir, { recursive: true })
  const db = createDb(dbPath)
  runMigrations(db)

  const admin = db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN.email)).get()
  if (admin) {
    present.push(`user      ${ADMIN.email}`)
  } else {
    db.insert(users)
      .values({
        name: ADMIN.name,
        email: ADMIN.email,
        passwordHash: await hashPassword(ADMIN.password),
        role: 'admin',
        mustChangePassword: false,
      })
      .run()
    created.push(`user      ${ADMIN.email} / ${ADMIN.password}`)
  }

  seedLocations(db)
  seedTypes(db)
  seedItems(db)

  const report = (label: string, list: string[]) =>
    process.stdout.write(`\n${label} (${list.length}):\n${list.length === 0 ? '  —\n' : list.map((l) => `  ${l}\n`).join('')}`)
  process.stdout.write(`Seeding ${dbPath}\n`)
  report('Created', created)
  report('Already present', present)
  process.stdout.write(`\nDone: ${created.length} created, ${present.length} already present.\n`)
  process.exit(0)
}

void main().catch((err: Error) => {
  process.stderr.write(`Seed failed: ${err.message}\n`)
  process.exit(1)
})
