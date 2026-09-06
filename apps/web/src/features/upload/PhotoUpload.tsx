import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { trpc } from '../../api/trpc'

type PhotoUploadProps = { itemId: number }

// Multipart upload to `POST /upload/image`. Sends an `itemId` text field plus
// the file; the browser sets the multipart boundary (no manual Content-Type).
// On success the item's list/get queries are invalidated so thumbnails refresh.
export function PhotoUpload({ itemId }: PhotoUploadProps) {
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
      const formData = new FormData()
      formData.append('itemId', String(itemId))
      formData.append('file', file)
      const res = await fetch('/upload/image', { method: 'POST', body: formData, credentials: 'include' })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      await res.json()
      utils.items.list.invalidate()
      utils.items.get.invalidate({ id: itemId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="my-4">
      <input ref={inputRef} type="file" accept="image/*" aria-label="Upload photo" onChange={handleFile} />
      {uploading && <p>Uploading…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
