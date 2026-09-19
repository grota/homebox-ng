import { useState } from 'react'
import type { FormEvent } from 'react'
import { trpc } from '../../api/trpc'
import { Badge, Button, Field, Input } from '../../ui'

// The `tagInput` default, also used for a tag whose stored colour is null
// (legacy rows written before `hexColor` was enforced).
const DEFAULT_COLOR = '#888888'

type TagRow = { id: number; name: string; color: string | null }

// Tags are catalog-wide (writes are `protectedProcedure`, not admin-gated), so
// every user manages them. One form serves both create and edit; `editingId`
// decides which mutation `handleSubmit` calls. `tags.create` upserts by name, so
// re-creating an existing name returns that tag rather than failing —
// `tags.update` is what makes a deliberate rename expressible.
export function TagsPage() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.tags.list.useQuery()
  const create = trpc.tags.create.useMutation()
  const update = trpc.tags.update.useMutation()
  const remove = trpc.tags.delete.useMutation()

  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const busy = create.isPending || update.isPending || remove.isPending

  const reset = () => {
    setEditingId(null)
    setName('')
    setColor(DEFAULT_COLOR)
    setError(null)
  }

  const startEdit = (tag: TagRow) => {
    setEditingId(tag.id)
    setName(tag.name)
    setColor(tag.color ?? DEFAULT_COLOR)
    setError(null)
    setStatus(null)
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setStatus(null)
    try {
      if (editingId == null) await create.mutateAsync({ name, color })
      else await update.mutateAsync({ id: editingId, name, color })
      await utils.tags.list.invalidate()
      // Item cards render tag names and colours, so the catalog is stale.
      if (editingId != null) await utils.items.list.invalidate()
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const handleDelete = async (tag: TagRow) => {
    // ponytail: native confirm — enough while there is no undo; swap for a
    // styled dialog if this ever grows one.
    if (!window.confirm(`Delete the tag "${tag.name}"? It is removed from every item carrying it.`)) return
    setError(null)
    setStatus(null)
    try {
      await remove.mutateAsync({ id: tag.id })
      await utils.tags.list.invalidate()
      await utils.items.list.invalidate()
      if (editingId === tag.id) reset()
      setStatus(`Deleted "${tag.name}".`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <section>
      <h1>Tags</h1>

      <form className="flex flex-col gap-3 max-w-[30rem] mx-auto my-4" onSubmit={handleSubmit}>
        <Field label="Name" htmlFor="tag-name">
          <Input id="tag-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Colour" htmlFor="tag-color">
          <Input
            id="tag-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-16 h-9 p-1"
          />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {editingId == null ? 'Create tag' : 'Save changes'}
          </Button>
          {editingId != null && <Button onClick={reset}>Cancel</Button>}
        </div>

        {error && <p role="alert" className="text-danger">{error}</p>}
        {status && <p role="status">{status}</p>}
      </form>

      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul className="list-none flex flex-wrap gap-2 items-center">
          {(data ?? []).map((tag) => (
            <li key={tag.id} className="flex items-center gap-1">
              {/* `tag.color` is arbitrary user data, so it rides on `Badge`'s inline
                  `color` prop rather than a token class. */}
              <Badge color={tag.color}>{tag.name}</Badge>
              <Button size="sm" onClick={() => startEdit(tag)}>
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={() => handleDelete(tag)}>
                Delete
              </Button>
            </li>
          ))}
          {(data ?? []).length === 0 && <p>No tags yet.</p>}
        </ul>
      )}
    </section>
  )
}
