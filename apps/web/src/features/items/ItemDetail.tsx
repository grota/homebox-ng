import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { PhotoUpload } from '../upload/PhotoUpload'
import { PhotoEditor } from '../upload/PhotoEditor'

// Shows a single item with its photos and an upload control. Thumbnails are
// served from the public `/file/<thumbPath>` route.
export function ItemDetail() {
  const { id } = useParams()
  const itemId = Number(id)
  const { data: item, isLoading } = trpc.items.get.useQuery({ id: itemId })
  const [editingImage, setEditingImage] = useState<{ id: number; originalPath: string } | null>(null)

  if (isLoading) return <p>Loading…</p>
  if (!item) return <p>Item not found</p>

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

      <PhotoUpload itemId={item.id} />

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {item.images.map((img) => (
          <div key={img.id} className="border border-border rounded-lg p-2">
            <img src={'/file/' + img.thumbPath} alt={item.name} className="w-full h-32 object-cover rounded-md mb-2" />
            <button
              type="button"
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
              onClick={() => setEditingImage({ id: img.id, originalPath: img.originalPath })}
            >
              Edit
            </button>
            <a
              href={'/file/' + (img.editedPath ?? img.originalPath)}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-text no-underline"
            >
              View
            </a>
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
