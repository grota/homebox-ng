import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// input-aware mock: record the tRPC input the page passes to `items.list.useQuery`
// so tests can assert the URL-param → query-input mapping. The rest of the
// module is mocked so the page renders without a backend or provider context
// (Ruling T6-A: the page is rendered under a sole MemoryRouter, no AppProviders).
//
// The tag facet's colour is a stored value, so the test that guards the chip's
// inline paint needs to control it. Mutable module state, reset in `beforeEach`;
// the factory closes over the binding and reads it when the module is imported,
// which is after this declaration has run.
let tagFacets: { id: number; name: string; color: string | null; count: number }[] = [
  { id: 1, name: 'vintage', color: null, count: 1 },
]

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const listInput: any[] = []
  const useQuery = vi.fn((input?: any) => {
    listInput.push(input)
    return {
      data: {
        items: [
          {
            id: 1,
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
            tags: [],
            images: [],
            snippet: '… Brass **Lamp** …',
          },
        ],
        total: 1,
        facets: {
          types: [{ id: 1, name: 'Lighting', count: 1 }],
          tags: tagFacets,
          // The location facet is a tree with two counts per node (ADR-0009).
          // This one holds its item directly and has no children, so its two
          // counts are equal and it renders as `Living Room (1)`.
          locations: [
            { id: 1, name: 'Living Room', parentId: null, ownCount: 1, subtreeCount: 1 },
          ],
        },
      },
      isLoading: false,
    }
  })
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        items: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } },
      }),
      items: {
        list: { useQuery },
        create: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
        update: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
      },
      locations: {
        list: { useQuery: () => ({ data: [{ id: 1, name: 'Living Room', parentId: null, description: null, depth: 1 }], isLoading: false }) },
      },
      itemTypes: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      tags: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
    },
    __itemsList: { listInput, useQuery },
  }
})

import { ItemsPage } from '../src/features/items/ItemsPage'

const renderPage = (initialEntries: string[]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <ItemsPage />
    </MemoryRouter>,
  )

const lastListInput = async () => {
  const { __itemsList } = (await import('../src/api/trpc')) as any
  return __itemsList.listInput[__itemsList.listInput.length - 1]
}

describe('items search + facets', () => {
  beforeEach(() => {
    tagFacets = [{ id: 1, name: 'vintage', color: null, count: 1 }]
  })

  // A facet chip is a toggle, so the selected one has to *look* selected. Picking
  // a tag or a location used to give no feedback beyond the results changing. All
  // three dimensions say it the same way, and `aria-pressed` is also the only
  // assertion that does not depend on reading a Tailwind class back out.
  it('marks the selected facet in each dimension, and only the selected one', () => {
    renderPage(['/items?q=lamp&typeId=1&locationId=1&tagIds=1'])

    expect(screen.getByRole('button', { name: 'Lighting (1)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'vintage (1)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Living Room (1)' })).toHaveAttribute('aria-pressed', 'true')
    // "All locations" is the selection only while no location is chosen.
    expect(screen.getByRole('button', { name: 'All locations' })).toHaveAttribute('aria-pressed', 'false')
  })

  // Search has two modes — a word matches from its start as you type, a quoted
  // word means that word and nothing else — and neither was visible anywhere.
  // Someone who never learns the second one cannot search precisely at all.
  it('offers a hint explaining how the search behaves', () => {
    renderPage(['/items'])

    expect(screen.getByRole('button', { name: 'Search syntax help' })).toBeInTheDocument()

    const hint = screen.getByRole('tooltip')
    // The facts that are not guessable from using the box: bare words are ANDed,
    // only the *last* one gets the appended prefix, and the boolean operators are
    // capitalised — which is the part a user gets wrong, because `or` and `OR`
    // look alike and behave nothing alike.
    expect(hint).toHaveTextContent('Words are ANDed together.')
    expect(hint).toHaveTextContent('appended (it is considered a prefix)')
    expect(hint).toHaveTextContent('to match exactly')
    expect(hint).toHaveTextContent('are operators rather than words to find. In lower case they are ordinary words.')
    expect(hint).toHaveTextContent('Parentheses group the operators')
    // `opacity-0`, not `hidden`: a `display: none` bubble is gone from the
    // accessibility tree, so the hint would exist only for people who can already
    // see it hover — and it would never appear for a keyboard user at all.
    expect(hint).not.toHaveClass('hidden')
  })

  // The hint button sits *beside* the label, never inside it. Everything inside a
  // `<label>` becomes the labelled control's accessible name, so nesting the
  // button there would rename the search box to "Search" followed by the whole
  // hint — for a screen reader, and for every `getByLabelText('Search')` here.
  it('keeps the search box named just "Search", with the hint outside the label', () => {
    renderPage(['/items'])

    expect(screen.getByLabelText('Search')).toHaveAttribute('id', 'item-search')
    expect(screen.getByText('Search', { selector: 'label' })).toHaveTextContent(/^Search$/)
  })

  it('treats "All locations" as the selected location when none is chosen', () => {
    renderPage(['/items?q=lamp'])

    expect(screen.getByRole('button', { name: 'All locations' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Living Room (1)' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('drives the query from URL params and renders a search box + facets', async () => {
    renderPage(['/items?q=lamp&typeId=1'])

    // Search box is bound to `q`.
    expect(screen.getByLabelText('Search')).toHaveValue('lamp')

    // The page maps URL params onto the tRPC input in one place.
    await waitFor(async () => {
      const last = await lastListInput()
      expect(last.search).toBe('lamp')
      expect(last.itemTypeId).toBe(1)
      expect(last.page).toBe(1)
    })

    // Facet sidebar lists types / tags / locations.
    expect(screen.getByText('Types')).toBeInTheDocument()
    expect(screen.getByText('Tags')).toBeInTheDocument()
    expect(screen.getByText('Locations')).toBeInTheDocument()

    // Facet chips carry their counts next to the value.
    expect(screen.getByRole('button', { name: 'Lighting (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'vintage (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Living Room (1)' })).toBeInTheDocument()

    // Item card shows its FTS snippet when `q` is active.
    expect(screen.getByTestId('item-snippet')).toHaveTextContent('Brass')
  })

  it('toggling a tag chip updates the query and re-queries', async () => {
    renderPage(['/items'])

    fireEvent.click(await screen.findByRole('button', { name: 'vintage (1)' }))

    await waitFor(async () => {
      const last = await lastListInput()
      expect(last.tagIds).toEqual([1])
      expect(last.page).toBe(1)
    })
  })

  it('typing in the search box debounces and re-queries', async () => {
    renderPage(['/items'])

    fireEvent.change(await screen.findByLabelText('Search'), { target: { value: 'lamp' } })

    await waitFor(async () => {
      const last = await lastListInput()
      expect(last.search).toBe('lamp')
    })
  })

  it('clear filters resets the URL params and query', async () => {
    renderPage(['/items?q=lamp&locationId=1&typeId=1&tagIds=1&page=3'])

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))

    expect(await screen.findByLabelText('Search')).toHaveValue('')

    await waitFor(async () => {
      const last = await lastListInput()
      expect(last.search).toBeUndefined()
      expect(last.locationId).toBeUndefined()
      expect(last.itemTypeId).toBeUndefined()
      expect(last.tagIds).toBeUndefined()
      expect(last.page).toBe(1)
    })
  })

  // The tag facet chip paints `f.color` as an inline background — the same sink
  // `ui/Badge.tsx` guards. `hexColor` on `tagInput` is the real fix; this is the
  // defence in depth for rows stored before it existed. Without the guard the
  // chip would carry `background: url(//evil.example/x.png)`.
  it('paints a hex tag colour but ignores a non-hex one', () => {
    tagFacets = [
      { id: 1, name: 'vintage', color: '#ff0000', count: 1 },
      { id: 2, name: 'evil', color: 'url(//evil.example/x.png)', count: 1 },
    ]
    renderPage(['/items'])

    expect(screen.getByRole('button', { name: 'vintage (1)' }).style.background).toBe('rgb(255, 0, 0)')
    expect(screen.getByRole('button', { name: 'evil (1)' }).style.background).toBe('')
  })

  // The chip's inline `background` beats every `hover:` utility, so its hover
  // state is a scrim element derived from the tag's colour. A chip that lost it
  // would pass every other assertion here — the colour and the accessible name
  // are both unchanged.
  it('reveals a colour-derived scrim on a tag chip, and none without a colour', () => {
    tagFacets = [
      { id: 1, name: 'vintage', color: '#ff0000', count: 1 },
      { id: 2, name: 'plain', color: null, count: 1 },
    ]
    renderPage(['/items'])

    const chip = screen.getByRole('button', { name: 'vintage (1)' })
    // Red is a dark colour, so the scrim lightens it.
    expect(chip.querySelector('[aria-hidden]')).toHaveStyle({ background: 'rgba(255, 255, 255, 0.18)' })
    expect(screen.getByRole('button', { name: 'plain (1)' }).querySelector('[aria-hidden]')).toBeNull()
  })
})
