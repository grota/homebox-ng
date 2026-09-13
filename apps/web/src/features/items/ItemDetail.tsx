import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { Badge, Button, Card, PageHeader, PhotoViewer } from '../../ui'
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
  // The drafts page reports how many items an unpack detected, and this is the
  // other entry point into the same flow: navigating on the *result* rather than
  // on the click is what carries the count across, so a photo that yields
  // nothing is not silent here either. Same convention as the drafts page's
  // `UnpackModal.onUnpacked` — `?detected=<n>`, read by the page it lands on.
  const unpack = trpc.unpack.run.useMutation({
    onSuccess: (result) => {
      void utils.drafts.list.invalidate()
      navigate(`/drafts?detected=${result.detected}`)
    },
  })
  // `path` is the rendition the editor opens, so the two Edit buttons differ only
  // in what they hand it (see the photo card below).
  const [editingImage, setEditingImage] = useState<{ id: number; path: string } | null>(null)
  const [viewing, setViewing] = useState<{ src: string; originalSrc: string; alt: string } | null>(null)
  const [editingItem, setEditingItem] = useState(false)

  // Every mutation below re-reads the item, which is what the gallery renders.
  const refresh = () => {
    utils.items.list.invalidate()
    void utils.items.get.invalidate({ id: itemId })
  }
  const trashItem = trpc.items.trash.useMutation({
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
              disabled={trashItem.isPending}
              onClick={() => {
                // ponytail: native confirm — enough for a single-item trash; swap for a
                // styled dialog if this ever grows bulk.
                if (confirm(`Move "${item.name}" to the trash?`)) trashItem.mutate({ id: itemId })
              }}
            >
              Move to trash
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

      {/* One `unpack` mutation is shared by every card's "Unpack this photo", so
          its error is shown here once rather than repeated inside the grid. A
          failed unpack stays on this page — the navigation to the drafts page
          happens on success — so without this the failure would be silent. */}
      {unpack.error && (
        <p role="alert" className="text-danger">
          {unpack.error.message}
        </p>
      )}

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {item.images.map((img) => (
          <Card key={img.id} padding="sm" className="flex flex-col gap-1">
            {/* The thumbnail is the control: a real <button> carries the accessible
                name, so the <img> inside it is `alt=""` — with alt text a screen
                reader would read the item name twice. */}
            <button
              type="button"
              aria-label={`View photo of ${item.name}`}
              onClick={() =>
                setViewing({
                  src: '/file/' + (img.editedPath ?? img.originalPath),
                  originalSrc: '/file/' + img.originalPath,
                  alt: item.name,
                })
              }
              className="block w-full cursor-zoom-in p-0"
            >
              <img src={'/file/' + img.thumbPath} alt="" className="w-full h-32 object-cover rounded-md" />
            </button>
            {img.isPrimary && <Badge>Primary</Badge>}
            {/* Edits stack on the last edit, not on the raw file: once an image
                has an `editedPath`, that is the rendition "Edit photo" opens. */}
            <Button onClick={() => setEditingImage({ id: img.id, path: img.editedPath ?? img.originalPath })}>
              Edit photo
            </Button>
            {/* Only offered when there is something to go back to — without an
                edit this is the button above, under a second name. */}
            {img.editedPath && (
              <Button onClick={() => setEditingImage({ id: img.id, path: img.originalPath })}>
                Edit original photo
              </Button>
            )}
            {!img.isPrimary && (
              <Button
                disabled={setPrimary.isPending}
                onClick={() => setPrimary.mutate({ itemId: item.id, imageId: img.id })}
              >
                Set primary
              </Button>
            )}
            <Button onClick={() => unpack.mutate({ kind: 'item', imageId: img.id })}>
              Unpack this photo
            </Button>
            {/* The "View" anchor lived here. Its job — seeing the full photo — is now
                the thumbnail's, and its one unique capability (opening the file in a
                new tab) moved into the viewer as "Open original". */}
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

      {viewing && (
        <PhotoViewer
          src={viewing.src}
          originalSrc={viewing.originalSrc}
          alt={viewing.alt}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  )
}
