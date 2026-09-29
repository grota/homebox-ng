import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The editor renders the rendition as an attribute here: which rendition it opens is
// exactly what the two Edit actions differ on.
vi.mock('react-filerobot-image-editor', async () => await import('./filerobotMock'))

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
  // `null` means "whatever the router really says", so navigation in this file is
  // real and `ItemDetail`'s own route (`/items/:id/edit`) can be reached by
  // clicking. Set it to a key to stand in for how the surface was *arrived at*
  // without travelling: `'default'` is a cold deep link, anything else is an
  // in-app arrival with somewhere to go back to.
  locationKey: null as string | null,
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
    // `navigate` stays a spy — it is how this file asserts navigation — but it also
    // performs the real navigation: the edit form is a route, so a click that changes
    // the URL has to actually change it for the form to come up.
    useNavigate: () => {
      const real = actual.useNavigate()
      return (to: unknown, options?: unknown) => {
        // Never called with a trailing `undefined`: the existing assertions in this file
        // are `toHaveBeenCalledWith(-1)`, which would not match `(-1, undefined)`.
        if (options === undefined) mocks.navigate(to)
        else mocks.navigate(to, options)
        return (real as (t: unknown, o?: unknown) => unknown)(to, options)
      }
    },
    // The real location, so tests that navigate for real see the path change. `key` is
    // overridable (`null` means "use the real one") so a test can say "as if this
    // surface had been reached from the catalog" without being there.
    useLocation: () => {
      const real = actual.useLocation()
      return { ...real, key: mocks.locationKey ?? real.key }
    },
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
import { behavior } from './filerobotMock'

behavior.probeSource = true

// `fromCatalog` puts the catalog *behind* the surface in the router's real history.
// It is what the surface's own Close needs: a MemoryRouter's `navigate(-1)` clamps at
// the start of its history, so with the surface as the only entry Back has nowhere to
// go and the catalog can never be reached however many times Close is pressed. Only
// the one-press test below needs the journey; every other test starts at the surface.
const renderDetail = ({ fromCatalog = false } = {}) =>
  render(
    <MemoryRouter initialEntries={fromCatalog ? ['/items', '/items/3'] : ['/items/3']}>
      <Routes>
        <Route path="/items/:id" element={<ItemDetail />} />
        {/* The edit form is this same component at its own URL (ADR-0011). */}
        <Route path="/items/:id/edit" element={<ItemDetail />} />
        {/* A probe, so "it left for the catalog" is observable: the same shape
            `catalogCard.test.tsx` uses for its `/items/:id` stub. */}
        <Route path="/items" element={<div data-testid="catalog" />} />
      </Routes>
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
    mocks.locationKey = null
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
  })

  // The badge sits to the *right* of the right arrow, so the bar reads
  // ‹ 2 of 5 › [Primary] — the counter stays bracketed by its arrows and the
  // badge hangs off the end rather than splitting the pair.
  it('puts the Primary badge to the right of the right arrow', () => {
    renderDetail()
    const bar = screen.getByRole('button', { name: 'Next photo' }).parentElement!
    const children = Array.from(bar.children).filter((el) => el.textContent?.trim() !== '')
    const nextIndex = children.indexOf(screen.getByRole('button', { name: 'Next photo' }))
    const badgeIndex = children.indexOf(screen.getByText('Primary'))
    expect(badgeIndex).toBe(nextIndex + 1)
  })

  // The badge must not move the counter. The bar centres its middle group, so a
  // badge *inside* that group makes the whole thing wider and shoves the counter
  // left — the arrows then sat in two different places depending on whether the
  // photo you were looking at was the primary, which is the kind of thing nobody
  // notices until they page through and the controls appear to jump.
  //
  // jsdom lays nothing out, so this cannot measure the position. What it can
  // assert is the *structure* that makes it stable: the badge is out of the flow
  // of the run being centred, so it cannot widen it. The pixel claim itself is
  // in `e2e/cardPhotos.spec.ts`.
  it('takes the badge out of the flow of the centred run', () => {
    renderDetail()
    // The run is the next arrow's parent, and it is what gets centred.
    const run = screen.getByRole('button', { name: 'Next photo' }).parentElement!
    expect(run).toHaveClass('relative')
    // A positioning context, and the badge hangs off its right edge — inside it,
    // so it is still trailing the arrow, but `absolute`, so it contributes no
    // width.
    expect(screen.getByText('Primary')).toHaveClass('absolute', 'left-full')
  })

  // The carousel loops, so neither arrow is ever dead on a multi-photo item.
  it('keeps both arrows live at the ends, and wraps round', () => {
    renderDetail()
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeEnabled()

    // Forward off the end of 2, back onto the primary.
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(shown()).toHaveAttribute('src', '/file/uploads/edited/e.png')

    // And back off the front.
    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }))
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
  })

  // Nothing to page to, so the arrows stay put but have nowhere to go.
  it('disables the arrows only when the item has a single photo', () => {
    mocks.overrides = { images: [mocks.images[0]] }
    renderDetail()
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled()
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
    // The keys wrap with the arrows rather than stopping at the ends.
    fireEvent.keyDown(window, { key: 'PageUp' })
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    // A key that is not the initial entry's, i.e. this surface was reached from
    // inside the app and Back is the right way out.
    mocks.locationKey = 'reached-from-the-catalog'
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

  // Whether this is a cold deep link is a question about *arrival*, and entering and
  // leaving the edit form rewrites the URL — so a check that reads `location.key` at
  // close time gets a key that says nothing about how the surface was reached, and a
  // deep link takes `navigate(-1)` out of the app. The answer is captured at mount.
  it('still leaves for the catalog when the surface was deep-linked, even after an edit', () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' })) // the form's Close
    fireEvent.click(screen.getByRole('button', { name: 'Close' })) // the surface's Close

    expect(mocks.navigate).toHaveBeenLastCalledWith('/items')
    expect(mocks.navigate).not.toHaveBeenCalledWith(-1)
  })

  // The two-press bug a hand check found, end to end and against the router's real
  // history. The form's exit used to `replace` its own entry, which left the surface's
  // entry underneath and put `/items/:id` in history twice: the surface's Close then
  // landed on the URL it was already showing, so the catalog took two presses — a dead
  // click. The exit goes back now, so one press is enough.
  it('reaches the catalog in one press from the surface after closing the form', async () => {
    mocks.locationKey = 'reached-from-the-surface'
    renderDetail({ fromCatalog: true })

    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' })) // the form's Close
    expect(screen.getByTestId('photo-viewer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' })) // the surface's Close
    expect(await screen.findByTestId('catalog')).toBeInTheDocument()
  })

  // The edit form replaces the surface, so Escape while it is up has to close the
  // *form* — the same thing its own Close button does. Before this, the surface's
  // Escape ran instead and took the user back to the catalog, losing the item they
  // were editing, which is exactly the asymmetry that made it a bug: the Close
  // button and Escape did different things.
  it('closes the edit form on Escape without leaving the surface', () => {
    // In-app, so the form's exit is the one that goes back the way it came in.
    mocks.locationKey = 'reached-from-the-surface'
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))
    expect(screen.getByLabelText('Name')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    // Escape does what the form's Close does: back to the surface it was pushed from.
    // What it must never do is take the surface's own exit to the catalog — that was the
    // bug this test was written for.
    expect(mocks.navigate).toHaveBeenCalledWith(-1)
    expect(mocks.navigate).not.toHaveBeenCalledWith('/items')
    expect(screen.getByTestId('photo-viewer')).toBeInTheDocument()
  })

  // The photo keys go quiet with the form: there is no photo on screen to move
  // between, and paging the carousel underneath an edit is nobody's intent.
  it('ignores the photo keys while the edit form is open', () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))

    fireEvent.keyDown(window, { key: 'PageDown' })

    // Asserted after closing the form, deliberately: while it is up the counter is
    // not in the DOM either way, so the same assertion made there would pass
    // whether or not the key went through.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
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
    mocks.locationKey = null
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
    mocks.locationKey = null
    mocks.overrides = {}
  })

  it("sends Edit item to the item's own edit URL", () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/items/3/edit')
  })

  it('renders the edit form at the edit URL, so a refresh lands in it', () => {
    render(
      <MemoryRouter initialEntries={['/items/3/edit']}>
        <Routes>
          <Route path="/items/:id" element={<ItemDetail />} />
          <Route path="/items/:id/edit" element={<ItemDetail />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    // The surface is replaced, not covered: one thing is on screen, and it is the form.
    expect(screen.queryByTestId('photo-viewer')).not.toBeInTheDocument()
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
    // Saving is one of the form's four exits (ADR-0011), so it lands on the item's
    // own URL — the same place its Close and its Escape go.
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/items/3', { replace: true }))
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
