import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// mock the tRPC module so hooks resolve deterministically without a backend.
// `Provider` is a passthrough so <AppProviders> (which renders <trpc.Provider>)
// doesn't blow up; `useUtils` supplies the invalidate helpers used by the pages;
// `items.update` is added so the create/edit form can call it unconditionally.
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        items: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } },
        tags: { list: { invalidate: vi.fn() } },
      }),
      items: {
        list: {
          useQuery: () => ({
            data: {
              items: [
                {
                  id: 1,
                  name: 'Lamp',
                  description: '',
                  quantity: 1,
                  unit: null,
                  published: false,
                  itemTypeId: 1,
                  locationId: null,
                  createdBy: 1,
                  createdAt: null,
                  updatedAt: null,
                  customFields: [],
                  type: null,
                  location: null,
                  tags: [],
                  images: [
                    { id: 1, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/x.jpg', isPrimary: true },
                  ],
                },
              ],
              total: 1,
              facets: { types: [], tags: [], locations: [] },
            },
            isLoading: false,
          }),
        },
        // Resolves with an id, like the real `items.create`, so the photo
        // upload has an `itemId` to send.
        create: { useMutation: () => ({ mutateAsync: vi.fn(async () => ({ id: 42 })), isPending: false, error: null }) },
        update: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
      },
      locations: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      // Type 1 carries one `currency` custom field so the form's numeric input is
      // reachable; the step test below depends on it.
      itemTypes: {
        list: {
          useQuery: () => ({
            data: [{ id: 1, name: 'Light', fields: [{ id: 9, name: 'Price', fieldType: 'currency', required: false }] }],
            isLoading: false,
          }),
        },
      },
      tags: {
        list: { useQuery: () => ({ data: [], isLoading: false }) },
        create: { useMutation: () => ({ mutateAsync: vi.fn(async () => ({ id: 7, name: 'new', color: null })), isPending: false, error: null }) },
        assign: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
      },
      // `<AppProviders>` renders `<SettingsProvider>`, which reads `settings.get`
      // and wires `settings.update`. Return `data: undefined` so the provider falls
      // back to the spec defaults.
      settings: {
        get: { useQuery: () => ({ data: undefined, isLoading: false }) },
        update: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
      },
    },
  }
})

import { ItemsPage } from '../src/features/items/ItemsPage'
import { AppProviders } from '../src/app/AppProviders'

describe('catalog pages', () => {
  it('renders the item list and a create form', async () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    expect(await screen.findByText(/Lamp/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /new item/i }))
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('uploads the picked photo using the id returned by create', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    render(<AppProviders><ItemsPage /></AppProviders>)

    fireEvent.click(screen.getByRole('button', { name: /new item/i }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lamp' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: '1' } })
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    // The picker only exists in create mode; the file is held until submit.
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: /create item/i }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/upload/image')
    const body = init?.body as FormData
    expect(body.get('itemId')).toBe('42')
    expect(body.get('file')).toBe(file)
    fetchSpy.mockRestore()
  })

  // A number input defaults to step=1, so a stored decimal like 120.50 raises
  // stepMismatch and native constraint validation blocks the whole submit — the
  // item is then unsaveable. `step="any"` is what matches `fitsFieldType`, which
  // blesses any float for these two types. jsdom implements no stepMismatch, so
  // only the attribute itself can be asserted here.
  it('gives a numeric custom field step="any" so a decimal can be saved', async () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    fireEvent.click(screen.getByRole('button', { name: /new item/i }))
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: '1' } })

    const price = await screen.findByLabelText('Price')
    expect(price).toHaveAttribute('type', 'number')
    expect(price).toHaveAttribute('step', 'any')
  })

  // The card used to be one <Link> wrapping everything. It now splits: the photo
  // opens the viewer, the name navigates. Both are siblings with unambiguous
  // names — an interactive element inside an anchor is invalid HTML.
  it('opens the viewer from the card photo and links the name to the item', () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    expect(screen.getByRole('link', { name: 'Lamp' })).toHaveAttribute('href', '/items/1')
    fireEvent.click(screen.getByRole('button', { name: 'View photo of Lamp' }))
    const dialog = screen.getByRole('dialog', { name: 'Lamp' })
    expect(within(dialog).getByRole('img', { name: 'Lamp' })).toHaveAttribute(
      'src',
      '/file/uploads/originals/a.png',
    )
  })
})
