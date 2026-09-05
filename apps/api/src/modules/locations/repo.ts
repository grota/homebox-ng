import { eq } from 'drizzle-orm'
import { locations } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

// Row shape surfaced by the app layer. CamelCase object keys (the schema is
// already camelCase on the JS surface). `description` is nullable in the DB.
export type LocationRow = {
  id: number
  parentId: number | null
  name: string
  description: string | null
}

// Select only the DTO columns (never timestamps).
const ROW_FIELDS = { id: locations.id, parentId: locations.parentId, name: locations.name, description: locations.description } as const

export const listLocations = (db: DrizzleDb): LocationRow[] => db.select(ROW_FIELDS).from(locations).all()

export const getLocation = (db: DrizzleDb, id: number): LocationRow | undefined =>
  db.select(ROW_FIELDS).from(locations).where(eq(locations.id, id)).get()

export const getParent = (db: DrizzleDb, parentId: number): LocationRow | undefined => getLocation(db, parentId)

export type CreateLocationData = { name: string; parentId: number | null; description: string | null }

export const createLocation = (db: DrizzleDb, data: CreateLocationData): LocationRow =>
  db.insert(locations).values(data).returning(ROW_FIELDS).get()

export type UpdateLocationData = Partial<Pick<CreateLocationData, 'name' | 'parentId' | 'description'>>

export const updateLocation = (db: DrizzleDb, id: number, data: UpdateLocationData): LocationRow =>
  db.update(locations).set(data).where(eq(locations.id, id)).returning(ROW_FIELDS).get()

export const deleteLocation = (db: DrizzleDb, id: number): boolean =>
  db.delete(locations).where(eq(locations.id, id)).run().changes > 0

// Number of rows whose `parentId` points at `parentId` (i.e. direct children).
export const countChildren = (db: DrizzleDb, parentId: number): number =>
  db.select({ id: locations.id }).from(locations).where(eq(locations.parentId, parentId)).all().length
