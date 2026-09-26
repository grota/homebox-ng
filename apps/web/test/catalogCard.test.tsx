import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The card's photo is a link and its title is the selection toggle. The title used
// to be a third of the one link every part of the card rode in (ADR-0005), which is
// why this file mocks a fully populated card: what left the link and what stayed is
// the subject, and `catalog.test.tsx` renders a single bare item where the split is
// not assertable.
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

const itemLink = () => screen.getByRole('link', { name: 'Brass Lamp' })
// The card names itself rather than being found by its relationship to the link:
// the link sat in three different places across three versions of this card, and
// a helper that assumed one of them silently measured the wrong element.
const card = () => screen.getByTestId('item-card')
// The overlay: an empty `<label for>` that covers the card, so the body picks the
// item. A direct child, which is what distinguishes it from the footer's label.
const overlay = () => card().querySelector(':scope > label')!

describe('catalog card click targets', () => {
  // The card is two targets: the body picks the item and the title opens it. It
  // was two the other way round for one round — the photo opened, the title
  // picked — and one before that (ADR-0005).
  //
  // The picking target is an empty absolutely-positioned label rather than a
  // control with content. That is deliberate: the body has to be the target even
  // on a card with nothing to put in it — no photo, no location, no tags — and
  // anything that *wraps* content collapses to nothing when the content is
  // empty, which is exactly how such an item became unopenable from the catalog.
  it('makes the whole card pick the item, and keeps the fields outside the link', () => {
    renderCatalog()

    // `z-10`, not `z-0`: the photo's wrapper is `relative` (the "1/2" badge is
    // absolute inside it) and a positioned `z-index: auto` element paints after a
    // `z-0` one in tree order — the photo came out on top and swallowed the click.
    expect(overlay()).toHaveClass('absolute', 'inset-0', 'z-10')
    // Out of flow and empty: the box it is clicked in comes from the card, which
    // is why the card has to be its positioning context, and why no content can
    // be needed to give it a size.
    expect(overlay()).toBeEmptyDOMElement()
    expect(overlay()).toHaveAttribute('for', 'select-item-7')
    expect(card()).toHaveClass('relative')

    // By selector, not by role: the photo is decorative (`alt=""`) because the
    // name sits directly beneath it, so it has no `img` role to query.
    expect(card().querySelector('img')).toHaveAttribute('src', expect.stringContaining('/file/'))

    // The one control that does *not* pick has to sit above the overlay — above
    // `z-10`, so `z-20` — or the overlay would swallow its clicks.
    expect(itemLink()).toHaveClass('relative', 'z-20')

    // Location, tags and the search snippet are card content, and they are not in
    // the link: the link is the title alone, so none of them is a second
    // destination inside the anchor.
    //
    // The item type is deliberately absent: a card is for recognising a thing, and
    // the type is a classification you look at once you have opened it.
    for (const text of ['Living Room', 'vintage']) {
      expect(within(card()).getByText(text)).toBeInTheDocument()
      expect(within(itemLink()).queryByText(text)).not.toBeInTheDocument()
    }
    expect(within(card()).queryByText('Lighting')).not.toBeInTheDocument()
    expect(within(card()).getByTestId('item-snippet')).toBeInTheDocument()
  })

  // The body picks the item, and the toggle goes both ways — the label activates
  // the footer's checkbox through the browser, so this is the same control the
  // footer's own row drives.
  it('picks and unpicks from the card body', () => {
    renderCatalog()
    const box = screen.getByRole('checkbox', { name: 'Select Brass Lamp' })
    expect(box).not.toBeChecked()

    fireEvent.click(overlay())
    expect(box).toBeChecked()
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.click(overlay())
    expect(box).not.toBeChecked()
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  // The title is the way in, and it is a real link: a text link to a screen
  // reader, a new-tab target to the browser.
  it('opens the item from the title', () => {
    renderCatalog()

    expect(itemLink()).toHaveAttribute('href', '/items/7')
    expect(itemLink()).toHaveTextContent('Brass Lamp')
    expect(itemLink().tagName).toBe('A')

    fireEvent.click(itemLink())

    expect(screen.getByText('DETAIL')).toBeInTheDocument()
  })

  // How many photos there are to look at. It reads "1/" because a card shows the
  // primary and the primary is position 1 of the order the surface uses — so the
  // number here is the one you land on when you open the card.
  it('badges the photo count when the item has more than one photo', () => {
    renderCatalog()

    expect(within(card()).getByText('1/2')).toBeInTheDocument()
  })

  // Marking a primary exists *for* the card image — "one marked primary (used as
  // the card image)", 2026-09-04 design. The card was the last surface still
  // taking the first photo in the array instead, so setting a primary changed
  // nothing anywhere the catalog could see it.
  it('shows the primary photo, not the first one in the list', () => {
    renderCatalog()

    expect(card().querySelector('img')).toHaveAttribute('src', '/file/uploads/thumbs/cover.jpg')
  })
})
