import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// The instance's item types, mutable so one test can render the state a fresh
// install is in — none defined, where the form cannot be completed at all.
// `vi.hoisted` because `vi.mock`'s factory is hoisted above this file's own
// declarations, so it cannot close over a plain `const` here.
const mockItemTypes = vi.hoisted(() => {
  const types = [
    { id: 1, name: 'Light', fields: [{ id: 9, name: 'Price', fieldType: 'currency', required: false }] },
  ]
  return { types, seed: types }
})

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
          useQuery: () => ({ data: mockItemTypes.types, isLoading: false }),
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
import { ItemNewPage } from '../src/features/items/ItemNewPage'
import { AppProviders } from '../src/app/AppProviders'

describe('catalog pages', () => {
  beforeEach(() => { mockItemTypes.types = mockItemTypes.seed })

  // The create form is a page (ADR-0011), so there is no trigger to click here and no
  // toggle to open twice: reaching `/items/new` is what puts the form up. The catalog's
  // half of that contract — its link — is asserted in the test below.
  describe('the create page', () => {
    // An install with no item types: the Type select holds nothing but its
    // placeholder, so the form cannot be completed however much you type. The
    // submit button was enabled and `handleSubmit` returned in silence, so clicking
    // it did nothing and said nothing — the only way to learn why was to read the
    // API's schema. It is now said twice: up front beside the control, and again if
    // you submit anyway.
    it('explains why an item cannot be created when the instance has no types', async () => {
      mockItemTypes.types = []
      render(<AppProviders><ItemNewPage /></AppProviders>)

      expect(screen.getByText(/No item types yet/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /create one/i })).toHaveAttribute('href', '/types')
      // `required` on a select with no options is unsatisfiable, so the control is
      // disabled instead — which is also why native validation lets the submit
      // through to the guard that reports the real reason.
      expect(screen.getByLabelText('Type')).toBeDisabled()

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lamp' } })
      fireEvent.click(screen.getByRole('button', { name: /create item/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/no item types yet/i)
    })

    it('renders the form', async () => {
      render(<AppProviders><ItemNewPage /></AppProviders>)
      expect(await screen.findByLabelText('Name')).toBeInTheDocument()
      expect(screen.getByLabelText('Type')).toBeInTheDocument()
    })

    it('uploads the picked photo using the id returned by create', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      render(<AppProviders><ItemNewPage /></AppProviders>)

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
      render(<AppProviders><ItemNewPage /></AppProviders>)
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: '1' } })

      const price = await screen.findByLabelText('Price')
      expect(price).toHaveAttribute('type', 'number')
      expect(price).toHaveAttribute('step', 'any')
    })
  })

  it('links the catalog to the create page', async () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    expect(await screen.findByText(/Lamp/i)).toBeInTheDocument()
    // A link, not a button that toggles something into view: the form is a page now,
    // and two clicks on a toggle used to hide it under the cursor.
    expect(screen.getByRole('link', { name: 'New item' })).toHaveAttribute('href', '/items/new')
  })

  // The card split into two targets while the photo opened a lightbox and the
  // name opened the item page. The item surface is a page now, so both lead to
  // the same place and the card went back to being one link (ADR-0005).
  it('links the whole card, photo included, to the item', () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    const link = screen.getByRole('link', { name: 'Lamp' })
    expect(link).toHaveAttribute('href', '/items/1')
    // Decorative (`alt=""`), so it is queried by selector rather than by role.
    expect(link.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/file/'))
    // One photo, so there is no count to show: "1/1" is noise on every card with a
    // single photo, which is most of them.
    expect(within(link).queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument()
  })

  // The rule the owner chose after asking "why only four columns?" — and the answer
  // was that Phase 4 had added a `1 / 2 / 4` ladder while migrating plain-CSS
  // classes, with no recorded reason. Auto-fill sizes the grid by a minimum card
  // width instead, so it adapts to the window and to the facet sidebar without a
  // breakpoint per step. jsdom has no layout, so the class list IS the subject:
  // this is what has to fail if a ladder comes back.
  it('sizes the catalog grid by a minimum card width, not a breakpoint ladder', () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    const grid = screen.getByRole('link', { name: 'Lamp' }).closest('.grid')!
    expect(grid.className).toContain('auto-fill')
    expect(grid.className).not.toMatch(/grid-cols-\d/)
  })

  // Clearing the filters empties the search box, so focus belongs in the box that
  // is now empty — the button that did the clearing is the wrong place to be, and
  // the whole point of clearing is to type something else.
  it('moves focus to the search field when the filters are cleared', () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    const search = screen.getByLabelText('Search')
    const clear = screen.getByRole('button', { name: /clear filters/i })

    clear.focus()
    expect(clear).toHaveFocus()

    fireEvent.click(clear)
    expect(search).toHaveFocus()
  })
})
