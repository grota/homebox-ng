import { desc, eq } from 'drizzle-orm'
import { images } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

// Row shape surfaced by the app layer. CamelCase object keys (the schema is
// already camelCase on the JS surface). `isPrimary` is a boolean SQLite column
// without a NOT NULL constraint, so it surfaces as `boolean | null` (the app
// layer normalizes it via `?? false` where a strict boolean is required).
export type ImageRow = {
  id: number
  itemId: number
  originalPath: string
  editedPath: string | null
  thumbPath: string
  width: number | null
  height: number | null
  format: string | null
  sizeBytes: number | null
  sortOrder: number | null
  isPrimary: boolean | null
}

// Select the full image row. Paths are stored RELATIVE to `DATA_DIR` (e.g.
// `uploads/originals/<uuid>.png`) so the public `GET /file/<relpath>` route can
// serve them without knowing where uploads live on disk.
const IMAGE_FIELDS = {
  id: images.id,
  itemId: images.itemId,
  originalPath: images.originalPath,
  editedPath: images.editedPath,
  thumbPath: images.thumbPath,
  width: images.width,
  height: images.height,
  format: images.format,
  sizeBytes: images.sizeBytes,
  sortOrder: images.sortOrder,
  isPrimary: images.isPrimary,
} as const

export type InsertImageData = {
  itemId: number
  originalPath: string
  thumbPath: string
  format: string | null
  sizeBytes: number
  width: number | null
  height: number | null
  sortOrder: number
  isPrimary: boolean
}

export const insertImage = (db: DrizzleDb, data: InsertImageData): ImageRow =>
  db.insert(images).values(data).returning(IMAGE_FIELDS).get()

export const getImage = (db: DrizzleDb, id: number): ImageRow | undefined =>
  db.select(IMAGE_FIELDS).from(images).where(eq(images.id, id)).get()

export const getImagesForItem = (db: DrizzleDb, itemId: number): ImageRow[] =>
  db.select(IMAGE_FIELDS).from(images).where(eq(images.itemId, itemId)).orderBy(desc(images.sortOrder)).all()

// Clear any primary on the item's images, then mark the target one primary, in
// a single transaction so the invariant (at most one primary per item) holds.
export const setImagePrimary = (db: DrizzleDb, itemId: number, imageId: number): void => {
  db.transaction((tx) => {
    tx.update(images).set({ isPrimary: false }).where(eq(images.itemId, itemId)).run()
    tx.update(images).set({ isPrimary: true }).where(eq(images.id, imageId)).run()
  })
}

export const deleteImage = (db: DrizzleDb, id: number): boolean =>
  db.delete(images).where(eq(images.id, id)).run().changes > 0
