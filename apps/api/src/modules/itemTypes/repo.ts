import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { itemTypes, itemTypeFields, items, itemCustomFieldValues } from '@homebox/db'
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

export const getField = (db: DrizzleDb, id: number): ItemTypeFieldRow | undefined =>
  db.select(FIELD_FIELDS).from(itemTypeFields).where(eq(itemTypeFields.id, id)).get()

export type FieldUpsert = {
  id?: number
  name: string
  fieldType: ItemTypeFieldRow['fieldType']
  required: boolean
  config: unknown
  sortOrder: number
}

// Apply an explicit field-set diff. An upsert WITH an `id` updates that row in
// place, so the id is unchanged and the `item_custom_field_values.field_id`
// cascade never fires — that is the whole fix. An upsert WITHOUT an id inserts.
// Only `deletedIds` deletes: omission never means deletion, because an inline
// "save this row" sends a single upsert and must not be able to mean "delete the
// rest".
//
// Does NOT open its own transaction — it is always called from within
// `service.updateFields`'s transaction, so the value clearing and the field ops
// commit together (same convention as `items/repo.ts`'s `replaceFieldValues`).
export const applyFieldOps = (db: DrizzleDb, typeId: number, upserts: FieldUpsert[], deletedIds: number[]): ItemTypeFieldRow[] => {
  for (const id of deletedIds) db.delete(itemTypeFields).where(eq(itemTypeFields.id, id)).run()
  for (const field of upserts) {
    if (field.id !== undefined) {
      db.update(itemTypeFields)
        .set({ name: field.name, fieldType: field.fieldType, required: field.required, config: field.config, sortOrder: field.sortOrder })
        .where(eq(itemTypeFields.id, field.id))
        .run()
    } else {
      db.insert(itemTypeFields)
        .values({ itemTypeId: typeId, name: field.name, fieldType: field.fieldType, required: field.required, config: field.config, sortOrder: field.sortOrder })
        .run()
    }
  }
  return db.select(FIELD_FIELDS).from(itemTypeFields).where(eq(itemTypeFields.itemTypeId, typeId)).all()
}

export type FieldValueRow = { itemId: number; name: string; value: string; published: boolean }

// Every NON-EMPTY value of one field, with the owning item's name. The emptiness
// predicate is `IS NOT NULL AND <> ''` and it is not negotiable: a blank field
// still has a row, so counting rows over-reports (see the design spec). SQL's
// three-valued logic already drops NULLs from `<> ''`, but both conditions are
// spelled out so the intent survives a reader who does not remember that.
export const listNonEmptyValues = (db: DrizzleDb, fieldId: number): FieldValueRow[] =>
  db
    .select({ itemId: itemCustomFieldValues.itemId, name: items.name, value: itemCustomFieldValues.value, published: items.published })
    .from(itemCustomFieldValues)
    .innerJoin(items, eq(items.id, itemCustomFieldValues.itemId))
    .where(and(eq(itemCustomFieldValues.fieldId, fieldId), isNotNull(itemCustomFieldValues.value), ne(itemCustomFieldValues.value, '')))
    .all() as FieldValueRow[]

// Drop one item's value for one field. Deleting the row (rather than storing
// '') keeps "no value" unambiguous: the item form reads a missing row as ''.
export const clearValue = (db: DrizzleDb, itemId: number, fieldId: number): void => {
  db.delete(itemCustomFieldValues).where(and(eq(itemCustomFieldValues.itemId, itemId), eq(itemCustomFieldValues.fieldId, fieldId))).run()
}

// Published items of the type — the population that can actually be edited, and
// so the only one that matters for a "items missing a value" count. Drafts are
// created value-less by the unpack flow (repo.createItem with fieldValues: [])
// and are only renamable, so including them would be noise.
export const countPublishedItemsOfType = (db: DrizzleDb, typeId: number): number =>
  db.select({ n: sql<number>`count(*)` }).from(items).where(and(eq(items.itemTypeId, typeId), eq(items.published, true))).get()?.n ?? 0

export const deleteType = (db: DrizzleDb, id: number): boolean =>
  db.delete(itemTypes).where(eq(itemTypes.id, id)).run().changes > 0

// True when any `items.item_type_id` row references the type. The FK on
// `items.item_type_id` has no cascade, so deletes are guarded in code.
export const hasItemsReference = (db: DrizzleDb, typeId: number): boolean =>
  db.select({ id: items.id }).from(items).where(eq(items.itemTypeId, typeId)).all().length > 0
