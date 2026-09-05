import { and, count, desc, eq, inArray, like, type SQL } from 'drizzle-orm'
import { items, itemCustomFieldValues, itemTypeFields, itemTypes, locations, itemTags, tags, images } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

// Row shape surfaced by the app layer. CamelCase object keys (the schema is
// already camelCase on the JS surface). Timestamps land as JS `Date` (the
// columns are `timestamp_ms` mode); `unit`/`locationId` are nullable.
export type ItemRow = {
  id: number
  name: string
  description: string
  quantity: number
  unit: string | null
  itemTypeId: number
  locationId: number | null
  createdBy: number
  published: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

export type CustomFieldValueRow = {
  itemId: number
  fieldId: number
  fieldName: string
  fieldType: 'text' | 'number' | 'currency' | 'date' | 'boolean' | 'url'
  value: string | null
}

export type TypeRefRow = { id: number; name: string }
export type LocationRefRow = { id: number; name: string }

export type TagRow = { itemId: number; id: number; name: string; color: string | null }
export type ImageRow = { itemId: number; id: number; originalPath: string; thumbPath: string; isPrimary: boolean | null }

// Select only the DTO columns.
const ITEM_FIELDS = {
  id: items.id,
  name: items.name,
  description: items.description,
  quantity: items.quantity,
  unit: items.unit,
  itemTypeId: items.itemTypeId,
  locationId: items.locationId,
  createdBy: items.createdBy,
  published: items.published,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
} as const

export const getItem = (db: DrizzleDb, id: number): ItemRow | undefined =>
  db.select(ITEM_FIELDS).from(items).where(eq(items.id, id)).get()

export type ListItemsOptions = {
  page?: number
  pageSize?: number
  search?: string
  locationId?: number
  itemTypeId?: number
}

// Paginated listing. `search` does a `LIKE %term%` on name; optional
// `locationId`/`itemTypeId` narrow the result. Sorted by `createdAt` desc.
// Returns the matching rows plus a total count (before pagination).
export const listItems = (db: DrizzleDb, opts: ListItemsOptions): { rows: ItemRow[]; total: number } => {
  const conds: SQL[] = []
  if (opts.search) conds.push(like(items.name, `%${opts.search}%`))
  if (opts.locationId != null) conds.push(eq(items.locationId, opts.locationId))
  if (opts.itemTypeId != null) conds.push(eq(items.itemTypeId, opts.itemTypeId))
  const where = conds.length ? and(...conds) : undefined

  const total = db.select({ c: count() }).from(items).where(where).get()?.c ?? 0
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20

  const rows = db
    .select(ITEM_FIELDS)
    .from(items)
    .where(where)
    .orderBy(desc(items.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { rows, total }
}

export type CreateFieldValueData = { fieldId: number; value: string | null }
export type CreateItemData = {
  name: string
  description: string
  quantity: number
  unit: string | null
  itemTypeId: number
  locationId: number | null
  createdBy: number
  published: boolean
  fieldValues: CreateFieldValueData[]
}

// Insert the item row AND its custom-field value rows in a single transaction.
// Returns the created item row (hydration happens in the service layer).
export const createItem = (db: DrizzleDb, data: CreateItemData): ItemRow =>
  db.transaction((tx) => {
    const created = tx
      .insert(items)
      .values({
        name: data.name,
        description: data.description,
        quantity: data.quantity,
        unit: data.unit,
        itemTypeId: data.itemTypeId,
        locationId: data.locationId,
        createdBy: data.createdBy,
        published: data.published,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning(ITEM_FIELDS)
      .get()
    for (const fv of data.fieldValues) {
      tx.insert(itemCustomFieldValues).values({ itemId: created.id, fieldId: fv.fieldId, value: fv.value }).run()
    }
    return created
  })

export type UpdateItemData = Partial<Pick<CreateItemData, 'name' | 'description' | 'quantity' | 'unit' | 'itemTypeId' | 'locationId' | 'published'>>

export const updateItem = (db: DrizzleDb, id: number, data: UpdateItemData): ItemRow | undefined =>
  db
    .update(items)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(items.id, id))
    .returning(ITEM_FIELDS)
    .get()

export const deleteItem = (db: DrizzleDb, id: number): boolean => db.delete(items).where(eq(items.id, id)).run().changes > 0

// Replace an item's whole custom-field value set: delete the existing rows,
// then insert the new ones, all in one transaction.
export const replaceFieldValues = (db: DrizzleDb, itemId: number, fieldValues: CreateFieldValueData[]): void => {
  db.transaction((tx) => {
    tx.delete(itemCustomFieldValues).where(eq(itemCustomFieldValues.itemId, itemId)).run()
    for (const fv of fieldValues) {
      tx.insert(itemCustomFieldValues).values({ itemId, fieldId: fv.fieldId, value: fv.value }).run()
    }
  })
}

// ---------------------------------------------------------------------------
// Child-table queries. Each has a batch variant (used for `list` to avoid N+1);
// the single-item variants delegate to the batch one so there is one query path.
// ---------------------------------------------------------------------------

// Custom-field values joined with their field definition rows to expose
// `fieldName`/`fieldType` for hydration.
export const listCustomFields = (db: DrizzleDb, itemIds: number[]): CustomFieldValueRow[] =>
  db
    .select({
      itemId: itemCustomFieldValues.itemId,
      fieldId: itemCustomFieldValues.fieldId,
      value: itemCustomFieldValues.value,
      fieldName: itemTypeFields.name,
      fieldType: itemTypeFields.fieldType,
    })
    .from(itemCustomFieldValues)
    .innerJoin(itemTypeFields, eq(itemCustomFieldValues.fieldId, itemTypeFields.id))
    .where(inArray(itemCustomFieldValues.itemId, itemIds))
    .all()

export const getCustomFields = (db: DrizzleDb, itemId: number): CustomFieldValueRow[] => listCustomFields(db, [itemId])

export const listTypeRefsById = (db: DrizzleDb, ids: number[]): TypeRefRow[] =>
  db.select({ id: itemTypes.id, name: itemTypes.name }).from(itemTypes).where(inArray(itemTypes.id, ids)).all()

export const getType = (db: DrizzleDb, id: number): TypeRefRow | undefined => listTypeRefsById(db, [id])[0]

export const listLocationRefsById = (db: DrizzleDb, ids: number[]): LocationRefRow[] =>
  db.select({ id: locations.id, name: locations.name }).from(locations).where(inArray(locations.id, ids)).all()

export const getLocation = (db: DrizzleDb, id: number): LocationRefRow | undefined => listLocationRefsById(db, [id])[0]

export const listTags = (db: DrizzleDb, itemIds: number[]): TagRow[] =>
  db
    .select({ itemId: itemTags.itemId, id: tags.id, name: tags.name, color: tags.color })
    .from(itemTags)
    .innerJoin(tags, eq(itemTags.tagId, tags.id))
    .where(inArray(itemTags.itemId, itemIds))
    .all()

export const getTags = (db: DrizzleDb, itemId: number): TagRow[] => listTags(db, [itemId])

export const listImages = (db: DrizzleDb, itemIds: number[]): ImageRow[] =>
  db
    .select({ itemId: images.itemId, id: images.id, originalPath: images.originalPath, thumbPath: images.thumbPath, isPrimary: images.isPrimary })
    .from(images)
    .where(inArray(images.itemId, itemIds))
    .all()

export const getImages = (db: DrizzleDb, itemId: number): ImageRow[] => listImages(db, [itemId])
