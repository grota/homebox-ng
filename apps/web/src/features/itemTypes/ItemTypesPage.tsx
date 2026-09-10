import { useState } from 'react'
import type { FormEvent } from 'react'
import { trpc } from '../../api/trpc'
import { Button, Field, Input, Select, Textarea } from '../../ui'

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
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Create type
          </Button>
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
