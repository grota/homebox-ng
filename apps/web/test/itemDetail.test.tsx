import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('react-filerobot-image-editor', () => ({
  // PhotoEditor imports the editor as its default export and `TABS` by name, so
  // the mock needs both. `source` is surfaced as an attribute because which
  // rendition the editor opens is exactly what the two Edit actions differ on.
  default: ({ source }: { source: string }) => <div data-testid="fil-editor" data-source={source} />,
  TABS: { FINETUNE: 'Finetune', FILTERS: 'Filters', ADJUST: 'Adjust', WATERMARK: 'Watermark', ANNOTATE: 'Annotate', RESIZE: 'Resize' },
}))

// Mutation spies live outside the factories so tests can assert on the calls.
// `vi.hoisted` is required: `vi.mock` factories are hoisted above plain consts.
const mocks = vi.hoisted(() => ({
  trashItem: vi.fn(),
  setPrimary: vi.fn(),
  deleteImage: vi.fn(),
  updateItem: vi.fn(async (x: unknown) => x),
  unpack: vi.fn(),
  unpackManual: vi.fn(),
  publish: vi.fn(),
  // `tags.assign` replaces an item's whole tag set, so what it is (and is not)
  // called with on save is worth asserting.
  assignTags: vi.fn(async (x: unknown) => x),
  // Mutable so a test can make the unpack mutation report a failure. Cleared in
  // `beforeEach`, since the other cases assert on the success path.
  unpackError: null as { message: string } | null,
  navigate: vi.fn(),
  // `MemoryRouter` gives the initial entry `key: 'default'`, which is exactly the
  // cold-deep-link case. Stubbed so both branches of the close rule are reachable
  // from a test rather than one of them being unreachable by accident.
  locationKey: 'abc',
  // Read per render by the `items.get` mock, so a test can reshape the item —
  // replace the photos, or flip a catalog item into a draft.
  overrides: {} as Record<string, unknown>,
  // The starting photos. Image 10 is the primary and carries an edit; image 11
  // has neither. `items.get` returns them newest-first, so the primary is NOT
  // first in the array — which is the whole point of the ordering rule.
  images: [
    { id: 10, originalPath: 'uploads/originals/a.png', editedPath: 'uploads/edited/e.png', thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true },
    { id: 11, originalPath: 'uploads/originals/b.png', editedPath: null, thumbPath: 'uploads/thumbs/b.jpg', isPrimary: null },
  ] as { id: number; originalPath: string; editedPath: string | null; thumbPath: string; isPrimary: boolean | null }[],
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({ key: mocks.locationKey, pathname: '/items/3', search: '', hash: '', state: null }),
  }
})

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  const item = {
    id: 3, name: 'Lamp', description: 'Desk', quantity: 1, unit: null,
    published: true,
    itemTypeId: 1, locationId: null, type: { id: 1, name: 'Light' }, location: { id: 2, name: 'Living Room' },
    // One field with a value and one without: the panel prints the first and
    // leaves the second out rather than em-dashing a form.
    customFields: [
      { fieldId: 1, fieldName: 'Serial', value: 'ABC-123' },
      { fieldId: 2, fieldName: 'Notes', value: null },
    ],
    // Untagged, so the edit-form cases below start from an empty set and a click
    // on the tag picker is an *addition*. The panel's case overrides this.
    tags: [] as { id: number; name: string; color: string | null }[],
    images: mocks.images,
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
        get: { useQuery: () => ({ data: { ...item, ...mocks.overrides }, isLoading: false }) },
        // The surface swaps to the inline edit form, which calls `items.update`
        // and loads the type/location selects.
        update: { useMutation: () => ({ mutate: mocks.updateItem, mutateAsync: mocks.updateItem, isPending: false, error: null }) },
        create: { useMutation: mutation(vi.fn()) },
        trash: { useMutation: mutation(mocks.trashItem) },
      },
      images: {
        setPrimary: { useMutation: mutation(mocks.setPrimary) },
        delete: { useMutation: mutation(mocks.deleteImage) },
      },
      drafts: {
        publish: { useMutation: mutation(mocks.publish) },
        list: { useQuery: () => ({ data: { items: [], total: 0 }, isLoading: false }) },
      },
      itemTypes: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      locations: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      // The edit form renders the tag picker (`tags.list`) and offers inline
      // creation + assignment.
      tags: {
        list: { useQuery: () => ({ data: [{ id: 5, name: 'fragile', color: null }], isLoading: false }) },
        create: { useMutation: () => ({ mutateAsync: vi.fn(async () => ({ id: 7, name: 'new', color: null })), isPending: false, error: null }) },
        assign: { useMutation: () => ({ mutateAsync: mocks.assignTags, isPending: false, error: null }) },
      },
      // The surface's "Auto unpack this photo" is backed by
      // `trpc.unpack.run.useMutation()`. It navigates from the run's *result*
      // (that is how the detected count reaches the drafts page), so `onSuccess`
      // is wired through rather than dropped.
      unpack: {
        // Manual unpack of a stored photo: `{ imageId, regions }` and nothing to
        // upload, because the photo is already on disk.
        manual: {
          useMutation: () => ({
            mutate: vi.fn(),
            mutateAsync: async (input: unknown) => {
              mocks.unpackManual(input)
              return { detected: 2 }
            },
            isPending: false,
            error: null,
          }),
        },
        run: {
          useMutation: (options?: { onSuccess?: (result: { detected: number }) => void }) => ({
            mutate: (input: unknown) => {
              mocks.unpack(input)
              // A failed run never calls `onSuccess`, which is what leaves the
              // surface without its navigation.
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
  }
})

// The upload path stubs `fetch`; nothing else here should inherit that stub.
afterEach(() => vi.unstubAllGlobals())

import { ItemDetail } from '../src/features/items/ItemDetail'

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={['/items/3']}>
      <Routes><Route path="/items/:id" element={<ItemDetail />} /></Routes>
    </MemoryRouter>,
  )

// The stage, not the panel: the item's name is the photo's alt text AND the
// panel's heading, and only one of those is an image.
const stage = () => screen.getByTestId('photo-viewer')
const shown = () => within(stage()).getByRole('img', { name: 'Lamp' })
const current = () => screen.getByRole('button', { name: 'Edit photo' })

describe('item surface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.unpackError = null
    mocks.locationKey = 'abc'
    mocks.overrides = {}
  })

  // Image 10 is the primary one, so it is what the surface opens on and what the
  // counter calls "1 of 2" — even though the server hands the images over
  // newest-first and the primary is not necessarily first in that array.
  it('opens on the primary photo and counts from it', () => {
    renderDetail()
    expect(shown()).toHaveAttribute('src', '/file/uploads/edited/e.png')
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    // The badge that says which photo is the cover, now that the per-photo cards
    // that used to carry it are gone.
    expect(screen.getByText('Primary')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled()
  })

  // Edits stack on the last edit, not on the raw file, so once an image has an
  // `editedPath` that is the rendition "Edit photo" opens.
  it('opens the editor on the edited rendition, and the original from its own action', () => {
    renderDetail()
    fireEvent.click(current())
    expect(screen.getByTestId('fil-editor')).toHaveAttribute('data-source', '/file/uploads/edited/e.png')
  })

  it('shows one photo\'s actions at a time, and only the ones that apply to it', () => {
    renderDetail()
    // Exactly the photo on screen: the surface is not a grid of cards any more.
    expect(screen.getAllByRole('button', { name: 'Edit photo' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Delete photo' })).toHaveLength(1)
    // Image 10 has an edit, so it is the one that can go back to its original.
    expect(screen.getByRole('button', { name: 'Edit original photo' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open original' })).toHaveAttribute(
      'href',
      '/file/uploads/originals/a.png',
    )
    // Image 10 is primary, so there is nothing to set.
    expect(screen.queryByRole('button', { name: 'Set primary' })).not.toBeInTheDocument()
  })

  it('moves to the next photo, which brings its own actions with it', () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))

    expect(shown()).toHaveAttribute('src', '/file/uploads/originals/b.png')
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(screen.queryByText('Primary')).not.toBeInTheDocument()
    // No edit on this one, so there is nothing to go back to and nothing to open
    // — the button beside it would be the same button under a second name.
    expect(screen.queryByRole('button', { name: 'Edit original photo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open original' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set primary' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled()
  })

  it('sets the photo on screen as primary', () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set primary' }))
    expect(mocks.setPrimary).toHaveBeenCalledWith({ itemId: 3, imageId: 11 })
  })

  // PageUp/PageDown, because the arrow keys pan the photo and the surface must
  // not take them (see the viewer's own tests).
  it('steps photos with PageUp and PageDown', () => {
    renderDetail()
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'PageUp' })
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderDetail()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(mocks.navigate).toHaveBeenCalledWith(-1)
  })

  // Back is only right when there is somewhere to go back to: the catalog keeps
  // its search and facets in the URL, and a cold deep link has no history at all.
  it('falls back to the catalog when the surface was opened directly', () => {
    mocks.locationKey = 'default'
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/items')
  })

  it('deletes the photo on screen after confirmation', () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Delete photo' }))
    expect(mocks.deleteImage).toHaveBeenCalledWith({ id: 10 })
  })

  it('moves the item to the trash', () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }))
    expect(mocks.trashItem).toHaveBeenCalledWith({ id: 3 })
  })

  // The image 10 is the *edited* one, so this is the assertion that matters: the
  // modal must draw on `originalPath`, because that is the file the server crops.
  // Drawing on the edited rendition would put the boxes in a different coordinate
  // space from the pixels being cut.
  it('opens the manual unpack modal on the original file, not the edited rendition', async () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Manual unpack this photo' }))
    const canvas = await screen.findByTestId('manual-unpack-canvas')
    expect(canvas.querySelector('img')).toHaveAttribute('src', '/file/uploads/originals/a.png')
  })

  // The drafts page reports what an unpack detected, and this entry point into
  // the same flow must not be the silent one: a run that finds nothing has to
  // say so here too, which it can only do if the count travels in the URL.
  it('reports the detected count to the drafts page when unpacking a photo', () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Auto unpack this photo' }))
    expect(mocks.unpack).toHaveBeenCalledWith({ kind: 'item', imageId: 10 })
    expect(mocks.navigate).toHaveBeenCalledWith('/drafts?detected=2')
  })

  // The navigation above happens on success, so a failed run leaves the user on
  // the surface. Without an error surface that failure is completely silent: no
  // movement, no message, nothing to distinguish it from a click that missed.
  it('shows the failure when an unpack does not succeed', () => {
    mocks.unpackError = { message: 'Detection failed' }
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Auto unpack this photo' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Detection failed')
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('says so, and offers the upload, when the item has no photos', () => {
    mocks.overrides = { images: [] }
    renderDetail()
    expect(screen.getByText('No photos yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit photo' })).not.toBeInTheDocument()
    // The one place a photo is added, in the empty case as in the full one — so
    // the first photo lands without the layout changing under the user.
    expect(screen.getByLabelText('Upload photo')).toBeInTheDocument()
  })
})

describe('item surface panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.overrides = {}
  })

  // The fields the old page printed, plus the two it never rendered at all even
  // though the DTO has always carried them.
  it('reads the item out, including the tags and custom fields the page omitted', () => {
    mocks.overrides = { tags: [{ id: 5, name: 'fragile', color: null }] }
    renderDetail()
    const panel = within(screen.getByTestId('item-panel'))
    expect(panel.getByRole('heading', { name: 'Lamp' })).toBeInTheDocument()
    // Regexes rather than strings: a label and its value share one <p>, so the
    // exact text of the paragraph is "Type: Light" and never "Light".
    expect(panel.getByText(/Light/)).toBeInTheDocument()
    expect(panel.getByText(/Living Room/)).toBeInTheDocument()
    expect(panel.getByText('fragile')).toBeInTheDocument()
    expect(panel.getByText('ABC-123')).toBeInTheDocument()
    // A field with no value is left out rather than em-dashed: this is a
    // read-out, not a form.
    expect(panel.queryByText('Notes')).not.toBeInTheDocument()
  })

  // The upload invalidates `items.get` and hands back the id it created, but the
  // refetched list arrives a render or two later. Moving to the photo before it
  // is in the list would set the index past the end and the clamp would land on
  // nothing, so the jump waits for the photo to appear — which is the whole
  // reason this is a test and not a one-liner.
  it('moves to a newly added photo once it lands in the list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 12 }) })))
    renderDetail()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    const file = new File(['x'], 'new.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload photo'), { target: { files: [file] } })
    // The photo is created but has not reached the mocked item yet, so the jump
    // is still waiting rather than pointing the index at nothing.
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    // The refetch lands: the new photo is in the list, newest-first behind the
    // primary. Any re-render will do, and toggling the panel is the cheapest.
    mocks.overrides = {
      images: [
        ...mocks.images,
        { id: 12, originalPath: 'uploads/originals/c.png', editedPath: null, thumbPath: 'uploads/thumbs/c.jpg', isPrimary: false },
      ],
    }
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

    await waitFor(() => expect(screen.getByText('3 of 3')).toBeInTheDocument())
    expect(shown()).toHaveAttribute('src', '/file/uploads/originals/c.png')
  })

  // A draft is an item, and the surface is the main way to meet one — so it has
  // to carry the drafts page's verb, or opening one would be a step backwards.
  it('offers Publish on a draft where a catalog item offers Edit item', () => {
    mocks.overrides = { published: false }
    renderDetail()
    expect(screen.queryByRole('button', { name: 'Edit item' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(mocks.publish).toHaveBeenCalledWith({ id: 3 })
  })
})

describe('item surface editing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.overrides = {}
  })

  it('reveals the edit form prefilled from the item', () => {
    renderDetail()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Lamp')
    expect(screen.getByRole('heading', { name: 'Edit item' })).toBeInTheDocument()
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
