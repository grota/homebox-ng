import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import { Badge, Button, Card, Modal, Pagination, PhotoViewer } from '../../ui'
import { useCardPhotoCycling, usePhotoIndex } from '../../lib/photoIndex'
import { flattenLocations, locationPathLabel, type FlatLocation } from '../../lib/locationPath'
import { useUserSettings } from '../../lib/settings/useUserSettings'

// Stable identity, so the peek's memo does not see a new array every render while
// nothing is being peeked at.
const NO_PHOTOS: never[] = []

// `Intl.RelativeTimeFormat` is the platform's own answer to "3 days ago", and it
// handles the pluralisation and the wording. Only three units: a trash is looked
// at within days, and "2 months ago" is the same information as "61 days ago".
const ago = (date: Date, locale: string): string => {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour')
  return rtf.format(-Math.round(hours / 24), 'day')
}

// Everything deleted-but-not-destroyed. Drafts and catalog items appear together,
// each labelled with which it is, because the trash holds both and the restore
// destination is exactly that difference (ADR-0004).
export function TrashPage() {
  const { t, i18n } = useTranslation()
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  // The window is the user's `itemsPerPage` preference; see the items page's note.
  const { itemsPerPage } = useUserSettings()
  const { data, isLoading } = trpc.trash.list.useQuery({ page, pageSize: itemsPerPage })
  // The location tree, so a row can say where the thing came from as a path — which
  // is what tells you whether restoring it is right.
  const locations = trpc.locations.list.useQuery()
  const locationById = new Map(flattenLocations(locations.data ?? []).map((l) => [l.id, l]))
  const refresh = () => void utils.trash.list.invalidate()
  const restore = trpc.trash.restore.useMutation({ onSuccess: refresh })
  const purge = trpc.trash.purge.useMutation({ onSuccess: refresh })
  const purgeAll = trpc.trash.purgeAll.useMutation({ onSuccess: refresh })
  const [busy, setBusy] = useState(false)
  // Which trashed thing is being peeked at, and which of its photos: the card
  // cycles its own photos, so the peek opens on the one that was showing rather
  // than always on the primary and making the reader re-find what they had picked.
  const [peek, setPeek] = useState<{ id: number; index: number } | null>(null)

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / itemsPerPage))

  const peekItem = rows.find((row) => row.id === peek?.id) ?? null
  // Keyed on the *pair*: closing and reopening the same card at a different photo
  // is a different starting position, and `usePhotoIndex` resets on a key change
  // rather than on an effect — so this lands on the right photo in one render
  // instead of painting the primary first and correcting itself.
  const peekPhotos = usePhotoIndex(peekItem?.images ?? NO_PHOTOS, `${peek?.id}:${peek?.index}`, peek?.index)

  const goTo = (next: number, replace = false) => {
    const q = new URLSearchParams(params)
    if (next <= 1) q.delete('page')
    else q.set('page', String(next))
    navigate(`/trash${q.toString() ? `?${q}` : ''}`, { replace })
  }

  // Emptying the last page leaves the URL pointing past the end of the trash.
  useEffect(() => {
    if (data && page > pageCount) goTo(pageCount, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, page, pageCount])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  if (isLoading) return <p>Loading…</p>

  return (
    <section className="space-y-4">
      <h1>{t('trash.title')}</h1>
      <p className="text-sm text-text-muted">{t('trash.explainer')}</p>

      {total === 0 ? (
        <p>{t('trash.empty')}</p>
      ) : (
        <>
          {/* The drafts page's grid, for the same reason: a row spent the page
              width on a 64px thumbnail. */}
          <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
            {rows.map((item) => (
              <li key={item.id}>
                <TrashCard
                  item={item}
                  locationById={locationById}
                  busy={busy}
                  onPeek={(id, index) => setPeek({ id, index })}
                  onRestore={(id) => void run(() => restore.mutateAsync({ id }))}
                  onPurge={(id) => {
                    if (window.confirm(t('trash.purgeOneConfirm', { name: item.name }))) void run(() => purge.mutateAsync({ id }))
                  }}
                />
              </li>
            ))}
          </ul>

          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('trash.purgeAllConfirm', { count: total }))) void run(() => purgeAll.mutateAsync({}))
            }}
          >
            {t('trash.purgeAll', { count: total })}
          </Button>
        </>
      )}

      <Pagination page={page} total={total} pageSize={itemsPerPage} onPage={goTo} />

      {/* A peek, not a surface: it is opened from a list you are returning to, so
          it is the one place an overlay is still the right container (ADR-0005).
          Nothing here acts on the item — no panel, because `items.get` refuses a
          trashed row, and no delete, because a photo is only destroyed by purge.
          The **primary photo** badge is the exception to "acts on nothing", and it
          is below for the reason its own comment gives. */}
      {peekPhotos.current && (
        <Modal open onOpenChange={(next) => { if (!next) setPeek(null) }} title={peekItem?.name ?? ''} size="full">
          <div className="relative h-full w-full bg-black/90">
            <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 p-3">
              {peekPhotos.photos.length > 1 && (
                <>
                  <Button aria-label={t('trash.previousPhoto')} disabled={!peekPhotos.canCycle} onClick={peekPhotos.previous}>
                    ‹
                  </Button>
                  <span className="text-sm text-white tabular-nums">
                    {peekPhotos.index + 1} of {peekPhotos.photos.length}
                  </span>
                  <Button aria-label={t('trash.nextPhoto')} disabled={!peekPhotos.canCycle} onClick={peekPhotos.next}>
                    ›
                  </Button>
                  {/* Trailing the right arrow, as on the item surface. The peek has
                      no `Set primary` — a trashed item's photos cannot be acted on,
                      and `items.get` refuses the row — so this is the only thing
                      that says which photo is the cover, and a reader restoring an
                      item needs to know. */}
                  {peekPhotos.current.isPrimary && (
                    <>
                      <Badge className="hidden sm:inline-block">Primary</Badge>
                      <Badge className="sm:hidden" aria-label="Primary">
                        <span aria-hidden="true">★</span>
                      </Badge>
                    </>
                  )}
                </>
              )}
              <Button className="ml-auto" onClick={() => setPeek(null)}>
                {t('trash.closePeek')}
              </Button>
            </div>
            <PhotoViewer
              key={peekPhotos.current.id}
              src={'/file/' + (peekPhotos.current.editedPath ?? peekPhotos.current.originalPath)}
              alt={peekItem?.name ?? ''}
            />
          </div>
        </Modal>
      )}
    </section>
  )
}

// One trashed thing's card. Its own component because the thumbnail cycles its
// photos — a wheel notch or a swipe over a card you are deciding whether to
// restore is how you look at them — and that position is state, so it cannot live
// in a `.map` in the page body.
function TrashCard({
  item,
  locationById,
  busy,
  onPeek,
  onRestore,
  onPurge,
}: {
  item: { id: number; name: string; published: boolean; locationId: number | null; location: { id: number; name: string } | null; trashedAt: string | null; images: { id: number; originalPath: string; editedPath: string | null; thumbPath: string; isPrimary: boolean | null }[] }
  locationById: Map<number, FlatLocation>
  busy: boolean
  onPeek: (id: number, index: number) => void
  onRestore: (id: number) => void
  onPurge: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const cycle = useCardPhotoCycling(item.images, item.id)

  return (
    <Card className="flex h-full flex-col gap-3">
      {cycle.current ? (
        <button
          type="button"
          aria-label={item.name}
          onClick={() => onPeek(item.id, cycle.index)}
          className="relative block w-full cursor-zoom-in"
          ref={cycle.ref}
          onPointerDown={cycle.onPointerDown}
          onPointerMove={cycle.onPointerMove}
          onKeyDown={cycle.onKeyDown}
          onClickCapture={cycle.onClickCapture}
        >
          <img
            src={`/file/${cycle.current.thumbPath}`}
            alt=""
            className="w-full aspect-square object-contain rounded bg-black"
          />
          {cycle.indicator && (
            <span className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white tabular-nums">
              {cycle.indicator}
            </span>
          )}
        </button>
      ) : (
        <span className="w-full aspect-square rounded bg-surface-raised" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="truncate text-text">{item.name}</p>
        <p className="text-sm text-text-muted">
          {item.published ? t('trash.kindItem') : t('trash.kindDraft')}
          {item.location ? ` · ${locationPathLabel(item.locationId, item.location.name, locationById)}` : ''}
          {item.trashedAt ? ` · ${t('trash.trashedWhen', { when: ago(new Date(item.trashedAt), i18n.language) })}` : ''}
        </p>
      </div>
      {/* Same as the drafts card: wrap rather than overflow, and sit
          on the floor of the card. */}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => onRestore(item.id)}>
          {t('trash.restore')}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => onPurge(item.id)}>
          {t('trash.purgeOne')}
        </Button>
      </div>
    </Card>
  )
}
