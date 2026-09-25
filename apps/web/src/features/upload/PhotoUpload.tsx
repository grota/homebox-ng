import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { trpc } from '../../api/trpc'
import { inputClass } from '../../ui'

type PhotoUploadProps = {
  itemId: number
  /**
   * The image row the upload created. The item surface needs it to move to the
   * photo the user just added; the create form has nowhere to move to and omits
   * it.
   */
  onUploaded?: (image: { id: number }) => void
}

// Multipart upload to `POST /upload/image`. Sends an `itemId` text field plus
// the file; the browser sets the multipart boundary (no manual Content-Type).
//
// Exported because the create form can only upload *after* `items.create`
// returns the new item's id — the id is the one input this needs that doesn't
// exist until the item does. Callers invalidate their own queries.
export async function uploadImage(itemId: number, file: File): Promise<{ id: number } | null> {
  const formData = new FormData()
  formData.append('itemId', String(itemId))
  formData.append('file', file)
  const res = await fetch('/upload/image', { method: 'POST', body: formData, credentials: 'include' })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  // The endpoint replies with the inserted row. Parsed defensively: the caller
  // that wants the id can have it, and a caller that doesn't cannot be broken by
  // it not being there.
  return (await res.json()) as { id: number }
}

// Uploads immediately on pick. On success the item's list/get queries are
// invalidated so thumbnails refresh.
export function PhotoUpload({ itemId, onUploaded }: PhotoUploadProps) {
  const utils = trpc.useUtils()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      const image = await uploadImage(itemId, file)
      utils.items.list.invalidate()
      utils.items.get.invalidate({ id: itemId })
      if (image) onUploaded?.(image)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="my-4">
      {/* `inputClass` rather than the `Input` primitive: the `ref` is here to clear the
          element's value after each pick. */}
      <input ref={inputRef} type="file" accept="image/*" aria-label="Upload photo" onChange={handleFile} className={inputClass} />
      {uploading && <p>Uploading…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
