import { useEffect, useState } from 'react'
import { FIELD_TYPES } from '@homebox/shared'
import type { FieldType } from '@homebox/shared'
import { trpc } from '../../api/trpc'
import { Button, Field, Input, Select } from '../../ui'

export type TypeField = { id: number; name: string; fieldType: FieldType; required: boolean; sortOrder: number }

// A locally-edited copy of one row, so a rename is only sent when Save is hit.
type DraftRow = { key: number; id: number; name: string; fieldType: FieldType; required: boolean; sortOrder: number }

// The field-set editor. Every row saves on its own, and each save sends exactly
// one upsert plus no deletions — which is only safe because the API's diff never
// infers a deletion from an omission (see ADR-0003).
export function TypeFields({ typeId, fields, canEdit }: { typeId: number; fields: TypeField[]; canEdit: boolean }) {
  const utils = trpc.useUtils()
  const updateFields = trpc.itemTypes.updateFields.useMutation()

  const [rows, setRows] = useState<DraftRow[]>(() => fields.map((f, index) => ({ key: index, ...f })))
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<FieldType>('text')
  const [error, setError] = useState<string | null>(null)

  // The server owns the rows: it assigns an added field its id, and a deletion
  // takes one away. Both come back through the `fields` prop on the refetch, so
  // local state has to converge on the prop — drop rows it no longer lists,
  // append ones it lists that this editor has not seen, and leave the values of
  // the rows in between alone, because every write refetches and a full sync
  // would wipe a name the admin is still typing. Returning `current` itself when
  // nothing changed keeps this from looping. Appended keys are the negated id, so
  // they cannot collide with the index keys seeded on the first render.
  useEffect(() => {
    setRows((current) => {
      const ids = new Set(fields.map((f) => f.id))
      const kept = current.filter((row) => ids.has(row.id))
      const seen = new Set(kept.map((row) => row.id))
      const added = fields.filter((f) => !seen.has(f.id))
      return added.length === 0 && kept.length === current.length ? current : [...kept, ...added.map((f) => ({ key: -f.id, ...f }))]
    })
  }, [fields])

  const run = async (input: Parameters<typeof updateFields.mutateAsync>[0]) => {
    setError(null)
    try {
      await updateFields.mutateAsync(input)
      await utils.itemTypes.list.invalidate()
      await utils.items.list.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the field')
    }
  }

  const patch = (key: number, next: Partial<DraftRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)))

  const isDirty = (row: DraftRow) => {
    const saved = fields.find((f) => f.id === row.id)
    return !saved || saved.name !== row.name || saved.fieldType !== row.fieldType || saved.required !== row.required
  }

  const save = (row: DraftRow) =>
    run({ id: typeId, upserts: [{ id: row.id, name: row.name, fieldType: row.fieldType, required: row.required, sortOrder: row.sortOrder }], deletedIds: [] })

  const add = () =>
    run({ id: typeId, upserts: [{ name: newName, fieldType: newType }], deletedIds: [] }).then(() => {
      setNewName('')
      setNewType('text')
    })

  // The count is read first so the confirmation can name what it destroys, and
  // the read is guarded on its own: a failed query must say so rather than reject
  // out of the click handler and leave the admin with no feedback at all.
  const remove = async (row: DraftRow) => {
    let usage: { total: number }
    try {
      usage = await utils.client.itemTypes.fieldValueUsage.query({ typeId, fieldId: row.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not count the values this field holds')
      return
    }
    const warning = usage.total === 0 ? `Delete the field “${row.name}”?` : `Delete the field “${row.name}”? This also destroys ${usage.total} stored value${usage.total === 1 ? '' : 's'}.`
    if (!window.confirm(warning)) return
    await run({ id: typeId, upserts: [], deletedIds: [row.id], acknowledgeValueLoss: true })
  }

  return (
    <div className="border border-border rounded-lg p-3 flex flex-col gap-2">
      <span className="text-text-muted">Custom fields</span>

      {rows.map((row) => (
        <div className="flex gap-3 items-end" key={row.key}>
          <Field label="Name" htmlFor={`field-name-${row.key}`} className="flex-1 min-w-0">
            <Input id={`field-name-${row.key}`} value={row.name} disabled={!canEdit} onChange={(e) => patch(row.key, { name: e.target.value })} className="w-full" />
          </Field>
          <Field label="Type" htmlFor={`field-type-${row.key}`}>
            <Select id={`field-type-${row.key}`} value={row.fieldType} disabled={!canEdit} onChange={(e) => patch(row.key, { fieldType: e.target.value as FieldType })}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          {canEdit && (
            <>
              {/* The toggle is a write control, so a non-admin is not shown it at
                  all — the type list below the form still marks required fields
                  with an asterisk. */}
              <label className="flex items-center gap-1">
                <input type="checkbox" aria-label={`${row.name} required`} checked={row.required} onChange={(e) => patch(row.key, { required: e.target.checked })} />
                required
              </label>
              <Button size="sm" variant="primary" disabled={!isDirty(row) || updateFields.isPending} onClick={() => save(row)}>
                Save
              </Button>
              <Button size="sm" variant="danger" disabled={updateFields.isPending} onClick={() => remove(row)}>
                Delete
              </Button>
            </>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="flex gap-3 items-end">
          <Field label="New field name" htmlFor="new-field-name" className="flex-1 min-w-0">
            <Input id="new-field-name" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full" />
          </Field>
          <Field label="New field type" htmlFor="new-field-type">
            <Select id="new-field-type" value={newType} onChange={(e) => setNewType(e.target.value as FieldType)}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Button disabled={newName.trim() === '' || updateFields.isPending} onClick={add}>
            Add field
          </Button>
        </div>
      )}

      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  )
}
