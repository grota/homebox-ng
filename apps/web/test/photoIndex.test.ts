import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { orderPhotos, usePhotoIndex } from '../src/lib/photoIndex'

// The server's order is `sortOrder desc` — newest first — so these arrive in that
// order and the primary is somewhere inside it, not necessarily first.
const photo = (id: number, isPrimary = false) => ({ id, isPrimary })
const NEWEST_FIRST = [photo(3), photo(2, true), photo(1)]

describe('orderPhotos', () => {
  it('lifts the primary to the front and leaves the rest in the server order', () => {
    expect(orderPhotos(NEWEST_FIRST).map((p) => p.id)).toEqual([2, 3, 1])
  })

  it('changes nothing when there is no primary, or the primary is already first', () => {
    expect(orderPhotos([photo(3), photo(1)]).map((p) => p.id)).toEqual([3, 1])
    expect(orderPhotos([photo(3, true), photo(1)]).map((p) => p.id)).toEqual([3, 1])
  })
})

describe('usePhotoIndex', () => {
  it('opens on the primary, which is the first photo shown', () => {
    const { result } = renderHook(() => usePhotoIndex(NEWEST_FIRST, 7))
    expect(result.current.current?.id).toBe(2)
    expect(result.current.index).toBe(0)
  })

  it('opens on the newest when nothing is primary', () => {
    const { result } = renderHook(() => usePhotoIndex([photo(3), photo(1)], 7))
    expect(result.current.current?.id).toBe(3)
  })

  // The carousel loops: stepping past the last photo lands on the first, and
  // stepping back before the first lands on the last. Both ends used to stop dead
  // with a disabled arrow, which on a list of items with two photos each meant
  // most arrows on screen were dead.
  it('wraps at both ends rather than stopping', () => {
    const { result } = renderHook(() => usePhotoIndex(NEWEST_FIRST, 7))

    // Forward off the end: 1 of 3 → 1 of 3, i.e. the primary again.
    act(() => result.current.next())
    act(() => result.current.next())
    expect(result.current.current?.id).toBe(1)
    act(() => result.current.next())
    expect(result.current.current?.id).toBe(2)

    // Back off the front, onto the last.
    act(() => result.current.previous())
    expect(result.current.current?.id).toBe(1)

    // A single photo wraps onto itself rather than going nowhere.
    const one = renderHook(() => usePhotoIndex([photo(9, true)], 7))
    act(() => one.result.current.next())
    expect(one.result.current.current?.id).toBe(9)
    act(() => one.result.current.previous())
    expect(one.result.current.current?.id).toBe(9)
  })

  // With wrapping there is no "end" to be disabled at, so an item with more than
  // one photo can always be stepped in either direction. One photo has nowhere to
  // go, so the arrows are the only thing that knows that.
  it('can always step while there is more than one photo, and cannot with one', () => {
    const { result } = renderHook(() => usePhotoIndex(NEWEST_FIRST, 7))
    expect(result.current.canPrevious).toBe(true)
    expect(result.current.canNext).toBe(true)

    act(() => result.current.next())
    act(() => result.current.next())
    expect(result.current.canNext).toBe(true)
    expect(result.current.canPrevious).toBe(true)

    const one = renderHook(() => usePhotoIndex([photo(9, true)], 7))
    expect(one.result.current.canNext).toBe(false)
    expect(one.result.current.canPrevious).toBe(false)
  })

  // The reason the index is not "fixed up" when the list changes: the refetch
  // after a delete is what produces the desired landing spot.
  it('lands on the next photo when the one on screen is deleted', () => {
    const { result, rerender } = renderHook(({ photos }) => usePhotoIndex(photos, 7), {
      initialProps: { photos: NEWEST_FIRST },
    })
    act(() => result.current.next())
    expect(result.current.current?.id).toBe(3)

    // 3 is gone: the list is one shorter and 1 takes its place.
    rerender({ photos: [photo(2, true), photo(1)] })
    expect(result.current.current?.id).toBe(1)
  })

  it('lands on the previous photo when the last one is deleted', () => {
    const { result, rerender } = renderHook(({ photos }) => usePhotoIndex(photos, 7), {
      initialProps: { photos: NEWEST_FIRST },
    })
    act(() => result.current.next())
    act(() => result.current.next())
    expect(result.current.current?.id).toBe(1)

    // Photo 1 is gone, leaving [2, 3] in display order. The index is past the
    // end, so the clamp lands on the new last — photo 3, which is the one before
    // the photo that was deleted.
    rerender({ photos: [photo(3), photo(2, true)] })
    expect(result.current.current?.id).toBe(3)
  })

  it('reports nothing current when the last photo goes, so the caller can close', () => {
    const { result, rerender } = renderHook(({ photos }) => usePhotoIndex(photos, 7), {
      initialProps: { photos: NEWEST_FIRST },
    })
    rerender({ photos: [] })
    expect(result.current.current).toBeNull()
    expect(result.current.canNext).toBe(false)
    expect(result.current.canPrevious).toBe(false)
  })

  // One route component serves every item, so without the key the index would
  // carry from the item you were looking at to the one you opened next.
  it('starts over when the item changes', () => {
    const { result, rerender } = renderHook(({ key }) => usePhotoIndex(NEWEST_FIRST, key), {
      initialProps: { key: 7 },
    })
    act(() => result.current.next())
    expect(result.current.index).toBe(1)

    rerender({ key: 8 })
    expect(result.current.index).toBe(0)
  })
})
