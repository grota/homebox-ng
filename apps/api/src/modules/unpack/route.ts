import { randomUUID } from 'node:crypto'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { itemTypes } from '@homebox/db'
import { parseSessionCookie, type DbHolder } from '../../context.js'
import { getSessionUser } from '../../auth/sessions.js'
import * as service from './service.js'

type RegisterUnpackRouteOptions = { dbHolder: DbHolder; dataDir: string }

const itemIdFrom = (field: unknown): number => {
  const raw = Array.isArray(field) ? field[0] : field
  const value = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : undefined
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : NaN
}

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

export const registerUnpackRoute = (app: FastifyInstance, { dbHolder, dataDir }: RegisterUnpackRouteOptions): void => {
  app.post('/upload/unpack', async (req, reply) => {
    const db = dbHolder.current
    const token = parseSessionCookie(req.headers.cookie)
    const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
    if (!user) return reply.code(401).send({ error: 'UNAUTHORIZED' })
    const part = await req.file()
    if (!part) return reply.code(400).send({ error: 'expected a file part' })
    if (typeof part.mimetype !== 'string' || !part.mimetype.startsWith('image/')) return reply.code(400).send({ error: 'file must be an image' })

    const itemTypeId = resolveItemType(db, (part.fields as Record<string, unknown>).itemTypeId)
    if (itemTypeId == null) return reply.code(400).send({ error: 'no item type available; create a type first' })

    let buffer: Buffer
    try { buffer = await part.toBuffer() } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'file too large' })
      throw err
    }
    const metadata = await sharp(buffer).metadata()
    if (!metadata.width || !metadata.height) return reply.code(400).send({ error: 'not a decodable image' })

    const tmpPath = join(tmpdir(), `unpack-${randomUUID()}.jpg`)
    await writeFile(tmpPath, buffer)
    try {
      const result = await service.runUnpack({ db, dataDir, userId: user.id }, { path: tmpPath, width: metadata.width, height: metadata.height, itemTypeId })
      return reply.code(200).send(result)
    } finally {
      await rm(tmpPath, { force: true }).catch(() => {})
    }
  })
}
