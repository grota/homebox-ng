import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { renderThumbnail } from '../src/modules/images/thumbnail.js'
import {
  createDb,
  runMigrations,
  users,
  locations,
  itemTypes,
  itemTypeFields,
  items,
  itemCustomFieldValues,
  images,
} from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { hashPassword } from '../src/auth/password.js'
import { DEFAULT_DATA_DIR, DEFAULT_DATABASE_PATH, resolveDataPath } from '../src/env.js'
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
//
// Items also get photos, taken from `scripts/seed/images/` — see `attachImages`.
const ADMIN = { name: 'Admin', email: 'a@a.com', password: 'aaaaaaaa' }

// Both paths go through the server's own rule (`resolveDataPath`) and its own
// defaults, so a bare `pnpm --filter @homebox/api seed` writes the database the
// server will open — whatever directory the process was started from. A relative
// value resolves against the workspace root, never the cwd; `detection-model.ts`
// reads the environment the same way.
const dataDir = resolveDataPath(process.env.DATA_DIR ?? DEFAULT_DATA_DIR)
const dbPath = resolveDataPath(process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH)

// The fixture photos, sitting next to this script. They carry no filename
// extension — they are named by content hash — so the format is sniffed with
// `sharp` rather than read off the name.
const SEED_IMAGES_DIR = fileURLToPath(new URL('./seed/images', import.meta.url))

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
//
// Thirty of them, one per fixture photo, so the catalog paginates and the grid
// has something real to lay out.
const ITEMS: { name: string; type: string; location: string; values: Record<string, string> }[] = [
  { name: 'Oak workbench', type: 'Probe texture', location: 'Garage', values: { finish: 'matte', width: '1200' } },
  { name: 'Steel bracket', type: 'Probe texture', location: 'Shed', values: { finish: 'brushed steel', width: '80' } },
  { name: 'Sample swatch', type: 'Probe texture', location: 'Study', values: { finish: 'n/a', width: '' } },
  { name: 'Wall panel', type: 'Probe texture', location: 'Garage', values: { finish: 'satin', width: '600' } },
  { name: 'Copper sheet', type: 'Probe texture', location: 'Garage', values: { finish: 'raw copper', width: '1000' } },
  { name: 'Ash veneer', type: 'Probe texture', location: 'Study', values: { finish: 'oiled', width: '900' } },
  { name: 'Slate tile', type: 'Probe texture', location: 'Shed', values: { finish: 'honed', width: '300' } },
  { name: 'Cork underlay', type: 'Probe texture', location: 'Shed', values: { finish: 'natural', width: '2000' } },
  { name: 'Brass kick plate', type: 'Probe texture', location: 'Home', values: { finish: 'polished', width: '450' } },
  { name: 'Linen panel', type: 'Probe texture', location: 'Home', values: { finish: 'woven', width: '1400' } },
  { name: 'Dining table', type: 'Furniture', location: 'Home', values: { material: 'oak', price: '899.00' } },
  { name: 'Bookshelf', type: 'Furniture', location: 'Study', values: { material: 'pine', price: '149.50' } },
  { name: 'Desk lamp', type: 'Furniture', location: 'Study', values: { material: 'brass', price: '79.99' } },
  { name: 'Coffee table', type: 'Furniture', location: 'Home', values: { material: 'walnut', price: '429.00' } },
  { name: 'Wardrobe', type: 'Furniture', location: 'Home', values: { material: 'birch ply', price: '1250.00' } },
  { name: 'Sideboard', type: 'Furniture', location: 'Home', values: { material: 'teak', price: '780.00' } },
  { name: 'Armchair', type: 'Furniture', location: 'Study', values: { material: 'bouclé', price: '640.00' } },
  { name: 'Bed frame', type: 'Furniture', location: 'Home', values: { material: 'ash', price: '1590.00' } },
  { name: 'Kitchen stool', type: 'Furniture', location: 'Home', values: { material: 'beech', price: '95.00' } },
  { name: 'Filing cabinet', type: 'Furniture', location: 'Study', values: { material: 'steel', price: '210.00' } },
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
  {
    name: 'Angle grinder',
    type: 'Electronics',
    location: 'Garage',
    values: { serial: 'MAK-GA9020-3311', manual: 'https://example.com/manuals/ga9020.pdf' },
  },
  {
    name: 'Heat gun',
    type: 'Electronics',
    location: 'Garage',
    values: { serial: 'MAK-HG6030-7781', manual: 'https://example.com/manuals/hg6030.pdf' },
  },
  {
    name: 'Soldering station',
    type: 'Electronics',
    location: 'Study',
    values: { serial: 'HKK-FX888D-2043', manual: 'https://example.com/manuals/fx888d.pdf' },
  },
  {
    name: 'Bench drill',
    type: 'Electronics',
    location: 'Shed',
    values: { serial: 'BOS-PBD40-5510', manual: 'https://example.com/manuals/pbd40.pdf' },
  },
  {
    name: 'Laser level',
    type: 'Electronics',
    location: 'Shed',
    values: { serial: 'BOS-GLL3-80-1122', manual: 'https://example.com/manuals/gll3-80.pdf' },
  },
  {
    name: 'Power meter',
    type: 'Electronics',
    location: 'Garage',
    values: { serial: '', manual: 'https://example.com/manuals/energy-meter.pdf' },
  },
  {
    name: 'Raspberry Pi',
    type: 'Electronics',
    location: 'Study',
    values: { serial: 'RPI-5-8GB-0091', manual: 'https://example.com/manuals/raspberry-pi-5.pdf' },
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

// The `n` largest files in the fixture set. The set holds more than the catalog
// can use, and the ordering is the point: the small ones are icons and
// placeholders that make a poor-looking grid, the big ones are real photographs.
const largestImages = async (n: number): Promise<string[]> => {
  let entries
  try {
    entries = await readdir(SEED_IMAGES_DIR, { withFileTypes: true })
  } catch {
    return [] // a checkout without the fixture photos still seeds a catalog
  }
  const sized = await Promise.all(
    entries.filter((e) => e.isFile()).map(async (e) => ({ name: e.name, size: (await stat(join(SEED_IMAGES_DIR, e.name))).size })),
  )
  return sized.sort((a, b) => b.size - a.size).slice(0, n).map((f) => f.name)
}

// Give the first `itemIds.length` items a photo, reproducing the layout the
// upload route writes (see `src/uploads.ts`): originals under
// `uploads/originals/`, a 400px JPEG thumb under `uploads/thumbs/`, both stored
// relative to `dataDir` so `GET /file/<relpath>` can serve them.
//
// The extension is not cosmetic. The file route picks the content type from it,
// and an extension it does not know is served as `application/octet-stream`,
// which an `<img>` refuses to render — the photo would be silently blank.
const attachImages = async (db: DrizzleDb, itemIds: number[]): Promise<number> => {
  const files = await largestImages(itemIds.length)
  for (const [i, name] of files.entries()) {
    const buffer = await readFile(join(SEED_IMAGES_DIR, name))
    // Decoded before anything is written, so a fixture that is not actually an
    // image fails the seed loudly instead of leaving a broken path in the DB.
    const metadata = await sharp(buffer).metadata()
    const format = metadata.format ?? 'jpeg'
    const ext = format === 'jpeg' ? 'jpg' : format

    // The fixture's own name is a content hash, so the stored path is stable —
    // re-running the seed overwrites in place rather than accumulating copies.
    const originalRel = `uploads/originals/${name}.${ext}`
    const thumbRel = `uploads/thumbs/${name}.jpg`

    const thumb = await renderThumbnail(buffer)
    await mkdir(dirname(join(dataDir, originalRel)), { recursive: true })
    await mkdir(dirname(join(dataDir, thumbRel)), { recursive: true })
    await writeFile(join(dataDir, originalRel), buffer)
    await writeFile(join(dataDir, thumbRel), thumb)

    db.insert(images)
      .values({
        itemId: itemIds[i],
        originalPath: originalRel,
        thumbPath: thumbRel,
        format,
        sizeBytes: buffer.length,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        // One photo per seeded item, so it is both the first and the cover.
        sortOrder: 1,
        isPrimary: true,
      })
      .run()
  }
  return files.length
}

// Only when the catalog is empty, so a re-run over an existing one cannot
// multiply the items. The FTS index is maintained at the application layer (see
// modules/items/fts.ts), so a direct insert leaves `items_fts` empty and every
// search would come back blank — rebuild it, but only when something landed.
const seedItems = async (db: DrizzleDb): Promise<void> => {
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

  // Insertion order, so the Nth item takes the Nth-largest photo.
  const itemIds: number[] = []

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
      itemIds.push(row.id)
      // One row per item per field, blank included as '' — a missing row and an
      // empty one read the same in the item form.
      for (const field of fieldsByType.get(typeId) ?? []) {
        tx.insert(itemCustomFieldValues)
          .values({ itemId: row.id, fieldId: field.id, value: item.values[field.name] ?? '' })
          .run()
      }
    }
  })

  // Outside the transaction on purpose: this writes files, and a rollback would
  // not take them back.
  const photos = await attachImages(db, itemIds)

  created.push(`items     ${ITEMS.length} across ${TYPES.length} types`)
  created.push(
    photos > 0
      ? `images    ${photos} attached`
      : 'images    none — no files in apps/api/scripts/seed/images/',
  )
  rebuildFTS(db)
  created.push('search    items_fts rebuilt')
}

const main = async () => {
  // Both directories: the data dir holds the uploads, and the database may be
  // pointed outside it. better-sqlite3 will not create either's parent, which is
  // the same reason `apps/api/src/index.ts` mkdirs the db's directory.
  await mkdir(dataDir, { recursive: true })
  await mkdir(dirname(dbPath), { recursive: true })
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
  await seedItems(db)

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
