# Create/edit pages, the photo editor's tabs, and a crop at create — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the item form URLs (`/items/new`, `/items/:id/edit`), put the photo editor's tabs in the app's order and open it on Annotate with the Text tool, and let a photo be cropped before it is uploaded.

**Architecture:** All three changes are web-side and share one theme — the form and the photo are things with a URL and a lifecycle, not component state. The create form moves from a `useState` toggle on the catalog to a route in the `Shell` layout; edit becomes `/items/:id/edit`, rendered by the **same** `ItemDetail` component as the surface, with "am I editing" derived from the path. The crop is Filerobot's own ADJUST tab (crop/rotate/flip) pointed at an object URL of the picked file, whose saved blob *becomes* the pending photo — so no server, schema or tRPC change is needed anywhere.

**Tech Stack:** React 19, react-router-dom 7 (JSX `<Routes>`), tRPC client, the repo's Radix-based `Modal`, `react-filerobot-image-editor@4.9.1`, vitest + @testing-library/react (jsdom), Playwright for one e2e assertion.

**Spec:** `docs/superpowers/specs/2026-09-25-photo-workflow-pages-and-crop-design.md` — and the two ADRs it points at, `docs/adr/0011-create-and-edit-are-pages.md` and `docs/adr/0012-a-photo-cropped-at-create-is-the-photo.md`, which carry the *why* for Tasks 2, 3 and 5. Read the spec before Task 1.

## Global Constraints

- **No new dependencies.** Filerobot already ships the crop tool; `sharp` stays server-side and this plan does not touch it.
- **No server, schema, tRPC or API changes.** Every task below is inside `apps/web`.
- **Commands, from the repo root:**
  - one test file: `pnpm --filter @homebox/web test test/<file>.test.tsx`
  - all web unit tests: `pnpm --filter @homebox/web test`
  - types: `pnpm --filter @homebox/web typecheck`
  - e2e (starts its own server via Playwright's `webServer`): `pnpm --filter @homebox/web test:e2e`
- **In a fresh worktree, `tsc` lies.** `apps/web` resolves `@homebox/api`'s tRPC types through that package's built `dist/`, which a fresh worktree does not have, so `typecheck` emits errors that look real (`Property 'useUtils' does not exist…`, implicit `any` in files you never touched). `pnpm --filter @homebox/api build` and they all disappear. Do not "fix" the files it names.
- **Filerobot canvas interaction is not e2e-tested**, by policy (`docs/superpowers/specs/2026-09-05-phase2-image-editor-design.md:112`). Editor coverage means asserting the *props* handed to the editor and the *blob* it hands back — never driving its canvas.
- **Values copied verbatim from the library:** `TABS.ANNOTATE === 'Annotate'`, `TABS.ADJUST === 'Adjust'`, `TABS.RESIZE === 'Resize'`, `TABS.FINETUNE === 'Finetune'`, `TOOLS.TEXT === 'Text'`. The library's own defaults are `defaultTabId: 'Adjust'` and `defaultToolId: 'Crop'`.
- **Commit after every task**, in the repo's message style (`feat(web): …`, lower case, a reason rather than a restatement), ending with the trailer:

  ```
  Co-Authored-By: Claude Code <noreply@anthropic.com>
  ```

- **Do not push and do not open a PR.** One branch, commits only.

---

### Task 1: The editor's tabs, in the app's order and on the app's default

**Files:**
- Modify: `apps/web/src/features/upload/PhotoEditor.tsx:13-16` (the tab list), `:78-86` (the editor's props)
- Test: `apps/web/test/photoEditor.test.tsx` (the module mock at `:14-25`, plus two new tests)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PhotoEditor` keeps its current props (`{ image, itemId, open, onClose }`). Task 4 adds two exports to this same file and must not change what is asserted here.

- [ ] **Step 1: Update the library mock so `TOOLS` exists, and write the two failing tests**

In `apps/web/test/photoEditor.test.tsx`, add `TOOLS` to the existing `vi.mock('react-filerobot-image-editor', …)` factory (it currently exports only `TABS` and `default`), so it reads:

```tsx
vi.mock('react-filerobot-image-editor', () => ({
  TABS: { FINETUNE: 'Finetune', FILTERS: 'Filters', ADJUST: 'Adjust', WATERMARK: 'Watermark', ANNOTATE: 'Annotate', RESIZE: 'Resize' },
  // Mirror the real named export: `defaultToolId`'s value comes from here
  // (`TOOLS.TEXT === 'Text'` in the package's own types).
  TOOLS: { TEXT: 'Text', PEN: 'Pen', CROP: 'Crop' },
  // The package exports the editor as its default export (plus `TABS`). On mount,
  // record the config — which rendition it was pointed at, which tabs it was
  // given — then invoke onSave with a fake edited image to exercise the submit path.
  default: (props: any) => {
    editorProps.push(props)
    props.onSave({ imageCanvas: { toBlob: (cb: any) => cb(new Blob(['x'], { type: 'image/png' })) }, mimeType: 'image/png' })
    return null
  },
}))
```

Then add these two tests inside the existing `describe`:

```tsx
  it('offers the tabs in the order the app wants, annotate first', () => {
    render(<PhotoEditor image={{ id: 7, path: 'uploads/originals/x.png' }} itemId={3} open onClose={vi.fn()} />)
    // Exactly four, in exactly this order: a `toContain` would not notice a reorder,
    // which is how the order drifted in the first place.
    expect(editorProps.at(-1).tabsIds).toEqual(['Annotate', 'Adjust', 'Resize', 'Finetune'])
  })

  it("opens on the first tab with that tab's own first tool armed", () => {
    render(<PhotoEditor image={{ id: 7, path: 'uploads/originals/x.png' }} itemId={3} open onClose={vi.fn()} />)
    const { defaultTabId, defaultToolId } = editorProps.at(-1)
    expect(defaultTabId).toBe('Annotate')
    // Not the library's own `Crop`: it is not in the Annotate tab's tool list, so the
    // tab would open with no tool highlighted and no options panel.
    expect(defaultToolId).toBe('Text')
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @homebox/web test test/photoEditor.test.tsx`

Expected: 2 failures — `tabsIds` is `['Finetune', 'Adjust', 'Annotate', 'Resize']`, and `defaultTabId` is `undefined`. The other four tests in the file still pass.

- [ ] **Step 3: Reorder the tabs and give the editor its defaults**

In `apps/web/src/features/upload/PhotoEditor.tsx`, replace the tab list and its comment:

```tsx
// The tabs this app wants, in the order it wants them. Filerobot shows only what is
// listed here, in this order — `[]` is not "none", it is "everything", so the set has
// to be spelled out. Filters and Watermark are deliberately absent. Annotate leads
// because marking where a thing is on a photo is what these photos are for.
const TABS_IDS = [TABS.ANNOTATE, TABS.ADJUST, TABS.RESIZE, TABS.FINETUNE]
```

and add `TOOLS` to the import on line 2:

```tsx
import FilerobotImageEditor, { TABS, TOOLS } from 'react-filerobot-image-editor'
```

Then pass two more props to `<FilerobotImageEditor>` (inside the existing `h-[70vh]` div):

```tsx
          tabsIds={TABS_IDS}
          // `TABS_IDS[0]` rather than a named tab: the array is the one place the order
          // lives, so reordering it re-defaults the editor and the two cannot drift.
          // Left alone, the library's own default is `Adjust`, which is why this opened
          // on the second tab without the app ever asking for it.
          defaultTabId={TABS_IDS[0]}
          // Required, not decoration: the library's default tool is `Crop`, which the
          // Annotate tab does not carry, so the tab would open with nothing highlighted
          // and no options panel. `Text` is that tab's first tool and the one
          // `TEXT_DEFAULTS` below already configures.
          defaultToolId={TOOLS.TEXT}
```

- [ ] **Step 4: Run the file again**

Run: `pnpm --filter @homebox/web test test/photoEditor.test.tsx`

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/upload/PhotoEditor.tsx apps/web/test/photoEditor.test.tsx
git commit -m "feat(web): the photo editor leads with annotate, and says so in a test

The tab order was a literal array with no assertion behind it, and the default
tab was never ours at all — the library's own default is Adjust, which is why
the editor opened a tab the app had not chosen. The order and both defaults are
now pinned."
```

---

### Task 2: The create form becomes a page at `/items/new`

**Files:**
- Create: `apps/web/src/features/items/ItemNewPage.tsx`
- Modify: `apps/web/src/features/items/ItemsPage.tsx` (`:2` imports, `:45` comment, `:48`, `:225-228`, `:234`, `:306`)
- Modify: `apps/web/src/app/routes.tsx` (import + one route inside the `Shell` layout route, after `/items` at `:56`)
- Test: `apps/web/test/catalog.test.tsx` (the four form tests at `:102-160`)
- Modify: `apps/web/test/admin.test.tsx:122` (role changes from button to link)
- Modify: `apps/web/e2e/00-catalog.spec.ts:44` (the trigger is an anchor now)

**Interfaces:**
- Consumes: `ItemForm`, props `{ item?: EditableItem; onSaved?: (item: { id: number }) => void; onCancel?: () => void }` (`ItemForm.tsx:23-27`) — unchanged.
- Produces: `export function ItemNewPage()` with no props, and the route `/items/new` inside the `Shell` layout. Task 3's route is independent of this one.

- [ ] **Step 1: Move the four form tests onto the page and add the catalog-side link assertion**

In `apps/web/test/catalog.test.tsx`, add the import beside the existing `ItemsPage` import:

```tsx
import { ItemNewPage } from '../src/features/items/ItemNewPage'
```

Wrap the four tests that click `New item` in a new nested `describe`, rendering the page instead of the catalog and dropping the click:

```tsx
  // The create form is a page (ADR-0011), so there is no trigger to click here and no
  // toggle to open twice: reaching `/items/new` is what puts the form up. The catalog's
  // half of that contract — its link — is asserted in the test below.
  describe('the create page', () => {
```

Each of the four keeps its body but replaces

```tsx
      render(<AppProviders><ItemsPage /></AppProviders>)
      fireEvent.click(screen.getByRole('button', { name: /new item/i }))
```

with

```tsx
      render(<AppProviders><ItemNewPage /></AppProviders>)
```

and, in `'renders the item list and a create form'`, drops the list assertion (it belongs to the catalog) and becomes about the form alone — rename it `'renders the form'`:

```tsx
    it('renders the form', async () => {
      render(<AppProviders><ItemNewPage /></AppProviders>)
      expect(await screen.findByLabelText('Name')).toBeInTheDocument()
      expect(screen.getByLabelText('Type')).toBeInTheDocument()
    })
```

Then add the catalog's own test, next to the existing list test:

```tsx
  it('links the catalog to the create page', async () => {
    render(<AppProviders><ItemsPage /></AppProviders>)
    expect(await screen.findByText(/Lamp/i)).toBeInTheDocument()
    // A link, not a button that toggles something into view: the form is a page now,
    // and two clicks on a toggle used to hide it under the cursor.
    expect(screen.getByRole('link', { name: 'New item' })).toHaveAttribute('href', '/items/new')
  })
```

- [ ] **Step 2: Run the file and watch it fail**

Run: `pnpm --filter @homebox/web test test/catalog.test.tsx`

Expected: the whole file fails to load — `Failed to resolve import "../src/features/items/ItemNewPage"`. (If instead only assertions fail, the import resolved; finish Step 3 before re-running.)

- [ ] **Step 3: Create the page, and turn the catalog's toggle into a link**

Create `apps/web/src/features/items/ItemNewPage.tsx`:

```tsx
import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ItemForm } from './ItemForm'

// The create page (ADR-0011). It is a page rather than a toggle on the catalog so the
// form has a URL: a refresh no longer throws away what was typed, and Back leaves the
// form instead of hiding it.
//
// Leaving goes back where the user came from, because the catalog keeps its search and
// facets in the URL and a bare `/items` would silently reset a filtered view — the same
// loss the item surface's own close already guards against. `location.key === 'default'`
// is a cold deep link, where Back would leave the app.
export function ItemNewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const leave = useCallback(() => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/items')
  }, [location.key, navigate])

  return <ItemForm onSaved={leave} onCancel={leave} />
}
```

In `apps/web/src/features/items/ItemsPage.tsx`:

1. Line 2 gains `Link`, and line 5 gains `buttonClasses`:

```tsx
import { Link, useSearchParams } from 'react-router-dom'
import { Button, buttonClasses, cn, Field, hoverScrim, Input, PageHeader, Pagination, Popover, Select, Tooltip } from '../../ui'
```

2. Delete the now-unused `import { ItemForm } from './ItemForm'` (line 10).

3. Line 45's comment becomes:

```tsx
// "New item" links to the create page; clicking a card navigates to the item.
```

4. Delete `const [showForm, setShowForm] = useState(false)` (line 48).

5. Delete `handleSaved` entirely (lines 225-228) — `ItemForm` invalidates `items.list` itself (`ItemForm.tsx:155`), so the extra call was only ever there to close the toggle.

6. The header action (line 234) becomes a link styled as a button, the shape `ItemDetail` already uses for "Open original" (`ItemDetail.tsx:243-250`):

```tsx
        actions={
          <Link to="/items/new" className={cn(buttonClasses(), 'no-underline')}>
            New item
          </Link>
        }
```

7. Delete the render line `{showForm && <ItemForm onSaved={handleSaved} onCancel={() => setShowForm(false)} />}` (line 306).

Also update `admin.test.tsx:122` — it asserts the literal `New item` control on the catalog, and that control is no longer a button:

```tsx
      expect(screen.getByRole('link', { name: 'New item' })).toBeInTheDocument()
```

- [ ] **Step 4: Declare the route**

In `apps/web/src/app/routes.tsx`, import the page beside the other items imports and add the route inside the **`Shell`** layout route, directly after `<Route path="/items" …>` (line 56):

```tsx
        {/* The create form is a page, not a toggle on the catalog (ADR-0011). It sits in
            the Shell because it is entered from the catalog and returns to it. Static
            segments outrank dynamic ones in the router's ranking, so this wins over
            `/items/:id` in the other layout route. */}
        <Route path="/items/new" element={<ItemNewPage />} />
```

- [ ] **Step 5: Run the three affected suites**

Run: `pnpm --filter @homebox/web test test/catalog.test.tsx test/admin.test.tsx test/shell.test.tsx`

Expected: all pass. If a nav assertion elsewhere expects `New item` to be a button, fix it the same way — a link, not a button.

- [ ] **Step 6: Point the e2e spec at the link, and assert the URL**

In `apps/web/e2e/00-catalog.spec.ts`, line 44 changes from `button:has-text` to `a:has-text`, and gains the URL assertion — which is also what fails loudly if `/items/new` were ever matched by `/items/:id` instead (the surface would render "Item not found" and the fills below would fail):

```ts
  await page.click('a:has-text("New item")')
  // The form is a page now (ADR-0011). This URL is the proof, and the route ranking's
  // regression test: a wrong match would land on the item surface instead.
  await expect(page).toHaveURL(/\/items\/new$/)
```

The assertions after the create (line 51, `expect(page.getByText('Lamp')).toBeVisible()`) are left as they are: the page leaves by going back, so create still ends on the catalog — and that assertion now also covers the round trip.

- [ ] **Step 7: Run the e2e spec**

Run: `pnpm --filter @homebox/web test:e2e e2e/00-catalog.spec.ts`

Expected: both tests in the file pass. (Playwright starts its own server; if the port is busy because another stack is running, stop it first or run against a clean checkout's config — this repo's `webServer` uses its own port.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/items/ItemNewPage.tsx apps/web/src/features/items/ItemsPage.tsx apps/web/src/app/routes.tsx apps/web/test/catalog.test.tsx apps/web/test/admin.test.tsx apps/web/e2e/00-catalog.spec.ts
git commit -m "feat(web): the new item form is a page, so a refresh stops eating it

It was a useState toggle on the catalog — the only form in the app with no URL,
where refresh and Back discarded the typing and a second click hid the form
under the cursor. Create is now /items/new inside the Shell, and it leaves by
going back so a filtered catalog keeps its query string."
```

---

### Task 3: Editing gets a URL — `/items/:id/edit`, the same component

**Files:**
- Modify: `apps/web/src/features/items/ItemDetail.tsx` (`:2`, `:55`, `:73-80`, `:94-112`, `:141-162`, `:285`)
- Modify: `apps/web/src/app/routes.tsx` (one route inside the **bare** layout route, after `/items/:id` at `:36`)
- Test: `apps/web/test/itemDetail.test.tsx` (the router mock at `:46-53`, `renderDetail` at `:148-153`, three assertions at `:258-284`, and new tests)

**Interfaces:**
- Consumes: the route shape from Task 2 is not required; this task's route is a sibling of `/items/:id`.
- Produces: `ItemDetail` renders the edit form when the path ends in `/edit`, and navigates to `/items/:id` with `replace` on every way out of it.

- [ ] **Step 1: Make the test router real, and write the failing tests**

This file mocks `react-router-dom` to assert *where* clicks go. The edit form is a route now, so the mock has to spy **and** navigate, and the location has to be the real one (with a controllable `key`, because `close()` reads it):

```tsx
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
```

In the `vi.hoisted` bag (`:15-44`), set `locationKey` to `null`, and reset it to `null` in `beforeEach` alongside the other resets.

`renderDetail` gains the edit route, plus a probe for the catalog so a test can see that the surface *left*:

```tsx
  const renderDetail = () =>
    render(
      <MemoryRouter initialEntries={['/items/3']}>
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
```

Then add three tests:

```tsx
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
```

- [ ] **Step 2: Run the file and watch the new tests fail**

Run: `pnpm --filter @homebox/web test test/itemDetail.test.tsx`

Expected: the first two new tests fail (there is no edit route, and Edit item toggles state rather than navigating), and the third fails on `not.toHaveBeenCalledWith(-1)`. The existing edit-mode tests may also fail — they click `Edit item` and expect the form, which only works once navigation is real *and* the route exists.

- [ ] **Step 3: Derive edit mode from the path, and navigate on every exit**

In `apps/web/src/features/items/ItemDetail.tsx`:

1. `useRef` joins the React import on line 1.

2. Delete `const [editingItem, setEditingItem] = useState(false)` (line 55) and derive it where `location` is already read:

```tsx
  // The edit form is this surface at its own URL (ADR-0011), so the route decides
  // whether it is up — not component state. That is what makes a refresh land back in
  // the form, and Back leave it.
  const editing = location.pathname.endsWith('/edit')
```

3. Replace `close` (lines 73-80) with a version that answers "did I arrive cold?" once, at mount, plus a way out of the form:

```tsx
  // Captured once, deliberately: entering and leaving the edit form rewrites this URL,
  // so from the moment it does, `location.key` says nothing about how the surface was
  // reached — and a cold deep link would take `navigate(-1)` straight out of the app.
  const arrivedCold = useRef(location.key === 'default')

  const close = useCallback(() => {
    // Back when there is somewhere to go back to: the catalog keeps its search and
    // facets in the URL, and a bare `/items` would silently reset a filtered view.
    if (!arrivedCold.current) navigate(-1)
    else navigate('/items')
  }, [navigate])

  // The form's own exits — its Close, its Cancel, its Save, and Escape — all land back
  // on the item's own URL. `replace`, so an abandoned edit leaves no history entry.
  const leaveEdit = useCallback(() => navigate(`/items/${itemId}`, { replace: true }), [navigate, itemId])
```

4. In the key handler (lines 94-112), the edit branch becomes, and the dependency array gains `leaveEdit` and loses `editingItem`:

```tsx
      if (editing) {
        if (event.key === 'Escape') leaveEdit()
        return
      }
```

5. The edit render block (lines 141-162) keeps its frame and changes only its exits:

```tsx
        <Button className="ml-auto" onClick={leaveEdit}>
          Close
        </Button>
```
```tsx
          <ItemForm
            item={item}
            onSaved={() => {
              leaveEdit()
              refresh()
            }}
            onCancel={leaveEdit}
          />
```

6. `ItemPanel`'s `onEdit` (line 285) becomes `onEdit={() => navigate(\`/items/${itemId}/edit\`)}`.

- [ ] **Step 4: Declare the route**

In `apps/web/src/app/routes.tsx`, inside the **bare** layout route, directly after `<Route path="/items/:id" …>` (line 36):

```tsx
        {/* The same component at its own URL: the item surface is where an item is
            edited, and `/edit` on the end is what makes a refresh land in the form and
            Back leave it (ADR-0011). */}
        <Route path="/items/:id/edit" element={<ItemDetail />} />
```

- [ ] **Step 5: Run the file, then the whole suite**

Run: `pnpm --filter @homebox/web test test/itemDetail.test.tsx`

Expected: all pass. Two notes on the existing tests, both expected:
- `'closes the edit form on Escape without leaving the surface'` (`:258`) asserts `expect(mocks.navigate).not.toHaveBeenCalled()`. Escape now leaves the *form*, which is a navigation, so that assertion becomes the thing the test actually means:

```tsx
      // Escape does what the form's Close does: back to the item's own URL. What it
      // must never do is take the surface's own exit — that was the bug this test
      // was written for.
      expect(mocks.navigate).toHaveBeenCalledWith('/items/3', { replace: true })
      expect(mocks.navigate).not.toHaveBeenCalledWith(-1)
      expect(screen.getByTestId('photo-viewer')).toBeInTheDocument()
```

- `'ignores the photo keys while the edit form is open'` (`:271`) needs no change: Escape returns to the surface for real, so `'1 of 2'` is back in the DOM and unchanged.

One more, and it is the one that will look like a bug in the *test* rather than in the fix: `locationKey` now falls back to the router's real key, and a `MemoryRouter`'s first entry has key `'default'`. So any existing test asserting the *non*-cold branch (`toHaveBeenCalledWith(-1)`) must set an explicit non-default key — `mocks.locationKey = 'reached-from-the-catalog'` — or it will take the cold branch instead and fail with `/items` where it expected `-1`.

Then run: `pnpm --filter @homebox/web test`

Expected: green, including `catalog.test.tsx` from Task 2.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @homebox/api build && pnpm --filter @homebox/web typecheck`

Expected: no errors. (`editingItem` gone means `useState` may now be unused in `ItemDetail` — it is not, the panel and photo states use it.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/items/ItemDetail.tsx apps/web/src/app/routes.tsx apps/web/test/itemDetail.test.tsx
git commit -m "feat(web): editing an item gets its own URL, on the surface it already had

The edit form already replaced the whole surface, but as component state — so a
refresh dropped out of the form and the address bar never said where you were.
It is /items/:id/edit now, rendered by the same component. That move exposed a
latent bug: close() read location.key to tell a deep link from an in-app
arrival, and the URL now changes while the surface is mounted."
```

---

### Task 4: The crop dialog

**Files:**
- Create: `apps/web/src/features/upload/PhotoCrop.tsx`
- Modify: `apps/web/src/features/upload/PhotoEditor.tsx:11` and `:27` (export the two pieces the crop needs)
- Test: `apps/web/test/photoCrop.test.tsx`

**Interfaces:**
- Consumes: `Modal` from `../../ui` (props `{ open, onOpenChange, title, children }`, as used at `PhotoEditor.tsx:70`).
- Produces, and Task 5 depends on these exactly:
  - `export function PhotoCrop({ file, onSave, onClose }: { file: File; onSave: (blob: Blob) => void; onClose: () => void })` — mounts open, calls `onSave` with the cropped bytes, `onClose` when dismissed.
  - `export const toBlob` and `export type SaveImageData` from `PhotoEditor.tsx`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/photoCrop.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// Same shape as `photoEditor.test.tsx`: record the config the component hands the
// editor, and hand `onSave` a fake canvas. Filerobot's canvas is not driven here —
// its interaction is too brittle for that, by the repo's own policy.
const { cropProps } = vi.hoisted(() => ({ cropProps: [] as any[] }))

vi.mock('react-filerobot-image-editor', () => ({
  TABS: { FINETUNE: 'Finetune', FILTERS: 'Filters', ADJUST: 'Adjust', WATERMARK: 'Watermark', ANNOTATE: 'Annotate', RESIZE: 'Resize' },
  TOOLS: { TEXT: 'Text', PEN: 'Pen', CROP: 'Crop' },
  default: (props: any) => {
    cropProps.push(props)
    return null
  },
}))

import { PhotoCrop } from '../src/features/upload/PhotoCrop'

describe('the crop dialog', () => {
  beforeEach(() => {
    cropProps.length = 0
    // jsdom does not implement these; the component builds an object URL from the
    // picked file, because the file has no server path yet.
    global.URL.createObjectURL = vi.fn(() => 'blob:fake-file') as any
    global.URL.revokeObjectURL = vi.fn() as any
  })

  const file = () => new File(['x'], 'a.png', { type: 'image/png' })

  it('opens on the file itself, with crop and nothing else', () => {
    render(<PhotoCrop file={file()} onSave={vi.fn()} onClose={vi.fn()} />)
    const props = cropProps.at(-1)
    expect(props.source).toBe('blob:fake-file')
    // One tab: crop, rotate, flip — the library renders no tab strip at all for a
    // single tab, and arms the crop tool by its own default.
    expect(props.tabsIds).toEqual(['Adjust'])
  })

  it('exports at the source pixels, as jpeg', () => {
    render(<PhotoCrop file={file()} onSave={vi.fn()} onClose={vi.fn()} />)
    const props = cropProps.at(-1)
    // `savingPixelRatio` multiplies the OUTPUT canvas, so the edit flow's 4 would
    // store the crop at four times its pixel size — and this blob becomes the
    // photo's original (ADR-0012), not a rendition of one.
    expect(props.savingPixelRatio).toBe(1)
    expect(props.defaultSavedImageType).toBe('jpeg')
  })

  it('hands the cropped bytes back, and closes without cropping on dismiss', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<PhotoCrop file={file()} onSave={onSave} onClose={onClose} />)
    const cropped = new Blob(['cropped'], { type: 'image/jpeg' })

    cropProps.at(-1).onSave({ imageCanvas: { toBlob: (cb: any) => cb(cropped) }, mimeType: 'image/jpeg' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(cropped))

    cropProps.at(-1).onClose()
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @homebox/web test test/photoCrop.test.tsx`

Expected: `Failed to resolve import "../src/features/upload/PhotoCrop"`.

- [ ] **Step 3: Export the two pieces the dialog reuses**

In `apps/web/src/features/upload/PhotoEditor.tsx`, add `export` to the type on line 11 and the helper on line 27 — no other change:

```tsx
export type SaveImageData = { imageCanvas?: HTMLCanvasElement; imageBase64?: string; mimeType?: string }
```
```tsx
// Derive a Blob from filerobot's `imageData`. Prefer the canvas (accurate size),
// fall back to decoding the base64 data URL. Exported because the crop step needs the
// same conversion with a destination of its own: `PhotoEditor` posts its blob against
// an `imageId`, and `PhotoCrop` has no id to post against yet.
export const toBlob = (imageData: SaveImageData): Promise<Blob | null> => {
```

- [ ] **Step 4: Write the dialog**

Create `apps/web/src/features/upload/PhotoCrop.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import FilerobotImageEditor, { TABS } from 'react-filerobot-image-editor'
import { Modal } from '../../ui'
import { toBlob, type SaveImageData } from './PhotoEditor'

// The tabs a crop step wants: ADJUST, which is crop, rotate and flip. With one tab the
// library renders no tab strip, and its own `defaultToolId` (crop) is the one tool this
// tab leads with — so this is the editor with less of it, not a second crop build.
const CROP_TABS = [TABS.ADJUST]

// Crop the picked file, before it is uploaded (ADR-0012). It takes a `File` rather than
// a server path because at this point the photo has no item id, and so no home on disk:
// the picker holds it until `items.create` returns (`ItemForm`).
type PhotoCropProps = { file: File; onSave: (blob: Blob) => void; onClose: () => void }

export function PhotoCrop({ file, onSave, onClose }: PhotoCropProps) {
  // The editor takes a URL. This one is local and dies with the component.
  const src = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(src), [src])

  const [error, setError] = useState<string | null>(null)

  const handleSave = async (imageData: SaveImageData) => {
    setError(null)
    const blob = await toBlob(imageData)
    if (!blob) {
      setError('The crop produced no image')
      return
    }
    onSave(blob)
  }

  return (
    <Modal open onOpenChange={(next) => { if (!next) onClose() }} title="Crop photo">
      {error && <p role="alert" className="text-danger">{error}</p>}
      {/* A definite height, for the reason `PhotoEditor` documents at length: the
          editor sizes to 100% of its parent and collapses inside a `height: auto`
          dialog. */}
      <div className="h-[70vh]">
        <FilerobotImageEditor
          source={src}
          onSave={handleSave}
          onClose={onClose}
          tabsIds={CROP_TABS}
          // This blob becomes the photo's ORIGINAL (ADR-0012), so it is exported at the
          // source's own pixels — `savingPixelRatio` multiplies the output canvas — and
          // as JPEG, because PNG is the wrong container for a photograph.
          savingPixelRatio={1}
          defaultSavedImageType="jpeg"
        />
      </div>
    </Modal>
  )
}
```

- [ ] **Step 5: Run it, then the editor's own file, to prove nothing regressed**

Run: `pnpm --filter @homebox/web test test/photoCrop.test.tsx test/photoEditor.test.tsx`

Expected: 9 passed (3 + 6).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/upload/PhotoCrop.tsx apps/web/src/features/upload/PhotoEditor.tsx apps/web/test/photoCrop.test.tsx
git commit -m "feat(web): a crop dialog for a photo that has not been uploaded yet

Filerobot's ADJUST tab over an object URL of the picked file: the same editor,
one tab, and its saved blob is what the create form will upload. It reuses
PhotoEditor's blob conversion rather than wiring the editor a second time, and
exports at source pixels — savingPixelRatio multiplies the output canvas."
```

---

### Task 5: Picking a photo opens the crop, and the crop is what uploads

**Files:**
- Modify: `apps/web/src/features/items/ItemForm.tsx` (`:5` imports, `:60` state, `:139-148` submit, `:325-332` the picker)
- Test: `apps/web/test/catalog.test.tsx` (the photo test in the create-page block)

**Interfaces:**
- Consumes: `PhotoCrop` and its props exactly as Task 4 produced them (`{ file, onSave, onClose }`).
- Produces: nothing later depends on this. `ItemForm`'s own props are unchanged, so its other call site (`ItemDetail.tsx:151`) and `locationSelect.test.tsx:84` keep working — and picking a photo while *editing* gets the same crop, which is intended.

- [ ] **Step 1: Add the editor mock and the two failing tests**

In `apps/web/test/catalog.test.tsx`, add a mock of the editor beside the existing tRPC mock — it must **not** call `onSave` on render, because here the pick is not a save:

```tsx
// The crop step opens on pick and saves only when the user says so, so this mock
// records its props and waits to be driven, unlike `photoEditor.test.tsx`'s.
const cropProps = vi.hoisted(() => [] as any[])

vi.mock('react-filerobot-image-editor', () => ({
  TABS: { FINETUNE: 'Finetune', FILTERS: 'Filters', ADJUST: 'Adjust', WATERMARK: 'Watermark', ANNOTATE: 'Annotate', RESIZE: 'Resize' },
  TOOLS: { TEXT: 'Text', PEN: 'Pen', CROP: 'Crop' },
  default: (props: any) => {
    cropProps.push(props)
    return null
  },
}))
```

Add `import { act } from '@testing-library/react'` to that file's imports, reset and stub in `beforeEach` (jsdom implements neither object-URL function):

```tsx
    cropProps.length = 0
    global.URL.createObjectURL = vi.fn(() => 'blob:picked') as any
    global.URL.revokeObjectURL = vi.fn() as any
```

Then change the existing photo test so it drives the crop, and add the dismissing case. Replace the body of `'uploads the picked photo using the id returned by create'` from the pick onward:

```tsx
      const file = new File(['x'], 'a.png', { type: 'image/png' })
      fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [file] } })

      // Picking opens the crop on the picked file; it is not an upload.
      expect(cropProps.at(-1).source).toBe('blob:picked')

      // Save the crop. The cropped bytes are what the photo becomes (ADR-0012), so the
      // POST must carry the crop — an object URL as its source is the proof it never
      // touched the server first.
      const cropped = new Blob(['cropped'], { type: 'image/jpeg' })
      await act(async () => {
        cropProps.at(-1).onSave({ imageCanvas: { toBlob: (cb: any) => cb(cropped) }, mimeType: 'image/jpeg' })
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
```

and add, in the same block:

```tsx
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
        cropProps.at(-1).onClose()
      })
      fireEvent.click(screen.getByRole('button', { name: /create item/i }))

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
      const body = fetchSpy.mock.calls[0][1]?.body as FormData
      expect(body.get('file')).toBe(file)
      fetchSpy.mockRestore()
    })
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @homebox/web test test/catalog.test.tsx`

Expected: `cropProps.at(-1)` is `undefined` (nothing renders the editor yet) — both tests fail.

- [ ] **Step 3: Wire the crop into the picker**

In `apps/web/src/features/items/ItemForm.tsx`:

1. Add the import beside the upload import on line 5:

```tsx
import { PhotoCrop } from '../upload/PhotoCrop'
```

2. Add state, next to `photo` on line 60:

```tsx
  const [photo, setPhoto] = useState<File | null>(null)
  // The file the crop dialog is open on, if any. Separate from `photo` on purpose:
  // closing the dialog without cropping keeps the file that was picked.
  const [cropping, setCropping] = useState<File | null>(null)
```

3. The picker (lines 325-332) opens the crop instead of setting the photo, and says so:

```tsx
      <Field label={item ? 'Add photo' : 'Photo'} htmlFor="item-photo">
        <Input
          id="item-photo"
          type="file"
          accept="image/*"
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCropping(e.target.files?.[0] ?? null)}
        />
      </Field>

      {/* Removing the background before the item exists is the point of cropping here
          (ADR-0012), so it is offered on pick rather than after the save. */}
      {cropping && (
        <PhotoCrop
          file={cropping}
          onSave={(blob) => {
            setPhoto(asFile(blob))
            setCropping(null)
          }}
          onClose={() => {
            setPhoto(cropping)
            setCropping(null)
          }}
        />
      )}
```

4. Add the container helper above the component, beside the other module-level declarations:

```tsx
// The crop dialog hands back a Blob; the upload wants a File. The container is taken
// from the blob rather than assumed, because a PNG stored under a `.jpg` name would be
// saved with the wrong extension and served with the wrong content type.
const asFile = (blob: Blob) => new File([blob], blob.type === 'image/png' ? 'photo.png' : 'photo.jpg', { type: blob.type })
```

The submit path (lines 139-148) does not change: it still creates the item and then uploads `photo`, which is now either the crop or the untouched file.

- [ ] **Step 4: Run the file, then everything**

Run: `pnpm --filter @homebox/web test`

Expected: all green — including `locationSelect.test.tsx`, which renders `ItemForm` directly and now mounts the crop only when a file is picked (it never picks one).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @homebox/web typecheck`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/items/ItemForm.tsx apps/web/test/catalog.test.tsx
git commit -m "feat(web): the photo can be cropped while the item is still being created

The picker opened a file dialog and the file went up as-is, so the only crop was
one click after the item existed. Picking now opens the crop, and its blob is
what uploads — the item is created and the cropped bytes go up as the photo, so
there is no second rendition and no second request."
```

---

## Verification

After Task 5, from the repo root:

- [ ] `pnpm --filter @homebox/api build && pnpm --filter @homebox/web typecheck` — clean.
- [ ] `pnpm --filter @homebox/web test` — the whole web suite.
- [ ] `pnpm --filter @homebox/web test:e2e` — the full e2e suite; `00-catalog.spec.ts` carries the new URL assertions.
- [ ] By hand, against a running stack (a worktree needs its own ports — see the README's *"Or: a branch that lives in a git worktree"*):
  - [ ] Catalog → **New item** → the address bar reads `/items/new`; **refresh** → still the form, nothing lost.
  - [ ] With a filter applied (e.g. `/items?q=lamp`), open create and **Cancel** → back at `/items?q=lamp`, filter intact.
  - [ ] **Create** an item → back at the catalog, the new card present.
  - [ ] Pick a photo on the create page → the crop opens on it, cropping and saving round-trips to the form, and the item's photo is the crop.
  - [ ] Pick a photo and **close** the crop → the photo is still the file as picked.
  - [ ] Item surface → **Edit item** → the URL is `/items/:id/edit`; **refresh** → still the form, prefilled; **Escape** → back on the surface, same item, same photo.
  - [ ] Deep-link `/items/:id/edit` in a fresh tab → **Close** → the catalog (not a dead end).
  - [ ] Photo editor (**Edit photo**) → it opens on **Annotate**, with the Text tool ready, and the tab order reads Annotate, Adjust, Resize, Finetune.
