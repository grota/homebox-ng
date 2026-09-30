import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'

// Where an item is in its photos. Two hosts ask: the item surface, and the trash
// peek — which is why this is shared rather than inline in one of them.

// An item's photos in the one order the app uses: the primary first, then the
// rest newest-first.
//
// Only the primary half is decided here. Newest-first is the *server's* ordering
// (`listImages` in `apps/api/src/modules/items/repo.ts` orders by `sortOrder
// desc`), and this is a stable filter that lifts the primary to the front without
// disturbing it — so there is one place that decides order, and it is not this.
export const orderPhotos = <T extends { isPrimary: boolean | null }>(photos: T[]): T[] => [
  ...photos.filter((photo) => photo.isPrimary),
  ...photos.filter((photo) => !photo.isPrimary),
]

export type PhotoIndex<T> = {
  photos: T[]
  index: number
  current: T | null
  setIndex: (next: number) => void
  next: () => void
  previous: () => void
  /** False for zero or one photo: with wrapping, both arrows live or die together. */
  canCycle: boolean
}

// The index is deliberately *not* reset or fixed up when the photo list changes,
// and that is the whole design: every mutation invalidates `items.get`, so
// deleting the photo on screen refetches a list one shorter and the next photo
// takes its slot — which is exactly "land on the next one". Deleting the last one
// leaves the index past the end and the clamp below lands on the new last, i.e.
// the previous. The host closes only when no photos are left.
//
// `resetKey` is the item's id: the surface is one route component reused across
// items, so without it the index would carry from one item to the next. Keyed
// state rather than an effect, because an effect would paint one frame of the
// previous item's photo position before correcting itself.
export function usePhotoIndex<T extends { isPrimary: boolean | null }>(
  photos: T[],
  resetKey: unknown,
  // Where a *reset* lands, rather than always the first photo. The trash peek is
  // why: it opens on whatever photo the card was showing, so reopening a card you
  // had swiped to the third photo does not throw that away. Every other host
  // resets across items, where the first photo is the right answer, and leaves
  // this alone.
  startIndex = 0,
): PhotoIndex<T> {
  const ordered = useMemo(() => orderPhotos(photos), [photos])
  const [state, setState] = useState({ key: resetKey, index: startIndex })
  const index = Math.min(state.key === resetKey ? state.index : startIndex, Math.max(0, ordered.length - 1))
  const setIndex = (next: number) => setState({ key: resetKey, index: next })

  return {
    photos: ordered,
    index,
    current: ordered[index] ?? null,
    setIndex,
    // The carousel loops, both ways. It used to stop at each end with a disabled
    // arrow, which was worse than wrong-looking: an item with two photos was the
    // common case, so most arrows on screen were dead, and a reader who knew the
    // last photo was on the left had to walk back through every one.
    //
    // Modulo rather than a branch, and it has to be the positive form: JS `%` keeps
    // the sign of the dividend, so `(-1) % 3` is `-1` and the clamp below would
    // land on nothing.
    next: () => setIndex((index + 1) % ordered.length),
    previous: () => setIndex((index - 1 + ordered.length) % ordered.length),
    // With wrapping there is no end to run out of, so this is only ever about
    // whether there is anywhere to go at all: one photo, or none.
    canCycle: ordered.length > 1,
  }
}

// How far a pointer had to travel before a drag stopped being a tap. The same
// number `PhotoViewer` uses, for the same reason: a finger resting on a phone
// moves a pixel or two.
const SWIPE_THRESHOLD = 4

export type CardPhotoCycling<T> = {
  /** The photo the card is showing, or `null` when there are none. */
  current: T | null
  /** Where it is in the set, 1-based — what the `n/N` badge prints. */
  index: number
  /** `false` for zero or one photo: there is nowhere to cycle to. */
  canCycle: boolean
  /** `n/N`, or `null` when cycling is off — a `1/1` badge is noise. */
  indicator: string | null
  /**
   * Attach to the element carrying the gestures, normally the thumbnail. A
   * callback ref rather than an object one, so it types as whatever the host
   * element is — a `<div>`, a `<Link>` or a `<button>` — without the hook having to
   * know which, and so the effect below can depend on the node having arrived.
   */
  ref: (node: HTMLElement | null) => void
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onKeyDown: (event: React.KeyboardEvent) => void
  /** The card's own click target still needs this; it only cancels after a swipe. */
  onClickCapture: (event: React.MouseEvent) => void
}

// Cycling a card's photos without leaving the list: a horizontal wheel notch over
// the thumbnail, a one-finger swipe, or the arrow keys once it has focus. Shared
// by all three card surfaces (catalog, drafts, trash) because they are the same
// gesture over the same picture and only the click target differs.
//
// It is a hook rather than a component because each card decides what its own
// click *means* — the catalog card's photo opens the item, the trash card's opens
// the peek — and that must not be baked into a shared wrapper.
export function useCardPhotoCycling<T extends { isPrimary: boolean | null }>(
  photos: T[],
  resetKey: unknown,
): CardPhotoCycling<T> {
  const { current, index, photos: ordered, next, previous, canCycle } = usePhotoIndex(photos, resetKey)

  // The pointer's starting point, and whether the gesture became a swipe. Kept in
  // a ref rather than state because it is read and written inside a drag and
  // re-rendering on it would be free anyway — nothing on screen depends on it.
  const start = useRef<{ x: number; y: number; swiped: boolean } | null>(null)
  // The thumbnail element itself, as state rather than a ref: the wheel listener
  // has to be attached once the node exists, and a ref read inside an effect is
  // still `null` on the first one.
  const [node, setNode] = useState<HTMLElement | null>(null)
  const ref = useCallback((next: HTMLElement | null) => setNode(next), [])

  // The wheel listener is attached natively and non-passively, because React's
  // own `onWheel` is passive and a passive listener cannot `preventDefault` — and
  // a horizontal wheel notch over a card is history navigation in some browsers.
  // Only horizontal is taken; a vertical notch still scrolls the page.
  useEffect(() => {
    if (!node || !canCycle) return
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      if (event.deltaX > 0) next()
      else previous()
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [node, canCycle, next, previous])

  const onPointerDown = (event: React.PointerEvent) => {
    if (!canCycle) return
    start.current = { x: event.clientX, y: event.clientY, swiped: false }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const from = start.current
    // Mostly-vertical is a scroll, not a swipe: leave it to the page.
    if (!from || from.swiped || Math.abs(event.clientY - from.y) > Math.abs(event.clientX - from.x)) return
    if (Math.abs(event.clientX - from.x) >= SWIPE_THRESHOLD) {
      // A leftward drag reveals the next photo, like scrolling a strip that way.
      if (event.clientX < from.x) next()
      else previous()
      from.swiped = true
    }
  }

  // A swipe and a tap are the same pointer gesture, and the browser fires the
  // click either way — so without this, cycling a card with one gesture would
  // also open the item with it.
  //
  // There is deliberately no `pointerup` handler. The browser fires `click` after
  // `pointerup`, so clearing the flag there would clear it before the click it
  // exists to cancel. It is armed per gesture instead — `onPointerDown` overwrites
  // it — and a click on a thumbnail always follows a pointerdown on it, so it can
  // never go stale.
  const onClickCapture = (event: React.MouseEvent) => {
    if (!start.current?.swiped) return
    event.preventDefault()
    event.stopPropagation()
    start.current = null
  }

  // The keyboard path for a gesture set that is otherwise pointer-only, which is
  // also where the browser puts focus once the thumbnail is a link.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!canCycle) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      next()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      previous()
    }
  }

  return {
    current,
    index,
    canCycle,
    indicator: canCycle ? `${index + 1}/${ordered.length}` : null,
    ref,
    onPointerDown,
    onPointerMove,
    onKeyDown,
    onClickCapture,
  }
}
