import { randomUUID } from 'node:crypto'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { itemTypes } from '@homebox/db'
import { itemIdFrom } from '../../uploads.js'
import { parseSessionCookie, type DbHolder } from '../../context.js'
import { getSessionUser } from '../../auth/sessions.js'
import { UnpackError } from './errors.js'
import { resolveDetectionProvider } from '../detection/resolve.js'
import { manualProvider, RegionsInputSchema, type ManualRegion } from './manual.js'
import * as service from './service.js'
import type { DetectionProviderImpl } from '../detection/provider.js'

type RegisterUnpackRouteOptions = { dbHolder: DbHolder; dataDir: string }

// Resolve the type for a root unpack: the provided field when valid, else the
// lowest-id existing type, else null (→ 400 "no item type available").
const resolveItemType = (db: DbHolder['current'], raw: unknown): number | null => {
  const provided = itemIdFrom(raw)
  if (!Number.isNaN(provided)) {
    const t = db.select({ id: itemTypes.id }).from(itemTypes).where(eq(itemTypes.id, provided)).get()
    if (t) return t.id
  }
  const first = db.select({ id: itemTypes.id }).from(itemTypes).orderBy(itemTypes.id).limit(1).get()
  return first?.id ?? null
}

// Send an error and yield null, so a validation failure is one line.
const fail = (reply: FastifyReply, code: number, error: string): null => {
  reply.code(code).send({ error })
  return null
}

// The prologue both unpack routes share: authenticate, read the single image
// part, check its mimetype, buffer it, and hand back the other form fields —
// they ride on the same multipart part, so the caller cannot read them after
// this has consumed it. Returns null having already sent the error reply, so a
// caller does `if (!part) return reply`.
const readImagePart = async (
  req: FastifyRequest,
  reply: FastifyReply,
  db: DbHolder['current'],
): Promise<{ userId: number; buffer: Buffer; fields: Record<string, unknown> } | null> => {
  const token = parseSessionCookie(req.headers.cookie)
  const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
  if (!user) return fail(reply, 401, 'UNAUTHORIZED')

  const part = await req.file()
  if (!part) return fail(reply, 400, 'expected a file part')
  if (typeof part.mimetype !== 'string' || !part.mimetype.startsWith('image/')) return fail(reply, 400, 'file must be an image')

  try {
    return { userId: user.id, buffer: await part.toBuffer(), fields: part.fields as Record<string, unknown> }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return fail(reply, 413, 'file too large')
    throw err
  }
}

// Both routes do the same dance around the pipeline: write the buffer where
// `createItemsFromImage` can read it, run, map a decode failure to a 400, and
// remove the temp file whatever happened.
const runOnTempFile = async (
  reply: FastifyReply,
  opts: { db: DbHolder['current']; dataDir: string; userId: number; itemTypeId: number; provider: DetectionProviderImpl; buffer: Buffer },
): Promise<FastifyReply> => {
  const tmpPath = join(tmpdir(), `unpack-${randomUUID()}.jpg`)
  await writeFile(tmpPath, opts.buffer)
  try {
    const result = await service.createItemsFromImage(
      { db: opts.db, dataDir: opts.dataDir, userId: opts.userId, provider: opts.provider },
      { path: tmpPath, itemTypeId: opts.itemTypeId },
    )
    return reply.code(200).send(result)
  } catch (err) {
    if (err instanceof UnpackError) return reply.code(400).send({ error: 'not a decodable image' })
    throw err
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {})
  }
}

export const registerUnpackRoute = (app: FastifyInstance, { dbHolder, dataDir }: RegisterUnpackRouteOptions): void => {
  // Root **auto** unpack: the boxes come from the configured detection provider.
  app.post('/upload/unpack', async (req, reply) => {
    const db = dbHolder.current
    const part = await readImagePart(req, reply, db)
    if (!part) return reply

    const itemTypeId = resolveItemType(db, part.fields.itemTypeId)
    if (itemTypeId == null) return reply.code(400).send({ error: 'no item type available; create a type first' })

    return runOnTempFile(reply, { db, dataDir, userId: part.userId, itemTypeId, provider: resolveDetectionProvider(db), buffer: part.buffer })
  })

  // Root **manual** unpack: the boxes arrive with the photo, drawn by the user.
  // One request, so abandoning the modal leaves no orphaned upload behind.
  app.post('/upload/unpack/manual', async (req, reply) => {
    const db = dbHolder.current
    const part = await readImagePart(req, reply, db)
    if (!part) return reply

    const itemTypeId = resolveItemType(db, part.fields.itemTypeId)
    if (itemTypeId == null) return reply.code(400).send({ error: 'no item type available; create a type first' })

    // The regions come as one JSON field, because a multipart form cannot carry a
    // nested array any other way. Parsed before anything is written to disk.
    const raw = part.fields.regions
    const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : undefined
    let regions: ManualRegion[]
    try {
      const parsed = RegionsInputSchema.safeParse(JSON.parse(typeof text === 'string' ? text : ''))
      if (!parsed.success) return reply.code(400).send({ error: 'invalid regions' })
      regions = parsed.data
    } catch {
      return reply.code(400).send({ error: 'invalid regions' })
    }

    return runOnTempFile(reply, { db, dataDir, userId: part.userId, itemTypeId, provider: manualProvider(regions), buffer: part.buffer })
  })
}
