import { useState } from 'react'
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

export function PhotoEditor({ image, itemId, open, onClose }: PhotoEditorProps) {
  const utils = trpc.useUtils()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleSave = async (imageData: SaveImageData) => {
    setSaving(true)
    setError(null)
    try {
      const blob = await toBlob(imageData)
      if (!blob) throw new Error('Editor produced no image')
      const form = new FormData()
      form.append('imageId', String(image.id))
      form.append('file', blob, 'edited.png')
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
      <div className="h-[70vh]">
        <FilerobotImageEditor
          source={'/file/' + image.path}
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
          savingPixelRatio={4}
          previewPixelRatio={window.devicePixelRatio || 1}
        />
      </div>
    </Modal>
  )
}
