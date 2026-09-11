import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent, WheelEvent } from 'react'
import { Button, buttonClasses } from './Button'
import { cn } from './cn'
import { Modal } from './Modal'
import {
  KEY_PAN_STEP,
  centerOn,
  containedRect,
  initialView,
  overflows,
  panBy,
  toggleZoom,
  visibleRect,
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

// A pinch's `wheel` event, stopped before the browser can turn it into page
// zoom. Module-level so the ref callback below is stable.
const stopPageZoom = (event: Event) => event.preventDefault()

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
  // A rendition row can outlive the file on disk, and `/file/*` sets no cache
  // headers, so a 404 on re-open is a real state rather than a theoretical one.
  const [failed, setFailed] = useState(false)
  // The pointer-down that may still turn out to be a click: where it started,
  // whether it has moved past the threshold, and what it landed on.
  const drag = useRef<{ x: number; y: number; moved: boolean; on: EventTarget | null } | null>(null)
  // Every finger currently down, for the two-finger pinch, and the spread they
  // had on the previous move.
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<number | null>(null)

  // A trackpad pinch arrives as a `wheel` event with `ctrlKey`, whose default
  // action is the browser's own page zoom — and nothing else can cancel it:
  // React registers `onWheel` passively on the root (verified in
  // react-dom@19.2.8's `listenToNativeEvent`), so the JSX handler below can
  // never `preventDefault`, and Radix passes `allowPinchZoom: true` to
  // react-remove-scroll, whose `shouldCancelEvent` returns false for exactly
  // this event. This native, non-passive listener runs first and only cancels
  // the default action — no `stopPropagation` — so the zoom handler fires too.
  //
  // Installed from the ref callback rather than an effect, and that is not a
  // style choice: `Modal` renders `Dialog.Content`, whose Radix `Presence`
  // mounts its subtree in a *later* commit than this component's, so a
  // mount-time effect here runs before the container exists — and with `[]`
  // deps it never runs again. A callback ref fires when the node actually
  // attaches, whenever that is; React 19 calls the returned cleanup on detach.
  const setContainer = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    if (!node) return
    node.addEventListener('wheel', stopPageZoom, { passive: false })
    return () => node.removeEventListener('wheel', stopPageZoom)
  }, [])

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
    // Primary button only: a right-click on the backdrop would otherwise arm a
    // click that the `pointerup` dismisses on, and one on the photo would toggle
    // the zoom.
    if (event.button !== 0) return
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
        ref={setContainer}
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
          // `pointer-events-none` is what keeps backdrop dismissal alive: this
          // element covers the whole container, and `onPointerDown` refuses any
          // target that is not the container or the image, so a clickable
          // message here would swallow every click for as long as it is up —
          // i.e. for good if the image never loads.
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white/70">
            {failed ? 'Could not load this photo' : 'Loading…'}
          </p>
        )}
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={onLoad}
          onError={() => setFailed(true)}
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
        {scene && overflows(scene.natural, scene.viewport, scene.transform.scale) ? (
          <PhotoNavigator
            src={src}
            natural={scene.natural}
            viewport={scene.viewport}
            transform={scene.transform}
            onJump={(at) =>
              apply((current) => centerOn(current.natural, current.viewport, current.transform, at))
            }
          />
        ) : null}
      </div>
    </Modal>
  )
}

// The navigator: the whole image in the corner with the visible region outlined,
// click or drag to jump the view.
//
// The picture is an SVG whose viewBox *is* the image, so `preserveAspectRatio`
// does the containing for free and the outline is drawn in image pixels — no
// measurement and no scaling maths of its own. `containedRect` is needed only to
// turn a pointer position back into an image coordinate.
function PhotoNavigator({
  src,
  natural,
  viewport,
  transform,
  onJump,
}: {
  src: string
  natural: Size
  viewport: Size
  transform: Transform
  onJump: (at: Point) => void
}) {
  const region = visibleRect(natural, viewport, transform)

  const jump = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const contained = containedRect(natural, { width: rect.width, height: rect.height })
    if (!contained.width || !contained.height) return
    onJump({
      x: (event.clientX - rect.left - contained.x) / contained.width,
      y: (event.clientY - rect.top - contained.y) / contained.height,
    })
  }

  return (
    <svg
      viewBox={`0 0 ${natural.width} ${natural.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Photo navigator"
      // Smaller and more transparent on a narrow viewport, per the spec — never
      // absent, because on a phone it is the only way to orient inside a photo.
      className="absolute bottom-3 right-3 h-20 w-20 touch-none rounded border border-white/30 bg-black/40 opacity-60 sm:h-32 sm:w-32 sm:opacity-90"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId)
        jump(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) jump(event)
      }}
    >
      <image href={src} width={natural.width} height={natural.height} />
      {/* Two strokes, white under black. The outline sits over a photo of
          arbitrary colour, so no token can supply it and a single colour would
          vanish on the half of the images that match it. */}
      <rect
        x={region.x}
        y={region.y}
        width={region.width}
        height={region.height}
        fill="none"
        stroke="white"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={region.x}
        y={region.y}
        width={region.width}
        height={region.height}
        fill="none"
        stroke="black"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
