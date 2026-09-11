import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PhotoViewer } from '../src/ui/PhotoViewer'

const VIEWPORT = { width: 800, height: 600 }
const LARGE = { width: 4000, height: 3000 }
const SMALL = { width: 400, height: 300 }
const SRC = '/file/uploads/edited/e.png'

const box = (width: number, height: number) => () => ({
  x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}),
})

// jsdom lays nothing out and never loads an image, so the two facts the viewer
// reads off the DOM — the container's box and the image's intrinsic size — are
// supplied here. Nothing else is stubbed: the geometry runs for real.
function openViewer(natural = LARGE) {
  const onClose = vi.fn()
  render(<PhotoViewer src={SRC} alt="Lamp" onClose={onClose} />)
  const container = screen.getByTestId('photo-viewer')
  container.getBoundingClientRect = box(VIEWPORT.width, VIEWPORT.height)
  const image = screen.getByRole('img', { name: 'Lamp' })
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: natural.width })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: natural.height })
  fireEvent.load(image)
  return { onClose, container, image }
}

// Parsed rather than string-compared: the centring arithmetic legitimately lands
// on values like -5.7e-14.
function transformOf(element: HTMLElement) {
  const match = element.style.transform.match(
    /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/,
  )
  if (!match) throw new Error(`unparseable transform: ${element.style.transform}`)
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) }
}

const expectTransform = (element: HTMLElement, expected: { x: number; y: number; scale: number }) => {
  const actual = transformOf(element)
  expect(actual.x).toBeCloseTo(expected.x)
  expect(actual.y).toBeCloseTo(expected.y)
  expect(actual.scale).toBeCloseTo(expected.scale)
}

describe('PhotoViewer initial zoom', () => {
  it('fits an image larger than the viewport', () => {
    const { image } = openViewer(LARGE)
    expectTransform(image, { scale: 0.2, x: 0, y: 0 })
  })

  it('shows an image that already fits at natural size, centred and never upscaled', () => {
    const { image } = openViewer(SMALL)
    expectTransform(image, { scale: 1, x: 200, y: 150 })
  })

  it('shows a loading frame until the image has loaded, never a wrong-zoom flash', () => {
    render(<PhotoViewer src={SRC} alt="Lamp" onClose={vi.fn()} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Lamp' })).toHaveClass('invisible')
    expect(screen.getByRole('img', { name: 'Lamp' }).style.transform).toBe('')
  })
})

describe('PhotoViewer chrome', () => {
  it('closes on the close button, which is always visible', () => {
    const { onClose } = openViewer(LARGE)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens the rendition in a new tab from the Open original link', () => {
    openViewer(LARGE)
    const link = screen.getByRole('link', { name: 'Open original' })
    expect(link).toHaveAttribute('href', SRC)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  // Escape comes from Modal, but the wiring from its `onOpenChange` to this
  // component's `onClose` is ours, and nothing else would catch it going missing.
  it('closes on Escape', async () => {
    const { onClose } = openViewer(LARGE)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})

// A pointer-down and -up in the same spot, which is the only thing the viewer
// counts as a click.
const click = (element: Element, at = { clientX: 0, clientY: 0 }) => {
  fireEvent.pointerDown(element, { pointerId: 1, ...at })
  fireEvent.pointerUp(element, { pointerId: 1, ...at })
}

describe('PhotoViewer dismissal', () => {
  it('closes when the backdrop itself is clicked', () => {
    const { container, onClose } = openViewer(LARGE)
    click(container)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when a drag ends on the backdrop', () => {
    const { container, onClose } = openViewer(LARGE)
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 100, clientY: 100, buttons: 1 })
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 100, clientY: 100 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('toggles fit and 1:1 when the image is clicked', () => {
    const { image } = openViewer(LARGE)
    click(image)
    expectTransform(image, { scale: 1, x: -1600, y: -1200 })
    click(image)
    expectTransform(image, { scale: 0.2, x: 0, y: 0 })
  })

  it('does nothing when the image already fits, because there is no second state', () => {
    const { image } = openViewer(SMALL)
    click(image)
    expectTransform(image, { scale: 1, x: 200, y: 150 })
  })
})

describe('PhotoViewer pan', () => {
  it('pans by the drag delta', () => {
    const { container, image } = openViewer(LARGE)
    click(image) // 1:1, where there is something off-screen to pan to
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 500, clientY: 350, buttons: 1 })
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 500, clientY: 350 })
    expectTransform(image, { scale: 1, x: -1500, y: -1150 })
  })
})

describe('PhotoViewer zoom and keyboard pan', () => {
  it('pans with the arrow keys, so the feature works without a pointer', () => {
    const { container, image } = openViewer(LARGE)
    click(image) // 1:1, where panning has somewhere to go
    fireEvent.keyDown(container, { key: 'ArrowRight' })
    expectTransform(image, { scale: 1, x: -1600 - 48, y: -1200 })
    fireEvent.keyDown(container, { key: 'ArrowDown' })
    expectTransform(image, { scale: 1, x: -1648, y: -1200 - 48 })
  })

  it('ignores keys it does not pan with', () => {
    const { container, image } = openViewer(LARGE)
    click(image)
    fireEvent.keyDown(container, { key: 'a' })
    expectTransform(image, { scale: 1, x: -1600, y: -1200 })
  })

  it('zooms about the pointer on wheel', () => {
    const { container, image } = openViewer(LARGE)
    fireEvent.wheel(container, { clientX: 400, clientY: 300, deltaY: -100 })
    // exp(100 / 400): exponential, so the gesture is scale-free — the same swipe
    // changes the zoom by the same factor at any magnification. A wheel notch
    // (deltaY -100) is one step of exactly that.
    const scale = 0.2 * Math.exp(0.25)
    expectTransform(image, { scale, x: 400 - (scale / 0.2) * 400, y: 300 - (scale / 0.2) * 300 })
  })

  it('zooms on a two-finger pinch', () => {
    const { container, image } = openViewer(LARGE)
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerDown(container, { pointerId: 2, clientX: 500, clientY: 300 })
    // Fingers 200px apart move to 300px: a factor of 1.5 about their midpoint.
    fireEvent.pointerMove(container, { pointerId: 2, clientX: 600, clientY: 300 })
    expectTransform(image, { scale: 0.3, x: -225, y: -150 })
  })

  it('does not treat the second finger of a pinch as a click', () => {
    const { container, onClose } = openViewer(LARGE)
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerDown(container, { pointerId: 2, clientX: 500, clientY: 300 })
    fireEvent.pointerUp(container, { pointerId: 2, clientX: 500, clientY: 300 })
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 300, clientY: 300 })
    expect(onClose).not.toHaveBeenCalled()
  })
})
