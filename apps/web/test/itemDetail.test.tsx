import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('react-filerobot-image-editor', () => ({
  // The package exports the editor as its default export only (no named export),
  // and PhotoEditor imports it via `import FilerobotImageEditor from '...'`, so
  // the mock must provide a `default` export or the component renders undefined.
  default: () => <div data-testid="fil-editor" />,
}))

// Mutation spies live outside the factories so tests can assert on the calls.
// `vi.hoisted` is required: `vi.mock` factories are hoisted above plain consts.
const mocks = vi.hoisted(() => ({
  deleteItem: vi.fn(),
  setPrimary: vi.fn(),
  deleteImage: vi.fn(),
  updateItem: vi.fn(async (x: unknown) => x),
  unpack: vi.fn(),
  // `tags.assign` replaces an item's whole tag set, so what it is (and is not)
  // called with on save is worth asserting.
  assignTags: vi.fn(async (x: unknown) => x),
  // Mutable so a test can make the unpack mutation report a failure. Cleared in
  // `beforeEach`, since the other cases assert on the success path.
  unpackError: null as { message: string } | null,
  navigate: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  const item = {
    id: 3, name: 'Lamp', description: 'Desk', quantity: 1, unit: null,
    itemTypeId: 1, locationId: null, type: { id: 1, name: 'Light' }, location: null,
    customFields: [],
    tags: [],
    images: [
      { id: 10, originalPath: 'uploads/originals/a.png', editedPath: 'uploads/edited/e.png', thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true },
      { id: 11, originalPath: 'uploads/originals/b.png', editedPath: null, thumbPath: 'uploads/thumbs/b.jpg', isPrimary: null },
    ],
  }
  const mutation = (spy: (x: unknown) => void) => () => ({
    mutate: spy, mutateAsync: vi.fn(), isPending: false, error: null,
  })
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ items: { list: { invalidate }, get: { invalidate } }, drafts: { list: { invalidate: vi.fn() } }, tags: { list: { invalidate: vi.fn() } } }),
      items: {
        get: { useQuery: () => ({ data: item, isLoading: false }) },
        // `ItemDetail` renders an inline edit form, which calls `items.update`
        // and loads the type/location selects.
        update: { useMutation: () => ({ mutate: mocks.updateItem, mutateAsync: mocks.updateItem, isPending: false, error: null }) },
        create: { useMutation: mutation(vi.fn()) },
        delete: { useMutation: mutation(mocks.deleteItem) },
      },
      images: {
        setPrimary: { useMutation: mutation(mocks.setPrimary) },
        delete: { useMutation: mutation(mocks.deleteImage) },
      },
      itemTypes: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      locations: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      // The edit form renders the tag picker (`tags.list`) and offers inline
      // creation + assignment. The item carries `tags: []` like the real DTO, so
      // the form knows the current set.
      tags: {
        list: { useQuery: () => ({ data: [{ id: 5, name: 'fragile', color: null }], isLoading: false }) },
        create: { useMutation: () => ({ mutateAsync: vi.fn(async () => ({ id: 7, name: 'new', color: null })), isPending: false, error: null }) },
        assign: { useMutation: () => ({ mutateAsync: mocks.assignTags, isPending: false, error: null }) },
      },
      // `ItemDetail` renders a per-image "Unpack this photo" button backed by
      // `trpc.unpack.run.useMutation()`, so the mock must provide it. The page
      // navigates from the run's *result* (that is how the detected count
      // reaches the drafts page), so `onSuccess` is wired through rather than
      // dropped — a stub that swallowed it would make the count unassertable.
      unpack: {
        run: {
          useMutation: (options?: { onSuccess?: (result: { detected: number }) => void }) => ({
            mutate: (input: unknown) => {
              mocks.unpack(input)
              // A failed run never calls `onSuccess`, which is what leaves the
              // page without its navigation.
              if (mocks.unpackError) return
              options?.onSuccess?.({ detected: 2 })
            },
            mutateAsync: vi.fn(),
            isPending: false,
            error: mocks.unpackError,
          }),
        },
      },
    },
    __item: item,
  }
})

import { ItemDetail } from '../src/features/items/ItemDetail'

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={['/items/3']}>
      <Routes><Route path="/items/:id" element={<ItemDetail />} /></Routes>
    </MemoryRouter>,
  )

describe('item detail photos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.unpackError = null
  })

  it('renders an Edit button per image and opens the editor', async () => {
    renderDetail()
    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    expect(editButtons).toHaveLength(2)
    fireEvent.click(editButtons[0])
    await waitFor(() => expect(screen.getByTestId('fil-editor')).toBeInTheDocument())
  })

  it('sets an image as primary, and offers the control only on non-primary images', () => {
    renderDetail()
    // Image 10 is already primary, so exactly one "Set primary" button renders.
    const buttons = screen.getAllByRole('button', { name: 'Set primary' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(mocks.setPrimary).toHaveBeenCalledWith({ itemId: 3, imageId: 11 })
  })

  it('deletes a photo after confirmation', () => {
    renderDetail()
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete photo' })[0])
    expect(mocks.deleteImage).toHaveBeenCalledWith({ id: 10 })
  })

  it('deletes the item and navigates back to the list', () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }))
    expect(mocks.deleteItem).toHaveBeenCalledWith({ id: 3 })
  })

  // The thumbnail used to be inert; the View anchor's job (seeing the full photo)
  // is now its job, and the anchor's other job (opening the file) moved inside
  // the viewer as "Open original".
  it('opens the viewer on the edited rendition from a photo thumbnail', () => {
    renderDetail()
    fireEvent.click(screen.getAllByRole('button', { name: 'View photo of Lamp' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Lamp' })
    expect(within(dialog).getByRole('img', { name: 'Lamp' })).toHaveAttribute(
      'src',
      '/file/uploads/edited/e.png',
    )
  })

  it('falls back to the original rendition when the image has no edit', () => {
    renderDetail()
    // Image 11 is the one with `editedPath: null`.
    fireEvent.click(screen.getAllByRole('button', { name: 'View photo of Lamp' })[1])
    const dialog = screen.getByRole('dialog', { name: 'Lamp' })
    expect(within(dialog).getByRole('img', { name: 'Lamp' })).toHaveAttribute(
      'src',
      '/file/uploads/originals/b.png',
    )
  })

  // The drafts page reports what an unpack detected, and this entry point into
  // the same flow must not be the silent one: a run that finds nothing has to
  // say so here too, which it can only do if the count travels in the URL.
  it('reports the detected count to the drafts page when unpacking a photo', () => {
    renderDetail()
    fireEvent.click(screen.getAllByRole('button', { name: 'Unpack this photo' })[0])
    expect(mocks.unpack).toHaveBeenCalledWith({ kind: 'item', imageId: 10 })
    expect(mocks.navigate).toHaveBeenCalledWith('/drafts?detected=2')
  })

  // The navigation above happens on success, so a failed run leaves the user on
  // this page. Without an error surface that failure is completely silent: no
  // movement, no message, nothing to distinguish it from a click that missed.
  it('shows the failure when an unpack does not succeed', () => {
    mocks.unpackError = { message: 'Detection failed' }
    renderDetail()
    fireEvent.click(screen.getAllByRole('button', { name: 'Unpack this photo' })[0])
    expect(screen.getByRole('alert')).toHaveTextContent('Detection failed')
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('omits fieldValues when the type definitions have not loaded', async () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Desk lamp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalled())
    const input = mocks.updateItem.mock.calls[0][0] as Record<string, unknown>
    expect(input).toMatchObject({ id: 3, name: 'Desk lamp' })
    // `itemTypes.list` is still `[]` here, so `selectedType` is undefined. A
    // present `fieldValues` key is a full replacement server-side, so it must be
    // absent or every custom-field value on the item would be wiped.
    expect(input).not.toHaveProperty('fieldValues')
  })

  it('reveals the edit form prefilled from the item', () => {
    renderDetail()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Lamp')
    expect(screen.getByRole('heading', { name: 'Edit item' })).toBeInTheDocument()
  })

  it('assigns the tags picked on the edit form to the item', async () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))

    // The checkbox's accessible name comes from the wrapping <label>.
    fireEvent.click(await screen.findByLabelText('fragile'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.assignTags).toHaveBeenCalledWith({ itemId: 3, tagIds: [5] }))
  })

  // `tags.assign` REPLACES the whole set, so saving a form whose tags were never
  // touched must not rewrite (and reindex) the links.
  it('leaves the tags alone when an edit does not change them', async () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))
    await screen.findByLabelText('fragile')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lamp Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalled())
    expect(mocks.assignTags).not.toHaveBeenCalled()
  })
})
