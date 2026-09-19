import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Selection on the catalog (ADR-0010). It is a set of item ids that lives
// independently of the view that produced it: changing the search, a filter or the
// page does not touch it, and it is lost on reload.
//
// "Select all" means everything the current search and filters match — never the
// twenty rows on screen — so the label carries the count, and the resolve call is
// what makes "all" real rather than "this page".
const state = vi.hoisted(() => ({
  lastInput: null as any,
  // What `resolveSelection` answers with. Tests set it to stand in for the server
  // resolving a clause.
  resolved: { ids: [] as number[], total: 0 },
  criteriaQuery: null as any,
}))

const resolveFetch = vi.hoisted(() => vi.fn(async () => state.resolved))

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const items = [
    { id: 1, name: 'Brass Lamp', locationId: null, location: null, images: [], tags: [] },
    { id: 2, name: 'Oak Table', locationId: null, location: null, images: [], tags: [] },
  ]
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        items: {
          list: { invalidate: vi.fn() },
          resolveSelection: { fetch: resolveFetch },
        },
      }),
      items: {
        list: {
          useQuery: (input: any) => {
            state.lastInput = input
            return {
              data: {
                items,
                total: 2,
                facets: {
                  types: [],
                  tags: [{ id: 9, name: 'fragile', color: null, count: 2 }],
                  locations: [{ id: 1, name: 'home', parentId: null, ownCount: 2, subtreeCount: 2 }],
                },
              },
              isLoading: false,
            }
          },
        },
        resolveSelection: {
          // The live count in the criteria panel: a clause with no criterion
          // resolves to nothing, which is what disables Apply.
          useQuery: (clause: any) => {
            state.criteriaQuery = clause
            const empty = Object.values(clause ?? {}).every((v) => v == null || (Array.isArray(v) && !v.length))
            return { data: empty ? { ids: [], total: 0 } : state.resolved, isLoading: false }
          },
        },
        createdAtRange: {
          useQuery: () => ({ data: { min: '2026-01-10', max: '2026-04-01' }, isLoading: false }),
        },
      },
      locations: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      itemTypes: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      tags: {
        list: {
          useQuery: () => ({
            data: [
              { id: 9, name: 'fragile', color: null },
              { id: 10, name: 'bulky', color: null },
            ],
            isLoading: false,
          }),
        },
      },
    },
  }
})

import { ItemsPage } from '../src/features/items/ItemsPage'

const renderCatalog = () =>
  render(
    <MemoryRouter initialEntries={['/items']}>
      <Routes>
        <Route path="/items" element={<ItemsPage />} />
      </Routes>
    </MemoryRouter>,
  )

const box = (name: string) => screen.getByRole('checkbox', { name })
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => {
  state.lastInput = null
  state.resolved = { ids: [], total: 0 }
  state.criteriaQuery = null
  vi.clearAllMocks()
})

describe('selecting items on the catalog', () => {
  it('selects a card and counts it, and deselects it again', () => {
    renderCatalog()

    fireEvent.click(box('Select Brass Lamp'))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.click(box('Select Brass Lamp'))
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  // The label carries the count because "all" does not mean "this page".
  it('selects everything the view matches, not just the page', async () => {
    state.resolved = { ids: [1, 2], total: 2 }
    renderCatalog()

    press('Select all 2 matching')

    await waitFor(() => expect(screen.getByText('2 selected')).toBeInTheDocument())
    expect(box('Select Brass Lamp')).toBeChecked()
    expect(box('Select Oak Table')).toBeChecked()
    // ...and it asked the server what the view matches, rather than assuming.
    expect(resolveFetch).toHaveBeenCalled()
  })

  it('clears the selection', () => {
    renderCatalog()
    fireEvent.click(box('Select Brass Lamp'))

    press('Deselect all')

    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  it('adds the items a criteria clause resolves to', async () => {
    state.resolved = { ids: [2], total: 1 }
    renderCatalog()

    press('Add to selection')
    fireEvent.click(screen.getByRole('checkbox', { name: 'fragile' }))
    press('Add 1 item')

    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
    expect(box('Select Oak Table')).toBeChecked()
  })

  it('removes the items a criteria clause resolves to', async () => {
    state.resolved = { ids: [1], total: 1 }
    renderCatalog()
    fireEvent.click(box('Select Brass Lamp'))
    fireEvent.click(box('Select Oak Table'))

    press('Remove from selection')
    fireEvent.click(screen.getByRole('checkbox', { name: 'fragile' }))
    press('Remove 1 item')

    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
    expect(box('Select Brass Lamp')).not.toBeChecked()
  })

  // A clause that matches nothing must not be applicable: it would be a no-op that
  // looks like it worked.
  it('will not apply a clause that resolves to nothing', () => {
    renderCatalog()

    press('Add to selection')

    expect(screen.getByRole('button', { name: 'Add 0 items' })).toBeDisabled()
  })

  // A selection can outlive the view that made it, so it must be findable. With
  // the facets hidden, because their counts describe the catalog under the filters
  // while the grid now describes the selection.
  it('can show just the selection, with the facet panel out of the way', () => {
    renderCatalog()
    fireEvent.click(box('Select Brass Lamp'))

    press('Selected only')

    expect(state.lastInput.ids).toEqual([1])
    // Asserted on `Locations`, not `Types`: the mock has an empty type facet, so
    // `Types` would be absent either way and the assertion would prove nothing.
    expect(screen.queryByText('Locations')).not.toBeInTheDocument()
  })
})
