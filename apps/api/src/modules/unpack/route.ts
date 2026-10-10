import type { FastifyInstance, FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import { itemTypes } from '@homebox/db'
import { fieldText, itemIdFrom, readImageUpload } from '../../uploads.js'
import type { DbHolder } from '../../context.js'
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

// Both routes run the same pipeline on the uploaded bytes and map a decode
// failure to a 400.
const runUnpack = async (
  reply: FastifyReply,
  opts: { db: DbHolder['current']; dataDir: string; userId: number; itemTypeId: number; provider: DetectionProviderImpl; image: Buffer },
): Promise<FastifyReply> => {
  try {
    const result = await service.createItemsFromImage(
      { db: opts.db, dataDir: opts.dataDir, userId: opts.userId, provider: opts.provider },
      { image: opts.image, itemTypeId: opts.itemTypeId },
    )
    return reply.code(200).send(result)
  } catch (err) {
    if (err instanceof UnpackError) return reply.code(400).send({ error: 'not a decodable image' })
    throw err
  }
}

export const registerUnpackRoute = (app: FastifyInstance, { dbHolder, dataDir }: RegisterUnpackRouteOptions): void => {
  // Root **auto** unpack: the boxes come from the configured detection provider.
  app.post('/upload/unpack', async (req, reply) => {
    const db = dbHolder.current
    const part = await readImageUpload(req, reply, db)
    if (!part) return reply

    const itemTypeId = resolveItemType(db, part.fields.itemTypeId)
    if (itemTypeId == null) return reply.code(400).send({ error: 'no item type available; create a type first' })

    return runUnpack(reply, { db, dataDir, userId: part.userId, itemTypeId, provider: resolveDetectionProvider(db), image: part.buffer })
  })

  // Root **manual** unpack: the boxes arrive with the photo, drawn by the user.
  // One request, so abandoning the modal leaves no orphaned upload behind.
  app.post('/upload/unpack/manual', async (req, reply) => {
    const db = dbHolder.current
    const part = await readImageUpload(req, reply, db)
    if (!part) return reply

    const itemTypeId = resolveItemType(db, part.fields.itemTypeId)
    if (itemTypeId == null) return reply.code(400).send({ error: 'no item type available; create a type first' })

    // The regions come as one JSON field, because a multipart form cannot carry a
    // nested array any other way. Parsed before anything is written to disk.
    const text = fieldText(part.fields.regions)
    let regions: ManualRegion[]
    try {
      const parsed = RegionsInputSchema.safeParse(JSON.parse(typeof text === 'string' ? text : ''))
      if (!parsed.success) return reply.code(400).send({ error: 'invalid regions' })
      regions = parsed.data
    } catch {
      return reply.code(400).send({ error: 'invalid regions' })
    }

    return runUnpack(reply, { db, dataDir, userId: part.userId, itemTypeId, provider: manualProvider(regions), image: part.buffer })
  })
}
