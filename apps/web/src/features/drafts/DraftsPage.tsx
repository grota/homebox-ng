import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUserSettings, useTrashConfirmation } from '../../lib/settings/useUserSettings'
import { trpc } from '../../api/trpc'
import { Button, Card, Input, Pagination } from '../../ui'
import { UnpackModal } from './UnpackModal'
import { flattenLocations, locationPathLabel, type FlatLocation } from '../../lib/locationPath'
import { useCardPhotoCycling } from '../../lib/photoIndex'

export function DraftsPage() {
  const { t } = useTranslation()
  // The window is the user's `itemsPerPage` preference; see the items page's note.
  const { itemsPerPage } = useUserSettings()
  // Whether this user wants to be asked before a move-to-trash, at all three
  // sites on this page.
  const askTrash = useTrashConfirmation()
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  // `UnpackModal.onUnpacked` below writes `?detected=<n>`, and this is the other
  // half of that handshake — read, then dropped from the URL, so the notice
  // describes an event rather than the address bar.
  //
  // `null` when the parameter is absent *or* blank and `NaN` when it is not a
  // number: the cases that render nothing. Blank counts as absent rather than as
  // zero — `?detected=` is a hand-edited URL, the one input this guard exists
  // for, and `Number('')` is a perfectly real `0` that would otherwise be read
  // as "the unpack ran and found nothing". A real `0` stays distinct from both —
  // it is the outcome that carries the most information, so it must not be
  // swallowed by an absent case's `?? 0`.
  //
  // Capture on mount: the notice must survive the URL rewrite below, which is
  // what removes the parameter from the URL so a reload does not re-trigger it.
  const [params] = useSearchParams()
  const [detected, setDetected] = useState(() => params.get('detected'))
  const count = detected === null || detected.trim() === '' ? null : Number(detected)
  // The page lives in the URL, like the items page, so a refresh or a Back keeps
  // it and the two pages behave the same way.
  const page = Math.max(1, Number(params.get('page')) || 1)
  const { data, isLoading } = trpc.drafts.list.useQuery({ page, pageSize: itemsPerPage })
  // The location tree, so a draft's line can show its whole path rather than the
  // leaf name — the same argument the catalog card makes.
  const locations = trpc.locations.list.useQuery()
  const locationById = new Map(flattenLocations(locations.data ?? []).map((l) => [l.id, l]))
  const update = trpc.drafts.update.useMutation()
  const publish = trpc.drafts.publish.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const trashOne = trpc.drafts.trash.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Both bulk actions clear the selection on success, as the spec requires — and
  // for the same reason: `selected` is never pruned when the list refetches, so
  // an id that survived a successful bulk action would be sent again by the next
  // one. Clearing here is also the first of the two layers that keep a bulk
  // trash from being half-applied; `trashAll`'s tolerance is the second.
  const publishAll = trpc.drafts.publishAll.useMutation({
    onSuccess: () => {
      setSelected(new Set())
      void utils.drafts.list.invalidate()
    },
  })
  const trashAll = trpc.drafts.trashAll.useMutation({
    onSuccess: () => {
      setSelected(new Set())
      void utils.drafts.list.invalidate()
    },
  })

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const allSelected = rows.length > 0 && selected.size === rows.length
  const pageCount = Math.max(1, Math.ceil(total / itemsPerPage))

  const setPage = (next: number) => {
    const q = new URLSearchParams(params)
    if (next <= 1) q.delete('page')
    else q.set('page', String(next))
    navigate(`/drafts${q.toString() ? `?${q}` : ''}`)
  }

  // Selection is page-scoped: it is cleared when the page changes rather than
  // carried across, so "Move selected to trash" can never act on rows the user
  // cannot see. The set is already never pruned on refetch, and a cross-page
  // version of it would be the same hazard with more reach.
  useEffect(() => { setSelected(new Set()) }, [page])

  // Landing on a page that no longer exists — after trashing everything on the
  // last one, say — would otherwise render "No drafts" under a non-empty list.
  useEffect(() => {
    if (data && page > pageCount) setPage(pageCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, page, pageCount])

  // Dropping the parameter is what makes the notice describe an event rather than
  // the address bar: a reload starts clean. `replace` keeps the pre-rewrite URL
  // out of history, so Back does not land on it and re-show the notice.
  //
  // The unpack runs *on this page*, so its navigation is a search change on a
  // mounted `DraftsPage`, not a fresh mount — the initial state above cannot see
  // that one, and capturing here too is what covers it. Both paths then rewrite
  // the URL, and the captured value is what keeps the notice on screen after it.
  // `page` is preserved: dropping it would silently bounce a paginated user back
  // to page 1 every time an unpack landed.
  useEffect(() => {
    const value = params.get('detected')
    if (value === null) return
    setDetected(value)
    const q = new URLSearchParams(params)
    q.delete('detected')
    navigate(`/drafts${q.toString() ? `?${q}` : ''}`, { replace: true })
  }, [params, navigate])

  // `false` renders nothing, so one definition serves both branches: the notice
  // sits directly under the heading — above the Unpack modal in the empty state,
  // above the select-all toolbar once drafts exist — so the page does not reflow
  // as the list fills or empties. Three outcomes, spelled out rather than folded
  // into one comparison: an absent or malformed parameter renders nothing (blank
  // is malformed, not a zero — see the `count` above), a
  // positive count names the number, and a zero takes the danger colour — it is
  // the one result the user has to act on, since a photo that yields nothing
  // otherwise leaves no error and no file to look at.
  const detectedNotice =
    count === null || Number.isNaN(count) ? false
    : count > 0 ? <p role="status">{t('drafts.unpacked', { count })}</p>
    : <p role="status" className="text-danger">{t('drafts.unpackedNone')}</p>

  if (isLoading) return <p>Loading…</p>
  // `total`, not the page's row count: a page past the end has no rows either,
  // and "No drafts" under a list of forty is a lie.
  if (total === 0) return (
    <div className="space-y-4">
      <h1>{t('drafts.title')}</h1>
      {detectedNotice}
      <UnpackModal onUnpacked={(n) => { void utils.drafts.list.invalidate(); navigate(`/drafts?detected=${n}`) }} />
      <p>{t('drafts.empty')}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <h1>{t('drafts.title')}</h1>
      {detectedNotice}
      <UnpackModal onUnpacked={(n) => { void utils.drafts.list.invalidate(); navigate(`/drafts?detected=${n}`) }} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={allSelected} onChange={() => { setSelected(allSelected ? new Set() : new Set(rows.map((d) => d.id))) }} />
          {t('drafts.selectAll')}
        </label>
        <Button disabled={selected.size === 0} onClick={() => void publishAll.mutateAsync({ ids: [...selected] })}>
          {t('drafts.publishSelected')}
        </Button>
        <Button
          variant="danger"
          disabled={selected.size === 0}
          onClick={() => {
            if (askTrash(t('drafts.trashSelectedConfirm', { count: selected.size }))) void trashAll.mutateAsync({ ids: [...selected] })
          }}
        >
          {t('drafts.trashSelected')}
        </Button>
      </div>

      {/* The whole set, not the page. A checkbox that silently spans pages would
          act on rows the user cannot review, so the capability is spelled out as
          two verbs that name what they do — and the server's existing "no ids
          means every draft" branch is what they call. */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-text-muted">{t('drafts.everything')}</span>
        <Button onClick={() => void publishAll.mutateAsync({})}>{t('drafts.publishAll', { count: total })}</Button>
        <Button
          variant="danger"
          onClick={() => {
            if (askTrash(t('drafts.trashAllConfirm', { count: total }))) void trashAll.mutateAsync({})
          }}
        >
          {t('drafts.trashAll', { count: total })}
        </Button>
      </div>

      {/* A card per draft rather than a row each. A row spent the whole page width
          on one 64px thumbnail and handed all the slack to the name field; a card
          shows the photo at a size you can actually recognise and then gets out of
          the way. The grid is the catalog's, so an item card and a draft card are
          the same size and shape. */}
      <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        {rows.map((d) => (
          <li key={d.id}>
            <DraftCard
              draft={d}
              locationById={locationById}
              selected={selected.has(d.id)}
              onToggle={() => toggle(d.id)}
              onRename={(name) => update.mutateAsync({ id: d.id, name })}
              onPublish={() => publish.mutateAsync({ id: d.id })}
              onTrash={() => {
                if (askTrash(t('drafts.trashConfirm', { name: d.name }))) void trashOne.mutateAsync({ id: d.id })
              }}
            />
          </li>
        ))}
      </ul>

      <Pagination page={page} total={total} pageSize={itemsPerPage} onPage={setPage} />
    </div>
  )
}

// One draft's card. Its own component because the thumbnail cycles its photos — a
// draft can carry the crops an unpack made of the same photo, so it can have
// several, and looking at them is what tells you whether to publish — and that
// position is state, so it cannot live in a `.map` in the page body.
function DraftCard({
  draft: d,
  locationById,
  selected,
  onToggle,
  onRename,
  onPublish,
  onTrash,
}: {
  draft: {
    id: number
    name: string
    locationId: number | null
    location: { id: number; name: string } | null
    images: { thumbPath: string; isPrimary: boolean | null }[]
  }
  locationById: Map<number, FlatLocation>
  selected: boolean
  onToggle: () => void
  onRename: (name: string) => Promise<unknown>
  onPublish: () => Promise<unknown>
  onTrash: () => void
}) {
  const { t } = useTranslation()
  const cycle = useCardPhotoCycling(d.images, d.id)

  return (
    <Card className="flex h-full flex-col gap-3">
      {/* The thumbnail opens the draft's own surface, the same one the catalog's
          cards open. Opening a lightbox here instead would leave the drafts page
          with a second, poorer photo experience — no per-photo actions and no way
          to publish from it. */}
      {cycle.current ? (
        <Link
          to={`/items/${d.id}`}
          aria-label={`Open ${d.name}`}
          className="relative block"
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
        </Link>
      ) : (
        <span className="w-full aspect-square rounded bg-surface-raised" aria-hidden />
      )}
      <Input
        defaultValue={d.name}
        onBlur={(e) => { if (e.target.value.trim() && e.target.value !== d.name) void onRename(e.target.value.trim()) }}
      />
      {/* Where it belongs, as a path: a draft's location is the thing you
          check before publishing it into a shared catalog, and the leaf
          alone does not say which `garage`. No overlay covers this card, so
          the native tooltip fires straight off the line. */}
      {d.location ? (
        <p
          className="truncate text-sm text-text-muted"
          data-testid="draft-location"
          title={locationPathLabel(d.locationId, d.location.name, locationById)}
        >
          {locationPathLabel(d.locationId, d.location.name, locationById)}
        </p>
      ) : null}
      {/* `flex-wrap` rather than a hard one-line row: a card this narrow
          cannot always fit a checkbox and two labels side by side, and
          stacking reads better than overflowing. `mt-auto` keeps the
          controls on the floor of every card in the row, so a long name
          does not leave them floating at different heights. */}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <Button onClick={() => void onPublish()}>{t('drafts.publish')}</Button>
        <Button variant="danger" onClick={onTrash}>
          {t('drafts.trash')}
        </Button>
      </div>
    </Card>
  )
}
