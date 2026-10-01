import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent, WheelEvent } from 'react'
import { cn } from './cn'
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
// click, not a drag.
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
// zoom. Module-level so the effect below has a stable function to remove.
const stopPageZoom = (event: Event) => event.preventDefault()

// The distance between the two fingers of a pinch.
const spread = (pointers: Map<number, Point>): number => {
  const [a, b] = [...pointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}

type PhotoViewerProps = {
  /** The full-size rendition — `editedPath ?? originalPath`. */
  src: string
  /** The item or draft name: the image's alt text. */
  alt: string
}

// The stage: one photo of an item surface, and everything about *looking* at it —
// the fit/zoom maths, the gestures, the navigator, the loading and failed states.
//
// It owns no chrome and no dismissal. The surface around it decides which photo
// this is, where the controls live, and what closing means; "Open original" is a
// per-photo action and sits with the others on the per-photo bar.
//
// The backdrop-click-to-close rule the viewer used to carry went with the overlay
// it was written for (ADR-0005): a page has no backdrop, and a click on empty
// space discarding the item you are reading is hostile. Clicking the *photo*
// still toggles fit ↔ 1:1.
export function PhotoViewer({ src, alt }: PhotoViewerProps) {
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
  // never `preventDefault`. This native, non-passive listener runs first and only
  // cancels the default action — no `stopPropagation` — so the zoom handler fires
  // too.
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    node.addEventListener('wheel', stopPageZoom, { passive: false })
    return () => node.removeEventListener('wheel', stopPageZoom)
  }, [])

  // A new photo is a new image: the previous photo's scene describes the previous
  // photo's pixels, and a previous 404 describes the previous file. The hosts key
  // this component by photo id, which remounts it and makes this redundant — kept
  // because "the caller must key it" is a rule nobody will remember, and the bug
  // it prevents is showing photo 3 at photo 2's zoom.
  //
  // Adjusted during render rather than in an effect, and that is not a style
  // choice. An effect with `[src]` deps runs *after* the commit that put the
  // `<img>` in the DOM, so a photo the browser already has cached can fire `load`
  // — and set a scene — before the effect runs to clear it. The reset then wipes
  // the photo that had just loaded, the `<img>` goes back to `invisible`, and no
  // further `load` ever arrives to set it again: "Loading…" for good, on an image
  // that is decoded and ready. Re-opening the item you just closed reproduces it
  // every time, because that is when the photo is warm. Setting state during
  // render happens before the new `<img>` is committed, so the order cannot
  // invert.
  const [renderedSrc, setRenderedSrc] = useState(src)
  if (renderedSrc !== src) {
    setRenderedSrc(src)
    setScene(null)
    setFailed(false)
  }

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
    // Primary button only: a right-click on the photo would otherwise arm a click
    // that the `pointerup` toggles the zoom on.
    if (event.button !== 0) return
    const { target } = event
    // Only the image and the container are gesture surfaces. The chrome —
    // navigator, and anything the host overlays — is neither, which is what makes
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
    // A drag is not a click.
    if (!start || start.moved) return
    // The image toggles; a click on the container around it does nothing at all.
    if (start.on !== imageRef.current) return
    apply((current) => toggleZoom(current.natural, current.viewport, current.transform))
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
    // The arrow keys are ours while the stage has focus: the surface does not
    // scroll, and the host's own keys are PageUp/PageDown. The host ignores
    // arrows while the stage can pan (focused and overflowing) and steps with
    // Left/Right everywhere else, so the split is by key *and* by stage state and
    // there is no ordering rule between two handlers. When fitted, panning is a
    // visual no-op, so nothing here is lost to the stepping.
    event.preventDefault()
    apply((current) => panBy(current.natural, current.viewport, current.transform, delta.x, delta.y))
  }

  return (
    <div
      ref={containerRef}
      data-testid="photo-viewer"
      // Marks the pan area for the host: its own arrow keys step photos except
      // while focus is in here *and* the navigator is up (only then can the
      // arrows pan anything).
      data-photo-stage
      // Focusable but not a tab stop. Clicking the non-focusable <img> sends
      // focus to the nearest focusable ancestor, which is this element — so
      // arrow-key panning keeps working after the user clicks the photo to zoom.
      // Without it, focus would land on <body> and the keydown would never reach
      // the handler below. Verified in Chromium.
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
        // `pointer-events-none` is what keeps the surfaces underneath reachable
        // and stops this frame swallowing the click that toggles the zoom: it
        // covers the whole container, and `onPointerDown` refuses any target that
        // is not the container or the image — so a clickable message here would
        // swallow every click for as long as it is up, i.e. for good if the image
        // never loads.
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
