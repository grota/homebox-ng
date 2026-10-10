import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createDb, images, items, itemTypes, runMigrations, users, type DrizzleDb } from '@homebox/db'

// `scripts/regenerate-thumbnails.ts` is the only thing in the app that rewrites a
// thumbnail **in place**, so a bug here damages files rather than rendering them
// wrong: a bad path would orphan every photo or overwrite an original. It is also
// the tool for the four upscaled thumbnails already on disk, which means it has to
// work on the files that exist today, not only on files it wrote itself.
//
// It runs as a CLI — it reads DATA_DIR and DATABASE_PATH from the environment and
// resolves them the way the server does — so it is exercised as a CLI against a
// temp data dir. Calling its body directly would skip the env handling, which is
// the part that decides which directory gets written to.
const exec = promisify(execFile)

const API_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = join(API_DIR, 'scripts/regenerate-thumbnails.ts')

const sizeOf = async (path: string) => {
  const meta = await sharp(readFileSync(path)).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}

// The rule as it stood before `renderThumbnail`: width only, so `sharp`'s default
// `withoutEnlargement: false` inflates anything narrower than 400.
const oldRule = (source: Buffer) => sharp(source).resize({ width: 400 }).jpeg({ quality: 80 }).toBuffer()

let rootDir: string
let dataDir: string
let dbPath: string
let db: DrizzleDb
let originalAbs: string
let thumbAbs: string

const sourcePath = 'uploads/originals/seed.png'
const thumbPath = 'uploads/thumbs/seed.jpg'
const editedOriginalPath = 'uploads/originals/edited-source.png'
const editedPath = 'uploads/edited/edit.png'
const editedThumbPath = 'uploads/thumbs/edit.jpg'

const run = async () => {
  const { stdout } = await exec('pnpm', ['exec', 'tsx', SCRIPT], {
    cwd: API_DIR,
    env: { ...process.env, DATA_DIR: dataDir, DATABASE_PATH: dbPath },
  })
  return stdout
}

beforeAll(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'homebox-thumb-regen-'))
  dataDir = join(rootDir, 'data')
  dbPath = join(rootDir, 'homebox.db')
  originalAbs = join(dataDir, sourcePath)
  thumbAbs = join(dataDir, thumbPath)
  mkdirSync(dirname(originalAbs), { recursive: true })
  mkdirSync(dirname(thumbAbs), { recursive: true })

  db = createDb(dbPath)
  runMigrations(db)

  // The parents exist only to satisfy the foreign keys on `images`; nothing in the
  // script reads them. Only the two path columns matter, and both are `notNull` on
  // every row the app writes.
  const [user] = db.insert(users).values({ name: 'Admin', email: 'a@b.co', passwordHash: 'x' }).returning({ id: users.id }).all()
  const [type] = db.insert(itemTypes).values({ name: 'Type' }).returning({ id: itemTypes.id }).all()
  const [item] = db.insert(items).values({ name: 'Item', itemTypeId: type.id, createdBy: user.id }).returning({ id: items.id }).all()
  db.insert(images).values({ itemId: item.id, originalPath: sourcePath, thumbPath }).run()
  // An edited photo, whose thumb must come from the edit: a 300×100 crop of a
  // 100×300 original, so the two sources give visibly different thumbs.
  db.insert(images).values({ itemId: item.id, originalPath: editedOriginalPath, editedPath, thumbPath: editedThumbPath }).run()
  mkdirSync(dirname(join(dataDir, editedPath)), { recursive: true })
  writeFileSync(join(dataDir, editedOriginalPath), await sharp({ create: { width: 100, height: 300, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toBuffer())
  writeFileSync(join(dataDir, editedPath), await sharp({ create: { width: 300, height: 100, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toBuffer())
  writeFileSync(join(dataDir, editedThumbPath), Buffer.from('stale'))

  // Smaller than the bound, so the two rules disagree visibly: the old one inflates
  // it to 400 wide, the new one leaves it alone.
  writeFileSync(originalAbs, await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 120, g: 120, b: 120 } } }).png().toBuffer())
  writeFileSync(thumbAbs, await oldRule(readFileSync(originalAbs)))
})

afterAll(() => rmSync(rootDir, { recursive: true, force: true }))

describe('regenerate-thumbnails', () => {
  it('re-renders a thumbnail in place under the current rule, and a second run is a no-op', async () => {
    const row = db.select().from(images).get()!
    expect(await sizeOf(thumbAbs)).toEqual({ width: 400, height: 200 }) // enlarged by the old rule

    expect(await run()).toContain('2 rewritten, 0 skipped, of 2 images.')

    // The paths in the database are untouched, which is the whole reason this is
    // safe to re-run: `thumbPath` is already unique and already known, so no file is
    // orphaned. The one write is the stored size, filled in from the photo.
    expect(db.select().from(images).get()).toEqual({ ...row, width: 200, height: 100 })
    expect(await sizeOf(thumbAbs)).toEqual({ width: 200, height: 100 }) // never enlarged
    // The edited photo's thumb follows the edit, not the original under it.
    expect(await sizeOf(join(dataDir, editedThumbPath))).toEqual({ width: 300, height: 100 })

    // Idempotent, and proved to have actually rewritten rather than merely left
    // alone: clobber the file, run again, and the previous bytes come back.
    const first = readFileSync(thumbAbs)
    writeFileSync(thumbAbs, Buffer.from('clobbered'))
    await run()
    expect(readFileSync(thumbAbs).equals(first)).toBe(true)
  }, 60_000)
})
