import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  create: vi.fn(async (input: unknown) => input),
  update: vi.fn(async (input: unknown) => input),
  remove: vi.fn(async () => ({ ok: true, locations: 3, items: 4 })),
  invalidate: vi.fn(),
}))

// A two-level tree plus a second top-level location, so the parent select and
// the subtree exclusion both have something to distinguish.
const tree = [
  {
    id: 1,
    name: 'House',
    parentId: null,
    description: null,
    depth: 1,
    children: [{ id: 2, name: 'Garage', parentId: 1, description: null, depth: 2 }],
  },
  { id: 3, name: 'Shed', parentId: null, description: null, depth: 1 },
]

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const mutation = (spy: (input: unknown) => unknown) => () => ({ mutateAsync: spy, isPending: false, error: null })
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      // `client` is what the page reaches for the pre-delete counts — the prompt
      // names how many items it is about to strand, and the location DTO carries
      // no item count to read it from.
      useUtils: () => ({
        locations: { list: { invalidate: mocks.invalidate } },
        client: { locations: { deletePreview: { query: async () => ({ locations: 3, items: 4 }) } } },
      }),
      locations: {
        list: { useQuery: () => ({ data: tree, isLoading: false }) },
        create: { useMutation: mutation(mocks.create) },
        update: { useMutation: mutation(mocks.update) },
        delete: { useMutation: mutation(mocks.remove) },
      },
      settings: {
        get: { useQuery: () => ({ data: undefined, isLoading: false }) },
        update: { useMutation: mutation(vi.fn()) },
      },
    },
  }
})

import { LocationsPage } from '../src/features/locations/LocationsPage'
import { AppProviders } from '../src/app/AppProviders'

const renderPage = () => render(<AppProviders><LocationsPage /></AppProviders>)

const parentOptionLabels = () =>
  within(screen.getByLabelText('Parent'))
    .getAllByRole('option')
    .map((option) => option.textContent)

beforeEach(() => vi.clearAllMocks())

describe('locations page', () => {
  it('renders the tree with a control per location', async () => {
    renderPage()
    // House, Garage, Shed — each row carries its own edit/delete pair.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(3))
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(3)
    // Every name also appears as a parent-select option, so count loosely.
    for (const name of ['House', 'Garage', 'Shed']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    }
  })

  it('creates a top-level location', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Cabin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create location' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ name: 'Cabin', parentId: null }))
  })

  it('prefills the form when editing and saves the change', async () => {
    renderPage()
    // DOM order is House, then its child Garage, then Shed.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0])

    expect(screen.getByLabelText('Name')).toHaveValue('House')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Main House' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ id: 1, name: 'Main House', parentId: null }))
  })

  // A location may not be moved under itself or one of its descendants — the API
  // rejects it as a cycle, so those options must not be offered at all.
  it('does not offer the edited location or its descendants as its own parent', async () => {
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0])

    const labels = parentOptionLabels()
    expect(labels).toContain('Shed')
    expect(labels.some((label) => label?.includes('House'))).toBe(false)
    expect(labels.some((label) => label?.includes('Garage'))).toBe(false)
  })

  it('names how many items it will strand, deletes only after the confirmation, and reports the counts', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete' }))[0])

    // Declining leaves the tree alone. The prompt has to say what actually
    // happens — the sub-locations go, the items stay. Awaited, because the
    // counts come from a query the handler runs before it asks.
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('4 items will stay in your catalog with no location')),
    )
    expect(mocks.remove).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ id: 1 }))
    // The API returns what it took, and the page reports it back.
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted 3 locations. 4 items now have no location.')
    confirm.mockRestore()
  })
})
