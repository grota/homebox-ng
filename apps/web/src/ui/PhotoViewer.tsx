import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent, WheelEvent } from 'react'
import { Button, buttonClasses } from './Button'
import { cn } from './cn'
import { Modal } from './Modal'
import {
  KEY_PAN_STEP,
  initialView,
  panBy,
  toggleZoom,
  zoomAt,
  type Point,
  type Size,
  type Transform,
} from './zoom'

type Scene = { natural: Size; viewport: Size; transform: Transform }

// A pointer that moved less than this many pixels between down and up was a
// click, not a drag. Without it a pan that happens to end on the backdrop would
// dismiss the viewer.
const DRAG_THRESHOLD = 4

// Arrow keys move the *view*, so the image travels the other way: ArrowRight
// reveals what is off-screen to the right.
const ARROW_PAN: Record<string, Point> = {
  ArrowLeft: { x: KEY_PAN_STEP, y: 0 },
  ArrowRight: { x: -KEY_PAN_STEP, y: 0 },
  ArrowUp: { x: 0, y: KEY_PAN_STEP },
  ArrowDown: { x: 0, y: -KEY_PAN_STEP },
}

// The distance between the two fingers of a pinch.
const spread = (pointers: Map<number, Point>): number => {
  const [a, b] = [...pointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}

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
  // The pointer-down that may still turn out to be a click: where it started,
  // whether it has moved past the threshold, and what it landed on.
  const drag = useRef<{ x: number; y: number; moved: boolean; on: EventTarget | null } | null>(null)
  // Every finger currently down, for the two-finger pinch, and the spread they
  // had on the previous move.
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<number | null>(null)

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

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { target } = event
    // Only the image and the backdrop itself are gesture surfaces. The chrome —
    // close button, navigator, open-original — is neither, which is what makes
    // `drag.on` provably one of exactly two elements.
    if (target !== containerRef.current && target !== imageRef.current) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size >= 2) {
      // A second finger means a pinch, and ends the pan — and any click the
      // first finger might still have become.
      drag.current = null
      pinch.current = spread(pointers.current)
      return
    }
    drag.current = { x: event.clientX, y: event.clientY, moved: false, on: target }
    // jsdom does not implement pointer capture; the drag still works without it,
    // it just stops tracking once the pointer leaves the element.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (pointers.current.size === 2 && pinch.current != null) {
      const next = spread(pointers.current)
      const [a, b] = [...pointers.current.values()]
      const box = measure()
      const at = box
        ? { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top }
        : { x: 0, y: 0 }
      const factor = next / pinch.current
      pinch.current = next
      apply((current) => zoomAt(current.natural, current.viewport, current.transform, factor, at))
      return
    }
    const start = drag.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    // Below the threshold this could still turn out to be a click, so nothing
    // moves yet.
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    start.moved = true
    start.x = event.clientX
    start.y = event.clientY
    apply((current) => panBy(current.natural, current.viewport, current.transform, dx, dy))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const start = drag.current
    drag.current = null
    // A drag is not a click: a pan that happens to end on the backdrop must not
    // dismiss the viewer.
    if (!start || start.moved) return
    // The whole dismissal rule, in one line: the backdrop closes, the image
    // toggles. `start.on` is one of those two and nothing else, because
    // `onPointerDown` refuses every other target.
    if (start.on === containerRef.current) onClose()
    else apply((current) => toggleZoom(current.natural, current.viewport, current.transform))
  }

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    pinch.current = null
    drag.current = null
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const box = measure()
    if (!box) return
    const at = { x: event.clientX - box.left, y: event.clientY - box.top }
    // Exponential, so the gesture is scale-free: the same swipe changes the zoom
    // by the same factor at any magnification, and scrolling up zooms in.
    apply((current) =>
      zoomAt(current.natural, current.viewport, current.transform, Math.exp(-event.deltaY / 400), at),
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = ARROW_PAN[event.key]
    if (!delta) return
    // Inside the dialog the arrow keys are ours: there is nothing else for them
    // to scroll, and the focus trap guarantees focus is already in here.
    event.preventDefault()
    apply((current) => panBy(current.natural, current.viewport, current.transform, delta.x, delta.y))
  }

  return (
    <Modal open onOpenChange={(next) => { if (!next) onClose() }} title={alt} size="full">
      {/* The backdrop is this element, and the dismissal rule is a positive check
          on it — see Task 4. `bg-black/90` is painted here rather than on the
          dialog because a full-viewport content hides the dialog's own overlay. */}
      <div
        ref={containerRef}
        data-testid="photo-viewer"
        // Focusable but not a tab stop. Without this, clicking the non-focusable
        // <img> sends focus to the nearest focusable ancestor — Radix's
        // Dialog.Content, which carries tabindex="-1" — and a keydown there
        // bubbles *up*, never reaching this container, so arrow-key panning dies
        // the moment the user clicks the photo to zoom. Verified in Chromium.
        tabIndex={-1}
        className="relative h-full w-full touch-none overflow-hidden bg-black/90 focus:outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
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
