import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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
    const loading = screen.getByText('Loading…')
    expect(loading).toBeInTheDocument()
    // Never a pointer target: the backdrop's dismissal is a positive check on
    // the container, so an intercepting loading frame would kill it.
    expect(loading).toHaveClass('pointer-events-none')
    expect(screen.getByRole('img', { name: 'Lamp' })).toHaveClass('invisible')
    expect(screen.getByRole('img', { name: 'Lamp' }).style.transform).toBe('')
  })
})

// A rendition can 404 — a stale `images` row outlives the file on disk, and
// `/file/*` sets no cache headers, so a re-open re-fetches and can fail — and
// without a failure state the viewer would sit on "Loading…" over black forever.
describe('PhotoViewer load failure', () => {
  // `openViewer` fires `load`, so this case renders raw.
  function openFailedViewer() {
    const onClose = vi.fn()
    render(<PhotoViewer src={SRC} alt="Lamp" onClose={onClose} />)
    const container = screen.getByTestId('photo-viewer')
    container.getBoundingClientRect = box(VIEWPORT.width, VIEWPORT.height)
    const image = screen.getByRole('img', { name: 'Lamp' })
    fireEvent.error(image)
    return { onClose, container, image }
  }

  it('replaces the loading frame with a failure message', () => {
    const { image } = openFailedViewer()
    expect(screen.getByText('Could not load this photo')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    // The image never got a scene, so it stays hidden rather than drawing a
    // broken-image box.
    expect(image).toHaveClass('invisible')
  })

  it('keeps the message out of the way of the backdrop, which still dismisses', () => {
    const { container, onClose } = openFailedViewer()
    // The message covers the whole container and `onPointerDown` refuses any
    // target that is not the container or the image, so a message that took
    // pointers would make backdrop-closing dead for as long as it is up. jsdom
    // does no hit-testing, so the class is the assertable half of that; the
    // click below pins the resulting behaviour.
    expect(screen.getByText('Could not load this photo')).toHaveClass('pointer-events-none')
    click(container)
    expect(onClose).toHaveBeenCalledTimes(1)
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

  // A trackpad pinch is a `wheel` event with `ctrlKey`, whose default action is
  // the browser's page zoom. React's own `onWheel` is registered passively (it
  // cannot `preventDefault`) and Radix's scroll lock lets pinch events through on
  // purpose, so the container carries a native, non-passive listener for it.
  // Dispatched natively rather than through `fireEvent`, because the listener —
  // not React — is what is under test here; a real browser pinch is the e2e's
  // job. `act` only because the state update React's own handler queues from a
  // native dispatch is not flushed by `fireEvent`'s batching.
  it('cancels the page zoom a pinch would trigger, and still zooms the photo', () => {
    const { container, image } = openViewer(LARGE)
    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: 400,
      clientY: 300,
      bubbles: true,
      cancelable: true,
    })
    act(() => container.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    // Cancelled, not swallowed: no `stopPropagation`, so the zoom still happens.
    const scale = 0.2 * Math.exp(0.25)
    expectTransform(image, { scale, x: 400 - (scale / 0.2) * 400, y: 300 - (scale / 0.2) * 300 })
  })
})

describe('PhotoViewer non-primary buttons', () => {
  it('ignores a right-click on the backdrop', () => {
    const { container, onClose } = openViewer(LARGE)
    fireEvent.pointerDown(container, { pointerId: 1, button: 2 })
    fireEvent.pointerUp(container, { pointerId: 1, button: 2 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores a right-click on the photo', () => {
    const { image } = openViewer(LARGE)
    fireEvent.pointerDown(image, { pointerId: 1, button: 2 })
    fireEvent.pointerUp(image, { pointerId: 1, button: 2 })
    expectTransform(image, { scale: 0.2, x: 0, y: 0 })
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

  // jsdom implements no click-focus, so this pins the precondition rather than the
  // behaviour: the container must be focusable, or a click on the <img> hands focus
  // to Radix's `tabindex="-1"` Dialog.Content and this container's keydown handler
  // is never reached. Verified in Chromium; Task 10's browser checkpoint exercises
  // the real interaction.
  it('keeps the container focusable so arrow keys survive a click on the photo', () => {
    const { container } = openViewer(LARGE)
    expect(container).toHaveAttribute('tabindex', '-1')
  })
})

describe('PhotoViewer navigator', () => {
  it('is absent while the whole image is visible', () => {
    openViewer(LARGE)
    // At fit there is nothing off-screen, so a navigator would be a second copy
    // of an image with nothing to navigate.
    expect(screen.queryByRole('img', { name: 'Photo navigator' })).not.toBeInTheDocument()
  })

  it('appears once the image overflows the viewport', () => {
    const { image } = openViewer(LARGE)
    click(image)
    expect(screen.getByRole('img', { name: 'Photo navigator' })).toBeInTheDocument()
  })

  it('stays absent for an image that cannot be zoomed past the viewport', () => {
    const { image } = openViewer(SMALL)
    click(image)
    expect(screen.queryByRole('img', { name: 'Photo navigator' })).not.toBeInTheDocument()
  })

  // The dismissal rule is a positive check on the backdrop element, not a
  // negative "the target is not the image". This is the test that tells them
  // apart: the navigator is neither the image nor the backdrop, so under the
  // negative rule the pointer sequence below would arm a click and dismiss the
  // viewer on the release.
  it('jumps the view when clicked, and does not dismiss the viewer', () => {
    const { image, onClose } = openViewer(LARGE)
    click(image)
    const navigator = screen.getByRole('img', { name: 'Photo navigator' })
    navigator.getBoundingClientRect = box(120, 120)
    // The 4000×3000 image is contained as 120×90 in a 120×120 box, 15px down, so
    // (120, 60) is the image's right edge at half its height.
    fireEvent.pointerDown(navigator, { pointerId: 1, clientX: 120, clientY: 60 })
    fireEvent.pointerUp(navigator, { pointerId: 1, clientX: 120, clientY: 60 })
    expectTransform(image, { scale: 1, x: -3200, y: -1200 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('jumps the view when dragged inside it', () => {
    const { image, onClose } = openViewer(LARGE)
    click(image)
    const navigator = screen.getByRole('img', { name: 'Photo navigator' })
    navigator.getBoundingClientRect = box(120, 120)
    fireEvent.pointerDown(navigator, { pointerId: 1, clientX: 60, clientY: 60 })
    fireEvent.pointerMove(navigator, { pointerId: 1, clientX: 120, clientY: 60, buttons: 1 })
    fireEvent.pointerUp(navigator, { pointerId: 1, clientX: 120, clientY: 60 })
    expectTransform(image, { scale: 1, x: -3200, y: -1200 })
    expect(onClose).not.toHaveBeenCalled()
  })
})
