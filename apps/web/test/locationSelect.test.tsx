import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// `locations.list` returns a **nested tree**. A `<select>` needs it flat, and both
// places that offer a location to choose — the item form, and the bulk edit panel's
// "set location" — mapped the tree as if it were already flat, so only the roots
// ever appeared. The fix is one flatten plus a depth-indented label, which is what
// the locations page's own parent selector has always done.
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

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const mutation = { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) }
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ items: { list: { invalidate: vi.fn() } } }),
      locations: { list: { useQuery: () => ({ data: TREE, isLoading: false }) } },
      itemTypes: {
        list: {
          useQuery: () => ({
            data: [{ id: 1, name: 'Lighting', description: '', fields: [], itemCount: 0 }],
            isLoading: false,
          }),
        },
      },
      tags: {
        list: { useQuery: () => ({ data: [], isLoading: false }) },
        create: mutation,
        assign: mutation,
      },
      items: {
        create: mutation,
        update: mutation,
        list: {
          useQuery: () => ({
            data: {
              items: [{ id: 1, name: 'Brass Lamp', locationId: 3, location: { id: 3, name: 'shelf A' }, images: [], tags: [] }],
              total: 1,
              facets: { types: [], tags: [], locations: [] },
            },
            isLoading: false,
          }),
        },
        selectionSummary: { useQuery: () => ({ data: null, isLoading: false }) },
        bulkUpdate: mutation,
      },
      uploads: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  }
})

import { ItemForm } from '../src/features/items/ItemForm'
import { BulkEditPanel } from '../src/features/items/BulkEditPanel'

const expectWholeTree = () => {
  expect(screen.getByRole('option', { name: 'home' })).toBeInTheDocument()
  // Indented by depth, like the locations page's parent selector: a flat list of
  // names would not say where `garage` sits.
  expect(screen.getByRole('option', { name: '— garage' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: '— — shelf A' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'shed' })).toBeInTheDocument()
}

describe('choosing a location from a tree', () => {
  it('offers every location in the item form, not just the roots', () => {
    render(<ItemForm onSaved={vi.fn()} onCancel={vi.fn()} />)

    expectWholeTree()
  })

  it('offers every location in the bulk edit panel', () => {
    render(<BulkEditPanel ids={[1]} locations={TREE} onApplied={vi.fn()} />)

    expectWholeTree()
  })
})
