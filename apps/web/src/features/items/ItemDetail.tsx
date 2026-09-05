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
      <Link to="/items">← Items</Link>
      <h1>{item.name}</h1>
      <p>{item.description}</p>
      <p>
        Qty: {item.quantity} {item.unit}
      </p>
      <p>Type: {item.type?.name}</p>
      <p>Location: {item.location?.name}</p>

      <PhotoUpload itemId={item.id} />

      <div className="grid">
        {item.images.map((img) => (
          <div key={img.id} className="image-card">
            <img src={'/file/' + img.thumbPath} alt={item.name} />
            <button type="button" onClick={() => setEditingImage({ id: img.id, originalPath: img.originalPath })}>
              Edit
            </button>
            <a href={'/file/' + (img.editedPath ?? img.originalPath)} target="_blank" rel="noreferrer">
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
