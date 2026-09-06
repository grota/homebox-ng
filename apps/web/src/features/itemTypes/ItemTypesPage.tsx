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

      <form className="flex flex-col gap-3 max-w-[30rem] my-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1">
          <label htmlFor="type-name">Name</label>
          <input
            id="type-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="px-2 py-1 border border-border rounded-md bg-surface text-text"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="type-description">Description</label>
          <textarea
            id="type-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="px-2 py-1 border border-border rounded-md bg-surface text-text"
          />
        </div>

        <div className="border border-border rounded-lg p-3">
          <div className="flex flex-col gap-1">
            <span className="text-text-muted">Custom fields</span>
            <button
              type="button"
              onClick={addField}
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
            >
              Add field
            </button>
          </div>
          {fields.map((field) => (
            <div className="flex gap-3" key={field.key}>
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  placeholder="Field name"
                  value={field.name}
                  onChange={(e) => patchField(field.key, { name: e.target.value })}
                  className="px-2 py-1 border border-border rounded-md bg-surface text-text"
                />
              </div>
              <div className="flex flex-col gap-1">
                <select
                  value={field.fieldType}
                  onChange={(e) => patchField(field.key, { fieldType: e.target.value as DraftField['fieldType'] })}
                  className="px-2 py-1 border border-border rounded-md bg-surface text-text"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => removeField(field.key)}
                className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={create.isPending} className="px-3 py-1.5 rounded-md border border-border bg-surface text-text">
            Create type
          </button>
        </div>
        {create.error && <p role="alert">{create.error.message}</p>}
      </form>

      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul className="list-none pl-0">
          {(data ?? []).map((type) => (
            <li key={type.id}>
              <strong>{type.name}</strong>
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
