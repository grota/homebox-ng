import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import { Button, Card, Pagination } from '../../ui'

const PAGE_SIZE = 20

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

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

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
                      <img src={`/file/${photo.thumbPath}`} className="h-16 w-16 shrink-0 rounded object-cover" alt="" />
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
    </section>
  )
}
