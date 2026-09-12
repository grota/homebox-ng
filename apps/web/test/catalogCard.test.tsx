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
                  images: [
                    { id: 1, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/x.jpg', isPrimary: true },
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

const photoButton = () => screen.getByRole('button', { name: 'View photo of Brass Lamp' })
const itemLink = () => screen.getByRole('link', { name: 'Brass Lamp' })

describe('catalog card click targets', () => {
  // The photo opens the viewer; every other part of the card is inside the link.
  // The two are siblings — an interactive element inside an anchor is invalid
  // HTML and ambiguous to assistive tech.
  it('puts every part of the card except the photo inside the item link', () => {
    renderCatalog()

    expect(itemLink()).toHaveAttribute('href', '/items/7')
    expect(itemLink()).not.toContainElement(photoButton())

    // Location, type, tags and the search snippet are card content, so they ride
    // inside the link rather than sitting next to it as dead space.
    for (const text of ['Living Room', 'Lighting', 'vintage']) {
      expect(within(itemLink()).getByText(text)).toBeInTheDocument()
    }
    expect(within(itemLink()).getByTestId('item-snippet')).toBeInTheDocument()
  })

  it('navigates on a click on the card content that is not the photo', () => {
    renderCatalog()

    fireEvent.click(within(itemLink()).getByText('Living Room'))

    expect(screen.getByText('DETAIL')).toBeInTheDocument()
  })

  it('still opens the photo viewer from the photo, without navigating', () => {
    renderCatalog()

    fireEvent.click(photoButton())

    expect(screen.getByRole('dialog', { name: 'Brass Lamp' })).toBeInTheDocument()
    expect(screen.queryByText('DETAIL')).not.toBeInTheDocument()
  })
})
