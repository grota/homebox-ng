import { TRPCError } from '@trpc/server'
import type { DrizzleDb } from '@homebox/db'
import type { ItemTypeInput } from '@homebox/shared'
import { fitsFieldType } from '@homebox/shared'
import type { FieldType } from '@homebox/shared'
import { reindexItem, reindexItemType } from '../items/fts.js'
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

export const updateItemType = (db: DrizzleDb, input: { id: number; name?: string; description?: string | null }): ItemTypeDto => {
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

  return toDto(row, repo.getTypeFields(db, input.id))
}

export type FieldUpsertInput = {
  id?: number
  name: string
  fieldType: FieldType
  required?: boolean
  config?: Record<string, unknown>
  sortOrder?: number
}

export type UpdateFieldsInput = {
  id: number
  upserts: FieldUpsertInput[]
  deletedIds: number[]
  clearIncompatible?: boolean
  acknowledgeValueLoss?: boolean
  acknowledgedValueCount?: number
}

export type FieldValueUsage = {
  total: number
  missing: number
  items: { itemId: number; name: string; value: string }[]
}

// `missing` is derived from the same value read as `total`: a published item of
// the type that has no non-empty value for this field. Computed from the
// UNFILTERED set, so asking "which values do not fit `url`" still reports how
// many items are simply blank.
export const fieldValueUsage = (
  db: DrizzleDb,
  input: { typeId: number; fieldId: number; fieldType?: FieldType }
): FieldValueUsage => {
  const field = repo.getField(db, input.fieldId)
  if (!field || field.itemTypeId !== input.typeId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That field does not belong to this item type.' })

  const rows = repo.listNonEmptyValues(db, input.fieldId)
  const ids = new Set(rows.filter((r) => r.published).map((r) => r.itemId))
  return {
    // `fieldType` narrows to the values a retype would strand; without it this
    // is every non-empty value, which is what a field deletion destroys.
    items: rows
      .filter((r) => input.fieldType === undefined || !fitsFieldType(input.fieldType, r.value))
      .map(({ itemId, name, value }) => ({ itemId, name, value })),
    total: rows.filter((r) => input.fieldType === undefined || !fitsFieldType(input.fieldType, r.value)).length,
    missing: Math.max(0, repo.countPublishedItemsOfType(db, input.typeId) - ids.size),
  }
}

// Rewrite the type's field set. Non-destructive except where explicitly
// acknowledged; see the design spec §5-§7.
export const updateFields = (db: DrizzleDb, input: UpdateFieldsInput): ItemTypeDto => {
  const type = repo.getType(db, input.id)
  if (!type) throw new TRPCError({ code: 'NOT_FOUND' })

  const existing = repo.getTypeFields(db, input.id)
  const byId = new Map(existing.map((f) => [f.id, f]))
  for (const field of input.upserts) {
    if (field.id !== undefined && !byId.has(field.id)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That field does not belong to this item type.' })
  }
  for (const id of input.deletedIds) {
    if (!byId.has(id)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That field does not belong to this item type.' })
  }
  // Updating a field in place AND deleting it in the same request is refused
  // rather than resolved: the delete removes the row the update claims to keep,
  // so the update would silently hit zero rows. Nothing in this diff is
  // inferred, so an ambiguous intent is an error, not a precedence rule.
  const deleted = new Set(input.deletedIds)
  if (input.upserts.some((f) => f.id !== undefined && deleted.has(f.id))) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'A field cannot be updated and deleted in the same request.' })
  }

  // Every value this write is about to destroy, collected BEFORE it is gone.
  const doomed = new Set<number>()

  // The casualties of every retype in the request, computed as a whole before
  // any of them is judged — a per-field loop would throw on the first casualty
  // and never see that a second field is dirty too.
  const casualties = input.upserts.flatMap((next) => {
    if (next.id === undefined) return []
    const current = byId.get(next.id)!
    if (current.fieldType === next.fieldType) return []
    const offenders = repo.listNonEmptyValues(db, next.id).filter((v) => !fitsFieldType(next.fieldType, v.value))
    return offenders.length === 0 ? [] : [{ current, next, offenders }]
  })

  // At most one field may need a clear. The count pin is a single number because
  // the modal shows one field's values; a request-level total would let a client
  // attest to the values it was shown while silently clearing another field's
  // unseen ones. Retyping several fields at once stays fine while at most one of
  // them strands anything.
  if (casualties.length > 1) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only one field can be converted at a time.' })
  }

  for (const { current, next, offenders } of casualties) {
    if (!input.clearIncompatible) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `${offenders.length} value${offenders.length === 1 ? '' : 's'} held by “${current.name}” cannot be read as ${next.fieldType}. Fix or clear them first.`,
      })
    }
    // The count pin: the modal's list is a snapshot, so a value added since must
    // not be destroyed unseen. Refuse rather than write.
    if (input.acknowledgedValueCount !== offenders.length) {
      throw new TRPCError({ code: 'CONFLICT', message: 'The values changed since you last looked. Re-check and try again.' })
    }
    for (const value of offenders) doomed.add(value.itemId)
  }

  if (input.deletedIds.length > 0 && !input.acknowledgeValueLoss) {
    const values = input.deletedIds.flatMap((id) => repo.listNonEmptyValues(db, id))
    if (values.length > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Deleting ${input.deletedIds.length === 1 ? 'this field' : 'these fields'} destroys ${values.length} stored value${values.length === 1 ? '' : 's'}.`,
      })
    }
  }
  // A cascade is about to remove these rows, so their item ids must be read now.
  for (const id of input.deletedIds) for (const value of repo.listNonEmptyValues(db, id)) doomed.add(value.itemId)

  // An omitted attribute PRESERVES the stored one rather than clearing it —
  // omission is not a delete anywhere in this diff, and a caller that only wants
  // to rename a field must not silently drop its `required` or `config`.
  let nextSortOrder = existing.reduce((max, f) => Math.max(max, f.sortOrder ?? 0), 0)
  const upserts: repo.FieldUpsert[] = input.upserts.map((field) => {
    const current = field.id === undefined ? undefined : byId.get(field.id)!
    return {
      id: field.id,
      name: field.name,
      fieldType: field.fieldType,
      required: field.required ?? current?.required ?? false,
      // `config` is undefined for a field that never had one, which the column
      // stores as NULL.
      config: field.config ?? current?.config ?? null,
      sortOrder: field.sortOrder ?? current?.sortOrder ?? (nextSortOrder += 1),
    }
  })

  const rows = db.transaction((tx) => {
    const t = tx as unknown as DrizzleDb
    // Clearing and retyping commit together: a failure between them would leave
    // the values destroyed AND the type unchanged, which is the worst outcome.
    for (const field of input.upserts) {
      if (field.id === undefined || !input.clearIncompatible) continue
      const current = byId.get(field.id)!
      if (current.fieldType === field.fieldType) continue
      for (const value of repo.listNonEmptyValues(t, field.id)) {
        if (!fitsFieldType(field.fieldType, value.value)) repo.clearValue(t, value.itemId, field.id)
      }
    }
    const next = repo.applyFieldOps(t, input.id, upserts, input.deletedIds)
    // The FTS blob carries the item's field VALUES, not the field's name, so it
    // only changes for items that just lost a value.
    for (const itemId of doomed) reindexItem(t, itemId)
    return next
  })

  return toDto(type, rows)
}

export const deleteItemType = (db: DrizzleDb, id: number): { ok: true } => {
  if (!repo.getType(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  if (repo.hasItemsReference(db, id)) throw new TRPCError({ code: 'CONFLICT' })
  if (!repo.deleteType(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  return { ok: true }
}
