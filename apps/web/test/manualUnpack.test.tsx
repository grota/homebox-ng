import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  boxFromCorners,
  isDrawable,
  moveBox,
  resizeBox,
  toImagePoint,
  toPixelBox,
  MIN_SIZE,
} from '../src/features/drafts/geometry'
import { ManualUnpackModal, type Region } from '../src/features/drafts/ManualUnpackModal'

const NATURAL = { width: 1000, height: 500 }

// ── The coordinate maths ──────────────────────────────────────────────────────
//
// Tested on its own, without a DOM. A bug here is silent: the boxes look right on
// screen and the server crops the wrong region, and there is no error anywhere to
// notice. This is the reason the maths is not inline in the component.

describe('toImagePoint', () => {
  it('maps a pointer to image pixels when the image is shown at 1:1', () => {
    const rect = { left: 0, top: 0, width: 1000, height: 500 }
    expect(toImagePoint({ x: 250, y: 100 }, rect, NATURAL)).toEqual({ x: 250, y: 100 })
  })

  it('divides out the display scale', () => {
    // The image is fitted to a 400×200 viewport, so it is drawn at 0.4.
    const rect = { left: 0, top: 0, width: 400, height: 200 }
    expect(toImagePoint({ x: 100, y: 50 }, rect, NATURAL)).toEqual({ x: 250, y: 125 })
  })

  it('subtracts the pan offset', () => {
    // Same 0.4 scale, panned 40px right and 20px down.
    const rect = { left: 40, top: 20, width: 400, height: 200 }
    expect(toImagePoint({ x: 140, y: 70 }, rect, NATURAL)).toEqual({ x: 250, y: 125 })
  })

  it('scales up when the image is drawn larger than natural', () => {
    // Zoom is clamped to 1:1 in the UI, but the maths must not assume it.
    const rect = { left: 0, top: 0, width: 2000, height: 1000 }
    expect(toImagePoint({ x: 500, y: 250 }, rect, NATURAL)).toEqual({ x: 250, y: 125 })
  })
})

describe('boxFromCorners', () => {
  it('normalises a drag in any direction', () => {
    const down = { x: 400, y: 300 }
    const up = { x: 100, y: 50 }
    expect(boxFromCorners(down, up, NATURAL)).toEqual({ x: 100, y: 50, width: 300, height: 250 })
  })

  it('keeps a box inside the image', () => {
    const box = boxFromCorners({ x: -50, y: -50 }, { x: 5000, y: 5000 }, NATURAL)
    expect(box).toEqual({ x: 0, y: 0, width: 1000, height: 500 })
  })

  it('reports a click honestly as a zero-area box, for isDrawable to reject', () => {
    // Growing it to the minimum here instead would make `isDrawable` always true,
    // and every stray click would become a draft.
    const box = boxFromCorners({ x: 10, y: 10 }, { x: 10, y: 10 }, NATURAL)
    expect(box).toEqual({ x: 10, y: 10, width: 0, height: 0 })
    expect(isDrawable(box)).toBe(false)
  })
})

describe('isDrawable', () => {
  it('rejects a box below the minimum on either axis', () => {
    expect(isDrawable({ x: 0, y: 0, width: MIN_SIZE, height: MIN_SIZE })).toBe(true)
    expect(isDrawable({ x: 0, y: 0, width: MIN_SIZE - 1, height: 100 })).toBe(false)
    expect(isDrawable({ x: 0, y: 0, width: 100, height: MIN_SIZE - 1 })).toBe(false)
  })
})

describe('moveBox', () => {
  it('moves by the delta', () => {
    expect(moveBox({ x: 10, y: 10, width: 100, height: 50 }, 20, 5, NATURAL)).toEqual({ x: 30, y: 15, width: 100, height: 50 })
  })

  it('stops at the edges instead of shrinking against them', () => {
    const box = { x: 10, y: 10, width: 100, height: 50 }
    expect(moveBox(box, -999, -999, NATURAL)).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(moveBox(box, 999, 999, NATURAL)).toEqual({ x: 900, y: 450, width: 100, height: 50 })
  })
})

describe('resizeBox', () => {
  const box = { x: 100, y: 100, width: 200, height: 100 }

  it('moves the dragged edge and leaves the anchor alone', () => {
    const resized = resizeBox(box, 'e', 50, 0, NATURAL)
    expect(resized).toEqual({ x: 100, y: 100, width: 250, height: 100 })
  })

  it('drags a corner on both axes', () => {
    const resized = resizeBox(box, 'nw', 20, 10, NATURAL)
    expect(resized).toEqual({ x: 120, y: 110, width: 180, height: 90 })
  })

  it('refuses to shrink past the minimum, keeping the anchor put', () => {
    // Drag the east edge far past the west one.
    const resized = resizeBox(box, 'e', -999, 0, NATURAL)
    expect(resized.width).toBe(MIN_SIZE)
    expect(resized.x).toBe(100) // the anchor did not move
  })

  it('clamps to the image instead of hanging off it', () => {
    const resized = resizeBox(box, 'se', 9999, 9999, NATURAL)
    expect(resized.x + resized.width).toBeLessThanOrEqual(NATURAL.width)
    expect(resized.y + resized.height).toBeLessThanOrEqual(NATURAL.height)
  })
})

// Every box the drawing produces is fractional — `toImagePoint` is a division —
// but the contract it is sent under is whole pixels, because the server turns it
// into a `sharp.extract` argument. So this conversion is what stands between a
// real photo and a 400.
describe('toPixelBox', () => {
  it('rounds a fractional box onto the pixel grid', () => {
    expect(toPixelBox({ x: 200.5, y: 201.4, width: 200.5, height: 99.2 }, NATURAL)).toEqual({
      x: 201,
      y: 201,
      width: 201,
      height: 99,
    })
  })

  // Rounding alone is not enough to make a box legal, and each of these is a
  // separate rejection reason on the server: `x + width` pushed past the image,
  // and a width rounded down to zero.
  it('keeps the rounded box inside the image', () => {
    const edge = toPixelBox({ x: 999.6, y: 499.7, width: 999.9, height: 999.9 }, NATURAL)
    expect(edge.x + edge.width).toBeLessThanOrEqual(NATURAL.width)
    expect(edge.y + edge.height).toBeLessThanOrEqual(NATURAL.height)
  })

  it('never rounds a box away to nothing', () => {
    const sliver = toPixelBox({ x: 10.4, y: 10.4, width: 0.2, height: 0.2 }, NATURAL)
    expect(sliver.width).toBe(1)
    expect(sliver.height).toBe(1)
  })
})

// ── The component ─────────────────────────────────────────────────────────────

// jsdom lays nothing out and never loads an image, so the two facts the modal
// reads off the DOM — the container's box and the image's natural size — are
// supplied here. The display scale is deliberately not 1: a suite that only ever
// draws at 1:1 would not notice a missing division.
const DISPLAY = { width: 500, height: 250 } // 0.5 of NATURAL
const LEFT = 30
const TOP = 12

const box = (width: number, height: number, left = 0, top = 0) => () => ({
  x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}),
})

const open = (onSubmit: (regions: Region[]) => Promise<void> = vi.fn(async () => {})) => {
  render(<ManualUnpackModal src="/file/uploads/originals/a.png" onSubmit={onSubmit} onClose={vi.fn()} />)
  const canvas = screen.getByTestId('manual-unpack-canvas')
  canvas.getBoundingClientRect = box(DISPLAY.width, DISPLAY.height)
  const wrapper = screen.getByTestId('manual-unpack-image')
  wrapper.getBoundingClientRect = box(DISPLAY.width, DISPLAY.height, LEFT, TOP)
  const img = wrapper.querySelector('img')!
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: NATURAL.width })
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: NATURAL.height })
  fireEvent.load(img)
  return { canvas, wrapper, onSubmit }
}

// A drag, in screen coordinates.
const drag = (canvas: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) => {
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(canvas, { pointerId: 1, buttons: 1, clientX: to.x, clientY: to.y })
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: to.x, clientY: to.y })
}

// The scale out of the image wrapper's `translate(...) scale(...)` style.
const scaleOf = (wrapper: HTMLElement) => Number(wrapper.style.transform.match(/scale\(([\d.]+)\)/)![1])

describe('ManualUnpackModal', () => {
  it('offers no submit until something is drawn', () => {
    open()
    expect(screen.getByRole('button', { name: /Create 0 drafts/ })).toBeDisabled()
  })

  // Screen (130,112) → image ((130-30)/0.5, (112-12)/0.5) = (200, 200).
  it('turns a drag into a named row, focused and ready to type', async () => {
    const { canvas, onSubmit } = open()
    drag(canvas, { x: 130, y: 112 }, { x: 230, y: 212 })

    const field = await screen.findByPlaceholderText('Item name')
    expect(field).toHaveFocus()

    fireEvent.change(field, { target: { value: 'Mug' } })
    fireEvent.click(screen.getByRole('button', { name: /Create 1 draft/ }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith([{ name: 'Mug', box: { x: 200, y: 200, width: 200, height: 200 } }])
  })

  // The case the test above cannot see, and the one a real user always hits: a
  // drag that lands *between* pixels. Half-pixel screen coordinates map to
  // fractional image pixels at any display scale, and the drawn box is then sent
  // to a schema that is `.int()` on all four numbers — so the raw box is a 400,
  // not a bad crop. The 1:1 drag above happens to produce whole numbers, which is
  // why this went unnoticed: the bug is invisible whenever the ratio is clean.
  it('submits whole pixels when the drag lands between them', async () => {
    const onSubmit = vi.fn<(regions: Region[]) => Promise<void>>(async () => {})
    const { canvas } = open(onSubmit)
    // (130.25 - 30) / 0.5 = 200.5 in image space, and the far corner likewise.
    drag(canvas, { x: 130.25, y: 112.5 }, { x: 230.75, y: 212.5 })

    const field = await screen.findByPlaceholderText('Item name')
    fireEvent.change(field, { target: { value: 'Mug' } })
    fireEvent.click(screen.getByRole('button', { name: /Create 1 draft/ }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const [regions] = onSubmit.mock.calls[0]
    expect(regions).toHaveLength(1)
    for (const value of Object.values(regions[0].box)) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('ignores a click that drew nothing', () => {
    const { canvas } = open()
    drag(canvas, { x: 130, y: 112 }, { x: 130, y: 112 })
    expect(screen.queryByPlaceholderText('Item name')).not.toBeInTheDocument()
  })

  it('deletes a box from its row and from the count', async () => {
    const { canvas, onSubmit } = open()
    drag(canvas, { x: 130, y: 112 }, { x: 230, y: 212 })
    await screen.findByPlaceholderText('Item name')

    fireEvent.click(screen.getByRole('button', { name: 'Delete box 1' }))
    expect(screen.queryByPlaceholderText('Item name')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create 0 drafts/ })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('removes the selected box with the Delete key', async () => {
    const { canvas } = open()
    drag(canvas, { x: 130, y: 112 }, { x: 230, y: 212 })
    const field = await screen.findByPlaceholderText('Item name')
    // Escape belongs to the Modal, so Delete is the only keyboard delete.
    field.blur()
    fireEvent.keyDown(window, { key: 'Delete' })
    await waitFor(() => expect(screen.queryByPlaceholderText('Item name')).not.toBeInTheDocument())
  })

  it('sends a blank name through rather than inventing one', async () => {
    const spy = vi.fn<(regions: Region[]) => Promise<void>>(async () => {})
    const { canvas } = open(spy)
    drag(canvas, { x: 130, y: 112 }, { x: 230, y: 212 })
    await screen.findByPlaceholderText('Item name')

    fireEvent.click(screen.getByRole('button', { name: /Create 1 draft/ }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    // The pipeline's `Draft N` is the only naming rule; the modal must not add a
    // second one by filling the field in for the user.
    expect(spy.mock.calls[0]![0][0]!.name).toBe('')
  })

  // The bug this pins, reported from a real session: at fit the image is
  // letterboxed on both axes, so `panBy` clamps every offset back to the centre
  // and a space-drag cannot move anything. The cursor promised a grab anyway,
  // which reads as a broken drag rather than as "nothing is off-screen".
  it('does not offer a grab cursor when there is nothing to pan', () => {
    const { canvas } = open()
    fireEvent.keyDown(window, { code: 'Space' })
    expect(canvas.className).toContain('cursor-not-allowed')
    expect(screen.getByText(/zoom in first/)).toBeInTheDocument()
  })

  it('offers the grab cursor once the photo is zoomed past fit', async () => {
    const { canvas } = open()
    // A wheel-up at the canvas centre: the same gesture the user zooms with.
    fireEvent.wheel(canvas, { deltaY: -200, clientX: 250, clientY: 125 })
    fireEvent.keyDown(window, { code: 'Space' })

    await waitFor(() => expect(canvas.className).toContain('cursor-grab'))
    expect(screen.queryByText(/zoom in first/)).not.toBeInTheDocument()
  })

  // The pan that depends on nothing: no held key, no focus, no modifier. The
  // space-drag below works, but it is also the gesture two rounds of a real
  // session could not make fire, and a toggle is what makes the feature
  // reachable regardless of what the browser does with the keyboard.
  it('pans with the Move photo toggle, using no keyboard at all', async () => {
    const { canvas } = open()
    // Zoom past fit first: at fit the image is letterboxed on both axes and
    // `panBy` clamps every offset back to the centre, so there is nothing to see.
    fireEvent.wheel(canvas, { deltaY: -200, clientX: 250, clientY: 125 })
    await waitFor(() => expect(canvas.className).toContain('cursor-crosshair'))

    const wrapper = screen.getByTestId('manual-unpack-image')
    const before = wrapper.style.transform
    fireEvent.click(screen.getByRole('button', { name: 'Move photo' }))
    expect(screen.getByRole('button', { name: 'Moving' })).toHaveAttribute('aria-pressed', 'true')

    drag(canvas, { x: 250, y: 125 }, { x: 300, y: 160 })
    await waitFor(() => expect(wrapper.style.transform).not.toBe(before))
  })

  // Space is a *toggle* of the same state the button drives, not a key to hold.
  // The held version only worked if the key was down at the instant the mouse
  // button went down, which is a rule nobody should have to learn — and on a real
  // session it never fired at all.
  it('toggles the move mode with Space, exactly like the button', () => {
    const { canvas } = open()
    fireEvent.keyDown(window, { code: 'Space' })
    expect(screen.getByRole('button', { name: 'Moving' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(window, { code: 'Space' })
    expect(screen.getByRole('button', { name: 'Move photo' })).toHaveAttribute('aria-pressed', 'false')
    expect(canvas.className).toContain('cursor-crosshair')
  })

  // Space is a control's own activation key. Eating it would make the modal
  // unusable by keyboard in exchange for a shortcut.
  it('leaves Space alone when a control has focus', () => {
    open()
    const button = screen.getByRole('button', { name: 'Move photo' })
    button.focus()
    fireEvent.keyDown(button, { code: 'Space' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  // The overlay is an inline <svg>, and Chromium drags those as images by
  // default, whatever the <img> next to it says. When the browser wins that race
  // it takes the pointer, panning dies mid-gesture, and a ghost of the overlay
  // trails the cursor — reported from a real session as the photo being dragged.
  it('cancels a native drag, so the browser never takes the pointer', () => {
    const { canvas } = open()
    const overlay = canvas.querySelector('svg')
    expect(overlay).not.toBeNull()

    // Dispatched on the overlay, because that is where the browser starts it.
    const event = new Event('dragstart', { bubbles: true, cancelable: true })
    overlay!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not draw a rectangle while the Move toggle is on', () => {
    const { canvas } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move photo' }))
    drag(canvas, { x: 130, y: 112 }, { x: 230, y: 212 })
    // A pan is not a draw, however far it drags.
    expect(screen.queryByPlaceholderText('Item name')).not.toBeInTheDocument()
  })

  // Clicking a `tabIndex={-1}` surface focuses it, and the browser then paints a
  // `:focus-visible` ring once the keyboard has been used — the blue border
  // reported from a real session. Starting on the drawing surface rather than on
  // "Cancel" makes that ring land somewhere sensible.
  it('starts focus on the drawing surface, not on a button', async () => {
    const { canvas } = open()
    await waitFor(() => expect(canvas).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveFocus()
  })

  // What the dialog library leaves focus on is its choice, not the user's, and it
  // is not always a button: a real session had it in a text box, which then ate
  // Space so the shortcut never fired. Whatever it was, the drawing surface wins.
  it('takes focus back from a text box, which would otherwise swallow Space', async () => {
    const { canvas } = open()
    // Inside the dialog: a box outside it would be pulled back by the focus trap,
    // so it would never hold focus long enough to swallow anything.
    const stray = document.createElement('input')
    canvas.appendChild(stray)
    stray.focus()
    expect(stray).toHaveFocus()

    await waitFor(() => expect(canvas).toHaveFocus())
  })

  it('keeps the modal open and shows why when the request fails', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('not a decodable image') })
    const { canvas } = open(onSubmit)
    drag(canvas, { x: 130, y: 112 }, { x: 230, y: 212 })
    await screen.findByPlaceholderText('Item name')

    fireEvent.click(screen.getByRole('button', { name: /Create 1 draft/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not a decodable image')
    // Still there, with the work intact.
    expect(screen.getByPlaceholderText('Item name')).toBeInTheDocument()
  })

  // The phone report this pins: the canvas has `touch-action: none`, so the
  // browser never turns two fingers into page zoom — if the modal does not
  // implement the pinch, nobody does.
  it('zooms with a two-finger pinch', () => {
    const { canvas } = open()
    const wrapper = screen.getByTestId('manual-unpack-image')

    const before = scaleOf(wrapper)
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 200, clientY: 100 })
    fireEvent.pointerDown(canvas, { pointerId: 2, button: 0, clientX: 300, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 2, buttons: 1, clientX: 350, clientY: 100 })

    expect(scaleOf(wrapper)).toBeGreaterThan(before)
  })

  // The second finger lands mid-draw more often than not — a box half-drawn by
  // the first finger must not be committed by the pinch's pointerups.
  it('discards the box a finger was drawing when a second finger lands', () => {
    const { canvas } = open()
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 130, clientY: 112 })
    fireEvent.pointerMove(canvas, { pointerId: 1, buttons: 1, clientX: 230, clientY: 212 })

    fireEvent.pointerDown(canvas, { pointerId: 2, button: 0, clientX: 300, clientY: 150 })
    fireEvent.pointerUp(canvas, { pointerId: 2 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })

    expect(screen.queryByPlaceholderText('Item name')).not.toBeInTheDocument()
  })

  // The desktop report this pins: the handles are authored in image pixels,
  // which the transform then scales — 12 units was ~3px on a phone photo at
  // fit, and every one of them showed the generic hand.
  it('gives each handle its axis cursor, at a screen-constant size', async () => {
    const { canvas } = open()
    drag(canvas, { x: 130, y: 112 }, { x: 230, y: 212 })
    await screen.findByPlaceholderText('Item name')

    const handle = (h: string) => canvas.querySelector(`[data-handle="${h}"]`)!
    expect(handle('nw').getAttribute('class')).toContain('cursor-nwse-resize')
    expect(handle('se').getAttribute('class')).toContain('cursor-nwse-resize')
    expect(handle('ne').getAttribute('class')).toContain('cursor-nesw-resize')
    expect(handle('sw').getAttribute('class')).toContain('cursor-nesw-resize')
    expect(handle('n').getAttribute('class')).toContain('cursor-ns-resize')
    expect(handle('s').getAttribute('class')).toContain('cursor-ns-resize')
    expect(handle('e').getAttribute('class')).toContain('cursor-ew-resize')
    expect(handle('w').getAttribute('class')).toContain('cursor-ew-resize')

    // At this suite's 0.5 display scale a 16px on-screen handle is 32 image
    // units wide; a fixed image-pixel size would shrink with every photo.
    expect(handle('nw').getAttribute('width')).toBe('32')
  })

  // The keyboard sentence is a column of wrapped text on a phone, and names
  // keys a phone does not have — the small-screen wording is the short one.
  it('has a short tap wording of the hint for screens without a keyboard', () => {
    open()
    expect(screen.getByText(/Tap a box to select it/)).toBeInTheDocument()
  })
})
