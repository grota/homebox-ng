import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The location facet is a tree (ADR-0009): roots stacked vertically, children
// nested inside their parents, and each node carrying two counts — what sits in
// it, and what its whole subtree holds.
//
// Two gestures on one row, and they are different: the **name** filters the grid,
// the **chevron** only opens a branch. Without the second, looking inside a
// location would mean filtering by it.
const state = vi.hoisted(() => ({ lastInput: null as any }))

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
              data: {
                items: [],
                total: 0,
                facets: {
                  types: [],
                  tags: [],
                  locations: [
                    {
                      id: 1,
                      name: 'home',
                      parentId: null,
                      ownCount: 4,
                      subtreeCount: 12,
                      children: [
                        {
                          id: 2,
                          name: 'garage',
                          parentId: 1,
                          ownCount: 1,
                          subtreeCount: 3,
                          children: [{ id: 3, name: 'shelf A', parentId: 2, ownCount: 2, subtreeCount: 2 }],
                        },
                      ],
                    },
                    { id: 4, name: 'shed', parentId: null, ownCount: 5, subtreeCount: 5 },
                    {
                      id: 'none',
                      name: 'Unlocated',
                      parentId: null,
                      ownCount: 1,
                      subtreeCount: 1,
                      unlocated: true,
                    },
                  ],
                },
              },
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

// The row for a location, located by its label text, so a nested assertion can
// say "this is inside that".
const rowFor = (label: string | RegExp) => screen.getByRole('button', { name: label }).closest('li')!

const chevron = (label: string | RegExp) => screen.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${label}$`) })

beforeEach(() => {
  state.lastInput = null
})

describe('the location facet tree', () => {
  it('opens collapsed to the roots', () => {
    renderCatalog()

    expect(screen.getByRole('button', { name: 'shed (5)' })).toBeInTheDocument()
    // Nothing is revealed until it is asked for.
    expect(screen.queryByRole('button', { name: 'garage 1 (3)' })).not.toBeInTheDocument()
  })

  it('shows both counts when they differ, and one when they do not', () => {
    renderCatalog()

    expect(screen.getByRole('button', { name: 'home 4 (12)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'shed (5)' })).toBeInTheDocument()
  })

  it('nests the children inside the selected location', () => {
    renderCatalog('?locationId=1')

    // `garage` is a child of `home`, so it renders inside home's row rather than
    // beside it — and home is open because it is what the grid is filtered by.
    expect(within(rowFor('home 4 (12)')).getByRole('button', { name: 'garage 1 (3)' })).toBeInTheDocument()
  })

  it('filters when the name is clicked', () => {
    renderCatalog()

    fireEvent.click(screen.getByRole('button', { name: 'home 4 (12)' }))

    expect(state.lastInput.locationId).toBe(1)
  })

  it('only opens the branch when the chevron is clicked', () => {
    renderCatalog()

    fireEvent.click(chevron('home'))

    expect(screen.getByRole('button', { name: 'garage 1 (3)' })).toBeInTheDocument()
    // Revealing a location is not selecting it: the grid is untouched.
    expect(state.lastInput.locationId).toBeUndefined()
  })

  // A collapsed ancestor must never hide what the grid is filtered by.
  it('cannot close the branch that leads to the selection', () => {
    renderCatalog('?locationId=3')

    expect(screen.getByRole('button', { name: 'shelf A (2)' })).toBeInTheDocument()
    fireEvent.click(chevron('home'))

    expect(screen.getByRole('button', { name: 'shelf A (2)' })).toBeInTheDocument()
  })

  // An item with no location is not in any subtree, so it needs a bucket of its
  // own — without it the tree does not account for the whole catalog.
  it('has a bucket for the items with no location, and selects it without a filter arg', () => {
    renderCatalog()

    fireEvent.click(screen.getByRole('button', { name: 'Unlocated (1)' }))

    expect(state.lastInput.locationId).toBe('none')
  })
})
