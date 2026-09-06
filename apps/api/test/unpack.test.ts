import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { detectionRegistry } from '../src/modules/detection/provider'
import { runUnpack, type UnpackContext } from '../src/modules/unpack/service'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateSettings } from '../src/modules/instanceSettings/service'
import { buildApp } from '../src/server'
import FormData from 'form-data'
import sharp from 'sharp'

const fakeProvider = { name: 'fake', detectBoxes: async () => [
  { label: 'cup', confidence: 0.9, box: { x: 10, y: 10, width: 80, height: 90 } },
  { label: 'plate', confidence: 0.8, box: { x: 200, y: 200, width: 100, height: 100 } },
] }

describe('runUnpack', () => {
  let dataDir: string
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'unpack-test-'))
    detectionRegistry.clear()
    detectionRegistry.register(fakeProvider)
  })

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

// HTTP surfaces. These use a `buildApp`-driven app, so they do NOT share the
// runUnpack unit fixture above: `buildApp` calls `registerDetectionProviders`,
// which clears the registry and (with DETECTION_MOCK=1) registers only the
// deterministic `mock` provider. The route tests therefore set DETECTION_MOCK=1
// BEFORE buildApp and point instance settings at `mock`.
describe('unpack routes', () => {
  let app: ReturnType<typeof buildApp>
  let adminCookie: string
  let routeDataDir: string
  let rootDir: string
  let itemTypeId: number
  let imageId: number

  // A real ≥300×300 PNG so both mock boxes survive clamping to the stored
  // width/height (a 1×1 PNG collapses every box → detected: 0).
  const bigPng = () => sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer()

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'test-secret'
    process.env.DETECTION_MOCK = '1'
    rootDir = mkdtempSync(join(tmpdir(), 'homebox-unpack-test-'))
    routeDataDir = join(rootDir, 'data')
    mkdirSync(routeDataDir, { recursive: true })
    const db = createDb(':memory:')
    runMigrations(db)
    app = buildApp({ db, dataDir: routeDataDir })
    await app.ready()

    // Bootstrap the admin (the `unpack.run` procedure is protected).
    await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@u.co', password: 'password123' } })
    const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@u.co', password: 'password123' } })
    adminCookie = login.headers['set-cookie'] as string

    // Create an item type + an item to attach an image to.
    const type = (await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: adminCookie }, payload: { name: 'UnpackType', fields: [] } })).json()?.result?.data
    expect(type?.id).toBeTruthy()
    itemTypeId = type.id
    const item = (await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload: { name: 'Original', itemTypeId, locationId: null, quantity: 1 } })).json()?.result?.data
    expect(item?.id).toBeTruthy()

    // Seed a 300×300 PNG via /upload/image so `join(dataDir, image.originalPath)`
    // exists and the image row carries width/height = 300.
    const form = new FormData()
    form.append('itemId', String(item.id))
    form.append('file', await bigPng(), { filename: 'seed.png', contentType: 'image/png' })
    const up = await app.inject({ method: 'POST', url: '/upload/image', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(up.statusCode).toBe(200)
    imageId = up.json().id

    // Point detection at the `mock` provider (registered by buildApp via DETECTION_MOCK=1).
    updateSettings(db, { detectionProvider: 'mock' as never })
  })

  afterAll(async () => {
    await app?.close()
    delete process.env.DETECTION_MOCK
    delete process.env.SESSION_SECRET
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('unpack.run (item kind) creates drafts from an existing image', async () => {
    const res = await app.inject({ method: 'POST', url: '/trpc/unpack.run', headers: { cookie: adminCookie }, payload: { kind: 'item', imageId } })
    expect(res.statusCode).toBe(200)
    const data = res.json()?.result?.data
    expect(data.detected).toBe(2)
    expect(data.drafts).toHaveLength(2)
    expect(data.drafts[0]).toMatchObject({ name: 'chair' })
    expect(data.drafts[1]).toMatchObject({ name: 'table' })
  })

  it('POST /upload/unpack (raw multipart) creates drafts from an uploaded image', async () => {
    const form = new FormData()
    form.append('itemTypeId', String(itemTypeId))
    form.append('file', await bigPng(), { filename: 'seed.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: '/upload/unpack', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.detected).toBe(2)
    expect(data.drafts).toHaveLength(2)
    expect(data.drafts[0]).toMatchObject({ id: expect.any(Number), name: 'chair', imageId: expect.any(Number) })
    expect(data.drafts[1]).toMatchObject({ id: expect.any(Number), name: 'table', imageId: expect.any(Number) })
  })
})
