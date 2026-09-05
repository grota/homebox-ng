import { useParams, Link } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { PhotoUpload } from '../upload/PhotoUpload'

// Shows a single item with its photos and an upload control. Thumbnails are
// served from the public `/file/<thumbPath>` route.
export function ItemDetail() {
  const { id } = useParams()
  const itemId = Number(id)
  const { data: item, isLoading } = trpc.items.get.useQuery({ id: itemId })

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
          <img key={img.id} src={'/file/' + img.thumbPath} alt={item.name} />
        ))}
        {item.images.length === 0 && <p>No photos yet.</p>}
      </div>
    </section>
  )
}
