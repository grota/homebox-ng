import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import { TRPCError } from '@trpc/server'
import { images, items } from '@homebox/db'
import { t, protectedProcedure } from '../../trpc.js'
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
      if (image.width == null || image.height == null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'image has no stored dimensions' })
      const sourceItem = ctx.db.select({ itemTypeId: items.itemTypeId }).from(items).where(eq(items.id, image.itemId)).get()
      if (!sourceItem) throw new TRPCError({ code: 'NOT_FOUND' })
      return service.runUnpack({ db: ctx.db, dataDir: ctx.dataDir, userId: ctx.user!.id }, {
        path: join(ctx.dataDir, image.originalPath),
        width: image.width,
        height: image.height,
        itemTypeId: sourceItem.itemTypeId,
      })
    }),
})
