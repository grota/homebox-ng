import { eq } from 'drizzle-orm'
import { itemTypes, itemTypeFields, items } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

// Row shapes surfaced by the app layer. CamelCase object keys (the schema is
// already camelCase on the JS surface). `description` is nullable; `config` is
// the JSON column (drizzle serializes/deserializes it — we never stringify).
export type ItemTypeRow = {
  id: number
  name: string
  description: string | null
}

// `required`/`sortOrder` are nullable columns in the schema (only `.notNull()`
// columns would be non-null), so the row types mirror that. The app layer
// normalizes them to `false`/`0` via `??` when mapping to DTOs.
export type ItemTypeFieldRow = {
  id: number
  itemTypeId: number
  name: string
  fieldType: 'text' | 'number' | 'currency' | 'date' | 'boolean' | 'url'
  required: boolean | null
  config: unknown
  sortOrder: number | null
}

// Select only the DTO columns (never the `createdAt` timestamp).
const TYPE_FIELDS = { id: itemTypes.id, name: itemTypes.name, description: itemTypes.description } as const
const FIELD_FIELDS = {
  id: itemTypeFields.id,
  itemTypeId: itemTypeFields.itemTypeId,
  name: itemTypeFields.name,
  fieldType: itemTypeFields.fieldType,
  required: itemTypeFields.required,
  config: itemTypeFields.config,
  sortOrder: itemTypeFields.sortOrder,
} as const

export const listTypes = (db: DrizzleDb): ItemTypeRow[] => db.select(TYPE_FIELDS).from(itemTypes).all()

export const getType = (db: DrizzleDb, id: number): ItemTypeRow | undefined =>
  db.select(TYPE_FIELDS).from(itemTypes).where(eq(itemTypes.id, id)).get()

export const listTypeFields = (db: DrizzleDb): ItemTypeFieldRow[] => db.select(FIELD_FIELDS).from(itemTypeFields).all()

export const getTypeFields = (db: DrizzleDb, typeId: number): ItemTypeFieldRow[] =>
  db.select(FIELD_FIELDS).from(itemTypeFields).where(eq(itemTypeFields.itemTypeId, typeId)).all()

export type CreateFieldData = {
  name: string
  fieldType: ItemTypeFieldRow['fieldType']
  required: boolean
  config: unknown
  sortOrder: number
}
export type CreateTypeData = { name: string; description: string | null; fields: CreateFieldData[] }

// Insert the type row AND its field definitions in a single transaction.
// Returns the created type hydrated with its `fields` rows.
export const createType = (db: DrizzleDb, data: CreateTypeData): ItemTypeRow & { fields: ItemTypeFieldRow[] } =>
  db.transaction((tx) => {
    const created = tx.insert(itemTypes).values({ name: data.name, description: data.description }).returning(TYPE_FIELDS).get()
    const fields = data.fields.map((f) =>
      tx
        .insert(itemTypeFields)
        .values({ itemTypeId: created.id, name: f.name, fieldType: f.fieldType, required: f.required, config: f.config, sortOrder: f.sortOrder })
        .returning(FIELD_FIELDS)
        .get()
    )
    return { ...created, fields }
  })

export type UpdateTypeData = Partial<Pick<CreateTypeData, 'name' | 'description'>>

export const updateType = (db: DrizzleDb, id: number, data: UpdateTypeData): ItemTypeRow =>
  db.update(itemTypes).set(data).where(eq(itemTypes.id, id)).returning(TYPE_FIELDS).get()

// Replace a type's whole field set: delete the existing defs, then insert the
// new ones, all in one transaction. Returns the freshly-inserted field rows.
export const replaceTypeFields = (db: DrizzleDb, typeId: number, fields: CreateFieldData[]): ItemTypeFieldRow[] =>
  db.transaction((tx) => {
    tx.delete(itemTypeFields).where(eq(itemTypeFields.itemTypeId, typeId)).run()
    return fields.map((f) =>
      tx
        .insert(itemTypeFields)
        .values({ itemTypeId: typeId, name: f.name, fieldType: f.fieldType, required: f.required, config: f.config, sortOrder: f.sortOrder })
        .returning(FIELD_FIELDS)
        .get()
    )
  })

export const deleteType = (db: DrizzleDb, id: number): boolean =>
  db.delete(itemTypes).where(eq(itemTypes.id, id)).run().changes > 0

// True when any `items.item_type_id` row references the type. The FK on
// `items.item_type_id` has no cascade, so deletes are guarded in code.
export const hasItemsReference = (db: DrizzleDb, typeId: number): boolean =>
  db.select({ id: items.id }).from(items).where(eq(items.itemTypeId, typeId)).all().length > 0
