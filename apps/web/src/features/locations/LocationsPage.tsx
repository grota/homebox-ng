import { useState } from 'react'
import type { FormEvent } from 'react'
import { trpc } from '../../api/trpc'
import { Button, Field, Input, Select } from '../../ui'
import { LocationTree } from './LocationTree'
import type { LocationTreeItem } from './LocationTree'

const findNode = (nodes: LocationTreeItem[], id: number): LocationTreeItem | null => {
  for (const node of nodes) {
    if (node.id === id) return node
    const hit = findNode(node.children ?? [], id)
    if (hit) return hit
  }
  return null
}

// The tree flattened into `<select>` options, each label indented by depth so
// the hierarchy still reads in a flat list.
const toOptions = (nodes: LocationTreeItem[]): { id: number; label: string }[] =>
  nodes.flatMap((node) => [
    { id: node.id, label: `${'— '.repeat(node.depth - 1)}${node.name}` },
    ...toOptions(node.children ?? []),
  ])

// A node plus everything beneath it — the ids a location may not be moved under
// (that would be a cycle, which the API rejects with CONFLICT).
const subtreeIds = (node: LocationTreeItem): number[] => [node.id, ...(node.children ?? []).flatMap(subtreeIds)]

// One form serves both create and edit: `editingId` decides which mutation
// `handleSubmit` calls. Locations carry a name and a parent and nothing else the
// UI sets — `description` is writable through the API but has no create-side
// counterpart in `locationInput`, so it is left alone rather than made
// edit-only.
export function LocationsPage() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.locations.list.useQuery()
  const create = trpc.locations.create.useMutation()
  const update = trpc.locations.update.useMutation()
  const remove = trpc.locations.delete.useMutation()

  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const tree = data ?? []
  const editing = editingId == null ? null : findNode(tree, editingId)
  const blocked = new Set(editing ? subtreeIds(editing) : [])
  const options = toOptions(tree).filter((option) => !blocked.has(option.id))
  const busy = create.isPending || update.isPending || remove.isPending

  const reset = () => {
    setEditingId(null)
    setName('')
    setParentId('')
    setError(null)
  }

  const startEdit = (location: LocationTreeItem) => {
    setEditingId(location.id)
    setName(location.name)
    setParentId(location.parentId ?? '')
    setError(null)
    setStatus(null)
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setStatus(null)
    const payload = { name, parentId: parentId === '' ? null : Number(parentId) }
    try {
      if (editingId == null) await create.mutateAsync(payload)
      else await update.mutateAsync({ id: editingId, ...payload })
      await utils.locations.list.invalidate()
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const handleDelete = async (location: LocationTreeItem) => {
    // The delete is deep and irreversible, so the prompt says what goes with the
    // location. ponytail: native confirm — enough while there is no undo; swap
    // for a styled dialog if this ever grows one.
    const ok = window.confirm(
      `Delete "${location.name}" and everything inside it?\n\nAny sub-locations and any items that live there are deleted too.`
    )
    if (!ok) return
    setError(null)
    setStatus(null)
    try {
      const result = await remove.mutateAsync({ id: location.id })
      await utils.locations.list.invalidate()
      if (editingId === location.id) reset()
      const locs = `${result.locations} location${result.locations === 1 ? '' : 's'}`
      const items = `${result.items} item${result.items === 1 ? '' : 's'}`
      setStatus(`Deleted ${locs} and ${items}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <section>
      <h1>Locations</h1>

      <form className="flex flex-col gap-3 max-w-[30rem] my-4" onSubmit={handleSubmit}>
        <Field label="Name" htmlFor="location-name">
          <Input id="location-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Parent" htmlFor="location-parent">
          <Select
            id="location-parent"
            value={parentId === '' ? '' : String(parentId)}
            onChange={(e) => setParentId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">No parent (top level)</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {editingId == null ? 'Create location' : 'Save changes'}
          </Button>
          {editingId != null && <Button onClick={reset}>Cancel</Button>}
        </div>

        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {status && <p role="status">{status}</p>}
      </form>

      {isLoading ? <p>Loading…</p> : <LocationTree locations={tree} onEdit={startEdit} onDelete={handleDelete} />}
    </section>
  )
}
