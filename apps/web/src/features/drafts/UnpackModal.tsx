import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'

// Root unpack: upload a clustered photo to POST /upload/unpack, which returns
// { detected, drafts }. The type is chosen from existing item types.
export function UnpackModal({ onUnpacked }: { onUnpacked: (detected: number) => void }) {
  const { t } = useTranslation()
  const types = trpc.itemTypes.list.useQuery()
  const [file, setFile] = useState<File | null>(null)
  const [itemTypeId, setItemTypeId] = useState<number | ''>('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!file) return
    if (itemTypeId === '') { setErr(t('drafts.chooseType')); return }
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('itemTypeId', String(itemTypeId))
      fd.append('photo', file)
      const res = await fetch('/upload/unpack', { method: 'POST', body: fd, credentials: 'include' })
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json() as { detected: number }
      setFile(null)
      onUnpacked(result.detected)
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <h2 className="font-semibold">{t('drafts.unpackTitle')}</h2>
      <input type="file" accept="image/*" onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)} />
      <select value={itemTypeId} onChange={(e) => setItemTypeId(e.target.value ? Number(e.target.value) : '')}>
        <option value="">{t('drafts.chooseType')}</option>
        {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button className="px-3 py-1.5 rounded-md border border-border bg-surface text-text" disabled={busy || !file} onClick={() => void submit()}>{t('drafts.unpack')}</button>
      {err && <p role="alert" className="text-danger">{err}</p>}
    </div>
  )
}
