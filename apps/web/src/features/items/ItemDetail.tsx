import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { Badge, Button, buttonClasses, cn, PhotoViewer } from '../../ui'
import { usePhotoIndex } from '../../lib/photoIndex'
import { PhotoEditor } from '../upload/PhotoEditor'
import { ManualUnpackModal } from '../drafts/ManualUnpackModal'
import { ItemForm } from './ItemForm'
import { ItemPanel } from './ItemPanel'

// A stable empty array, so `usePhotoIndex`'s memo does not see a new one every
// render while the query is still loading.
const NO_PHOTOS: never[] = []

// The item surface: where an item is met in full, and the only place its photos
// are both browsed and acted on (ADR-0005). It is a page rather than an overlay
// so the editor and the manual-unpack modal open over it exactly as they always
// have, with no stacked dialogs and no index to carry across a close and reopen.
//
// All mutations invalidate `items.get`/`items.list` rather than patching local
// state, so the carousel reflects `isPrimary` and deletions from one source — and
// `usePhotoIndex` deliberately does not try to compensate for the list shrinking,
// because that shrinking *is* the desired "land on the next photo".
export function ItemDetail() {
  const { id } = useParams()
  const itemId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  const utils = trpc.useUtils()
  const { data: item, isLoading } = trpc.items.get.useQuery({ id: itemId })

  // Every mutation below re-reads the item, which is what the carousel renders.
  const refresh = useCallback(() => {
    utils.items.list.invalidate()
    void utils.items.get.invalidate({ id: itemId })
  }, [utils, itemId])

  const unpack = trpc.unpack.run.useMutation({
    onSuccess: (result) => {
      void utils.drafts.list.invalidate()
      navigate(`/drafts?detected=${result.detected}`)
    },
  })
  const manualUnpack = trpc.unpack.manual.useMutation()
  const setPrimary = trpc.images.setPrimary.useMutation({ onSuccess: refresh })
  const deleteImage = trpc.images.delete.useMutation({ onSuccess: refresh })
  const trashItem = trpc.items.trash.useMutation({
    onSuccess: () => {
      utils.items.list.invalidate()
      navigate('/items')
    },
  })

  const [panelOpen, setPanelOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(false)
  // `path` is the rendition the editor opens, so the two Edit actions differ only
  // in what they hand it.
  const [editingImage, setEditingImage] = useState<{ id: number; path: string } | null>(null)
  // Manual unpack draws on the file the *server* will crop — `originalPath`, not
  // the edited rendition. Drawing on the edited rendition would put the boxes in
  // a different coordinate space from the pixels being cut, and every crop would
  // be off by whatever the edit changed.
  const [manualImage, setManualImage] = useState<{ imageId: number; originalPath: string } | null>(null)
  // The photo an upload just created, so the carousel can move to it once the
  // refetch has actually delivered it.
  const [pendingPhoto, setPendingPhoto] = useState<number | null>(null)

  const { photos, index, current, setIndex, next, previous, canPrevious, canNext } = usePhotoIndex(
    item?.images ?? NO_PHOTOS,
    itemId,
  )

  const close = useCallback(() => {
    // Back when there is somewhere to go back to: the catalog keeps its search
    // and facets in the URL, and a bare `/items` would silently reset a filtered
    // view. `location.key === 'default'` is a cold deep link, where Back would
    // leave the app instead.
    if (location.key !== 'default') navigate(-1)
    else navigate('/items')
  }, [location.key, navigate])

  // The surface's own keys. The arrows belong to the stage (they pan), so the
  // split is by key and there is no ordering rule between two handlers.
  //
  // Capture phase, and "is an overlay up?" asked of the DOM rather than of this
  // component's state. Both parts are load-bearing and neither is a style choice:
  // Radix handles Escape on the *document*, so by the time an Escape has bubbled
  // back out to `window` the dialog is already unmounted and this component has
  // re-rendered with `editingImage === null`. A guard reading that state sees
  // "no overlay is open" and closes the surface underneath the dialog it just
  // dismissed — which is exactly what it did. `window`'s capture phase runs
  // before `document`'s, so the dialog is still there to be found; `role="dialog"`
  // is what every `Modal` renders (Radix's `Dialog.Content`).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      if (event.key === 'Escape') close()
      else if (event.key === 'PageDown' && canNext) setIndex(index + 1)
      else if (event.key === 'PageUp' && canPrevious) setIndex(index - 1)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [close, index, canNext, canPrevious, setIndex])

  // Moving to a photo that does not exist yet would set the index past the end,
  // and the clamp would land on nothing. Wait for the refetch that follows the
  // upload to actually contain it.
  useEffect(() => {
    if (pendingPhoto == null) return
    const at = photos.findIndex((photo) => photo.id === pendingPhoto)
    if (at < 0) return
    setIndex(at)
    setPendingPhoto(null)
  }, [pendingPhoto, photos, setIndex])

  if (isLoading || !item) {
    return (
      <div className="flex h-dvh flex-col bg-bg text-text">
        <div className="flex justify-end border-b border-border bg-surface px-3 py-2">
          <Button onClick={close}>Close</Button>
        </div>
        <p className="grid flex-1 place-items-center text-text-muted">
          {isLoading ? 'Loading…' : 'Item not found'}
        </p>
      </div>
    )
  }

  // Editing replaces the surface rather than covering it, as it did on the page
  // this replaces. The surface has no Shell above it any more, so the frame and
  // its way out come with it.
  if (editingItem) {
    return (
      <div className="flex h-dvh flex-col overflow-y-auto bg-bg text-text">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <span className="truncate font-semibold lg:hidden">{item.name}</span>
          <Button className="ml-auto" onClick={() => setEditingItem(false)}>
            Close
          </Button>
        </div>
        <div className="mx-auto w-full max-w-3xl p-4">
          <ItemForm
            item={item}
            onSaved={() => {
              setEditingItem(false)
              refresh()
            }}
            onCancel={() => setEditingItem(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col bg-bg text-text">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        {/* The panel carries the name from `lg` up; below that it is behind a
            toggle, so the top bar has to say what is on screen. */}
        <span className="truncate font-semibold lg:hidden">{item.name}</span>
        <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
          {current && (
            <>
              <Button size="sm" variant="ghost" aria-label="Previous photo" disabled={!canPrevious} onClick={previous}>
                ‹
              </Button>
              <span className="text-sm tabular-nums">
                {index + 1} of {photos.length}
              </span>
              {/* `Set primary` is absent on the primary photo, so this is what
                  keeps "which one is the cover" answerable. */}
              {current.isPrimary && <Badge>Primary</Badge>}
              <Button size="sm" variant="ghost" aria-label="Next photo" disabled={!canNext} onClick={next}>
                ›
              </Button>
            </>
          )}
        </div>
        <Button size="sm" className="lg:hidden" aria-expanded={panelOpen} onClick={() => setPanelOpen((open) => !open)}>
          {panelOpen ? 'Hide details' : 'Details'}
        </Button>
        <Button onClick={close}>Close</Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {current ? (
              // Keyed by photo id so the zoom, the pan and the load state are the
              // new photo's rather than the previous one's.
              <PhotoViewer
                key={current.id}
                src={'/file/' + (current.editedPath ?? current.originalPath)}
                alt={item.name}
              />
            ) : (
              <p className="grid h-full place-items-center text-text-muted">No photos yet.</p>
            )}
            {/* Detection through any provider takes seconds, and the navigation to
                the drafts page only happens on success — so without this there is
                no sign anything is running at all. */}
            {unpack.isPending && (
              <p role="status" className="pointer-events-none absolute inset-0 grid place-items-center bg-black/60 text-sm text-white">
                Unpacking…
              </p>
            )}
          </div>

          {/* A failed run stays on the surface — the navigation happens on
              success — so without this the failure would be silent. */}
          {unpack.error && (
            <p role="alert" className="bg-surface px-3 py-2 text-danger">
              {unpack.error.message}
            </p>
          )}

          {current && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-2">
              <Button onClick={() => setEditingImage({ id: current.id, path: current.editedPath ?? current.originalPath })}>
                Edit photo
              </Button>
              {/* Edits stack on the last edit, so "Edit original photo" only
                  exists once there is an original to go back from — otherwise it
                  is the button beside it under a second name. */}
              {current.editedPath && (
                <>
                  <Button onClick={() => setEditingImage({ id: current.id, path: current.originalPath })}>
                    Edit original photo
                  </Button>
                  {/* An <a>, not a Button — it opens the file in a new tab, which
                      a <button> cannot. This is the UI's only route to the
                      unedited file, and the only reason the rendition above is
                      separate from the path it displays. */}
                  <a
                    href={'/file/' + current.originalPath}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonClasses(), 'no-underline')}
                  >
                    Open original
                  </a>
                </>
              )}
              {!current.isPrimary && (
                <Button
                  disabled={setPrimary.isPending}
                  onClick={() => setPrimary.mutate({ itemId: item.id, imageId: current.id })}
                >
                  Set primary
                </Button>
              )}
              <Button disabled={unpack.isPending} onClick={() => unpack.mutate({ kind: 'item', imageId: current.id })}>
                Auto unpack this photo
              </Button>
              <Button onClick={() => setManualImage({ imageId: current.id, originalPath: current.originalPath })}>
                Manual unpack this photo
              </Button>
              {/* A photo is not trashable, so this is permanent (ADR-0004). */}
              <Button
                variant="danger"
                disabled={deleteImage.isPending}
                onClick={() => {
                  if (confirm('Delete this photo?')) deleteImage.mutate({ id: current.id })
                }}
              >
                Delete photo
              </Button>
            </div>
          )}
        </main>

        <ItemPanel
          item={item}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onEdit={() => setEditingItem(true)}
          onTrash={() => {
            if (confirm(`Move "${item.name}" to the trash?`)) trashItem.mutate({ id: itemId })
          }}
          onPhotoAdded={setPendingPhoto}
        />
      </div>

      {editingImage && (
        <PhotoEditor image={editingImage} itemId={item.id} open onClose={() => setEditingImage(null)} />
      )}

      {manualImage && (
        <ManualUnpackModal
          src={'/file/' + manualImage.originalPath}
          onClose={() => setManualImage(null)}
          onSubmit={async (regions) => {
            // Throws on failure, which the modal shows and keeps the drawing for.
            const result = await manualUnpack.mutateAsync({ imageId: manualImage.imageId, regions })
            setManualImage(null)
            // Same convention as the auto path: navigate on the *result*, so a
            // run that yields nothing is not silent here either.
            void utils.drafts.list.invalidate()
            navigate(`/drafts?detected=${result.detected}`)
          }}
        />
      )}
    </div>
  )
}
