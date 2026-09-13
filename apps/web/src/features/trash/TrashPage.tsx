import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import { Button, Card, Modal, Pagination, PhotoViewer } from '../../ui'
import { usePhotoIndex } from '../../lib/photoIndex'

const PAGE_SIZE = 20

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
  const { data, isLoading } = trpc.trash.list.useQuery({ page, pageSize: PAGE_SIZE })
  const refresh = () => void utils.trash.list.invalidate()
  const restore = trpc.trash.restore.useMutation({ onSuccess: refresh })
  const purge = trpc.trash.purge.useMutation({ onSuccess: refresh })
  const purgeAll = trpc.trash.purgeAll.useMutation({ onSuccess: refresh })
  const [busy, setBusy] = useState(false)
  // Which trashed thing is being peeked at. The index is deliberately not part of
  // this: it lives in `usePhotoIndex` and resets on the id.
  const [peekId, setPeekId] = useState<number | null>(null)

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const peekItem = rows.find((row) => row.id === peekId) ?? null
  const peek = usePhotoIndex(peekItem?.images ?? NO_PHOTOS, peekId)

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
          <ul className="space-y-3">
            {rows.map((item) => {
              const photo = item.images.find((i) => i.isPrimary) ?? item.images[0]
              return (
                <li key={item.id}>
                  <Card className="flex items-center gap-3">
                    {photo ? (
                      <button
                        type="button"
                        aria-label={item.name}
                        onClick={() => setPeekId(item.id)}
                        className="shrink-0 cursor-zoom-in"
                      >
                        <img src={`/file/${photo.thumbPath}`} className="h-16 w-16 shrink-0 rounded object-cover" alt="" />
                      </button>
                    ) : (
                      <span className="h-16 w-16 shrink-0 rounded bg-surface-raised" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-text">{item.name}</p>
                      <p className="text-sm text-text-muted">
                        {item.published ? t('trash.kindItem') : t('trash.kindDraft')}
                        {item.trashedAt ? ` · ${t('trash.trashedWhen', { when: ago(new Date(item.trashedAt), i18n.language) })}` : ''}
                      </p>
                    </div>
                    <Button disabled={busy} onClick={() => void run(() => restore.mutateAsync({ id: item.id }))}>
                      {t('trash.restore')}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t('trash.purgeOneConfirm', { name: item.name }))) void run(() => purge.mutateAsync({ id: item.id }))
                      }}
                    >
                      {t('trash.purgeOne')}
                    </Button>
                  </Card>
                </li>
              )
            })}
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

      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={goTo} />

      {/* A peek, not a surface: it is opened from a list you are returning to, so
          it is the one place an overlay is still the right container (ADR-0005).
          Nothing here acts on the item — no panel, because `items.get` refuses a
          trashed row, and no delete, because a photo is only destroyed by purge. */}
      {peek.current && (
        <Modal open onOpenChange={(next) => { if (!next) setPeekId(null) }} title={peekItem?.name ?? ''} size="full">
          <div className="relative h-full w-full bg-black/90">
            <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 p-3">
              {peek.photos.length > 1 && (
                <>
                  <Button aria-label={t('trash.previousPhoto')} disabled={!peek.canPrevious} onClick={peek.previous}>
                    ‹
                  </Button>
                  <span className="text-sm text-white tabular-nums">
                    {peek.index + 1} of {peek.photos.length}
                  </span>
                  <Button aria-label={t('trash.nextPhoto')} disabled={!peek.canNext} onClick={peek.next}>
                    ›
                  </Button>
                </>
              )}
              <Button className="ml-auto" onClick={() => setPeekId(null)}>
                {t('trash.closePeek')}
              </Button>
            </div>
            <PhotoViewer
              key={peek.current.id}
              src={'/file/' + (peek.current.editedPath ?? peek.current.originalPath)}
              alt={peekItem?.name ?? ''}
            />
          </div>
        </Modal>
      )}
    </section>
  )
}
