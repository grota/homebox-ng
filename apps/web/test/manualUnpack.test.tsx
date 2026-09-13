import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  boxFromCorners,
  isDrawable,
  moveBox,
  resizeBox,
  toImagePoint,
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
})
