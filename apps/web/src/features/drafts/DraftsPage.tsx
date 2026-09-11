import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import { Button, Card, Input } from '../../ui'
import { UnpackModal } from './UnpackModal'

export function DraftsPage() {
  const { t } = useTranslation()
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  // `UnpackModal.onUnpacked` below writes `?detected=<n>`, and this is the other
  // half of that handshake — read, then dropped from the URL, so the notice
  // describes an event rather than the address bar.
  //
  // `null` when the parameter is absent and `NaN` when it is not a number: the
  // two cases that render nothing. A real `0` stays distinct from both — the
  // unpack ran and found nothing, which is the outcome that carries the most
  // information, so it must not be swallowed by an absent case's `?? 0`.
  //
  // Capture on mount: the notice must survive the URL rewrite below, which is
  // what removes the parameter from the URL so a reload does not re-trigger it.
  const [params] = useSearchParams()
  const [detected, setDetected] = useState(() => params.get('detected'))
  const count = detected === null ? null : Number(detected)
  const { data, isLoading } = trpc.drafts.list.useQuery()
  const update = trpc.drafts.update.useMutation()
  const publish = trpc.drafts.publish.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const publishAll = trpc.drafts.publishAll.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const discard = trpc.drafts.discard.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const discardAll = trpc.drafts.discardAll.useMutation({
    onSuccess: () => {
      // `selected` is never pruned when the list refetches, so a discarded id
      // survives in the set and would be sent again by the next bulk action.
      // Clearing here is the first of the two layers that keep a bulk discard
      // from being half-applied; `discardAll`'s tolerance is the second.
      setSelected(new Set())
      void utils.drafts.list.invalidate()
    },
  })

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = (data?.length ?? 0) > 0 && selected.size === data?.length

  // Dropping the parameter is what makes the notice describe an event rather than
  // the address bar: a reload starts clean. `replace` keeps the pre-rewrite URL
  // out of history, so Back does not land on it and re-show the notice.
  //
  // The unpack runs *on this page*, so its navigation is a search change on a
  // mounted `DraftsPage`, not a fresh mount — the initial state above cannot see
  // that one, and capturing here too is what covers it. Both paths then rewrite
  // the URL, and the captured value is what keeps the notice on screen after it.
  useEffect(() => {
    const value = params.get('detected')
    if (value === null) return
    setDetected(value)
    navigate('/drafts', { replace: true })
  }, [params, navigate])

  // `false` renders nothing, so one definition serves both branches: the notice
  // sits directly under the heading — above the Unpack modal in the empty state,
  // above the select-all toolbar once drafts exist — so the page does not reflow
  // as the list fills or empties. Three outcomes, spelled out rather than folded
  // into one comparison: an absent or malformed parameter renders nothing, a
  // positive count names the number, and a zero takes the danger colour — it is
  // the one result the user has to act on, since a photo that yields nothing
  // otherwise leaves no error and no file to look at.
  const detectedNotice =
    count === null || Number.isNaN(count) ? false
    : count > 0 ? <p role="status">{t('drafts.unpacked', { count })}</p>
    : <p role="status" className="text-danger">{t('drafts.unpackedNone')}</p>

  if (isLoading) return <p>Loading…</p>
  if (!data || data.length === 0) return (
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
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={allSelected} onChange={() => { const ids = data.map((d) => d.id); setSelected(allSelected ? new Set() : new Set(ids)) }} />
          {t('drafts.selectAll')}
        </label>
        <Button disabled={selected.size === 0} onClick={() => void publishAll.mutateAsync({ ids: [...selected] })}>
          {t('drafts.publishSelected')}
        </Button>
        <Button
          variant="danger"
          disabled={selected.size === 0}
          onClick={() => {
            if (window.confirm(t('drafts.discardSelectedConfirm', { count: selected.size }))) void discardAll.mutateAsync({ ids: [...selected] })
          }}
        >
          {t('drafts.discardSelected')}
        </Button>
      </div>
      <ul className="space-y-3">
        {data.map((d) => (
          // The `<li>` stays the list item — `Card` renders a `<div>`, and a
          // `<div>` child of `<ul>` would drop the rows' list semantics.
          <li key={d.id}>
            <Card className="flex items-center gap-3">
              <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
              <img src={`/file/${d.images.find((i) => i.isPrimary)?.thumbPath ?? d.images[0]?.thumbPath}`} className="w-16 h-16 object-cover rounded" alt="" />
              <Input
                className="flex-1"
                defaultValue={d.name}
                onBlur={(e) => { if (e.target.value.trim() && e.target.value !== d.name) void update.mutateAsync({ id: d.id, name: e.target.value.trim() }) }}
              />
              <Button onClick={() => void publish.mutateAsync({ id: d.id })}>{t('drafts.publish')}</Button>
              <Button variant="danger" onClick={() => void discard.mutateAsync({ id: d.id })}>{t('drafts.discard')}</Button>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
