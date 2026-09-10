import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { Badge, Button, Card, PageHeader } from '../../ui'
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
      <PageHeader
        title={item.name}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setEditingItem(true)}>Edit item</Button>
            <Button
              variant="danger"
              disabled={deleteItem.isPending}
              onClick={() => {
                // ponytail: native confirm — enough for a single-item delete; swap for a
                // styled dialog if this ever grows bulk/undo.
                if (confirm(`Delete "${item.name}" and its photos?`)) deleteItem.mutate({ id: itemId })
              }}
            >
              Delete item
            </Button>
          </div>
        }
      />
      <p className="text-text">{item.description}</p>
      <p className="text-text-muted">
        Qty: {item.quantity} {item.unit}
      </p>
      <p className="text-text-muted">Type: {item.type?.name}</p>
      <p className="text-text-muted">Location: {item.location?.name}</p>

      <PhotoUpload itemId={item.id} />

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {item.images.map((img) => (
          <Card key={img.id} padding="sm" className="flex flex-col gap-1">
            <img src={'/file/' + img.thumbPath} alt={item.name} className="w-full h-32 object-cover rounded-md" />
            {img.isPrimary && <Badge>Primary</Badge>}
            <Button onClick={() => setEditingImage({ id: img.id, originalPath: img.originalPath })}>
              Edit
            </Button>
            {!img.isPrimary && (
              <Button
                disabled={setPrimary.isPending}
                onClick={() => setPrimary.mutate({ itemId: item.id, imageId: img.id })}
              >
                Set primary
              </Button>
            )}
            <Button onClick={() => { unpack.mutate({ kind: 'item', imageId: img.id }); navigate('/drafts') }}>
              Unpack this photo
            </Button>
            {/* ponytail: an <a>, not a <Button> — it opens the file in a new tab, which
                a <button> cannot. The classes mirror the secondary variant; export a
                shared buttonClass if a second anchor ever needs them. */}
            <a
              href={'/file/' + (img.editedPath ?? img.originalPath)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text no-underline transition-colors hover:bg-surface-raised"
            >
              View
            </a>
            <Button
              variant="danger"
              disabled={deleteImage.isPending}
              onClick={() => {
                if (confirm('Delete this photo?')) deleteImage.mutate({ id: img.id })
              }}
            >
              Delete photo
            </Button>
          </Card>
        ))}
        {item.images.length === 0 && <p>No photos yet.</p>}
      </div>

      {editingImage && (
        <PhotoEditor image={editingImage} itemId={item.id} open onClose={() => setEditingImage(null)} />
      )}
    </section>
  )
}
