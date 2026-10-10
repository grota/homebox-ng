import { createReadStream, existsSync } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join, resolve, sep } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import sharp from 'sharp'
import { renderThumbnail } from './modules/images/thumbnail.js'
import { eq, max } from 'drizzle-orm'
import { images, items, type DrizzleDb } from '@homebox/db'
import { parseSessionCookie } from './context.js'
import type { DbHolder } from './context.js'
import { getSessionUser } from './auth/sessions.js'
import { insertImage } from './modules/images/repo.js'
import { getSettings as getInstanceSettings } from './modules/instanceSettings/service.js'

// Hard parser ceiling: never pre-truncate a file the admin might allow. The
// effective per-request cap is read from instance_settings below.
export const HARD_UPLOAD_CEILING_MB = Number(process.env.MAX_UPLOAD_MB) || 100
const hardUploadBytes = HARD_UPLOAD_CEILING_MB * 1024 * 1024

type RegisterUploadRoutesOptions = { dbHolder: DbHolder; dataDir: string }

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

// Read a text field that precedes the file part. `part.fields` values can be a
// string, a `{ value, ... }` object, or (rarely) an array; normalize to a string.
export const fieldText = (field: unknown): string | undefined => {
  const raw = Array.isArray(field) ? field[0] : field
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && 'value' in raw) {
    const value = (raw as { value: unknown }).value
    return typeof value === 'string' ? value : undefined
  }
  return undefined
}

// An id field (`itemId`, `imageId`, `itemTypeId`) as a positive integer, or NaN.
export const itemIdFrom = (field: unknown): number => {
  const id = Number(fieldText(field))
  return Number.isInteger(id) && id > 0 ? id : NaN
}

export type ImageUpload = { userId: number; buffer: Buffer; mimetype: string; filename: string | undefined; fields: Record<string, unknown> }

// Send an error reply and yield `null`, so a validation failure is one line.
const fail = (reply: FastifyReply, code: number, error: string): null => {
  reply.code(code).send({ error })
  return null
}

// The shared head of every image route (photo upload, photo edit, both unpacks):
// authenticate the session cookie, read the single image part, check its
// mimetype, and enforce the effective per-request cap from instance_settings.
// The other form fields ride on the same part, so they come back with it — a
// caller cannot read them once this has consumed the stream. Returns null after
// having already sent the error reply, so callers do `if (!upload) return reply`.
export const readImageUpload = async (req: FastifyRequest, reply: FastifyReply, db: DrizzleDb): Promise<ImageUpload | null> => {
  const token = parseSessionCookie(req.headers.cookie)
  const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
  if (!user) return fail(reply, 401, 'UNAUTHORIZED')

  const part = await req.file()
  if (!part) return fail(reply, 400, 'expected a file part')
  if (typeof part.mimetype !== 'string' || !part.mimetype.startsWith('image/')) return fail(reply, 400, 'file must be an image')

  let buffer: Buffer
  try {
    buffer = await part.toBuffer()
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return fail(reply, 413, 'file too large')
    }
    throw err
  }
  if (buffer.length > getInstanceSettings(db).maxUploadMb * 1024 * 1024) return fail(reply, 413, 'file too large')

  return { userId: user.id, buffer, mimetype: part.mimetype, filename: part.filename, fields: part.fields as Record<string, unknown> }
}

// Dimensions plus the thumbnail, or null when the bytes are not a decodable
// image (a forged `image/*` content type) — `sharp` throws on those. Run before
// anything is written, so a bad image never leaves a partial file behind.
const decodeImage = async (buffer: Buffer): Promise<{ width: number | null; height: number | null; thumb: Buffer } | null> => {
  try {
    const metadata = await sharp(buffer).metadata()
    // `autoOrient` is the size as displayed: a portrait phone photo stores
    // landscape pixels plus an EXIF rotation, and the raw size would say landscape.
    const { width, height } = metadata.autoOrient
    return { width: width ?? null, height: height ?? null, thumb: await renderThumbnail(buffer) }
  } catch {
    return null
  }
}

const removeFiles = (dataDir: string, rels: (string | null)[]): void => {
  for (const rel of rels) if (rel) unlink(join(dataDir, rel)).catch(() => {}) // best-effort
}

export const registerUploadRoutes = (app: FastifyInstance, { dbHolder, dataDir }: RegisterUploadRoutesOptions): void => {
  // Align busboy's own file-size limit with HARD_UPLOAD_CEILING_MB so uploads
  // over the hard ceiling are rejected by the multipart parser (surfaced as
  // FST_REQ_FILE_TOO_LARGE) rather than silently truncated. The effective
  // per-request cap is read from instance_settings inside the handlers.
  app.register(multipart, { limits: { fileSize: hardUploadBytes, files: 1 } })

  // Multipart upload of one image for an item. Auth required (the image is tied
  // to an item, which is itself auth-gated via the tRPC `items` router).
  app.post('/upload/image', async (req, reply) => {
    const db = dbHolder.current
    const upload = await readImageUpload(req, reply, db)
    if (!upload) return reply
    const itemId = itemIdFrom(upload.fields.itemId)
    if (Number.isNaN(itemId)) return reply.code(400).send({ error: 'invalid itemId' })

    const item = db.select({ id: items.id }).from(items).where(eq(items.id, itemId)).get()
    if (!item) return reply.code(404).send({ error: 'item not found' })

    const decoded = await decodeImage(upload.buffer)
    if (!decoded) return reply.code(400).send({ error: 'not a decodable image' })

    const uuid = randomUUID()
    const ext = extFromFilename(upload.filename) ?? extFromMime(upload.mimetype) ?? 'bin'

    // Paths are stored RELATIVE to dataDir so `GET /file/<relpath>` can serve
    // them without knowing where uploads live on disk.
    const originalRel = `uploads/originals/${uuid}.${ext}`
    const thumbRel = `uploads/thumbs/${uuid}.jpg`

    const originalAbs = join(dataDir, originalRel)
    const thumbAbs = join(dataDir, thumbRel)
    await mkdir(dirname(originalAbs), { recursive: true })
    await writeFile(originalAbs, upload.buffer)
    await mkdir(dirname(thumbAbs), { recursive: true })
    await writeFile(thumbAbs, decoded.thumb)

    // `max(sortOrder)` is null when the item has no images yet → this is the
    // first image, so it becomes primary and starts at sortOrder 1.
    const maxSort = db.select({ m: max(images.sortOrder) }).from(images).where(eq(images.itemId, itemId)).get()?.m

    const row = insertImage(db, {
      itemId,
      originalPath: originalRel,
      thumbPath: thumbRel,
      format: upload.mimetype,
      sizeBytes: upload.buffer.length,
      width: decoded.width,
      height: decoded.height,
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
    const db = dbHolder.current
    const upload = await readImageUpload(req, reply, db)
    if (!upload) return reply
    const imageId = itemIdFrom(upload.fields.imageId)
    if (Number.isNaN(imageId)) return reply.code(400).send({ error: 'invalid imageId' })

    const existing = db.select().from(images).where(eq(images.id, imageId)).get()
    if (!existing) return reply.code(404).send({ error: 'image not found' })

    const decoded = await decodeImage(upload.buffer)
    if (!decoded) return reply.code(400).send({ error: 'not a decodable image' })

    const uuid = randomUUID()
    const ext = extFromFilename(upload.filename) ?? extFromMime(upload.mimetype) ?? 'bin'
    const editedRel = `uploads/edited/${uuid}.${ext}`
    const thumbRel = `uploads/thumbs/${uuid}.jpg`

    const editedAbs = join(dataDir, editedRel)
    const thumbAbs = join(dataDir, thumbRel)
    await mkdir(dirname(editedAbs), { recursive: true })
    await writeFile(editedAbs, upload.buffer)
    await mkdir(dirname(thumbAbs), { recursive: true })
    await writeFile(thumbAbs, decoded.thumb)

    const row = db.update(images).set({
      editedPath: editedRel,
      thumbPath: thumbRel,
      width: decoded.width,
      height: decoded.height,
      format: upload.mimetype,
      sizeBytes: upload.buffer.length,
    }).where(eq(images.id, imageId)).returning({
      id: images.id,
      originalPath: images.originalPath,
      editedPath: images.editedPath,
      thumbPath: images.thumbPath,
      isPrimary: images.isPrimary,
      width: images.width,
      height: images.height,
    }).get()

    // The image could be deleted between the existence check and the update;
    // then the files just written belong to nothing.
    if (!row) {
      removeFiles(dataDir, [editedRel, thumbRel])
      return reply.code(404).send({ error: 'image not found' })
    }

    // The row no longer names the previous rendition, so nothing else can: drop
    // its edited file and thumbnail. Never the original — that one is kept.
    removeFiles(dataDir, [existing.editedPath, existing.thumbPath])

    return reply.code(200).send(row)
  })

  // Public file-serving route, used by `<img src="/file/uploads/...">` tags
  // which cannot send a Cookie header. Guards against path traversal, and serves
  // only the `uploads/` tree: `dataDir` also holds the database and the stored
  // backups, which must never be reachable without a session.
  app.get('/file/*', async (req, reply) => {
    const relpath = (req.params as { '*': string })['*']
    const abs = relpath.startsWith('uploads/') ? resolveInside(dataDir, relpath) : null
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
