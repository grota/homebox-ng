import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The catalog's ordering is a stored per-user preference, and the control that
// changes it sits with the list rather than only on `/settings` — a sort is
// something you change while looking at what you are sorting.
//
// The one subtlety is relevance: it is the order *while a search term is active*
// and it is not a preference, so it is never written down and it is not offered
// when there is nothing to rank.
const state = vi.hoisted(() => ({
  itemsSort: 'createdAt:desc' as string,
  // The input `items.list` was last called with, which is how these tests see
  // which order the page actually asked the server for.
  lastInput: null as any,
}))

const updateSettings = vi.hoisted(() => vi.fn(async (input: any) => input))

vi.mock('../src/lib/settings/useUserSettings', () => ({
  useUserSettings: () => ({
    language: 'en',
    locale: 'en-US',
    themeMode: 'auto',
    lightThemeId: 'light-default',
    darkThemeId: 'dark-default',
    itemsSort: state.itemsSort,
    formatDate: () => 'Sept 6, 2026',
    updateSettings,
  }),
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
          useQuery: (input: any) => {
            state.lastInput = input
            return {
              data: { items: [], total: 0, facets: { types: [], tags: [], locations: [] } },
              isLoading: false,
            }
          },
        },
      },
      locations: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      itemTypes: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      tags: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
    },
  }
})

import { ItemsPage } from '../src/features/items/ItemsPage'

const renderCatalog = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/items${search}`]}>
      <Routes>
        <Route path="/items" element={<ItemsPage />} />
      </Routes>
    </MemoryRouter>,
  )

const order = () => screen.getByLabelText('Order')

beforeEach(() => {
  state.itemsSort = 'createdAt:desc'
  state.lastInput = null
  vi.clearAllMocks()
})

describe('the catalog order control', () => {
  it('opens on the stored order and asks the server for it', () => {
    state.itemsSort = 'name:asc'
    renderCatalog()

    expect(order()).toHaveValue('name:asc')
    expect(state.lastInput.sort).toBe('name:asc')
  })

  it('stores a newly chosen order and orders by it', async () => {
    renderCatalog()

    fireEvent.change(order(), { target: { value: 'updatedAt:asc' } })

    expect(updateSettings).toHaveBeenCalledWith({ itemsSort: 'updatedAt:asc' })
    expect(state.lastInput.sort).toBe('updatedAt:asc')
  })

  // Relevance is the interesting case: it is what a search is ordered by until
  // the user says otherwise, and it is a consequence of searching rather than a
  // preference, so it is never stored.
  it('shows relevance while searching, and does not store it', () => {
    renderCatalog('?q=lamp')

    expect(order()).toHaveValue('relevance')
    expect(state.lastInput.sort).toBe('relevance')

    fireEvent.change(order(), { target: { value: 'relevance' } })

    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('does not offer relevance when there is nothing to rank', () => {
    renderCatalog()

    expect(order()).not.toHaveTextContent('Relevance')
  })

  it('lets a chosen order override relevance while searching', () => {
    renderCatalog('?q=lamp')

    fireEvent.change(order(), { target: { value: 'name:desc' } })

    expect(state.lastInput.sort).toBe('name:desc')
    expect(updateSettings).toHaveBeenCalledWith({ itemsSort: 'name:desc' })
  })
})
