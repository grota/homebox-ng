import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The card's whole non-image surface is a link. `catalog.test.tsx` renders a
// single bare item (no location, no type, no tags), so "everything but the photo
// navigates" is not assertable there; this file mocks a fully populated card and
// renders the page under a router so a click can be followed to the detail route.
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

describe('catalog card click targets', () => {
  // The card is ONE target again. It was two while the photo opened a lightbox
  // and the name opened the item page — two destinations because there were two
  // places to see an item. There is one now (ADR-0005), so the photo, the fields
  // and the snippet all ride inside the link, and no interactive element sits
  // inside an anchor.
  it('puts the whole card, the photo included, inside the one link', () => {
    renderCatalog()

    expect(itemLink()).toHaveAttribute('href', '/items/7')
    // By selector, not by role: the photo is decorative (`alt=""`) because the
    // name sits directly beneath it, so it has no `img` role to query.
    expect(itemLink().querySelector('img')).toHaveAttribute('src', expect.stringContaining('/file/'))

    // Location, tags and the search snippet are card content, so they ride inside
    // the link rather than sitting next to it as dead space.
    //
    // The item type is deliberately absent: a card is for recognising a thing, and
    // the type is a classification you look at once you have opened it.
    for (const text of ['Living Room', 'vintage']) {
      expect(within(itemLink()).getByText(text)).toBeInTheDocument()
    }
    expect(within(itemLink()).queryByText('Lighting')).not.toBeInTheDocument()
    expect(within(itemLink()).getByTestId('item-snippet')).toBeInTheDocument()
  })

  // How many photos there are to look at. It reads "1/" because a card shows the
  // primary and the primary is position 1 of the order the surface uses — so the
  // number here is the one you land on when you open the card.
  it('badges the photo count when the item has more than one photo', () => {
    renderCatalog()

    expect(within(itemLink()).getByText('1/2')).toBeInTheDocument()
  })

  // Marking a primary exists *for* the card image — "one marked primary (used as
  // the card image)", 2026-09-04 design. The card was the last surface still
  // taking the first photo in the array instead, so setting a primary changed
  // nothing anywhere the catalog could see it.
  it('shows the primary photo, not the first one in the list', () => {
    renderCatalog()

    expect(itemLink().querySelector('img')).toHaveAttribute('src', '/file/uploads/thumbs/cover.jpg')
  })

  it('navigates on a click on the card content', () => {
    renderCatalog()

    fireEvent.click(within(itemLink()).getByText('Living Room'))

    expect(screen.getByText('DETAIL')).toBeInTheDocument()
  })
})
