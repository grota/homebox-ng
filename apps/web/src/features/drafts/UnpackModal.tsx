import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
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

  const allTypes = types.data ?? []
  // With exactly one type there is nothing to choose, so it is already chosen —
  // opening a select whose only option is the one you must pick is a step that
  // can only go wrong. Derived rather than copied into state by an effect: the
  // query resolves after the first render, so an effect would add a second render
  // and leave a window in which the form says "choose a type" while the one type
  // sits right there. A real choice still wins, the moment it is made.
  const selectedTypeId: number | '' =
    itemTypeId === '' && allTypes.length === 1 ? allTypes[0].id : itemTypeId

  const manualRef = useRef<HTMLButtonElement>(null)

  // Choosing a photo is the last step before choosing *how* to unpack, and the
  // native picker leaves focus on itself — so it is handed to the first of the
  // two actions, and the next move is a keystroke rather than a trip to the mouse.
  //
  // An effect, not a line in the change handler: the button is `disabled` until
  // the photo reaches state, and a disabled button cannot take focus, so
  // focusing inline does nothing at all — in a browser as much as in a test.
  // Guarded on `file` because the field is also cleared after a successful
  // unpack, which must not move focus.
  useEffect(() => {
    if (file) manualRef.current?.focus()
  }, [file])

  // One message per reason, because they are different problems with different
  // fixes: "choose a type" is useless advice on an instance that has none to
  // choose from, and it is the answer both actions used to give.
  const typeError = () => (allTypes.length === 0 ? t('drafts.noTypes') : t('drafts.chooseType'))

  const submitAuto = async () => {
    if (!file) return
    if (selectedTypeId === '') { setErr(typeError()); return }
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('itemTypeId', String(selectedTypeId))
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
    fd.append('itemTypeId', String(selectedTypeId))
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
    if (selectedTypeId === '') { setErr(typeError()); return }
    setErr(null)
    setManual(true)
  }

  return (
    <>
      <Card className="space-y-3">
        <h2 className="font-semibold">{t('drafts.unpackTitle')}</h2>
        {/* One row: the photo, the type, and both ways to unpack. They are one
            decision seen at once — the same file and the same type feed either
            action — so they read as a single control group rather than as a form
            you fill in and then act on. Manual comes first because it is the one
            that opens another surface; auto resolves where it stands.
            `flex-wrap` rather than a hard one-line rule: the row is wider than a
            phone, and wrapping keeps every control usable there instead of
            squeezing them into a strip. */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            accept="image/*"
            // `min-w-0` lets the native control shrink below its intrinsic width
            // rather than forcing the row wider than the card.
            className="min-w-0"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)}
          />
          <Select
            value={selectedTypeId}
            onChange={(e) => setItemTypeId(e.target.value ? Number(e.target.value) : '')}
            // Nothing to choose from, and the line below says so; a live control
            // that opens onto an empty list reads as a rendering bug.
            disabled={allTypes.length === 0}
          >
            <option value="">{t('drafts.chooseType')}</option>
            {allTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          {/* The pair wraps together. Left as loose siblings, a narrow screen
              broke them across two lines — select + Manual, then Auto alone —
              which separates two actions that differ only in where the boxes
              come from. */}
          <div className="flex gap-2">
            {/* Manual carries the emphasis: it is first, and it is where focus
                lands once a photo is chosen. */}
            <Button ref={manualRef} variant="primary" disabled={busy || !file} onClick={openManual}>
              {t('drafts.unpackManual')}
            </Button>
            {/* Detection takes seconds and nothing else on the page moves while
                it runs, so the button says what is happening rather than going
                quiet. */}
            <Button disabled={busy || !file} onClick={() => void submitAuto()}>
              {busy ? t('drafts.unpacking') : t('drafts.unpackAuto')}
            </Button>
          </div>
        </div>

        {/* An unseeded instance has no types, so unpacking cannot finish however
            good the photo is. Said here, beside the controls, rather than only
            after a failed submit — and with the way out. */}
        {allTypes.length === 0 && (
          <p className="text-text-muted text-sm">
            {t('drafts.noTypes')} <Link to="/types">{t('drafts.createOne')}</Link>
          </p>
        )}
        {err && <p role="alert" className="text-danger">{err}</p>}
      </Card>

      {manual && preview && (
        <ManualUnpackModal src={preview} onSubmit={submitManual} onClose={() => setManual(false)} />
      )}
    </>
  )
}
