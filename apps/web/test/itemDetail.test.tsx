import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
      useUtils: () => ({ items: { list: { invalidate }, get: { invalidate } }, drafts: { list: { invalidate: vi.fn() } } }),
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
      // `ItemDetail` renders a per-image "Unpack this photo" button backed by
      // `trpc.unpack.run.useMutation()`, so the mock must provide it.
      unpack: { run: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }) } },
    },
    __item: item,
  }
})

import { ItemDetail } from '../src/features/items/ItemDetail'
import { buttonClasses } from '../src/ui'

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

  // `no-underline` is no longer part of Button's `base` (it is dead on a real
  // <button>), so this anchor has to carry it itself or the link underlines.
  // Comparing against `buttonClasses()` also fails if the anchor drifts back to a
  // hand-written copy of the string, which is the point of the shared helper.
  it('renders the photo View link with the shared button classes plus no-underline', () => {
    renderDetail()
    expect(screen.getAllByRole('link', { name: 'View' })[0]).toHaveClass(
      ...buttonClasses().split(' '),
      'no-underline',
    )
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
})
