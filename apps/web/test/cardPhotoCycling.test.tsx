import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useCardPhotoCycling } from '../src/lib/photoIndex'

// Three photos, the primary NOT first: the server sends newest-first, so a card
// that took `images[0]` would show a photo nobody chose as the cover.
const photo = (id: number, isPrimary = false) => ({ id, isPrimary })
const THREE = [photo(3), photo(2, true), photo(1)]

// The hook is tested through a host element, because the gestures are attached to
// a DOM node: React's handlers and a non-passive native `wheel` listener only
// exist once something has rendered. A bare `renderHook` would exercise the
// state and none of the wiring that is the actual risk here.
function Thumbnail({
  photos = THREE,
  onOpen = () => {},
}: {
  photos?: { id: number; isPrimary: boolean }[]
  onOpen?: () => void
}) {
  const cycle = useCardPhotoCycling(photos, 7)
  return (
    <div>
      <div
        data-testid="thumb"
        tabIndex={0}
        ref={cycle.ref}
        onPointerDown={cycle.onPointerDown}
        onPointerMove={cycle.onPointerMove}
        onKeyDown={cycle.onKeyDown}
        onClickCapture={cycle.onClickCapture}
        onClick={onOpen}
      >
        {cycle.current && <span data-testid="id">{cycle.current.id}</span>}
        {cycle.indicator && <span data-testid="indicator">{cycle.indicator}</span>}
      </div>
    </div>
  )
}

const mount = (props: Parameters<typeof Thumbnail>[0] = {}) => {
  render(<Thumbnail {...props} />)
  return { thumb: screen.getByTestId('thumb'), shown: () => screen.getByTestId('id').textContent }
}

const indicator = () => screen.queryByTestId('indicator')?.textContent ?? null

// A horizontal wheel notch over the thumbnail: the desktop gesture.
const wheel = (target: HTMLElement, deltaX: number, deltaY = 0) => {
  const event = new WheelEvent('wheel', { deltaX, deltaY, cancelable: true, bubbles: true })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

// A one-finger drag: pointer down, move, up. The touch gesture is a horizontal
// scroll, which is the same thing expressed as pointer events.
const swipe = (target: HTMLElement, dx: number, dy = 0) => {
  act(() => {
    fireEvent.pointerDown(target, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy })
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy })
  })
}

describe('useCardPhotoCycling', () => {
  // It opens on the primary, because a card has always shown the primary and the
  // `n/N` badge is the position you land on when you open the card.
  it('starts on the primary and reports where it is in the set', () => {
    const { shown } = mount()
    expect(shown()).toBe('2')
    expect(indicator()).toBe('1/3')
  })

  it('does not cycle, or claim a position, for a single photo', () => {
    const { shown } = mount({ photos: [photo(9, true)] })
    expect(shown()).toBe('9')
    // A `1/1` badge is noise, and there is nowhere to go.
    expect(indicator()).toBeNull()
  })

  // The horizontal wheel is the desktop gesture. It has to be *horizontal*: an
  // ordinary vertical wheel notch over a card must keep scrolling the page, which
  // is what a trackpad's two-finger scroll sends.
  it('steps on a horizontal wheel notch, and leaves a vertical one to the page', () => {
    const { thumb, shown } = mount()

    wheel(thumb, 40)
    expect(shown()).toBe('3')
    wheel(thumb, 40)
    expect(shown()).toBe('1')

    // Vertical: not ours, and not stopped either — the page must still scroll.
    expect(wheel(thumb, 0, 120).defaultPrevented).toBe(false)
    expect(shown()).toBe('1')
  })

  // A horizontal wheel over a card is history navigation in some browsers, and an
  // item page is the last thing to lose. React's own `onWheel` is passive and
  // cannot do this, so the listener is attached natively — which is also what the
  // test above proves, by checking the event really was cancelled.
  it('stops the horizontal wheel from navigating away', () => {
    const { thumb } = mount()
    expect(wheel(thumb, 40).defaultPrevented).toBe(true)
  })

  // The touch gesture, and it loops: 3 of 3 then back round to the primary.
  it('steps on a horizontal swipe, and loops at both ends', () => {
    const { thumb, shown } = mount()

    swipe(thumb, -60)
    expect(shown()).toBe('3')
    swipe(thumb, -60)
    expect(shown()).toBe('1')
    swipe(thumb, -60)
    expect(shown()).toBe('2')

    // The other way, off the front onto the last.
    swipe(thumb, 60)
    expect(shown()).toBe('1')
  })

  // A mostly-vertical drag is a scroll, not a swipe, and must not be eaten.
  it('leaves a mostly-vertical drag alone', () => {
    const { thumb, shown } = mount()
    swipe(thumb, 10, -80)
    expect(shown()).toBe('2')
  })

  // A tap is a tap: below the threshold nothing is stepped, so the click that
  // follows is the card's own click target — open the item, or select it.
  it('treats a drag shorter than the threshold as a tap', () => {
    const { thumb, shown } = mount()
    swipe(thumb, -2)
    expect(shown()).toBe('2')
  })

  // The swipe and the tap are the same pointer gesture and the browser fires the
  // click either way. Left alone, every swipe would also open the item.
  it('swallows the click that ends a swipe, and leaves a tap alone', () => {
    const open = vi.fn()
    const { thumb } = mount({ onOpen: open })

    fireEvent.click(thumb)
    expect(open).toHaveBeenCalledTimes(1)

    swipe(thumb, -60)
    fireEvent.click(thumb)
    expect(open).toHaveBeenCalledTimes(1)
  })

  // Wheel and swipe are pointer-only, so the focused thumbnail is the keyboard
  // path — and it is where a keyboard user lands once the photo is the link.
  it('steps with the arrow keys, and keeps them from scrolling the page', () => {
    const { thumb, shown } = mount()

    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    act(() => {
      thumb.dispatchEvent(right)
    })
    expect(shown()).toBe('3')
    expect(right.defaultPrevented).toBe(true)

    act(() => {
      thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    })
    expect(shown()).toBe('2')

    // Enter is the browser's, and has to reach whatever is underneath.
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    act(() => {
      thumb.dispatchEvent(enter)
    })
    expect(enter.defaultPrevented).toBe(false)
  })

  // One card, one item: a photo that goes away must not leave the counter
  // pointing past the end of what is left.
  it('keeps the position inside the set when a photo goes away', () => {
    const { rerender } = render(<Thumbnail photos={THREE} />)
    swipe(screen.getByTestId('thumb'), -60)
    expect(indicator()).toBe('2/3')

    rerender(<Thumbnail photos={[photo(2, true)]} />)
    expect(indicator()).toBeNull()
    expect(screen.getByTestId('id').textContent).toBe('2')
  })

})
