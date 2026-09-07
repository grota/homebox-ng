import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import { TRPCError } from '@trpc/server'
import { images, items } from '@homebox/db'
import { t, protectedProcedure } from '../../trpc.js'
import { UnpackError } from './errors.js'
import { resolveDetectionProvider } from '../detection/resolve.js'
import * as service from './service.js'

// `kind: 'item'` unpacks an already-attached image. The root (`kind: 'root'`)
// multipart upload goes through the raw `/upload/unpack` route (tRPC can't take
// multipart); this procedure covers the item-photo surface only.
export const unpackRouter = t.router({
  run: protectedProcedure
    .input(z.object({ kind: z.literal('item'), imageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const image = ctx.db.select().from(images).where(eq(images.id, input.imageId)).get()
      if (!image) throw new TRPCError({ code: 'NOT_FOUND' })
      const sourceItem = ctx.db.select({ itemTypeId: items.itemTypeId }).from(items).where(eq(items.id, image.itemId)).get()
      if (!sourceItem) throw new TRPCError({ code: 'NOT_FOUND' })
      try {
        const provider = resolveDetectionProvider(ctx.db)
        return await service.createItemsFromImage({ db: ctx.db, dataDir: ctx.dataDir, userId: ctx.user!.id, provider }, {
          path: join(ctx.dataDir, image.originalPath),
          itemTypeId: sourceItem.itemTypeId,
        })
      } catch (err) {
        if (err instanceof UnpackError) throw new TRPCError({ code: 'BAD_REQUEST', message: 'not a decodable image' })
        throw err
      }
    }),
})
