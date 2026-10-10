import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations, images } from '@homebox/db'
import FormData from 'form-data'
import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { createMaintenance, startThumbnailJob } from '../src/modules/system/maintenance'

// The admin route onto `regenerateThumbnails` (the CLI's own coverage is
// `regenerateThumbnails.test.ts`): a background run, polled for progress and result.
let app: ReturnType<typeof buildApp>
let db: ReturnType<typeof createDb>
let dataDir: string
let adminCookie: string
let userCookie: string
let itemId: number

const START = (cookie: string) => app.inject({ method: 'POST', url: '/trpc/system.regenerateThumbnails', headers: { cookie }, payload: {} })
const STATUS = async (cookie: string) => (await app.inject({ method: 'GET', url: '/trpc/system.thumbnailsStatus', headers: { cookie } })).json()

const waitForDone = async () => {
  for (let i = 0; i < 200; i++) {
    const job = (await STATUS(adminCookie)).result.data
    if (job.status !== 'running') return job
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('thumbnail run did not finish')
}

const upload = async (buffer: Buffer, filename: string, contentType: string) => {
  const form = new FormData()
  form.append('itemId', String(itemId))
  form.append('file', buffer, { filename, contentType })
  const res = await app.inject({ method: 'POST', url: '/upload/image', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
  expect(res.statusCode).toBe(200)
  return res.json()
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  dataDir = mkdtempSync(join(tmpdir(), 'homebox-thumbjob-'))
  db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db, dataDir }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  adminCookie = (await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })).headers['set-cookie'] as string
  await app.inject({ method: 'POST', url: '/trpc/users.create', headers: { cookie: adminCookie }, payload: { name: 'U', email: 'u@b.co', password: 'password123', role: 'user' } })
  userCookie = (await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'u@b.co', password: 'password123' } })).headers['set-cookie'] as string
  const type = (await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: adminCookie }, payload: { name: 'T', fields: [] } })).json().result.data
  itemId = (await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload: { name: 'I', itemTypeId: type.id, locationId: null, quantity: 1 } })).json().result.data.id
})
afterAll(async () => { await app?.close(); rmSync(dataDir, { recursive: true, force: true }) })

describe('thumbnail regeneration from the admin', () => {
  it('is admin-only', async () => {
    expect((await START(userCookie)).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/trpc/system.thumbnailsStatus', headers: { cookie: userCookie } })).statusCode).toBe(403)
  })

  it('is idle before the first run', async () => {
    expect((await STATUS(adminCookie)).result.data).toEqual({ status: 'idle' })
  })

  it('re-renders every thumbnail, corrects stale sizes, and reports what it skipped', async () => {
    const plain = await upload(await sharp({ create: { width: 600, height: 300, channels: 3, background: '#777' } }).png().toBuffer(), 'a.png', 'image/png')
    // A row written before uploads honoured EXIF orientation: the raw size, sideways.
    const phone = await upload(await sharp({ create: { width: 400, height: 300, channels: 3, background: '#333' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(), 'p.jpg', 'image/jpeg')
    db.update(images).set({ width: 400, height: 300 }).where(eq(images.id, phone.id)).run()
    const missing = await upload(await sharp({ create: { width: 50, height: 50, channels: 3, background: '#111' } }).png().toBuffer(), 'm.png', 'image/png')
    unlinkSync(join(dataDir, missing.originalPath))
    unlinkSync(join(dataDir, plain.thumbPath))

    const start = await START(adminCookie)
    expect(start.statusCode).toBe(200)
    expect(start.json().result.data.status).toBe('running')

    const job = await waitForDone()
    expect(job).toEqual({
      status: 'done',
      total: 3,
      rewritten: 2,
      resized: 1,
      skippedCount: 1,
      skipped: [{ path: missing.originalPath, reason: 'file missing' }],
    })
    expect(existsSync(join(dataDir, plain.thumbPath))).toBe(true)
    expect(db.select({ w: images.width, h: images.height }).from(images).where(eq(images.id, phone.id)).get()).toEqual({ w: 300, h: 400 })
    // Written through a temp name and renamed into place; none may be left over.
    expect(readdirSync(join(dataDir, 'uploads', 'thumbs')).filter((f) => f.includes('.tmp-'))).toEqual([])
    // The result outlives the request that started it.
    expect((await STATUS(adminCookie)).result.data).toEqual(job)
  })

  it('joins a run already in progress instead of starting a second one', () => {
    const m = createMaintenance()
    const first = startThumbnailJob(m, db, dataDir)
    expect(startThumbnailJob(m, db, dataDir)).toBe(first)
  })

  it('refuses to start while a restore is being applied', () => {
    const m = createMaintenance()
    m.restoring = true
    expect(() => startThumbnailJob(m, db, dataDir)).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
  })
})
