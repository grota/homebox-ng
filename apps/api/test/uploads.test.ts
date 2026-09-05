import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'
import FormData from 'form-data'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// NOTE: the brief's original PNG (iVBORw0KGgo...gJggg==) fails sharp's pixel
// decode ("vipspng: libpng read error") — the 1x1 header reads but the pixel
// data can't be decoded by libvips. This is a known-good 1x1 transparent PNG we
// substitute so the thumbnail pipeline actually runs. See report deviation.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

let app: ReturnType<typeof buildApp>
let adminCookie: string
let itemId: number
let dataDir: string

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  dataDir = mkdtempSync(join(tmpdir(), 'homebox-uploads-'))
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db, dataDir }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const aLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = aLogin.headers['set-cookie'] as string
  const type = (await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: adminCookie }, payload: { name: 'ImgType', fields: [] } })).json()?.result?.data
  const item = (await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload: { name: 'Pic', itemTypeId: type.id, locationId: null, quantity: 1 } })).json()?.result?.data
  itemId = item.id
})
afterAll(() => { app?.close(); rmSync(dataDir, { recursive: true, force: true }) })

describe('image upload', () => {
  it('uploads an image and creates a thumbnail', async () => {
    const form = new FormData()
    form.append('itemId', String(itemId))
    form.append('file', png, { filename: 'test.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: '/upload/image', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(200)
    const img = res.json()
    expect(img.originalPath).toMatch(/originals\//)
    expect(img.thumbPath).toMatch(/thumbs\//)
  })
})
