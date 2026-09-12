import { useState } from 'react'
import type { FormEvent } from 'react'
import { FIELD_TYPES, type FieldType } from '@homebox/shared'
import { trpc } from '../../api/trpc'
import { useAuth } from '../../lib/auth'
import { Button, Field, Input, Select, Textarea } from '../../ui'

// A draft custom-field row being edited in the form. `key` is a local (React)
// identity so rows can be added/removed without colliding on index.
type DraftField = { key: number; name: string; fieldType: FieldType }

type TypeRow = { id: number; name: string; description: string | null; fields: { id: number; name: string; fieldType: DraftField['fieldType'] }[] }

// The comparable shape of a field set: names trimmed, blank rows dropped, order
// significant. Comparing these decides whether an edit needs to send `fields`.
const signature = (fields: { name: string; fieldType: string }[]): string =>
  JSON.stringify(fields.filter((f) => f.name.trim().length > 0).map((f) => ({ name: f.name.trim(), fieldType: f.fieldType })))

// Create/edit an item type. Item types are admin-managed (`itemTypes.create` /
// `update` / `delete` are `adminProcedure`), so every write control is hidden
// from a non-admin rather than offered and then refused with FORBIDDEN.
export function ItemTypesPage() {
  const utils = trpc.useUtils()
  const isAdmin = useAuth().user?.role === 'admin'
  const { data, isLoading } = trpc.itemTypes.list.useQuery()
  const create = trpc.itemTypes.create.useMutation()
  const update = trpc.itemTypes.update.useMutation()
  const remove = trpc.itemTypes.delete.useMutation()

  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<DraftField[]>([])
  const [nextKey, setNextKey] = useState(0)
  // The field set as loaded, so an edit that did not touch it can omit `fields`.
  const [loadedFields, setLoadedFields] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const addField = () => {
    setFields((current) => [...current, { key: nextKey, name: '', fieldType: 'text' }])
    setNextKey((k) => k + 1)
  }

  const removeField = (key: number) => setFields((current) => current.filter((f) => f.key !== key))

  const patchField = (key: number, patch: Partial<DraftField>) =>
    setFields((current) => current.map((f) => (f.key === key ? { ...f, ...patch } : f)))

  const reset = () => {
    setEditingId(null)
    setName('')
    setDescription('')
    setFields([])
    setLoadedFields('')
    setError(null)
  }

  const startEdit = (type: TypeRow) => {
    const rows = type.fields.map((f, index) => ({ key: index, name: f.name, fieldType: f.fieldType }))
    setEditingId(type.id)
    setName(type.name)
    setDescription(type.description ?? '')
    setFields(rows)
    setNextKey(rows.length) // new rows continue past the loaded keys, so none collide
    setLoadedFields(signature(rows))
    setError(null)
    setStatus(null)
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setStatus(null)

    // `items.update`-style replace semantics: the API replaces the type's WHOLE
    // field set, and `item_custom_field_values.field_id` cascades — so
    // re-sending an unchanged set would delete every item's values for this
    // type. Omit `fields` unless the set actually changed. ponytail: a genuine
    // field edit still cascades those values away; the upgrade path is to diff
    // by field name server-side and update rows in place.
    const fieldSetChanged = editingId == null || signature(fields) !== loadedFields
    const input = {
      name,
      description,
      ...(fieldSetChanged
        ? { fields: fields.filter((f) => f.name.trim().length > 0).map((f) => ({ name: f.name.trim(), fieldType: f.fieldType })) }
        : {}),
    }

    try {
      if (editingId == null) await create.mutateAsync({ ...input, fields: input.fields ?? [] })
      else await update.mutateAsync({ id: editingId, ...input })
      await utils.itemTypes.list.invalidate()
      // A rename changes the type name shown on items, and a field edit changes
      // their custom-field definitions, so the catalog is stale either way.
      if (editingId != null) await utils.items.list.invalidate()
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const handleDelete = async (type: TypeRow) => {
    // ponytail: native confirm — enough while there is no undo; swap for a
    // styled dialog if this ever grows one.
    if (!window.confirm(`Delete the item type "${type.name}"?`)) return
    setError(null)
    setStatus(null)
    try {
      await remove.mutateAsync({ id: type.id })
      await utils.itemTypes.list.invalidate()
      if (editingId === type.id) reset()
      setStatus(`Deleted "${type.name}".`)
    } catch (err) {
      // `deleteItemType` answers CONFLICT while any item still references the
      // type. The bare tRPC message for that is "Conflict", which says nothing
      // about what to do next, so it is spelled out here instead.
      const code = (err as { data?: { code?: string } })?.data?.code
      setError(
        code === 'CONFLICT'
          ? `"${type.name}" is still used by items, so it cannot be deleted.`
          : err instanceof Error
            ? err.message
            : 'Delete failed'
      )
    }
  }

  return (
    <section>
      <h1>Item types</h1>

      {isAdmin ? (
        <form className="flex flex-col gap-3 max-w-[30rem] my-4" onSubmit={handleSubmit}>
          <Field label="Name" htmlFor="type-name">
            <Input
              id="type-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>

          <Field label="Description" htmlFor="type-description">
            <Textarea
              id="type-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div className="border border-border rounded-lg p-3">
            <div className="flex flex-col gap-1">
              <span className="text-text-muted">Custom fields</span>
              <Button type="button" onClick={addField}>Add field</Button>
            </div>
            {fields.map((field) => (
              <div className="flex gap-3" key={field.key}>
                <div className="flex flex-col gap-1">
                  <Input
                    type="text"
                    placeholder="Field name"
                    value={field.name}
                    onChange={(e) => patchField(field.key, { name: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Select
                    value={field.fieldType}
                    onChange={(e) => patchField(field.key, { fieldType: e.target.value as DraftField['fieldType'] })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="button" onClick={() => removeField(field.key)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={create.isPending || update.isPending}>
              {editingId == null ? 'Create type' : 'Save changes'}
            </Button>
            {editingId != null && <Button onClick={reset}>Cancel</Button>}
          </div>

          {error && <p role="alert" className="text-danger">{error}</p>}
          {status && <p role="status">{status}</p>}
        </form>
      ) : (
        <p className="text-text-muted">Item types are managed by an administrator.</p>
      )}

      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul className="list-none pl-0">
          {(data ?? []).map((type) => (
            <li key={type.id}>
              <div className="flex items-center gap-2">
                <strong>{type.name}</strong>
                {isAdmin && (
                  <>
                    <Button size="sm" onClick={() => startEdit(type)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(type)}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
              {type.description && <p>{type.description}</p>}
              {type.fields.length > 0 && (
                <ul>
                  {type.fields.map((field) => (
                    <li key={field.id}>
                      {field.name} <span className="text-text-muted">({field.fieldType})</span>
                      {field.required ? ' *' : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {(data ?? []).length === 0 && <p>No item types yet.</p>}
        </ul>
      )}
    </section>
  )
}
