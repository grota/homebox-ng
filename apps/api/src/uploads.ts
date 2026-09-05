import { createReadStream, existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join, resolve, sep } from 'node:path'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import sharp from 'sharp'
import { eq, max } from 'drizzle-orm'
import { images, items } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { parseSessionCookie } from './context.js'
import { getSessionUser } from './auth/sessions.js'
import { insertImage } from './modules/images/repo.js'

// No `instance_settings` table exists in Phase 1 (the plan's original source of
// `max_upload_mb`), so this is a module constant. A settings table is out of
// scope; `process.env.MAX_UPLOAD_MB` can override it if a deploy needs to.
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 10

const maxUploadBytes = MAX_UPLOAD_MB * 1024 * 1024

type RegisterUploadRoutesOptions = { db: DrizzleDb; dataDir: string }

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

// Resolve a relative upload path and confirm it stays inside `dataDir`. Returns
// the absolute path, or null when the path is unsafe (empty, contains a `..`
// segment, an absolute/backslash path, or a null byte).
const resolveInside = (dataDir: string, relpath: string): string | null => {
  if (!relpath || relpath.startsWith('/') || relpath.includes('\\') || relpath.includes('\0') || relpath.split('/').includes('..')) return null
  const root = resolve(dataDir)
  const abs = resolve(root, relpath)
  if (abs !== root && !abs.startsWith(root + sep)) return null
  return abs
}

// Read the `itemId` text field that precedes the file part. `part.fields`
// values can be a string, a `{ value, ... }` object, or (rarely) an array;
// normalize to a single `number`.
const itemIdFrom = (field: unknown): number => {
  let raw = Array.isArray(field) ? field[0] : field
  const value =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'value' in raw
        ? (raw as { value: unknown }).value
        : undefined
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : NaN
}

export const registerUploadRoutes = (app: FastifyInstance, { db, dataDir }: RegisterUploadRoutesOptions): void => {
  // Align busboy's own file-size limit with MAX_UPLOAD_MB so uploads over the
  // cap are rejected by the multipart parser (surfaced as FST_REQ_FILE_TOO_LARGE)
  // rather than silently truncated.
  app.register(multipart, { limits: { fileSize: maxUploadBytes, files: 1 } })

  // Multipart upload of one image for an item. Auth required (the image is tied
  // to an item, which is itself auth-gated via the tRPC `items` router).
  app.post('/upload/image', async (req, reply) => {
    const token = parseSessionCookie(req.headers.cookie)
    const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
    if (!user) return reply.code(401).send({ error: 'UNAUTHORIZED' })

    const part = await req.file()
    if (!part) return reply.code(400).send({ error: 'expected a file part' })

    const itemId = itemIdFrom((part.fields as Record<string, unknown>).itemId)
    if (Number.isNaN(itemId)) return reply.code(400).send({ error: 'invalid itemId' })

    if (typeof part.mimetype !== 'string' || !part.mimetype.startsWith('image/')) {
      return reply.code(400).send({ error: 'file must be an image' })
    }

    const item = db.select({ id: items.id }).from(items).where(eq(items.id, itemId)).get()
    if (!item) return reply.code(404).send({ error: 'item not found' })

    let buffer: Buffer
    try {
      buffer = await part.toBuffer()
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file too large' })
      }
      throw err
    }
    if (buffer.length > maxUploadBytes) return reply.code(413).send({ error: 'file too large' })

    const metadata = await sharp(buffer).metadata()
    const width = metadata.width ?? null
    const height = metadata.height ?? null

    const uuid = randomUUID()
    const ext = extFromFilename(part.filename) ?? extFromMime(part.mimetype) ?? 'bin'

    // Paths are stored RELATIVE to dataDir so `GET /file/<relpath>` can serve
    // them without knowing where uploads live on disk.
    const originalRel = `uploads/originals/${uuid}.${ext}`
    const thumbRel = `uploads/thumbs/${uuid}.jpg`

    const originalAbs = join(dataDir, originalRel)
    const thumbAbs = join(dataDir, thumbRel)
    await mkdir(dirname(originalAbs), { recursive: true })
    await writeFile(originalAbs, buffer)

    const thumb = await sharp(buffer).resize({ width: 400 }).jpeg({ quality: 80 }).toBuffer()
    await mkdir(dirname(thumbAbs), { recursive: true })
    await writeFile(thumbAbs, thumb)

    // `max(sortOrder)` is null when the item has no images yet → this is the
    // first image, so it becomes primary and starts at sortOrder 1.
    const maxSort = db.select({ m: max(images.sortOrder) }).from(images).where(eq(images.itemId, itemId)).get()?.m

    const row = insertImage(db, {
      itemId,
      originalPath: originalRel,
      thumbPath: thumbRel,
      format: part.mimetype,
      sizeBytes: buffer.length,
      width,
      height,
      sortOrder: (maxSort ?? 0) + 1,
      isPrimary: maxSort == null,
    })

    return reply.code(200).send(row)
  })

  // Non-destructive edit of an existing image. Writes the edited file to a fresh
  // `uploads/edited/` path, regenerates the thumb, and updates the row's
  // `editedPath`/`thumbPath`/dimensions/format/size while leaving
  // `originalPath`, `sortOrder`, `isPrimary` and `itemId` untouched.
  app.post('/upload/image/edit', async (req, reply) => {
    const token = parseSessionCookie(req.headers.cookie)
    const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
    if (!user) return reply.code(401).send({ error: 'UNAUTHORIZED' })

    const part = await req.file()
    if (!part) return reply.code(400).send({ error: 'expected a file part' })

    const imageId = itemIdFrom((part.fields as Record<string, unknown>).imageId)
    if (Number.isNaN(imageId)) return reply.code(400).send({ error: 'invalid imageId' })

    if (typeof part.mimetype !== 'string' || !part.mimetype.startsWith('image/')) {
      return reply.code(400).send({ error: 'file must be an image' })
    }

    const existing = db.select().from(images).where(eq(images.id, imageId)).get()
    if (!existing) return reply.code(404).send({ error: 'image not found' })

    let buffer: Buffer
    try {
      buffer = await part.toBuffer()
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file too large' })
      }
      throw err
    }
    if (buffer.length > maxUploadBytes) return reply.code(413).send({ error: 'file too large' })

    let width: number | null = null
    let height: number | null = null

    const uuid = randomUUID()
    const ext = extFromFilename(part.filename) ?? extFromMime(part.mimetype) ?? 'bin'
    const editedRel = `uploads/edited/${uuid}.${ext}`
    const thumbRel = `uploads/thumbs/${uuid}.jpg`

    const editedAbs = join(dataDir, editedRel)
    const thumbAbs = join(dataDir, thumbRel)

    // `sharp` throws on undecodable bytes (a forged `image/*` content type). Decode
    // and produce the thumb before writing anything to disk, so a bad image never
    // leaves a partial file behind — return a clean 400 instead of a 500.
    let thumb: Buffer
    try {
      const metadata = await sharp(buffer).metadata()
      width = metadata.width ?? null
      height = metadata.height ?? null
      thumb = await sharp(buffer).resize({ width: 400 }).jpeg({ quality: 80 }).toBuffer()
    } catch {
      return reply.code(400).send({ error: 'not a decodable image' })
    }

    await mkdir(dirname(editedAbs), { recursive: true })
    await writeFile(editedAbs, buffer)
    await mkdir(dirname(thumbAbs), { recursive: true })
    await writeFile(thumbAbs, thumb)

    const row = db.update(images).set({
      editedPath: editedRel,
      thumbPath: thumbRel,
      width,
      height,
      format: part.mimetype,
      sizeBytes: buffer.length,
    }).where(eq(images.id, imageId)).returning({
      id: images.id,
      originalPath: images.originalPath,
      editedPath: images.editedPath,
      thumbPath: images.thumbPath,
      isPrimary: images.isPrimary,
      width: images.width,
      height: images.height,
    }).get()

    // The image could be deleted between the existence check and the update.
    if (!row) return reply.code(404).send({ error: 'image not found' })

    return reply.code(200).send(row)
  })

  // Public file-serving route, used by `<img src="/file/uploads/...">` tags
  // which cannot send a Cookie header. Guards against path traversal.
  app.get('/file/*', async (req, reply) => {
    const relpath = (req.params as { '*': string })['*']
    const abs = resolveInside(dataDir, relpath)
    if (!abs) return reply.code(403).send({ error: 'forbidden' })
    if (!existsSync(abs)) return reply.code(404).send({ error: 'not found' })
    const type = MIME_BY_EXT[extname(abs).toLowerCase()] ?? 'application/octet-stream'
    return reply.type(type).send(createReadStream(abs))
  })
}

const extFromFilename = (filename: string | undefined): string | null => {
  if (!filename) return null
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) return null
  const ext = filename.slice(dot + 1).toLowerCase()
  return ext || null
}

const extFromMime = (mimetype: string): string | null => {
  const subtype = mimetype.split('/')[1]
  if (!subtype) return null
  return subtype === 'jpeg' ? 'jpg' : subtype
}
