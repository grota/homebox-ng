import { useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { Button, buttonClasses } from './Button'
import { cn } from './cn'
import { Modal } from './Modal'
import { initialView, type Size, type Transform } from './zoom'

type Scene = { natural: Size; viewport: Size; transform: Transform }

type PhotoViewerProps = {
  /** The full-size rendition — `editedPath ?? originalPath`. */
  src: string
  /** The item or draft name: the image's alt text and the dialog's name. */
  alt: string
  onClose: () => void
}

// Full-screen photo viewer. It composes `Modal size="full"` for the focus trap,
// Escape handling and focus restore (ADR-0002), and owns everything else: the
// fit/zoom maths, the gestures, and the dismissal rule — Radix has no overlay to
// fire an outside-click on when the dialog fills the viewport.
export function PhotoViewer({ src, alt, onClose }: PhotoViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [scene, setScene] = useState<Scene | null>(null)

  const measure = () => containerRef.current?.getBoundingClientRect()

  // The image's own dimensions are the only trustworthy source: the API sends
  // none, and the ones it stores are pre-EXIF-rotation. So the zoom is decided
  // here, on `load`, and the frame before it is a loading state — never a
  // wrong-zoom flash.
  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    const box = measure()
    if (!box || box.width <= 0 || box.height <= 0) return
    if (!img.naturalWidth || !img.naturalHeight) return
    const natural = { width: img.naturalWidth, height: img.naturalHeight }
    const viewport = { width: box.width, height: box.height }
    setScene({ natural, viewport, transform: initialView(natural, viewport) })
  }

  // Every gesture ends in a new transform for the current scene, and nothing
  // before `load` has one.
  const apply = (next: (current: Scene) => Transform) =>
    setScene((current) => (current ? { ...current, transform: next(current) } : current))

  return (
    <Modal open onOpenChange={(next) => { if (!next) onClose() }} title={alt} size="full">
      {/* The backdrop is this element, and the dismissal rule is a positive check
          on it — see Task 4. `bg-black/90` is painted here rather than on the
          dialog because a full-viewport content hides the dialog's own overlay. */}
      <div
        ref={containerRef}
        data-testid="photo-viewer"
        className="relative h-full w-full touch-none overflow-hidden bg-black/90"
      >
        {scene ? null : (
          <p className="absolute inset-0 grid place-items-center text-sm text-white/70">Loading…</p>
        )}
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={onLoad}
          // Preflight caps every <img> at `max-width: 100%`, which would defeat
          // the natural-size maths; `max-w-none` restores the intrinsic box, and
          // the explicit width/height make the drawn size exactly `natural`
          // before the transform scales it.
          className={cn('absolute left-0 top-0 max-w-none select-none', scene ? '' : 'invisible')}
          style={
            scene
              ? {
                  width: scene.natural.width,
                  height: scene.natural.height,
                  transform: `translate(${scene.transform.x}px, ${scene.transform.y}px) scale(${scene.transform.scale})`,
                  transformOrigin: '0 0',
                }
              : undefined
          }
        />
        {/* An <a>, not a <Button> — it opens the file in a new tab, which a
            <button> cannot. This is the capability the photo card's "View" anchor
            had, moved inside the viewer. */}
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonClasses(), 'absolute left-3 top-3 no-underline')}
        >
          Open original
        </a>
        <Button className="absolute right-3 top-3" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  )
}
