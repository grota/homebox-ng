import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { PhotoUpload } from '../upload/PhotoUpload'
import { PhotoEditor } from '../upload/PhotoEditor'
import { ItemForm } from './ItemForm'

// Shows a single item with its photos and an upload control. Thumbnails are
// served from the public `/file/<thumbPath>` route.
//
// All mutations invalidate `items.get`/`items.list` rather than patching local
// state, so the gallery reflects `isPrimary` and deletions from one source.
export function ItemDetail() {
  const { id } = useParams()
  const itemId = Number(id)
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const { data: item, isLoading } = trpc.items.get.useQuery({ id: itemId })
  const unpack = trpc.unpack.run.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const [editingImage, setEditingImage] = useState<{ id: number; originalPath: string } | null>(null)
  const [editingItem, setEditingItem] = useState(false)

  // Every mutation below re-reads the item, which is what the gallery renders.
  const refresh = () => {
    utils.items.list.invalidate()
    void utils.items.get.invalidate({ id: itemId })
  }
  const deleteItem = trpc.items.delete.useMutation({
    onSuccess: () => {
      utils.items.list.invalidate()
      navigate('/items')
    },
  })
  const setPrimary = trpc.images.setPrimary.useMutation({ onSuccess: refresh })
  const deleteImage = trpc.images.delete.useMutation({ onSuccess: refresh })

  if (isLoading) return <p>Loading…</p>
  if (!item) return <p>Item not found</p>

  if (editingItem) {
    return (
      <section>
        <ItemForm
          item={item}
          onSaved={() => {
            setEditingItem(false)
            refresh()
          }}
          onCancel={() => setEditingItem(false)}
        />
      </section>
    )
  }

  return (
    <section>
      <Link to="/items" className="no-underline text-text">
        ← Items
      </Link>
      <h1>{item.name}</h1>
      <p className="text-text">{item.description}</p>
      <p className="text-text-muted">
        Qty: {item.quantity} {item.unit}
      </p>
      <p className="text-text-muted">Type: {item.type?.name}</p>
      <p className="text-text-muted">Location: {item.location?.name}</p>

      <div className="flex gap-2 my-4">
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
          onClick={() => setEditingItem(true)}
        >
          Edit item
        </button>
        <button
          type="button"
          disabled={deleteItem.isPending}
          className="px-3 py-1.5 rounded-md border border-border bg-surface text-danger"
          onClick={() => {
            // ponytail: native confirm — enough for a single-item delete; swap for a
            // styled dialog if this ever grows bulk/undo.
            if (confirm(`Delete "${item.name}" and its photos?`)) deleteItem.mutate({ id: itemId })
          }}
        >
          Delete item
        </button>
      </div>

      <PhotoUpload itemId={item.id} />

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {item.images.map((img) => (
          <div key={img.id} className="border border-border rounded-lg p-2 flex flex-col gap-1">
            <img src={'/file/' + img.thumbPath} alt={item.name} className="w-full h-32 object-cover rounded-md" />
            {img.isPrimary && <span className="text-xs text-text-muted">Primary</span>}
            <button
              type="button"
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
              onClick={() => setEditingImage({ id: img.id, originalPath: img.originalPath })}
            >
              Edit
            </button>
            {!img.isPrimary && (
              <button
                type="button"
                disabled={setPrimary.isPending}
                className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
                onClick={() => setPrimary.mutate({ itemId: item.id, imageId: img.id })}
              >
                Set primary
              </button>
            )}
            <button
              type="button"
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
              onClick={() => { unpack.mutate({ kind: 'item', imageId: img.id }); navigate('/drafts') }}
            >
              Unpack this photo
            </button>
            <a
              href={'/file/' + (img.editedPath ?? img.originalPath)}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-text no-underline text-center"
            >
              View
            </a>
            <button
              type="button"
              disabled={deleteImage.isPending}
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-danger"
              onClick={() => {
                if (confirm('Delete this photo?')) deleteImage.mutate({ id: img.id })
              }}
            >
              Delete photo
            </button>
          </div>
        ))}
        {item.images.length === 0 && <p>No photos yet.</p>}
      </div>

      {editingImage && (
        <PhotoEditor image={editingImage} itemId={item.id} open onClose={() => setEditingImage(null)} />
      )}
    </section>
  )
}
