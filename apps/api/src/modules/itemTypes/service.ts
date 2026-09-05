import { TRPCError } from '@trpc/server'
import type { DrizzleDb } from '@homebox/db'
import type { ItemTypeInput } from '@homebox/shared'
import { reindexItemType } from '../items/fts.js'
import type { ItemTypeFieldInput } from './router.js'
import * as repo from './repo.js'
import type { ItemTypeFieldRow, ItemTypeRow } from './repo.js'

export type ItemTypeFieldDto = {
  id: number
  itemTypeId: number
  name: string
  fieldType: ItemTypeFieldRow['fieldType']
  required: boolean
  config: unknown
  sortOrder: number
}

export type ItemTypeDto = {
  id: number
  name: string
  description: string | null
  fields: ItemTypeFieldDto[]
}

const toFieldDto = (row: ItemTypeFieldRow): ItemTypeFieldDto => ({
  id: row.id,
  itemTypeId: row.itemTypeId,
  name: row.name,
  fieldType: row.fieldType,
  required: row.required ?? false,
  config: row.config,
  sortOrder: row.sortOrder ?? 0,
})

const toDto = (row: ItemTypeRow, fields: ItemTypeFieldRow[]): ItemTypeDto => ({
  id: row.id,
  name: row.name,
  description: row.description,
  fields: fields.map(toFieldDto),
})

// Group all field rows by their type id so each type can be hydrated in one pass.
const groupFields = (rows: ItemTypeFieldRow[]): Map<number, ItemTypeFieldRow[]> => {
  const byType = new Map<number, ItemTypeFieldRow[]>()
  for (const row of rows) {
    const arr = byType.get(row.itemTypeId) ?? []
    arr.push(row)
    byType.set(row.itemTypeId, arr)
  }
  return byType
}

export const listItemTypes = (db: DrizzleDb): ItemTypeDto[] => {
  const types = repo.listTypes(db)
  const byType = groupFields(repo.listTypeFields(db))
  return types.map((row) => toDto(row, byType.get(row.id) ?? []))
}

export const createItemType = (db: DrizzleDb, input: ItemTypeInput & { fields: ItemTypeFieldInput[] }): ItemTypeDto => {
  const created = repo.createType(db, {
    name: input.name,
    description: input.description,
    fields: input.fields.map((f) => ({
      name: f.name,
      fieldType: f.fieldType,
      required: f.required ?? false,
      config: f.config ?? null,
      sortOrder: f.sortOrder ?? 0,
    })),
  })
  return toDto(created, created.fields)
}

export const updateItemType = (db: DrizzleDb, input: { id: number; name?: string; description?: string | null; fields?: ItemTypeFieldInput[] }): ItemTypeDto => {
  const existing = repo.getType(db, input.id)
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })

  const data: repo.UpdateTypeData = {}
  if (input.name !== undefined) data.name = input.name
  if (input.description !== undefined) data.description = input.description

  const row = Object.keys(data).length > 0 ? repo.updateType(db, input.id, data) : existing

  // A type rename changes `type_name` for every item that references it, so
  // re-index those items after the write. The searchable blob only carries the
  // name (not the description), so reindex only when the name changed.
  if (input.name !== undefined) reindexItemType(db, input.id)

  const fields =
    input.fields !== undefined
      ? repo.replaceTypeFields(
          db,
          input.id,
          input.fields.map((f) => ({
            name: f.name,
            fieldType: f.fieldType,
            required: f.required ?? false,
            config: f.config ?? null,
            sortOrder: f.sortOrder ?? 0,
          }))
        )
      : repo.getTypeFields(db, input.id)

  return toDto(row, fields)
}

export const deleteItemType = (db: DrizzleDb, id: number): { ok: true } => {
  if (!repo.getType(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  if (repo.hasItemsReference(db, id)) throw new TRPCError({ code: 'CONFLICT' })
  if (!repo.deleteType(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  return { ok: true }
}
