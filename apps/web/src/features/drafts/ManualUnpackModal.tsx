import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react'
import { Button, Input, Modal } from '../../ui'
import { initialView, overflows, panBy, zoomAt, type Transform } from '../../ui/zoom'
import { boxFromCorners, isDrawable, moveBox, resizeBox, toImagePoint, type Box, type Handle, type Size } from './geometry'

/** What the caller sends: a rectangle in the source image's own pixels, and the
 *  name typed for it. */
export type Region = { name: string; box: Box }

type DrawnRegion = Region & { id: number }

// Where a gesture started. `draw`/`move`/`resize` hold *image* points; `pan` holds
// a *screen* point, because panning is measured in viewport pixels.
type Mode =
  | { kind: 'draw'; from: { x: number; y: number } }
  | { kind: 'move'; id: number; from: { x: number; y: number }; start: Box }
  | { kind: 'resize'; id: number; handle: Handle; from: { x: number; y: number }; start: Box }
  | { kind: 'pan'; from: { x: number; y: number } }

// A fixed cycle, assigned by creation order. No palette to configure and no theme
// token to invent; the number in the row and on the box is the reliable channel,
// this is the fast one.
const HUES = ['#e11d48', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

type ManualUnpackModalProps = {
  /** The image to draw on: an object URL for an upload, or a stored `/file/…` path. */
  src: string
  /** Runs the request with the drawn regions. Throwing keeps the modal open and
   *  shows the message; the caller closes on success. */
  onSubmit: (regions: Region[]) => Promise<void>
  onClose: () => void
}

// Draw rectangles on a photo, name them, and turn each into a draft.
//
// The overlay is authored in *image* pixels and carries the same transform as the
// image, so a rectangle needs no per-rectangle maths and a wrong transform can
// move the picture but never the boxes. `geometry.ts` holds the coordinate work.
export function ManualUnpackModal({ src, onSubmit, onClose }: ManualUnpackModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [natural, setNatural] = useState<Size | null>(null)
  const [transform, setTransform] = useState<Transform | null>(null)
  // The measured container, kept so `canPan` can be computed while rendering.
  const [viewport, setViewport] = useState<Size | null>(null)
  const [regions, setRegions] = useState<DrawnRegion[]>([])
  const [pending, setPending] = useState<{ id: number; box: Box } | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(1)
  const focusNameFor = useRef<number | null>(null)

  // Space pans, so it must not also scroll the page or re-fire a focused button.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      setSpaceDown(true)
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // Delete removes the selection. Escape is deliberately NOT bound here: it is
  // the Modal's own close, and repurposing it would make an accidental Escape
  // delete a rectangle instead of asking about the work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (selected == null) return
      e.preventDefault()
      setRegions((rs) => rs.filter((r) => r.id !== selected))
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  // Focus the new row's name field, so the loop is drag → type → drag → type.
  useEffect(() => {
    if (focusNameFor.current == null) return
    const el = document.querySelector<HTMLInputElement>(`[data-region-name="${focusNameFor.current}"]`)
    focusNameFor.current = null
    el?.focus()
  }, [regions])

  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    if (!img.naturalWidth || !img.naturalHeight) return
    const size = { width: img.naturalWidth, height: img.naturalHeight }
    setNatural(size)
    const box = containerRef.current?.getBoundingClientRect()
    if (box && box.width > 0 && box.height > 0) {
      const measured = { width: box.width, height: box.height }
      setViewport(measured)
      setTransform(initialView(size, measured))
    }
  }

  // Everything hangs off the wrapper's measured rectangle: it is the image at
  // display scale, so dividing by that scale lands in image pixels whatever the
  // transform happens to be.
  const viewportSize = (): Size => {
    const box = containerRef.current?.getBoundingClientRect()
    return { width: box?.width ?? 0, height: box?.height ?? 0 }
  }

  // Whether a drag could actually move the photo. At fit the image is letterboxed
  // on both axes, and `panBy` clamps every offset back to the centre — so a
  // space-drag is a no-op that looks broken. `overflows` is the same predicate the
  // photo viewer uses, and it is already unit-tested; the bug this guards against
  // was promising a grab cursor in a state where nothing can be grabbed.
  const canPan = !!(natural && viewport && transform && overflows(natural, viewport, transform.scale))

  const pointAt = useCallback((clientX: number, clientY: number) => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect || !natural || rect.width <= 0) return null
    return toImagePoint({ x: clientX, y: clientY }, rect, natural)
  }, [natural])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !natural) return
    const point = pointAt(event.clientX, event.clientY)
    if (!point) return
    // Keep the measurement fresh: `canPan` decides the cursor from it, and a
    // modal that was resized while open would otherwise keep the stale answer.
    setViewport(viewportSize())
    event.currentTarget.setPointerCapture?.(event.pointerId)

    // Space pans, and panning beats everything: with the key held, a drag that
    // starts inside a rectangle must not move it.
    if (spaceDown) { setMode({ kind: 'pan', from: { x: event.clientX, y: event.clientY } }); return }

    const target = event.target as HTMLElement
    const handle = target.dataset.handle as Handle | undefined
    const regionId = target.dataset.region ? Number(target.dataset.region) : null

    if (handle && regionId != null) {
      const region = regions.find((r) => r.id === regionId)!
      setSelected(regionId)
      setMode({ kind: 'resize', id: regionId, handle, from: point, start: region.box })
      return
    }
    if (regionId != null) {
      const region = regions.find((r) => r.id === regionId)!
      setSelected(regionId)
      setMode({ kind: 'move', id: regionId, from: point, start: region.box })
      return
    }
    setSelected(null)
    setMode({ kind: 'draw', from: point })
    setPending({ id: nextId.current++, box: { x: point.x, y: point.y, width: 0, height: 0 } })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!natural || !mode) return

    if (mode.kind === 'pan') {
      // Deltas from the last move, not `movementX`: that is unreliable under
      // pointer capture, and a stale one would make the photo jump.
      const dx = event.clientX - mode.from.x
      const dy = event.clientY - mode.from.y
      setMode({ kind: 'pan', from: { x: event.clientX, y: event.clientY } })
      setTransform((t) => (t ? panBy(natural, viewportSize(), t, dx, dy) : t))
      return
    }
    const point = pointAt(event.clientX, event.clientY)
    if (!point) return

    if (mode.kind === 'draw') {
      setPending((p) => (p ? { ...p, box: boxFromCorners(mode.from, point, natural) } : p))
    } else if (mode.kind === 'move') {
      const box = moveBox(mode.start, point.x - mode.from.x, point.y - mode.from.y, natural)
      setPending({ id: mode.id, box })
    } else {
      const box = resizeBox(mode.start, mode.handle, point.x - mode.from.x, point.y - mode.from.y, natural)
      setPending({ id: mode.id, box })
    }
  }

  const onPointerUp = () => {
    if (!mode) return
    if (mode.kind === 'pan') { setMode(null); return }
    if (mode.kind === 'draw' && pending) {
      // A click with no drag is not a rectangle.
      if (isDrawable(pending.box)) {
        const id = pending.id
        setRegions((rs) => [...rs, { id, name: '', box: pending.box }])
        setSelected(id)
        focusNameFor.current = id
      }
      setPending(null)
    } else if (pending && mode.kind !== 'draw') {
      const { id, box } = pending
      setRegions((rs) => rs.map((r) => (r.id === id ? { ...r, box } : r)))
      setPending(null)
    }
    setMode(null)
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!natural || !transform) return
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    const at = { x: event.clientX - box.left, y: event.clientY - box.top }
    const viewport = { width: box.width, height: box.height }
    setTransform((t) => (t ? zoomAt(natural, viewport, t, Math.exp(-event.deltaY / 400), at) : t))
  }

  const filled = regions.filter((r) => r.name.trim() !== '')
  const requestClose = () => {
    if (regions.length > 0 && !window.confirm('Throw away the boxes you have drawn?')) return
    onClose()
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      // Blank names are sent as-is: the pipeline's `Draft N` fallback is the one
      // naming rule, and the modal does not get a second one.
      await onSubmit(regions.map((r) => ({ name: r.name.trim(), box: r.box })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unpack failed')
      setBusy(false)
    }
  }

  const drawn = (r: DrawnRegion) => (pending && pending.id === r.id ? pending.box : r.box)
  const colourOf = (r: DrawnRegion) => HUES[regions.indexOf(r) % HUES.length]

  return (
    <Modal open onOpenChange={(next) => { if (!next) requestClose() }} title="Manual unpack" size="full">
      <div className="flex h-full flex-col bg-surface">
        <div className="flex items-center justify-between gap-4 border-b border-border p-3">
          {/* The hint answers the question the cursor raises. Holding Space on a
              photo that already fits used to show a grab cursor and then do
              nothing, which reads as a broken drag rather than as "there is
              nothing off-screen". */}
          <p className="text-sm text-text-muted">
            {spaceDown && !canPan
              ? 'The whole photo is already visible — zoom in first, then drag to move it.'
              : 'Drag on the photo to draw a box. Scroll to zoom, then hold Space and drag to move the photo. Click a box to select it; press Delete to remove it.'}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button onClick={requestClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || regions.length === 0} onClick={() => void submit()}>
              {busy ? 'Creating…' : `Create ${regions.length} draft${regions.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>

        {error && <p role="alert" className="px-3 py-2 text-danger">{error}</p>}

        <div
          ref={containerRef}
          data-testid="manual-unpack-canvas"
          tabIndex={-1}
          className={`relative min-h-0 flex-1 touch-none overflow-hidden bg-black/90 focus:outline-none ${
            spaceDown ? (canPan ? 'cursor-grab' : 'cursor-not-allowed') : 'cursor-crosshair'
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <div
            ref={wrapperRef}
            data-testid="manual-unpack-image"
            className="absolute left-0 top-0 origin-top-left"
            style={
              natural && transform
                ? {
                    width: natural.width,
                    height: natural.height,
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                    transformOrigin: '0 0',
                  }
                : { opacity: 0 }
            }
          >
            {/* Kept at its own size and never larger than the wrapper: the wrapper
                IS the image's box, and `toImagePoint` measures it. */}
            <img src={src} alt="" draggable={false} onLoad={onLoad} className="block h-full w-full select-none" />
            {natural && (
              <svg
                className="absolute left-0 top-0"
                width={natural.width}
                height={natural.height}
                viewBox={`0 0 ${natural.width} ${natural.height}`}
              >
                {regions.map((r, i) => {
                  const box = drawn(r)
                  const isSelected = selected === r.id
                  return (
                    <g key={r.id}>
                      <rect
                        data-region={r.id}
                        x={box.x}
                        y={box.y}
                        width={box.width}
                        height={box.height}
                        fill={colourOf(r)}
                        fillOpacity={0.15}
                        stroke={colourOf(r)}
                        strokeWidth={isSelected ? 3 : 2}
                        vectorEffect="non-scaling-stroke"
                        className="cursor-move"
                      />
                      <text x={box.x + 4} y={box.y + 16} fill={colourOf(r)} fontSize={16} className="pointer-events-none select-none">
                        {i + 1}
                      </text>
                      {isSelected &&
                        HANDLES.map((h) => {
                          const cx = h.includes('w') ? box.x : h.includes('e') ? box.x + box.width : box.x + box.width / 2
                          const cy = h.includes('n') ? box.y : h.includes('s') ? box.y + box.height : box.y + box.height / 2
                          return (
                            <rect
                              key={h}
                              data-handle={h}
                              data-region={r.id}
                              x={cx - 6}
                              y={cy - 6}
                              width={12}
                              height={12}
                              fill="white"
                              stroke={colourOf(r)}
                              vectorEffect="non-scaling-stroke"
                              className="cursor-pointer"
                            />
                          )
                        })}
                    </g>
                  )
                })}
                {pending && mode?.kind === 'draw' && (
                  <rect
                    x={pending.box.x}
                    y={pending.box.y}
                    width={pending.box.width}
                    height={pending.box.height}
                    fill="white"
                    fillOpacity={0.15}
                    stroke="white"
                    strokeDasharray="4"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            )}
          </div>
        </div>

        <div className="max-h-56 shrink-0 overflow-y-auto border-t border-border p-3">
          {regions.length === 0 ? (
            <p className="text-sm text-text-muted">No boxes yet. Drag on the photo to add one.</p>
          ) : (
            <ul className="space-y-2">
              {regions.map((r, i) => {
                const box = drawn(r)
                return (
                  <li key={r.id} className="flex items-center gap-3">
                    <span className="w-5 text-right text-sm" style={{ color: colourOf(r) }}>{i + 1}</span>
                    {natural && (
                      // A CSS crop of the same source, so the row shows what the box
                      // frames without the server having cropped anything yet.
                      <span
                        aria-hidden
                        className="h-12 w-16 shrink-0 rounded border border-border bg-no-repeat"
                        style={{
                          backgroundImage: `url(${src})`,
                          backgroundSize: `${(natural.width / box.width) * 64}px ${(natural.height / box.height) * 48}px`,
                          backgroundPosition: `${-(box.x / box.width) * 64}px ${-(box.y / box.height) * 48}px`,
                        }}
                      />
                    )}
                    <Input
                      data-region-name={r.id}
                      className="flex-1"
                      placeholder="Item name"
                      value={r.name}
                      onChange={(e) => setRegions((rs) => rs.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))}
                    />
                    <Button
                      variant="danger"
                      aria-label={`Delete box ${i + 1}`}
                      onClick={() => {
                        setRegions((rs) => rs.filter((x) => x.id !== r.id))
                        if (selected === r.id) setSelected(null)
                      }}
                    >
                      Delete
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          {filled.length !== regions.length && regions.length > 0 && (
            <p className="mt-2 text-sm text-text-muted">A box with no name becomes &ldquo;Draft N&rdquo;.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
