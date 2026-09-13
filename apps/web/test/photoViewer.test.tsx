import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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
  render(<PhotoViewer src={SRC} alt="Lamp" />)
  const container = screen.getByTestId('photo-viewer')
  container.getBoundingClientRect = box(VIEWPORT.width, VIEWPORT.height)
  const image = screen.getByRole('img', { name: 'Lamp' })
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: natural.width })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: natural.height })
  fireEvent.load(image)
  return { container, image }
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

// A pointer-down and -up in the same spot, which is the only thing the stage
// counts as a click.
const click = (element: Element, at = { clientX: 0, clientY: 0 }) => {
  fireEvent.pointerDown(element, { pointerId: 1, ...at })
  fireEvent.pointerUp(element, { pointerId: 1, ...at })
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
    render(<PhotoViewer src={SRC} alt="Lamp" />)
    const loading = screen.getByText('Loading…')
    expect(loading).toBeInTheDocument()
    // Never a pointer target: a clickable frame over the whole stage would
    // swallow the click that toggles the zoom — i.e. every click, for as long as
    // it is up.
    expect(loading).toHaveClass('pointer-events-none')
    expect(screen.getByRole('img', { name: 'Lamp' })).toHaveClass('invisible')
    expect(screen.getByRole('img', { name: 'Lamp' }).style.transform).toBe('')
  })

  // The stage is reused across photos — the surface keys it by image id to force
  // a remount, and this is the belt to that pair of braces. Without it, the new
  // photo would be drawn at the previous photo's zoom.
  it('starts over when the photo changes', () => {
    const { rerender } = render(<PhotoViewer src={SRC} alt="Lamp" />)
    const container = screen.getByTestId('photo-viewer')
    container.getBoundingClientRect = box(VIEWPORT.width, VIEWPORT.height)
    const first = screen.getByRole('img', { name: 'Lamp' })
    Object.defineProperty(first, 'naturalWidth', { configurable: true, value: LARGE.width })
    Object.defineProperty(first, 'naturalHeight', { configurable: true, value: LARGE.height })
    fireEvent.load(first)
    click(first) // zoom to 1:1
    expectTransform(first, { scale: 1, x: -1600, y: -1200 })

    rerender(<PhotoViewer src="/file/uploads/originals/b.png" alt="Lamp" />)
    const second = screen.getByRole('img', { name: 'Lamp' })
    expect(second).toHaveClass('invisible')
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})

// A rendition can 404 — a stale `images` row outlives the file on disk, and
// `/file/*` sets no cache headers, so a re-open re-fetches and can fail — and
// without a failure state the stage would sit on "Loading…" over black forever.
describe('PhotoViewer load failure', () => {
  // `openViewer` fires `load`, so this case renders raw.
  function openFailedViewer() {
    render(<PhotoViewer src={SRC} alt="Lamp" />)
    const container = screen.getByTestId('photo-viewer')
    container.getBoundingClientRect = box(VIEWPORT.width, VIEWPORT.height)
    const image = screen.getByRole('img', { name: 'Lamp' })
    fireEvent.error(image)
    return { container, image }
  }

  it('replaces the loading frame with a failure message', () => {
    const { image } = openFailedViewer()
    expect(screen.getByText('Could not load this photo')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    // The image never got a scene, so it stays hidden rather than drawing a
    // broken-image box.
    expect(image).toHaveClass('invisible')
  })

  it('keeps the message out of the way of the gesturing underneath it', () => {
    openFailedViewer()
    // The message covers the whole container and `onPointerDown` refuses any
    // target that is not the container or the image, so a message that took
    // pointers would leave the stage dead to every gesture for as long as it is
    // up.
    expect(screen.getByText('Could not load this photo')).toHaveClass('pointer-events-none')
  })
})

describe('PhotoViewer dismissal', () => {
  // The rule this replaces — "click the background → close" — belonged to the
  // full-viewport overlay. On a page there is no backdrop, and a click on empty
  // space discarding the item you are reading is hostile (ADR-0005). The stage
  // therefore has exactly one gesture on a click, and it is the photo's.
  it('does nothing when the space around the photo is clicked', () => {
    const { container, image } = openViewer(LARGE)
    click(container)
    expectTransform(image, { scale: 0.2, x: 0, y: 0 })
  })

  it('does nothing when a drag ends on that space either', () => {
    const { container, image } = openViewer(LARGE)
    click(image) // 1:1, where panning has somewhere to go
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 100, clientY: 100, buttons: 1 })
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 100, clientY: 100 })
    // Panned, and the release was not read as a click on the photo.
    expectTransform(image, { scale: 1, x: -1510, y: -1110 })
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

  // A drag that starts on the photo and ends there is a pan, not a click, or
  // every pan would also toggle the zoom on release.
  it('does not treat a drag on the photo as a click', () => {
    const { image } = openViewer(LARGE)
    // At fit the image fills the viewport exactly, so the pan itself clamps to
    // nothing — which leaves the zoom as the whole observable difference: a
    // release read as a click would have gone to 1:1.
    fireEvent.pointerDown(image, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(image, { pointerId: 1, clientX: 60, clientY: 10, buttons: 1 })
    fireEvent.pointerUp(image, { pointerId: 1, clientX: 60, clientY: 10 })
    expectTransform(image, { scale: 0.2, x: 0, y: 0 })
  })

  // A trackpad pinch is a `wheel` event with `ctrlKey`, whose default action is
  // the browser's page zoom. React's own `onWheel` is registered passively (it
  // cannot `preventDefault`), so the container carries a native, non-passive
  // listener for it. Dispatched natively rather than through `fireEvent`, because
  // the listener — not React — is what is under test here; a real browser pinch
  // is the e2e's job. `act` only because the state update React's own handler
  // queues from a native dispatch is not flushed by `fireEvent`'s batching.
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

  // The surface navigates with PageUp/PageDown, so the stage must not also claim
  // them — the split between the two handlers is by key, not by event order.
  it('leaves the navigation keys to the surface that hosts it', () => {
    const { container, image } = openViewer(LARGE)
    click(image)
    fireEvent.keyDown(container, { key: 'PageDown' })
    fireEvent.keyDown(container, { key: 'PageUp' })
    expectTransform(image, { scale: 1, x: -1600, y: -1200 })
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
    const { container, image } = openViewer(LARGE)
    fireEvent.pointerDown(container, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerDown(container, { pointerId: 2, clientX: 500, clientY: 300 })
    fireEvent.pointerUp(container, { pointerId: 2, clientX: 500, clientY: 300 })
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 300, clientY: 300 })
    expectTransform(image, { scale: 0.2, x: 0, y: 0 })
  })

  // jsdom implements no click-focus, so this pins the precondition rather than the
  // behaviour: the container must be focusable, or a click on the non-focusable
  // <img> sends focus to <body> and this container's keydown handler is never
  // reached. Verified in Chromium.
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

  // The stage accepts exactly two gesture targets, the container and the image,
  // and the navigator is neither. This is the test that pins that: a navigator
  // click must jump the view and leave the zoom alone, because a "the target is
  // not the image" test would arm a click and toggle the zoom on release.
  it('jumps the view when clicked, and does not toggle the zoom', () => {
    const { image } = openViewer(LARGE)
    click(image)
    const navigator = screen.getByRole('img', { name: 'Photo navigator' })
    navigator.getBoundingClientRect = box(120, 120)
    // The 4000×3000 image is contained as 120×90 in a 120×120 box, 15px down, so
    // (120, 60) is the image's right edge at half its height.
    fireEvent.pointerDown(navigator, { pointerId: 1, clientX: 120, clientY: 60 })
    fireEvent.pointerUp(navigator, { pointerId: 1, clientX: 120, clientY: 60 })
    expectTransform(image, { scale: 1, x: -3200, y: -1200 })
  })

  it('jumps the view when dragged inside it', () => {
    const { image } = openViewer(LARGE)
    click(image)
    const navigator = screen.getByRole('img', { name: 'Photo navigator' })
    navigator.getBoundingClientRect = box(120, 120)
    fireEvent.pointerDown(navigator, { pointerId: 1, clientX: 60, clientY: 60 })
    fireEvent.pointerMove(navigator, { pointerId: 1, clientX: 120, clientY: 60, buttons: 1 })
    fireEvent.pointerUp(navigator, { pointerId: 1, clientX: 120, clientY: 60 })
    expectTransform(image, { scale: 1, x: -3200, y: -1200 })
  })
})
