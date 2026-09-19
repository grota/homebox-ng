import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The panel that applies one edit to a whole selection. Its job is to say what
// will change *before* it changes anything: every property shows the distribution
// of what the selection currently holds, and each row carries the count of items it
// would touch.
//
// Those counts come from `selectionSummary`, not from arithmetic here, and they are
// what the write pins — so what the button promises and what the server checks are
// the same numbers.
const state = vi.hoisted(() => ({
  summary: null as any,
  lastSummaryInput: null as any,
  lastUpdate: null as any,
  updateError: null as any,
}))

const bulkUpdate = vi.hoisted(() =>
  vi.fn(async (input: any) => {
    state.lastUpdate = input
    if (state.updateError) throw state.updateError
    return { updated: 3 }
  }),
)

const createTag = vi.hoisted(() => vi.fn(async (input: any) => ({ id: 99, name: input.name, color: null })))

const baseSummary = {
  total: 3,
  types: [{ id: 1, name: 'Lighting', count: 3 }],
  locations: [
    { id: 2, name: 'garage', count: 2 },
    { id: 1, name: 'home', count: 1 },
  ],
  tags: [
    { id: 9, name: 'fragile', color: null, count: 2 },
    { id: 10, name: 'bulky', color: null, count: 1 },
  ],
  fields: [
    {
      fieldId: 7,
      fieldName: 'Size',
      fieldType: 'text',
      values: [
        { value: 'large', count: 2 },
        { value: null, count: 1 },
      ],
    },
  ],
  changes: {},
}

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        items: {
          list: { invalidate: vi.fn() },
          // "Select all" resolves through the server; the panel needs a selection
          // to exist before it can say anything about one.
          resolveSelection: { fetch: vi.fn(async () => ({ ids: [1, 2, 3], total: 3 })) },
        },
      }),
      items: {
        list: {
          useQuery: () => ({
            data: {
              items: [
                { id: 1, name: 'Brass Lamp', locationId: null, location: null, images: [], tags: [] },
                { id: 2, name: 'Oak Table', locationId: null, location: null, images: [], tags: [] },
                { id: 3, name: 'Copper Wire', locationId: null, location: null, images: [], tags: [] },
              ],
              total: 3,
              facets: { types: [], tags: [], locations: [] },
            },
            isLoading: false,
          }),
        },
        selectionSummary: {
          useQuery: (input: any) => {
            state.lastSummaryInput = input
            // The pending edit drives `changes`, exactly as the server derives them.
            const pending = input?.pending ?? {}
            const changes: Record<string, number> = {}
            if (pending.location) changes.location = 3
            if (pending.tags?.add?.length) changes['tags.add'] = 2
            if (pending.tags?.remove?.length) changes['tags.remove'] = 1
            for (const field of pending.fieldValues ?? []) changes[`field:${field.fieldId}`] = 1
            return { data: { ...(state.summary ?? baseSummary), changes }, isLoading: false }
          },
        },
        bulkUpdate: { useMutation: () => ({ mutateAsync: bulkUpdate, isPending: false }) },
      },
      tags: {
        list: {
          useQuery: () => ({
            data: [
              { id: 9, name: 'fragile', color: null },
              { id: 10, name: 'bulky', color: null },
              { id: 11, name: 'heirloom', color: null },
            ],
            isLoading: false,
          }),
        },
        create: { useMutation: () => ({ mutateAsync: createTag, isPending: false }) },
      },
      locations: {
        list: {
          useQuery: () => ({
            data: [
              { id: 1, name: 'home', parentId: null, depth: 1 },
              { id: 2, name: 'garage', parentId: 1, depth: 2 },
              { id: 3, name: 'shed', parentId: null, depth: 1 },
            ],
            isLoading: false,
          }),
        },
      },
    },
  }
})

import { ItemsPage } from '../src/features/items/ItemsPage'

const renderWithSelection = async () => {
  render(
    <MemoryRouter initialEntries={['/items']}>
      <Routes>
        <Route path="/items" element={<ItemsPage />} />
      </Routes>
    </MemoryRouter>,
  )
  // Select everything, then open the panel — the two gestures the panel follows.
  fireEvent.click(screen.getByRole('button', { name: /Select all 3 matching/ }))
  await waitFor(() => expect(screen.getByText('3 selected')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Apply to selection' }))
}

beforeEach(() => {
  state.summary = null
  state.lastSummaryInput = null
  state.lastUpdate = null
  state.updateError = null
  vi.clearAllMocks()
})

describe('the bulk edit panel', () => {
  it('shows what the selection holds, per property', async () => {
    await renderWithSelection()

    // The distribution, not a "Mixed" label — it is what the edit overwrites.
    expect(screen.getByText(/garage ×2 · home ×1/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /fragile/ })).toBeInTheDocument()
    expect(screen.getByText(/large/)).toBeInTheDocument()
  })

  it('sets a location for every selected item, and pins the counts it showed', async () => {
    await renderWithSelection()

    fireEvent.change(screen.getByLabelText('Set location'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /Apply to 3 items/ }))

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalled())
    expect(state.lastUpdate).toMatchObject({
      ids: [1, 2, 3],
      location: { set: 3 },
      // The counts the panel displayed, not ones the server has to guess.
      acknowledgedItemCount: 3,
      acknowledgedOverwriteCounts: { location: 3 },
    })
  })

  it('removes a tag that is unchecked and adds one that is picked', async () => {
    await renderWithSelection()

    fireEvent.click(screen.getByRole('checkbox', { name: /fragile/ }))
    fireEvent.change(screen.getByLabelText('Add a tag'), { target: { value: '11' } })
    fireEvent.click(screen.getByRole('button', { name: /Add tag/ }))
    fireEvent.click(screen.getByRole('button', { name: /Apply to 3 items/ }))

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalled())
    expect(state.lastUpdate.tags).toEqual({ add: [11], remove: [9] })
  })

  // A tag that does not exist yet is created as the edit is applied, because the
  // write path is the one place that can do it atomically with the rest.
  it('creates a tag that does not exist yet, then adds it', async () => {
    await renderWithSelection()

    fireEvent.change(screen.getByLabelText('Or create a tag'), { target: { value: 'spare' } })
    fireEvent.click(screen.getByRole('button', { name: /Create tag/ }))
    // Creating resolves a promise, and the apply is disabled until the composed
    // edit registers — so wait for the button rather than clicking into a no-op.
    await waitFor(() => expect(screen.getByRole('button', { name: /Apply to 3 items/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Apply to 3 items/ }))

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalled())
    expect(createTag).toHaveBeenCalledWith({ name: 'spare' })
    expect(state.lastUpdate.tags).toEqual({ add: [99], remove: [] })
  })

  // A refusal is a refusal: the panel stays open with the server's message, so the
  // user can look at what moved rather than wondering whether it worked.
  it('stays open and reports a refused write', async () => {
    state.updateError = { message: 'The selection now holds 2 items, not 3. Nothing was changed.' }
    await renderWithSelection()

    fireEvent.change(screen.getByLabelText('Set location'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /Apply to 3 items/ }))

    await waitFor(() => expect(screen.getByText(/now holds 2 items/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Apply to 3 items/ })).toBeInTheDocument()
  })

  it('closes and clears the selection once it has applied', async () => {
    await renderWithSelection()

    fireEvent.change(screen.getByLabelText('Set location'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /Apply to 3 items/ }))

    await waitFor(() => expect(screen.queryByText('3 selected')).not.toBeInTheDocument())
  })
})
