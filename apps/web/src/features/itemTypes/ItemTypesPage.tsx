import { useState } from 'react'
import type { FormEvent } from 'react'
import { trpc } from '../../api/trpc'

const FIELD_TYPES = ['text', 'number', 'currency', 'date', 'boolean', 'url'] as const

// A draft custom-field row being edited in the create form. `key` is a local
// (React) identity so rows can be added/removed without colliding on index.
type DraftField = { key: number; name: string; fieldType: (typeof FIELD_TYPES)[number] }

export function ItemTypesPage() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.itemTypes.list.useQuery()
  const create = trpc.itemTypes.create.useMutation()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<DraftField[]>([])
  const [nextKey, setNextKey] = useState(0)

  const addField = () => {
    setFields((current) => [...current, { key: nextKey, name: '', fieldType: 'text' }])
    setNextKey((k) => k + 1)
  }

  const removeField = (key: number) => setFields((current) => current.filter((f) => f.key !== key))

  const patchField = (key: number, patch: Partial<DraftField>) =>
    setFields((current) => current.map((f) => (f.key === key ? { ...f, ...patch } : f)))

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await create.mutateAsync({
      name,
      description,
      fields: fields
        .filter((f) => f.name.trim().length > 0)
        .map((f) => ({ name: f.name.trim(), fieldType: f.fieldType })),
    })
    await utils.itemTypes.list.invalidate()
    setName('')
    setDescription('')
    setFields([])
  }

  return (
    <section>
      <h1>Item types</h1>

      <form className="form" onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="type-name">Name</label>
          <input
            id="type-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="type-description">Description</label>
          <textarea
            id="type-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-fields">
          <div className="form-field">
            <span className="muted">Custom fields</span>
            <button type="button" onClick={addField}>
              Add field
            </button>
          </div>
          {fields.map((field) => (
            <div className="form-row" key={field.key}>
              <div className="form-field">
                <input
                  type="text"
                  placeholder="Field name"
                  value={field.name}
                  onChange={(e) => patchField(field.key, { name: e.target.value })}
                />
              </div>
              <div className="form-field">
                <select
                  value={field.fieldType}
                  onChange={(e) => patchField(field.key, { fieldType: e.target.value as DraftField['fieldType'] })}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={() => removeField(field.key)}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="form-actions">
          <button type="submit" disabled={create.isPending}>
            Create type
          </button>
        </div>
        {create.error && <p role="alert">{create.error.message}</p>}
      </form>

      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul className="type-list">
          {(data ?? []).map((type) => (
            <li key={type.id}>
              <strong>{type.name}</strong>
              {type.description && <p>{type.description}</p>}
              {type.fields.length > 0 && (
                <ul>
                  {type.fields.map((field) => (
                    <li key={field.id}>
                      {field.name} <span className="muted">({field.fieldType})</span>
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
