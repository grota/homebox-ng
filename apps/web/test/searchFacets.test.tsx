import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// input-aware mock: record the tRPC input the page passes to `items.list.useQuery`
// so tests can assert the URL-param → query-input mapping. The rest of the
// module is mocked so the page renders without a backend or provider context
// (Ruling T6-A: the page is rendered under a sole MemoryRouter, no AppProviders).
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
          tags: [{ id: 1, name: 'vintage', color: null, count: 1 }],
          locations: [{ id: 1, name: 'Living Room', count: 1 }],
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
})
