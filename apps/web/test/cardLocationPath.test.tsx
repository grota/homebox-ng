import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The card's location line used to be the leaf name alone, so an item in
// `shed / shelf A` and one in `home / garage / shelf A` were indistinguishable.
// It is the full path now, built from `locations.list` — the same tree the
// sidebar drills into — so the fixture here is the tree, not a flat list.
//
// `vi.hoisted` because `vi.mock`'s factory is hoisted above the module body; a
// plain `let` would not exist yet when the factory runs.
const state = vi.hoisted(() => ({
  locations: [] as any[],
  locationId: 3 as number | null,
}))

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ items: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } } }),
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
                  published: true,
                  itemTypeId: 1,
                  locationId: state.locationId,
                  createdBy: 1,
                  createdAt: null,
                  updatedAt: null,
                  customFields: [],
                  type: { id: 1, name: 'Lighting' },
                  // The DTO only ever carries the leaf, plus its id. The path is the
                  // client's job, from the tree below.
                  location:
                    state.locationId == null ? null : { id: state.locationId, name: 'shelf A' },
                  tags: [],
                  images: [],
                },
              ],
              total: 1,
              facets: { types: [], tags: [], locations: [] },
            },
            isLoading: false,
          }),
        },
      },
      locations: { list: { useQuery: () => ({ data: state.locations, isLoading: false }) } },
      itemTypes: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      tags: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
    },
  }
})

import { ItemsPage } from '../src/features/items/ItemsPage'

// home > garage > shelf A, plus a sibling root. Ids are the location ids the
// item's `locationId` points at.
const TREE = [
  {
    id: 1,
    name: 'home',
    parentId: null,
    depth: 1,
    children: [
      {
        id: 2,
        name: 'garage',
        parentId: 1,
        depth: 2,
        children: [{ id: 3, name: 'shelf A', parentId: 2, depth: 3 }],
      },
    ],
  },
  { id: 4, name: 'shed', parentId: null, depth: 1 },
]

const renderCatalog = () =>
  render(
    <MemoryRouter initialEntries={['/items']}>
      <Routes>
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/items/:id" element={<div>DETAIL</div>} />
      </Routes>
    </MemoryRouter>,
  )

// The card names itself rather than being found by its relationship to the link:
// where the link sits in the card has changed twice, and a helper that assumed a
// position silently measured the wrong element when it moved.
const card = () => screen.getByTestId('item-card')
const locationLine = () => screen.queryByTestId('item-location')

beforeEach(() => {
  state.locations = TREE
  state.locationId = 3
})

describe('the catalog card shows its location as a path', () => {
  // The whole point: the leaf alone does not say where the thing is. Asserted on
  // the card's text rather than on a `data-testid`, so this fails on the *path*
  // being absent rather than on a selector that does not exist yet. (It was
  // asserted on the link's text while the link wrapped the card's content; it
  // covers the card as an empty box now.)
  it('renders the full path from the root, joined with the sidebar separator', () => {
    renderCatalog()

    expect(card()).toHaveTextContent('home › garage › shelf A')
    expect(locationLine()).toHaveTextContent('home › garage › shelf A')
  })

  // A root location has no ancestors, so there is no separator to show. This is
  // the case a naive `path.join(' › ')` over a wrongly-populated walk breaks.
  it('renders a root location as its name alone', () => {
    state.locationId = 4
    renderCatalog()

    expect(locationLine()).toHaveTextContent('shed')
    expect(locationLine()?.textContent).not.toContain('›')
  })

  // Not an empty paragraph, not a stray separator: nothing.
  it('renders no location line for an item with no location', () => {
    state.locationId = null
    renderCatalog()

    expect(locationLine()).not.toBeInTheDocument()
  })

  // The data model permits a cyclic `parent_id` chain, and `locations.list`
  // surfaces a cycle as two roots pointing at each other (the server's
  // `buildTree` makes orphans roots rather than dropping them). Walking `parentId`
  // up without a guard is an infinite loop inside a render.
  it('terminates on a cyclic parent chain instead of hanging', () => {
    state.locations = [
      { id: 10, name: 'a', parentId: 11, depth: 1 },
      { id: 11, name: 'b', parentId: 10, depth: 1 },
    ]
    state.locationId = 10
    renderCatalog()

    expect(card()).toHaveTextContent('b › a')
    expect(locationLine()?.textContent).toBe('b › a')
  })

  // A path is unbounded in width (names are free text) and the card is ~200px.
  it('keeps the full path available when the line is truncated', () => {
    renderCatalog()

    expect(locationLine()).toHaveAttribute('title', 'home › garage › shelf A')
    expect(locationLine()?.className).toContain('truncate')
  })

  // The tree arrives on its own query. While it is in flight — or if it fails —
  // the leaf from the item DTO is still true, and is what the card showed before.
  it('falls back to the leaf name when the location tree is not loaded', () => {
    state.locations = []
    renderCatalog()

    expect(locationLine()).toHaveTextContent('shelf A')
  })

  // The path must never be a link of its own — that would be a nested destination
  // inside the card, which is invalid HTML when the outer thing is an anchor and a
  // keyboard trap either way. This fixture's item has no photo and no tags: the
  // bare card whose only anchor used to be a box around its own text, which is how
  // an item with nothing to put there ended up with no way in from the catalog.
  // The path is text on the card now, inside no anchor at all.
  it('leaves the path as text on the card, never a link of its own', () => {
    renderCatalog()

    const path = locationLine()
    expect(path?.tagName).not.toBe('A')
    expect(path?.closest('a')).toBeNull()
    expect(within(card()).getByTestId('item-location')).toBeInTheDocument()
    // Exactly one link on the card, and it is the title: the way in.
    expect(within(card()).getAllByRole('link')).toHaveLength(1)
    expect(within(card()).getByRole('link')).toHaveTextContent('Brass Lamp')
  })
})
