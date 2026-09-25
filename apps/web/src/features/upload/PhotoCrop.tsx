import { useEffect, useState } from 'react'
import FilerobotImageEditor, { TABS } from 'react-filerobot-image-editor'
import { Modal } from '../../ui'
import { toBlob, type SaveImageData } from './PhotoEditor'

// The tabs a crop step wants: ADJUST, which is crop, rotate and flip. With one tab the
// library renders no tab strip, and its own `defaultToolId` (crop) is the one tool this
// tab leads with — so this is the editor with less of it, not a second crop build.
const CROP_TABS = [TABS.ADJUST]

// Crop the picked file, before it is uploaded (ADR-0012). It takes a `File` rather than
// a server path because at this point the photo has no item id, and so no home on disk:
// the picker holds it until `items.create` returns (`ItemForm`).
type PhotoCropProps = { file: File; onSave: (blob: Blob) => void; onClose: () => void }

export function PhotoCrop({ file, onSave, onClose }: PhotoCropProps) {
  // The URL is created in the effect, not during render: React discards one of
  // StrictMode's two renders, so a URL created while rendering can be revoked while the
  // mounted editor is still pointing at it. Created here, the live URL is always the one
  // the last setup made, and the one it revoked is one nothing ever saw.
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const [error, setError] = useState<string | null>(null)

  const handleSave = async (imageData: SaveImageData) => {
    setError(null)
    try {
      const blob = await toBlob(imageData)
      if (!blob) {
        setError('The crop produced no image')
        return
      }
      onSave(blob)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The crop failed')
    }
  }

  // The URL does not exist until the effect has run, so the dialog opens one empty
  // frame late — the cost of getting the lifetime above right.
  if (!src) return null

  return (
    <Modal open onOpenChange={(next) => { if (!next) onClose() }} title="Crop photo">
      {error && <p role="alert" className="text-danger">{error}</p>}
      {/* A definite height, for the reason `PhotoEditor` documents at length: the
          editor sizes to 100% of its parent and collapses inside a `height: auto`
          dialog. */}
      <div className="h-[70vh]">
        <FilerobotImageEditor
          source={src}
          onSave={handleSave}
          onClose={onClose}
          tabsIds={CROP_TABS}
          // This blob becomes the photo's ORIGINAL (ADR-0012), so it is exported at the
          // source's own pixels — `savingPixelRatio` multiplies the output canvas — and
          // as JPEG, because PNG is the wrong container for a photograph.
          savingPixelRatio={1}
          // Required by the library's config type, same as `PhotoEditor` passes it — the
          // preview scale, not the saved one, so it does not touch the output pixels.
          previewPixelRatio={window.devicePixelRatio || 1}
          defaultSavedImageType="jpeg"
        />
      </div>
    </Modal>
  )
}
