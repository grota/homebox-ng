import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import { Button, Card, Input, Select } from '../../ui'
import { ManualUnpackModal, type Region } from './ManualUnpackModal'

// Root unpack: upload a clustered photo, then either let the detector find the
// boxes (**auto**) or draw them (**manual**). One photo and one type are shared
// between the two — one mental model, two ways to find things.
export function UnpackModal({ onUnpacked }: { onUnpacked: (detected: number) => void }) {
  const { t } = useTranslation()
  const types = trpc.itemTypes.list.useQuery()
  const [file, setFile] = useState<File | null>(null)
  const [itemTypeId, setItemTypeId] = useState<number | ''>('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(false)

  // The modal draws on a local object URL, so nothing is uploaded until the user
  // submits. That is what keeps an abandoned modal from leaving an orphaned
  // photo on disk.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const submitAuto = async () => {
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

  // Throws on failure so the modal can show it and keep the drawing; the caller
  // closes itself on success.
  const submitManual = async (regions: Region[]) => {
    if (!file) return
    const fd = new FormData()
    fd.append('itemTypeId', String(itemTypeId))
    fd.append('regions', JSON.stringify(regions))
    fd.append('photo', file)
    const res = await fetch('/upload/unpack/manual', { method: 'POST', body: fd, credentials: 'include' })
    if (!res.ok) throw new Error(await res.text())
    const result = await res.json() as { detected: number }
    setManual(false)
    setFile(null)
    onUnpacked(result.detected)
  }

  const openManual = () => {
    if (itemTypeId === '') { setErr(t('drafts.chooseType')); return }
    setErr(null)
    setManual(true)
  }

  return (
    <>
      <Card className="space-y-3">
        <h2 className="font-semibold">{t('drafts.unpackTitle')}</h2>
        <Input type="file" accept="image/*" onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)} />
        <Select value={itemTypeId} onChange={(e) => setItemTypeId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">{t('drafts.chooseType')}</option>
          {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <div className="flex gap-2">
          <Button variant="primary" disabled={busy || !file} onClick={() => void submitAuto()}>{t('drafts.unpackAuto')}</Button>
          <Button disabled={busy || !file} onClick={openManual}>{t('drafts.unpackManual')}</Button>
        </div>
        {err && <p role="alert" className="text-danger">{err}</p>}
      </Card>

      {manual && preview && (
        <ManualUnpackModal src={preview} onSubmit={submitManual} onClose={() => setManual(false)} />
      )}
    </>
  )
}
