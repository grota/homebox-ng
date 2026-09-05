import { useState } from 'react'
import { Link } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { ItemForm } from './ItemForm'

// Paginated catalog listing. Thumbnails come from the first image on each item
// (the service hydrates items with an `images` array). Clicking a card navigates
// to `/items/:id`. "New item" toggles an inline create form.
export function ItemsPage() {
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const utils = trpc.useUtils()

  const { data, isLoading } = trpc.items.list.useQuery({ page })
  const items = data?.items ?? []

  const handleSaved = () => {
    utils.items.list.invalidate()
    setShowForm(false)
  }

  return (
    <section>
      <header className="page-header">
        <h1>Items</h1>
        <button type="button" onClick={() => setShowForm((open) => !open)}>
          New item
        </button>
      </header>

      {showForm && <ItemForm onSaved={handleSaved} onCancel={() => setShowForm(false)} />}

      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <div className="grid">
          {items.map((item) => (
            <Link key={item.id} to={`/items/${item.id}`} className="card">
              {item.images?.[0]?.thumbPath ? (
                <img src={'/file/' + item.images[0].thumbPath} alt={item.name} />
              ) : null}
              <h2>{item.name}</h2>
              <p>{item.location?.name}</p>
              <p>{item.type?.name}</p>
              {item.tags.map((tag) => (
                <span key={tag.id} className="tag">
                  {tag.name}
                </span>
              ))}
            </Link>
          ))}
          {items.length === 0 && <p>No items yet.</p>}
        </div>
      )}

      {data && data.total > 1 && (
        <div className="pager">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Prev
          </button>
          <span>Page {page}</span>
          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page * 20 >= data.total}>
            Next
          </button>
        </div>
      )}
    </section>
  )
}
