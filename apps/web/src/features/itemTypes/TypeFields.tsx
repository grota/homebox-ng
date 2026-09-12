import { useEffect, useState } from 'react'
import { FIELD_TYPES } from '@homebox/shared'
import type { FieldType } from '@homebox/shared'
import { trpc } from '../../api/trpc'
import { Button, Field, Input, Select } from '../../ui'
import { IncompatibleValuesDialog, type Offender } from './IncompatibleValuesDialog'

export type TypeField = { id: number; name: string; fieldType: FieldType; required: boolean; sortOrder: number }

// A locally-edited copy of one row, so a rename is only sent when Save is hit.
type DraftRow = { key: number; id: number; name: string; fieldType: FieldType; required: boolean; sortOrder: number }

// What `fieldValueUsage` answers with: `total` is the count a warning or a
// destructive button commits to, `items` the rows it shows. Without `fieldType`
// it counts every value a deletion destroys; with one, only the values that do
// not fit it — which is what a retype strands.
type FieldValueUsage = { total: number; missing: number; items: Offender[] }

// The field-set editor. Every row saves on its own, and each save sends exactly
// one upsert plus no deletions — which is only safe because the API's diff never
// infers a deletion from an omission (see ADR-0003).
export function TypeFields({ typeId, fields, canEdit }: { typeId: number; fields: TypeField[]; canEdit: boolean }) {
  const utils = trpc.useUtils()
  const updateFields = trpc.itemTypes.updateFields.useMutation()

  const [rows, setRows] = useState<DraftRow[]>(() => fields.map((f, index) => ({ key: index, ...f })))
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<FieldType>('text')
  const [newRequired, setNewRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The retype whose values do not fit, held until the admin settles it, and the
  // count shown on the row that is waiting for them.
  const [pending, setPending] = useState<{ row: DraftRow; usage: FieldValueUsage } | null>(null)
  const [usageFor, setUsageFor] = useState<{ key: number; total: number } | null>(null)
  // The other inline warning: turning `required` ON strands the type's published
  // items that have no value yet, so the row says how many (§9).
  const [missingFor, setMissingFor] = useState<{ key: number; count: number } | null>(null)
  // The re-check's own failure, which belongs to the dialog rather than the form.
  const [recheckError, setRecheckError] = useState<string | null>(null)

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

  // Reports whether the write landed. The failure is swallowed into `error`
  // rather than rethrown, so without this every caller's continuation runs
  // whether the save succeeded or not — which is how a failed Add used to wipe
  // the name the admin had just typed.
  const run = async (input: Parameters<typeof updateFields.mutateAsync>[0]) => {
    setError(null)
    try {
      await updateFields.mutateAsync(input)
      await utils.itemTypes.list.invalidate()
      await utils.items.list.invalidate()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the field')
      return false
    }
  }

  const patch = (key: number, next: Partial<DraftRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)))

  const isDirty = (row: DraftRow) => {
    const saved = fields.find((f) => f.id === row.id)
    return !saved || saved.name !== row.name || saved.fieldType !== row.fieldType || saved.required !== row.required
  }

  // Every read of the usage goes through here, and every call site gets a guarded
  // read: they run outside `run`'s try/catch, which covers only the mutation, so an
  // unguarded rejection would escape the click handler as a silent no-op — the
  // admin clicks, nothing happens, and no message ever appears.
  const readUsage = async (input: { fieldId: number; fieldType?: FieldType }) => {
    try {
      return await utils.client.itemTypes.fieldValueUsage.query({ typeId, ...input })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not count the values this field holds')
      return null
    }
  }

  // Changing a row's type asks what it would strand, so the warning is on the row
  // BEFORE Save rather than arriving as a refusal after it.
  const previewRetype = async (row: DraftRow, fieldType: FieldType) => {
    patch(row.key, { fieldType })
    const usage = await readUsage({ fieldId: row.id, fieldType })
    // A failed read claims nothing: a warning left over from the type picked
    // before would be a claim about a value nobody re-checked.
    setUsageFor(usage && usage.total > 0 ? { key: row.key, total: usage.total } : null)
  }

  // The one shape a row's save takes — the retype paths below add their flags to it.
  const upsertRow = (row: DraftRow) => ({
    id: typeId,
    upserts: [{ id: row.id, name: row.name, fieldType: row.fieldType, required: row.required, sortOrder: row.sortOrder }],
    deletedIds: [],
  })

  // A retype is the one edit the API gates while the field still holds values it
  // would strand, so the check happens here and the refusal becomes the dialog. A
  // retype that strands nothing is an ordinary save: no dialog, and no clear flag.
  const save = async (row: DraftRow) => {
    const saved = fields.find((f) => f.id === row.id)
    if (saved && saved.fieldType !== row.fieldType) {
      const usage = await readUsage({ fieldId: row.id, fieldType: row.fieldType })
      if (!usage) return
      if (usage.total > 0) {
        // The dialog is handed the offenders, and hands back the count it showed —
        // which is the number the server re-validates before clearing anything.
        setRecheckError(null)
        setPending({ row, usage })
        return
      }
    }
    await run(upsertRow(row))
  }

  // The dialog's list is a snapshot, and the whole point of its links is that the
  // admin LEAVES to fix the items in another tab — so it is re-read when they come
  // back, and the count the destructive button commits to follows. Re-subscribing
  // on each `pending` change is cheaper than a ref would be to keep `readUsage`
  // (which only closes over the constant `typeId`) out of the dependencies.
  useEffect(() => {
    if (!pending) return
    const recheck = async () => {
      try {
        const usage = await utils.client.itemTypes.fieldValueUsage.query({ typeId, fieldId: pending.row.id, fieldType: pending.row.fieldType })
        setRecheckError(null)
        setPending((current) => (current ? { ...current, usage } : current))
        setUsageFor(usage.total > 0 ? { key: pending.row.key, total: usage.total } : null)
      } catch (err) {
        // This one does NOT go through `readUsage`: the form's alert is no use while
        // the dialog is open (it renders outside Radix's portal, behind the overlay
        // and its `aria-hidden`), and the count on screen is now unverified — so the
        // dialog is told, and it refuses the action until a re-check lands.
        setRecheckError(err instanceof Error ? err.message : 'Could not re-check the values this field holds')
      }
    }
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [pending])

  // `required` rides along with the add: §9 gives the add row the same control as
  // the field row, and omitting it here would mean a field added to an existing
  // type always starts non-required, costing a second save to make it required.
  const add = async () => {
    const saved = await run({ id: typeId, upserts: [{ name: newName, fieldType: newType, required: newRequired }], deletedIds: [] })
    if (!saved) return
    setNewName('')
    setNewType('text')
    setNewRequired(false)
  }

  // Turning `required` on strands catalog items: the item form renders `required`
  // on the input, so every published item of the type with no value for this field
  // cannot be saved until it is filled. Informational and non-blocking — the
  // toggle flips either way, and the read says so rather than claiming a count.
  const toggleRequired = async (row: DraftRow, required: boolean) => {
    patch(row.key, { required })
    if (!required) {
      setMissingFor((current) => (current?.key === row.key ? null : current))
      return
    }
    const usage = await readUsage({ fieldId: row.id })
    setMissingFor(usage && usage.missing > 0 ? { key: row.key, count: usage.missing } : null)
  }

  // The count is read first so the confirmation can name what it destroys.
  const remove = async (row: DraftRow) => {
    const usage = await readUsage({ fieldId: row.id })
    if (!usage) return
    const warning = usage.total === 0 ? `Delete the field “${row.name}”?` : `Delete the field “${row.name}”? This also destroys ${usage.total} stored value${usage.total === 1 ? '' : 's'}.`
    if (!window.confirm(warning)) return
    await run({ id: typeId, upserts: [], deletedIds: [row.id], acknowledgeValueLoss: true })
  }

  // Cancel is inert: no write, and the row goes back to the type the server still
  // has — so a later save cannot silently clear the values the admin declined to
  // clear here. Both the warning and the dialog's snapshot go with it.
  const cancelRetype = () => {
    const row = pending?.row
    setPending(null)
    setUsageFor(null)
    setRecheckError(null)
    if (row) {
      const saved = fields.find((f) => f.id === row.id)
      if (saved) patch(row.key, { fieldType: saved.fieldType })
    }
  }

  return (
    <div className="border border-border rounded-lg p-3 flex flex-col gap-2">
      <span className="text-text-muted">Custom fields</span>

      {rows.map((row) => (
        <div className="flex gap-3 items-end" key={row.key}>
          <Field label="Name" htmlFor={`field-name-${row.key}`} className="flex-1 min-w-0">
            {/* Named after the field, like the `required` toggle below: the visible
                label is a bare "Name", which the page's own type-name input also
                carries, so an accessible name is what tells the two apart. */}
            <Input
              id={`field-name-${row.key}`}
              aria-label={`${row.name} name`}
              value={row.name}
              disabled={!canEdit}
              onChange={(e) => patch(row.key, { name: e.target.value })}
              className="w-full"
            />
          </Field>
          <Field label="Type" htmlFor={`field-type-${row.key}`}>
            <Select id={`field-type-${row.key}`} value={row.fieldType} disabled={!canEdit} onChange={(e) => previewRetype(row, e.target.value as FieldType)}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
            {/* “won't fit” rather than “don't fit”, so the singular needs no second
                ternary. The count is the one the dialog will make the admin commit to. */}
            {usageFor?.key === row.key && (
              <span className="text-danger text-xs">
                {usageFor.total} value{usageFor.total === 1 ? '' : 's'} won't fit {row.fieldType}
              </span>
            )}
          </Field>
          {canEdit && (
            <>
              <div className="flex flex-col gap-1">
                {/* The toggle is a write control, so a non-admin is not shown it at
                    all — the type list below the form still marks required fields
                    with an asterisk. */}
                <label className="flex items-center gap-1">
                  <input type="checkbox" aria-label={`${row.name} required`} checked={row.required} onChange={(e) => toggleRequired(row, e.target.checked)} />
                  required
                </label>
                {missingFor?.key === row.key && (
                  <span className="text-danger text-xs">
                    {missingFor.count} item{missingFor.count === 1 ? '' : 's'} with no value for this field and can't be saved until it's filled
                  </span>
                )}
              </div>
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
          {/* §9's third home for the control, alongside the field row and the
              create-type form. */}
          <label className="flex items-center gap-1">
            <input type="checkbox" aria-label="New field required" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
            required
          </label>
          <Button disabled={newName.trim() === '' || updateFields.isPending} onClick={add}>
            Add field
          </Button>
        </div>
      )}

      {error && <p role="alert" className="text-danger">{error}</p>}

      {/* The dialog's destructive button is a write control, so it stays behind the
          same gate as the rest of them — `pending` can only be set by a Save or a
          type change, both of which a non-admin is never shown. */}
      {canEdit && (
        <IncompatibleValuesDialog
          open={pending !== null}
          fieldName={pending?.row.name ?? ''}
          targetType={pending?.row.fieldType ?? 'text'}
          offenders={pending?.usage.items ?? []}
          total={pending?.usage.total ?? 0}
          refreshError={recheckError}
          busy={updateFields.isPending}
          onCancel={cancelRetype}
          onConfirm={async () => {
            if (!pending) return
            const { row, usage } = pending
            setPending(null)
            setUsageFor(null)
            setRecheckError(null)
            // ONE field per call: the API refuses a request that would clear two,
            // because a single acknowledged count cannot attest to both. Cleared
            // and retyped in one transaction, so they cannot diverge. The re-check
            // can also have emptied the list while this was open — then there is
            // nothing to clear or attest to, and this is the same plain retype the
            // unstranded path sends.
            await run(usage.total > 0 ? { ...upsertRow(row), clearIncompatible: true, acknowledgedValueCount: usage.total } : upsertRow(row))
          }}
        />
      )}
    </div>
  )
}
