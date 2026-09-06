import { describe, it, expect, beforeEach } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { detectionRegistry } from '../src/modules/detection/provider'
import { runUnpack, type UnpackContext } from '../src/modules/unpack/service'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateSettings } from '../src/modules/instanceSettings/service'
import sharp from 'sharp'

const fakeProvider = { name: 'fake', detectBoxes: async () => [
  { label: 'cup', confidence: 0.9, box: { x: 10, y: 10, width: 80, height: 90 } },
  { label: 'plate', confidence: 0.8, box: { x: 200, y: 200, width: 100, height: 100 } },
] }

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'unpack-test-'))
  detectionRegistry.clear()
  detectionRegistry.register(fakeProvider)
})

describe('runUnpack', () => {
  const seed = (db: ReturnType<typeof createDb>) => {
    db.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Unpack Tester', 'unpack@test.dev', 'x')").run()
    db.prepare("INSERT INTO item_types (id, name) VALUES (1, 'Uncategorized')").run()
    updateSettings(db, { detectionProvider: 'fake' as never })
  }

  it('creates one draft per box with a crop image, published=false, no location', async () => {
    const db = createDb(':memory:'); runMigrations(db)
    seed(db)
    const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer()
    const path = join(dataDir, 'src.png'); writeFileSync(path, png)
    const result = await runUnpack({ db, dataDir, userId: 1 }, { path, width: 300, height: 300, itemTypeId: 1 })
    expect(result.detected).toBe(2)
    expect(result.drafts).toHaveLength(2)
    const draftRow = db.prepare('SELECT published, location_id AS locationId, item_type_id AS itemTypeId, created_by AS createdBy FROM items WHERE id = ?').get(result.drafts[0].id) as any
    expect(draftRow).toMatchObject({ published: 0, locationId: null, itemTypeId: 1, createdBy: 1 })
    const img = db.prepare('SELECT original_path AS originalPath, thumb_path AS thumbPath, is_primary AS isPrimary FROM images WHERE item_id = ?').get(result.drafts[0].id) as any
    expect(img.isPrimary).toBe(1)
    expect(img.originalPath).toMatch(/uploads\/originals\//)
  })
  it('returns { detected: 0, drafts: [] } when no boxes', async () => {
    detectionRegistry.clear(); detectionRegistry.register({ name: 'fake', detectBoxes: async () => [] })
    const db = createDb(':memory:'); runMigrations(db)
    seed(db)
    const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer()
    const path = join(dataDir, 'src.png'); writeFileSync(path, png)
    const result = await runUnpack({ db, dataDir, userId: 1 }, { path, width: 300, height: 300, itemTypeId: 1 })
    expect(result).toEqual({ detected: 0, drafts: [] })
  })
})
