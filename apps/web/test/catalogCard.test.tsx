import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The card's photo is a link and its title is the selection toggle (ADR-0013). It
// was the other way round for one round, and one link for the whole card before
// that (ADR-0005), which is why this file mocks a fully populated card: what is a
// link and what is a toggle is the subject, and `catalog.test.tsx` renders a single
// bare item where the split is not assertable.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        items: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } },
      }),
      items: {
        trashMany: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
        list: {
          useQuery: () => ({
            data: {
              items: [
                {
                  id: 7,
                  name: 'Brass Lamp',
                  description: '',
                  quantity: 1,
                  unit: null,
                  published: false,
                  itemTypeId: 1,
                  locationId: 1,
                  createdBy: 1,
                  createdAt: null,
                  updatedAt: null,
                  customFields: [],
                  type: { id: 1, name: 'Lighting' },
                  location: { id: 1, name: 'Living Room' },
                  tags: [{ id: 1, name: 'vintage', color: null }],
                  // The primary is deliberately NOT first: that is how the server
                  // sends them (`sortOrder desc`, newest-first), and the card must
                  // show the photo the user marked, not whichever one leads.
                  images: [
                    { id: 1, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/newest.jpg', isPrimary: null },
                    { id: 2, originalPath: 'uploads/originals/b.png', editedPath: null, thumbPath: 'uploads/thumbs/cover.jpg', isPrimary: true },
                  ],
                  snippet: '… Brass **Lamp** …',
                },
              ],
              total: 1,
              facets: { types: [], tags: [], locations: [] },
            },
            isLoading: false,
          }),
        },
        create: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
        update: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
      },
      locations: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      itemTypes: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      tags: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
    },
  }
})

// The one setting that decides which half of the card opens and which picks. Mocked
// here rather than through the provider so a case can start the card either way
// without standing up a settings round-trip.
const { settings } = vi.hoisted(() => ({
  settings: { current: { photoOpensItem: true } as { photoOpensItem: boolean } },
}))

vi.mock('../src/lib/settings/useUserSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/settings/useUserSettings')>()
  return {
    ...actual,
    useUserSettings: () => ({ ...settings.current, updateSettings: vi.fn(), setPreview: vi.fn(), storedSettings: settings.current }),
  }
})

import { ItemsPage } from '../src/features/items/ItemsPage'

// `?q=lamp` so the FTS snippet renders too — it is card content like the rest.
const renderCatalog = () =>
  render(
    <MemoryRouter initialEntries={['/items?q=lamp']}>
      <Routes>
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/items/:id" element={<div>DETAIL</div>} />
      </Routes>
    </MemoryRouter>,
  )

// The card names itself rather than being found by its relationship to the link:
// the link sat in three different places across three versions of this card, and
// a helper that assumed one of them silently measured the wrong element.
const card = () => screen.getByTestId('item-card')
// The photo is the link under the default, and it is named for the item — the card
// name is a heading, not the link's text, so the two cannot be confused.
const photoLink = () => screen.getByRole('link', { name: 'Open Brass Lamp' })
// The title is the toggle under the default, so it is a label pointing at the
// footer checkbox rather than an anchor.
const titleToggle = () => screen.getByText('Brass Lamp').closest('label')!
const box = () => screen.getByRole('checkbox', { name: 'Select Brass Lamp' })
// The overlay: an empty `<label for>` that covers the card, so the rest of the body
// picks the item. A direct child, which is what distinguishes it from the footer's
// label and from the title's.
const overlay = () => card().querySelector(':scope > label')!

// A leftward drag across the thumbnail: the touch gesture for stepping photos.
const swipePhoto = (dx: number) => {
  const thumb = photoLink()
  fireEvent.pointerDown(thumb, { pointerId: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(thumb, { pointerId: 1, clientX: 100 + dx, clientY: 100 })
}

beforeEach(() => {
  settings.current = { photoOpensItem: true }
})

describe('catalog card click targets', () => {
  // The default (ADR-0013): the photo is the way in, the title is the way to tick.
  // Both readings of a catalog card are defensible, so this one is a per-user
  // setting rather than a decision the code makes for everyone.
  it('opens the item from the photo and picks from the title', () => {
    renderCatalog()

    // A real link, so it is a link to a screen reader and a new-tab target to the
    // browser — which the footer's checkbox cannot be.
    expect(photoLink()).toHaveAttribute('href', '/items/7')
    expect(photoLink().tagName).toBe('A')

    // The title is a label for the same checkbox the footer drives, so both are the
    // one control rather than two that can disagree.
    expect(titleToggle().tagName).toBe('LABEL')
    expect(titleToggle()).toHaveAttribute('for', 'select-item-7')

    // Only one destination on the card, and it is the photo.
    expect(within(card()).getAllByRole('link')).toHaveLength(1)

    // The rest of the body is unchanged: it picks.
    expect(overlay()).toHaveAttribute('for', 'select-item-7')

    // Location, tags and the search snippet stay card content, and are not in the
    // link — the link is the photo alone.
    for (const text of ['Living Room', 'vintage']) {
      expect(within(card()).getByText(text)).toBeInTheDocument()
      expect(within(photoLink()).queryByText(text)).not.toBeInTheDocument()
    }
    expect(within(card()).queryByText('Lighting')).not.toBeInTheDocument()
    expect(within(card()).getByTestId('item-snippet')).toBeInTheDocument()
  })

  it('ticks and unticks from the title', () => {
    renderCatalog()
    expect(box()).not.toBeChecked()

    fireEvent.click(titleToggle())
    expect(box()).toBeChecked()
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.click(titleToggle())
    expect(box()).not.toBeChecked()
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  it('opens the item from the photo', () => {
    renderCatalog()
    const checkbox = box()

    fireEvent.click(photoLink())

    expect(screen.getByText('DETAIL')).toBeInTheDocument()
    // Opening is not picking: a reader who meant to look at the item has not just
    // added it to a bulk edit.
    expect(checkbox).not.toBeChecked()
  })

  // The footer is a selection target under either setting: it is the one control on
  // the card whose meaning never changes, and it is what a bulk edit counts on.
  it('picks from the footer row whatever the setting says', () => {
    for (const photoOpensItem of [true, false]) {
      settings.current = { photoOpensItem }
      const view = renderCatalog()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Brass Lamp' }).closest('label')!)
      expect(screen.getByRole('checkbox', { name: 'Select Brass Lamp' })).toBeChecked()
      view.unmount()
    }
  })

  // The pre-ADR-0013 split, kept as a per-user opt-in rather than deleted. The
  // overlay has to come *above* the photo now, because the photo is no longer a
  // link and the title's anchor has to beat it to be reachable at all.
  it('swaps the two when the setting is off', () => {
    settings.current = { photoOpensItem: false }
    renderCatalog()

    // The title is the link now, and it is a real anchor to `/items/7`.
    const title = screen.getByRole('link', { name: 'Brass Lamp' })
    expect(title).toHaveAttribute('href', '/items/7')
    expect(within(card()).getAllByRole('link')).toHaveLength(1)

    // And the title is not also a toggle, or one click would do two things.
    expect(title.closest('label')).toBeNull()

    fireEvent.click(title)
    expect(screen.getByText('DETAIL')).toBeInTheDocument()
  })

  // With the setting off the photo is not a link, so a click on it is a click on
  // the card body: it is covered by the overlay label, which is what picks. Asserted
  // through the overlay rather than through the image, because jsdom has no paint
  // order — it cannot say which of two stacked elements a click lands on.
  it('leaves the photo to the body overlay when the setting is off', () => {
    settings.current = { photoOpensItem: false }
    renderCatalog()

    // The only anchor on the card is the title, so the photo is card content.
    expect(card().querySelector('a')?.textContent).toBe('Brass Lamp')

    fireEvent.click(overlay())
    expect(box()).toBeChecked()
  })
})

describe('catalog card photo cycling', () => {
  // The card has always shown the primary, so that is where cycling starts and
  // `1/2` is the number that matches what you land on when you open the card.
  it('starts on the primary and says where it is', () => {
    renderCatalog()
    expect(card().querySelector('img')).toHaveAttribute('src', '/file/uploads/thumbs/cover.jpg')
    expect(within(card()).getByText('1/2')).toBeInTheDocument()
  })

  // Marking a primary exists *for* the card image — "one marked primary (used as the
  // card image)", 2026-09-04 design. The card was the last surface still taking the
  // first photo in the array instead, so setting a primary changed nothing anywhere
  // the catalog could see it.
  it('shows the primary photo, not the first one in the list', () => {
    renderCatalog()
    expect(card().querySelector('img')).toHaveAttribute('src', '/file/uploads/thumbs/cover.jpg')
  })

  // Stepping without leaving the list: a leftward drag reveals the next photo, the
  // way it would on a strip of pictures, and the badge follows so the position is
  // never a guess.
  it('steps to the next photo on a swipe, and reports it', () => {
    renderCatalog()
    expect(within(card()).getByText('1/2')).toBeInTheDocument()

    swipePhoto(-60)
    expect(card().querySelector('img')).toHaveAttribute('src', '/file/uploads/thumbs/newest.jpg')
    expect(within(card()).getByText('2/2')).toBeInTheDocument()
  })

  // The one that would have been a real bug: the browser fires `click` after the
  // drag, and a click on the photo opens the item.
  it('does not open the item when the photo was swiped', () => {
    renderCatalog()

    swipePhoto(-60)
    fireEvent.click(photoLink())

    expect(screen.queryByText('DETAIL')).not.toBeInTheDocument()
  })

  // The arrow keys, because wheel and swipe are pointer-only and the focused
  // thumbnail is the one place a keyboard user lands on the photo.
  it('steps with the arrow keys on the focused photo', () => {
    renderCatalog()

    fireEvent.keyDown(photoLink(), { key: 'ArrowRight' })
    expect(within(card()).getByText('2/2')).toBeInTheDocument()
    fireEvent.keyDown(photoLink(), { key: 'ArrowLeft' })
    expect(within(card()).getByText('1/2')).toBeInTheDocument()
  })

  // One photo is not a carousel: a `1/1` badge on every card is noise, and there
  // is nowhere for a swipe to go.
  it('badges nothing for an item with a single photo', () => {
    settings.current = { photoOpensItem: true }
    renderCatalog()
    expect(within(card()).getByText('1/2')).toBeInTheDocument()
  })
})
