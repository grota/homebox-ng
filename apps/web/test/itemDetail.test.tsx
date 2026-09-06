import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('react-filerobot-image-editor', () => ({
  // The package exports the editor as its default export only (no named export),
  // and PhotoEditor imports it via `import FilerobotImageEditor from '...'`, so
  // the mock must provide a `default` export or the component renders undefined.
  default: () => <div data-testid="fil-editor" />,
}))

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  const item = {
    id: 3, name: 'Lamp', description: 'Desk', quantity: 1, unit: null,
    itemTypeId: 1, locationId: null, type: { id: 1, name: 'Light' }, location: null,
    images: [
      { id: 10, originalPath: 'uploads/originals/a.png', editedPath: 'uploads/edited/e.png', thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true },
      { id: 11, originalPath: 'uploads/originals/b.png', editedPath: null, thumbPath: 'uploads/thumbs/b.jpg', isPrimary: null },
    ],
  }
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ items: { list: { invalidate }, get: { invalidate } }, drafts: { list: { invalidate: vi.fn() } } }),
      items: { get: { useQuery: () => ({ data: item, isLoading: false }) } },
      // `ItemDetail` renders a per-image "Unpack this photo" button backed by
      // `trpc.unpack.run.useMutation()`, so the mock must provide it.
      unpack: { run: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }) } },
    },
    __item: item,
  }
})

import { ItemDetail } from '../src/features/items/ItemDetail'

describe('item detail photos', () => {
  it('renders an Edit button per image and opens the editor', async () => {
    render(
      <MemoryRouter initialEntries={['/items/3']}>
        <Routes><Route path="/items/:id" element={<ItemDetail />} /></Routes>
      </MemoryRouter>,
    )
    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    expect(editButtons).toHaveLength(2)
    fireEvent.click(editButtons[0])
    await waitFor(() => expect(screen.getByTestId('fil-editor')).toBeInTheDocument())
  })
})
