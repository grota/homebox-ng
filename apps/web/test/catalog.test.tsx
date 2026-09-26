import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'

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

// `items.create` resolves with an id, like the real one, so the photo upload has an
// `itemId` to send. Hoisted (and shared) so a test can also assert that the item was
// created at all — the Clear case below submits with no photo, and "the create still
// happens" is the half of it that a missing upload request cannot show.
const mockCreate = vi.hoisted(() => ({ mutateAsync: vi.fn(async () => ({ id: 42 })) }))

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
        trashMany: { useMutation: () => ({ mutateAsync: vi.fn(async (x: any) => x), isPending: false, error: null }) },
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
        create: { useMutation: () => ({ mutateAsync: mockCreate.mutateAsync, isPending: false, error: null }) },
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

// The crop step opens on pick and saves only when the user says so, so the shared mock
// records its props and waits to be driven, unlike `photoEditor.test.tsx`'s.
vi.mock('react-filerobot-image-editor', async () => await import('./filerobotMock'))

import { ItemsPage } from '../src/features/items/ItemsPage'
import { ItemNewPage } from '../src/features/items/ItemNewPage'
import { AppProviders } from '../src/app/AppProviders'
import { editorProps } from './filerobotMock'

describe('catalog pages', () => {
  beforeEach(() => {
    mockItemTypes.types = mockItemTypes.seed
    mockCreate.mutateAsync.mockClear()
    editorProps.length = 0
    global.URL.createObjectURL = vi.fn(() => 'blob:picked') as any
    global.URL.revokeObjectURL = vi.fn() as any
  })

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
      fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [file] } })

      // Picking opens the crop on the picked file; it is not an upload.
      expect(editorProps.at(-1).source).toBe('blob:picked')

      // Save the crop. The cropped bytes are what the photo becomes (ADR-0012), so the
      // POST must carry the crop — an object URL as its source is the proof it never
      // touched the server first.
      const cropped = new Blob(['cropped'], { type: 'image/jpeg' })
      await act(async () => {
        editorProps.at(-1).onSave({ imageCanvas: { toBlob: (cb: any) => cb(cropped) }, mimeType: 'image/jpeg' })
      })

      fireEvent.click(screen.getByRole('button', { name: /create item/i }))

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('/upload/image')
      const body = init?.body as FormData
      expect(body.get('itemId')).toBe('42')
      const uploaded = body.get('file') as File
      expect(uploaded.name).toBe('photo.jpg')
      expect(uploaded.type).toBe('image/jpeg')
      // Restored here rather than left to the next test: `vi.spyOn` on a property that
      // is already a spy hands back the *same* mock, so an unrestored one carries this
      // test's call into the next one and its `mock.calls[0]` is the wrong request.
      fetchSpy.mockRestore()
    })

    // The crop's saved type is whatever the dialog reports, not an assumed `.jpg`: the
    // dialog offers jpeg, png and webp, and a blob named for the wrong container is
    // stored with the wrong extension and served with the wrong content type. The test
    // above drives the jpeg branch, so these two drive the other two containers.
    //
    // Pick, crop to `type`, submit, and hand back the file the POST carried. The spy is
    // restored before the assertions so a failure here cannot leak it into the next test.
    const uploadCroppedAs = async (type: string) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      render(<AppProviders><ItemNewPage /></AppProviders>)

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lamp' } })
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: '1' } })
      fireEvent.change(screen.getByLabelText('Photo'), {
        target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
      })

      await act(async () => {
        editorProps.at(-1).onSave({ imageCanvas: { toBlob: (cb: any) => cb(new Blob(['c'], { type })) }, mimeType: type })
      })
      fireEvent.click(screen.getByRole('button', { name: /create item/i }))

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
      const body = fetchSpy.mock.calls[0][1]?.body as FormData
      fetchSpy.mockRestore()
      return body.get('file') as File
    }

    it('uploads a png crop as photo.png', async () => {
      const uploaded = await uploadCroppedAs('image/png')
      expect(uploaded.name).toBe('photo.png')
      expect(uploaded.type).toBe('image/png')
    })

    // The type the old code fell through to `.jpg` for, so this is the case that names
    // the mismatch: extension `.jpg` over `image/webp` content.
    it('uploads a webp crop as photo.webp, not an assumed .jpg', async () => {
      const uploaded = await uploadCroppedAs('image/webp')
      expect(uploaded.name).toBe('photo.webp')
      expect(uploaded.type).toBe('image/webp')
    })

    it('uploads the file as picked when the crop is dismissed', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      render(<AppProviders><ItemNewPage /></AppProviders>)

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lamp' } })
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: '1' } })
      const file = new File(['x'], 'a.png', { type: 'image/png' })
      fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [file] } })

      // Closing the crop keeps the photo that was picked: the crop is a step the user
      // may decline, not a gate on adding a photo.
      await act(async () => {
        editorProps.at(-1).onClose()
      })
      fireEvent.click(screen.getByRole('button', { name: /create item/i }))

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
      const body = fetchSpy.mock.calls[0][1]?.body as FormData
      expect(body.get('file')).toBe(file)
      fetchSpy.mockRestore()
    })

    // The picker now keeps the file input's value, so the field shows the chosen file
    // the way any other file input does — and beside it the form names the photo it is
    // actually holding. The line is what tells the truth after a crop: the upload is
    // `photo.jpg` while the input's own text still says the original's name.
    it('names the photo it is holding, in place of an input that only shows the pick', async () => {
      render(<AppProviders><ItemNewPage /></AppProviders>)

      fireEvent.change(screen.getByLabelText('Photo'), {
        target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
      })
      // Dismissed, so what is held is the file as picked.
      await act(async () => {
        editorProps.at(-1).onClose()
      })

      expect(screen.getByText('a.png')).toBeInTheDocument()
    })

    // The picker holds one photo until submit, so without this the only way to change
    // your mind was to pick a different one. Clear empties the state *and* the input:
    // a file input whose value has not changed fires no `change` event, so emptying it
    // is also what makes the same file pickable again.
    it('drops the pending photo when Clear is pressed, and still creates the item', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
      render(<AppProviders><ItemNewPage /></AppProviders>)

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lamp' } })
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: '1' } })
      fireEvent.change(screen.getByLabelText('Photo'), {
        target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
      })
      // Dismissing the crop keeps the picked file as the photo being held.
      await act(async () => {
        editorProps.at(-1).onClose()
      })
      expect(screen.getByText('a.png')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

      // The pending photo is gone. The other half — that the input's own value is
      // emptied too, which is what makes the same file pickable again — is not
      // assertable here: jsdom reports `''` for a file input's `value` whether or not
      // one was chosen, so the assertion would hold with or without the line in
      // `clearPhoto`.
      expect(screen.queryByText('a.png')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /create item/i }))

      await waitFor(() => expect(mockCreate.mutateAsync).toHaveBeenCalled())
      // The item is still created; the cleared photo goes up nowhere. "No file in the
      // upload" is true here in its strongest form — with nothing pending there is no
      // upload request at all.
      expect(fetchSpy).not.toHaveBeenCalled()
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

  // The card was two targets while the photo opened a lightbox and the name opened
  // the item page, then one when both led to the same page (ADR-0005). It is two
  // again: the photo opens the item, the title toggles the selection.
  it('links the title to the item, and only the title', () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    const link = screen.getByRole('link', { name: 'Lamp' })
    expect(link).toHaveAttribute('href', '/items/1')
    expect(link).toHaveTextContent('Lamp')
    // Decorative (`alt=""`), so it is queried by selector rather than by role.
    // The photo is card content, not part of the link: clicking it picks the item.
    const card = screen.getByTestId('item-card')
    expect(card.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/file/'))
    expect(within(card).getAllByRole('link')).toHaveLength(1)
    // One photo, so there is no count to show: "1/1" is noise on every card with a
    // single photo, which is most of them.
    expect(within(card).queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument()
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
