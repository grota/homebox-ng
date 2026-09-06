import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import { UnpackModal } from './UnpackModal'

export function DraftsPage() {
  const { t } = useTranslation()
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const { data, isLoading } = trpc.drafts.list.useQuery()
  const update = trpc.drafts.update.useMutation()
  const publish = trpc.drafts.publish.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const publishAll = trpc.drafts.publishAll.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const discard = trpc.drafts.discard.useMutation({ onSuccess: () => void utils.drafts.list.invalidate() })
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = (data?.length ?? 0) > 0 && selected.size === data?.length

  if (isLoading) return <p>Loading…</p>
  if (!data || data.length === 0) return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('drafts.title')}</h1>
      <UnpackModal onUnpacked={(n) => navigate(`/drafts?detected=${n}`)} />
      <p>{t('drafts.empty')}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('drafts.title')}</h1>
      <UnpackModal onUnpacked={(n) => navigate(`/drafts?detected=${n}`)} />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={allSelected} onChange={() => { const ids = data.map((d) => d.id); setSelected(allSelected ? new Set() : new Set(ids)) }} />
          {t('drafts.selectAll')}
        </label>
        <button className="px-3 py-1.5 rounded-md border border-border bg-surface text-text" disabled={selected.size === 0} onClick={() => void publishAll.mutateAsync({ ids: [...selected] })}>
          {t('drafts.publishSelected')}
        </button>
      </div>
      <ul className="space-y-3">
        {data.map((d) => (
          <li key={d.id} className="flex items-center gap-3 border border-border rounded-md p-3">
            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
            <img src={`/file/${d.images.find((i) => i.isPrimary)?.thumbPath ?? d.images[0]?.thumbPath}`} className="w-16 h-16 object-cover rounded" alt="" />
            <input
              className="px-2 py-1 border border-border rounded-md bg-surface text-text flex-1"
              defaultValue={d.name}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value !== d.name) void update.mutateAsync({ id: d.id, name: e.target.value.trim() }) }}
            />
            <button className="px-3 py-1.5 rounded-md border border-border bg-surface text-text" onClick={() => void publish.mutateAsync({ id: d.id })}>{t('drafts.publish')}</button>
            <button className="px-3 py-1.5 rounded-md border border-border text-red-600" onClick={() => void discard.mutateAsync({ id: d.id })}>{t('drafts.discard')}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
