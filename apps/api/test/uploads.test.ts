import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'
import FormData from 'form-data'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'

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

const uploadImage = async () => {
  const form = new FormData()
  form.append('itemId', String(itemId))
  form.append('file', png, { filename: 'tmp.png', contentType: 'image/png' })
  const res = await app.inject({ method: 'POST', url: '/upload/image', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
  expect(res.statusCode).toBe(200)
  return res.json()
}

describe('image edit', () => {
  it('saves the edited image, regenerates the thumb, and keeps the original', async () => {
    const img = await uploadImage()
    // A different-sized PNG so width/height change proves metadata is re-read.
    const edited = await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()

    const form = new FormData()
    form.append('imageId', String(img.id))
    form.append('file', edited, { filename: 'edited.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(200)
    const out = res.json()
    expect(out.editedPath).toMatch(/edited\//)
    expect(out.thumbPath).toMatch(/thumbs\//)
    expect(out.thumbPath).not.toBe(img.thumbPath)  // regenerated to a new file
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    expect(out.originalPath).toBe(img.originalPath)  // non-destructive
    expect(out.isPrimary).toBe(img.isPrimary)
  })

  it('rejects unauthenticated requests', async () => {
    const img = await uploadImage()
    const form = new FormData()
    form.append('imageId', String(img.id))
    form.append('file', png, { filename: 'edited.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a bad or unknown imageId', async () => {
    const img = await uploadImage()
    for (const bad of ['abc', '999999']) {
      const form = new FormData()
      form.append('imageId', bad)
      form.append('file', png, { filename: 'edited.png', contentType: 'image/png' })
      const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
      expect([400, 404]).toContain(res.statusCode)
    }
  })

  it('rejects a non-image file', async () => {
    const img = await uploadImage()
    const form = new FormData()
    form.append('imageId', String(img.id))
    form.append('file', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' })
    const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a file over the size cap', async () => {
    const img = await uploadImage()
    const big = Buffer.alloc(11 * 1024 * 1024, 1)  // > default 10MB MAX_UPLOAD_MB
    const form = new FormData()
    form.append('imageId', String(img.id))
    form.append('file', big, { filename: 'big.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(413)
  })

  it('rejects a forged image mimetype with undecodable bytes', async () => {
    const img = await uploadImage()
    const form = new FormData()
    form.append('imageId', String(img.id))
    form.append('file', Buffer.from('this is not a real image'), { filename: 'x.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(400)
  })
})
