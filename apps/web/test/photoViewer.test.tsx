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
