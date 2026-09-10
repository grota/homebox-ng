import { useState } from 'react'
import FilerobotImageEditor from 'react-filerobot-image-editor'
import { trpc } from '../../api/trpc'
import { Modal } from '../../ui'

type PhotoEditorProps = { image: { id: number; originalPath: string }; itemId: number; open: boolean; onClose: () => void }
type SaveImageData = { imageCanvas?: HTMLCanvasElement; imageBase64?: string; mimeType?: string }

// Derive a Blob from filerobot's `imageData`. Prefer the canvas (accurate size),
// fall back to decoding the base64 data URL.
const toBlob = (imageData: SaveImageData): Promise<Blob | null> => {
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
      <FilerobotImageEditor
        source={'/file/' + image.originalPath}
        onSave={handleSave}
        onClose={onClose}
        savingPixelRatio={4}
        previewPixelRatio={window.devicePixelRatio || 1}
      />
    </Modal>
  )
}
