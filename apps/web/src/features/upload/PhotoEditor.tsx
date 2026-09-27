import { useEffect, useRef, useState, type RefObject } from 'react'
import FilerobotImageEditor, { TABS, TOOLS } from 'react-filerobot-image-editor'
import { trpc } from '../../api/trpc'
import { Modal } from '../../ui'

// `path` is whichever rendition this session edits: the item page's "Edit photo"
// passes the edited file when there is one, "Edit original photo" passes the
// original. Saving always writes a NEW `editedPath`, so either way the original
// on disk is never overwritten.
type PhotoEditorProps = { image: { id: number; path: string }; itemId: number; open: boolean; onClose: () => void }
export type SaveImageData = { imageCanvas?: HTMLCanvasElement; imageBase64?: string; mimeType?: string }

// The tabs this app wants, in the order it wants them. Filerobot shows only what is
// listed here, in this order — `[]` is not "none", it is "everything", so the set has
// to be spelled out. Filters and Watermark are deliberately absent. Annotate leads
// because marking where a thing is on a photo is what these photos are for.
const TABS_IDS = [TABS.ANNOTATE, TABS.ADJUST, TABS.RESIZE, TABS.FINETUNE]

// What the Annotate tab's Text tool drops on the canvas. Filerobot's default is
// a lorem-ipsum sentence at 14px; marking where a thing is on a photo wants one
// character big enough to read at thumbnail size. Merged over the defaults
// (AssemblyPoint deep-merges `config` over `defaultConfig`), so `fonts`,
// `align` and the rest survive; the options panel still clamps 1–500.
const TEXT_DEFAULTS = { text: 'X', fontSize: 120 }

// Derive a Blob from filerobot's `imageData`. Prefer the canvas (accurate size),
// fall back to decoding the base64 data URL. Exported because the crop step needs the
// same conversion with a destination of its own: `PhotoEditor` posts its blob against
// an `imageId`, and `PhotoCrop` has no id to post against yet.
export const toBlob = (imageData: SaveImageData): Promise<Blob | null> => {
  if (imageData.imageCanvas) {
    return new Promise((resolve) => imageData.imageCanvas!.toBlob((b) => resolve(b), imageData.mimeType ?? 'image/png'))
  }
  if (imageData.imageBase64) {
    const base64 = imageData.imageBase64.split(',')[1] ?? imageData.imageBase64
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return Promise.resolve(new Blob([bytes], { type: imageData.mimeType ?? 'image/png' }))
  }
  return Promise.resolve(null)
}

// The filename extension for a blob's type. Filerobot's save-as menu offers jpeg, jpg, png
// and webp, and its `mimeType` is `'image/' + the chosen extension` — so `image/jpg`, not
// `image/jpeg`, is a real value here. The blob's own type is what the browser actually
// produced (a canvas asked for an unknown type falls back to PNG), so it is the only
// trustworthy source for the name.
const EXT_FOR_TYPE: Record<string, string | undefined> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
export const filenameForBlob = (blob: Blob, stem: string) => `${stem}.${EXT_FOR_TYPE[blob.type] ?? 'jpg'}`

// Filerobot's export canvas is always full resolution — Konva's `toCanvas` falls
// back to a pixel ratio of 1, not to `savingPixelRatio` — but what it DRAWS into
// that canvas is a cache of the photo as it fits the editor's stage, at
// `savingPixelRatio` × that size (`Konva.pixelRatio` is set to it right before the
// cache). A static ratio therefore saves a stage-sized bitmap blown up to
// full-size pixels: full-resolution files with only a screenful of real detail.
// The ratio that fixes it is the photo's pixels over the stage's, whichever they
// happen to be.
export const savingPixelRatioFor = (
  stage: { width: number; height: number },
  natural: { width: number; height: number },
): number => {
  // Integer scale: the cache is stage × ratio, so ceil guarantees photo-dense
  // coverage on the binding edge; a zero-size stage (pre-layout) stays at 1.
  if (!Number.isFinite(stage.width) || !Number.isFinite(stage.height) || stage.width <= 0 || stage.height <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(natural.width / stage.width, natural.height / stage.height)))
}

// The measured ratio above, for an editor rendering inside `hostRef`. The photo's
// own pixels come from the same source the editor opens; the stage only exists
// once that source has loaded into it, so measure across the next frames until it
// does, and again whenever the host is resized.
const MAX_MEASURE_FRAMES = 180
export const useSavingPixelRatio = (hostRef: RefObject<HTMLElement | null>, source: string | null): number => {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [ratio, setRatio] = useState(1)

  useEffect(() => {
    if (!source) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setNatural({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = source
    return () => {
      cancelled = true
    }
  }, [source])

  useEffect(() => {
    if (!natural) return
    const measure = (): boolean => {
      const box = hostRef.current?.querySelector('.konvajs-content')?.getBoundingClientRect()
      if (!box?.width || !box.height) return false
      setRatio(savingPixelRatioFor({ width: box.width, height: box.height }, natural))
      return true
    }
    let raf = 0
    let attempts = 0
    const tick = () => {
      if (measure()) return
      if (++attempts > MAX_MEASURE_FRAMES) {
        // ponytail: warn-only fallback, old soft-save bug returns if stage never lays out
        console.warn('[photo] stage never laid out, saving at pixel ratio 1')
        return
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    const observer = new ResizeObserver(() => measure())
    if (hostRef.current) observer.observe(hostRef.current)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [natural, hostRef])

  return ratio
}

export function PhotoEditor({ image, itemId, open, onClose }: PhotoEditorProps) {
  const utils = trpc.useUtils()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const source = '/file/' + image.path
  const savingPixelRatio = useSavingPixelRatio(hostRef, open ? source : null)

  if (!open) return null

  const handleSave = async (imageData: SaveImageData) => {
    setSaving(true)
    setError(null)
    try {
      const blob = await toBlob(imageData)
      if (!blob) throw new Error('Editor produced no image')
      const form = new FormData()
      form.append('imageId', String(image.id))
      form.append('file', blob, filenameForBlob(blob, 'edited'))
      const res = await fetch('/upload/image/edit', { method: 'POST', body: form, credentials: 'include' })
      if (!res.ok) throw new Error(`Save failed: ${res.status}`)
      utils.items.list.invalidate()
      utils.items.get.invalidate({ id: itemId })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose() }} title="Edit photo">
      {error && <p role="alert" className="text-danger">{error}</p>}
      {saving && <p>Saving…</p>}
      {/* The editor sizes itself to 100% of its parent and gives up entirely when
          that parent has no height — inside a `height: auto` dialog it collapsed
          to its own 250px `min-height`, leaving the photo a postage stamp. A
          definite height here is the whole fix. */}
      <div className="h-[70vh]" ref={hostRef}>
        <FilerobotImageEditor
          source={source}
          onSave={handleSave}
          onClose={onClose}
          tabsIds={TABS_IDS}
          // `TABS_IDS[0]` rather than a named tab: the array is the one place the order
          // lives, so reordering it re-defaults the editor and the two cannot drift.
          // Left alone, the library's own default is `Adjust`, which is why this opened
          // on the second tab without the app ever asking for it.
          defaultTabId={TABS_IDS[0]}
          // Required, not decoration: the library's default tool is `Crop`, which the
          // Annotate tab does not carry, so the tab would open with nothing highlighted
          // and no options panel. `Text` is that tab's first tool and the one
          // `TEXT_DEFAULTS` below already configures.
          defaultToolId={TOOLS.TEXT}
          Text={TEXT_DEFAULTS}
          // Measured, not guessed: what keeps the saved rendition's pixels the
          // photo's own rather than a screenful blown up — see
          // `savingPixelRatioFor`.
          savingPixelRatio={savingPixelRatio}
          previewPixelRatio={window.devicePixelRatio || 1}
        />
      </div>
    </Modal>
  )
}
