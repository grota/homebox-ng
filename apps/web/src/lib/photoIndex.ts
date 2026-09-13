import { useMemo, useState } from 'react'

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
  canPrevious: boolean
  canNext: boolean
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
): PhotoIndex<T> {
  const ordered = useMemo(() => orderPhotos(photos), [photos])
  const [state, setState] = useState({ key: resetKey, index: 0 })
  const index = Math.min(state.key === resetKey ? state.index : 0, Math.max(0, ordered.length - 1))
  const setIndex = (next: number) => setState({ key: resetKey, index: next })

  return {
    photos: ordered,
    index,
    current: ordered[index] ?? null,
    setIndex,
    next: () => setIndex(Math.min(index + 1, ordered.length - 1)),
    previous: () => setIndex(Math.max(index - 1, 0)),
    // Disabled at the ends rather than wrapping: a wrap would move "7 of 7" to
    // "1 of 7" with nothing to signal it.
    canPrevious: index > 0,
    canNext: index < ordered.length - 1,
  }
}
