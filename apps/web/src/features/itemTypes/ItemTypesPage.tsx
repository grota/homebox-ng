import { useState } from 'react'
import type { FormEvent } from 'react'
import { FIELD_TYPES, type FieldType } from '@homebox/shared'
import { trpc } from '../../api/trpc'
import { useAuth } from '../../lib/auth'
import { Button, Field, Input, Select, Textarea } from '../../ui'
import { TypeFields, type TypeField } from './TypeFields'

// A draft custom-field row being edited while CREATING a type. `key` is a local
// (React) identity so rows can be added/removed without colliding on index.
// Editing an existing type's fields is `TypeFields`' job: its rows diff against
// the stored ones, which a create-only draft has nothing to diff against.
type DraftField = { key: number; name: string; fieldType: FieldType; required: boolean }

type TypeRow = { id: number; name: string; description: string | null; fields: TypeField[] }

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
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // The type currently open for editing, so its stored fields can be handed to
  // `TypeFields` (which diffs against them) and its id is non-null when the
  // editor is on screen.
  const editing = (data ?? []).find((type) => type.id === editingId)

  const addField = () => {
    setFields((current) => [...current, { key: nextKey, name: '', fieldType: 'text', required: false }])
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
    setError(null)
  }

  const startEdit = (type: TypeRow) => {
    setEditingId(type.id)
    setName(type.name)
    setDescription(type.description ?? '')
    // The create draft is abandoned rather than kept: the name and description
    // are being overwritten anyway, so leaving its rows behind would offer to
    // create a type out of half of someone else's draft.
    setFields([])
    setError(null)
    setStatus(null)
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setStatus(null)

    try {
      if (editingId == null) {
        // Only `create` carries `fields`; it is the one call that defines a whole
        // field set. `update` never carries them, so no edit can replace (and
        // cascade away the values of) fields it did not touch — see ADR-0003.
        await create.mutateAsync({
          name,
          description,
          fields: fields
            .filter((f) => f.name.trim().length > 0)
            .map((f) => ({ name: f.name.trim(), fieldType: f.fieldType, required: f.required })),
        })
      } else {
        await update.mutateAsync({ id: editingId, name, description })
        // A rename changes the type name shown on items, so the catalog is stale.
        await utils.items.list.invalidate()
      }
      await utils.itemTypes.list.invalidate()
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

          {editingId == null && (
            <div className="border border-border rounded-lg p-3">
              <div className="flex flex-col gap-1">
                <span className="text-text-muted">Custom fields</span>
                <Button type="button" onClick={addField}>Add field</Button>
              </div>
              {fields.map((field) => (
                <div className="flex gap-3 items-center" key={field.key}>
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
                      onChange={(e) => patchField(field.key, { fieldType: e.target.value as FieldType })}
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      aria-label="Required"
                      checked={field.required}
                      onChange={(e) => patchField(field.key, { required: e.target.checked })}
                    />
                    required
                  </label>
                  <Button type="button" onClick={() => removeField(field.key)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}

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

      {editing && (
        <div className="max-w-[30rem] my-4">
          <TypeFields typeId={editing.id} fields={editing.fields} canEdit={isAdmin} />
        </div>
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
