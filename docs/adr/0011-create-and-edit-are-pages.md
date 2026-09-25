# ADR-0011: Creating and editing an item are pages with URLs

**Status:** Accepted (2026-09-25).

## Context

The catalog's "New item" was an inline toggle: `ItemsPage.tsx:48` (a `useState`), `:234` (a
`Button` that toggles it), `:306` (`{showForm && <ItemForm …>}`). It was the only form in the app
with no URL, so a refresh or a Back silently discarded the typing, and a second click on the button
hid the form under the cursor.

Editing was already a page in substance — `ItemDetail.tsx:141-162` throws the whole surface away and
renders the form in its own frame with its own Close — but the URL did not say so, and the mode was
component state (`ItemDetail.tsx:55`).

ADR-0005 left the rule this decision has to be taken on, in its own closing words: "an overlay is
for peeking at something *from a list you are returning to*; the item itself is a page with a URL. A
future feature should pick on that basis."

## Decision

**Create and edit are pages, and each picks its frame by ADR-0005's rule.**

- **Create is `/items/new`, inside the `Shell` layout route** (`routes.tsx:40-62`). Creating is
  entered from the catalog and returns to it, so it takes the app's chrome and nav. The form already
  carries its own measure (`ItemForm.tsx:164`), and the "no item types yet" guidance links to another
  Shell page (`ItemForm.tsx:238`), which only resolves to a sane destination inside `Shell`.
- **Edit is `/items/:id/edit`, in the same nav-less layout route as `/items/:id`** (`routes.tsx:27-37`)
  and rendered by **the same `ItemDetail` component**. "Am I editing" is derived from the path; the
  `editingItem` state is deleted. The surface's Edit button navigates there; Close, Cancel, Save and
  Escape all leave the form by the one rule the Consequences below describe.
- **Neither is an overlay or a dialog**, by ADR-0005's rule: an overlay is for a peek, and a form is
  a task.
- **Leaving create goes back where the user came from** — `navigate(-1)`, with `/items` as the
  cold-deep-link fallback — because the catalog keeps its search and facets in the URL
  (`ItemsPage.tsx:47`) and a bare `/items` would silently reset a filtered view. That is the same
  loss `ItemDetail.close()` (`:73-80`) already exists to prevent.

## Consequences

**`ItemDetail`'s "did I arrive cold?" test had to move to mount time.** `close()` chooses between
`navigate(-1)` and `navigate('/items')` on `location.key === 'default'` (`ItemDetail.tsx:73-80`).
That was sound while the surface's URL never changed underneath it; now that entering and leaving
edit rewrites the URL, the key changes mid-life, and a cold deep link to `/items/:id/edit` would
exit the app on Close — the exact failure the check was written to prevent. It becomes a `useRef`
captured at mount.

**Refresh and Back work on both pages**, which is the point: `/items/42/edit` reloads into edit mode,
and Back leaves it.

**Leaving the form goes back rather than replacing.** Entry is a `push` from the surface, so
every exit is `navigate(-1)` when the surface was reached in-app, and a `replace` to
`/items/:id` when it was a cold deep link (there is nothing to go back to). Without that,
exiting with `replace` left the surface's own entry underneath and put `/items/:id` in
history twice, so the surface's close took two presses to reach the catalog — a dead click,
which is worse than a surprising one. The cost of going back is that the form's entry
survives as a *forward* entry: Forward returns to the form, Back never does.

### Alternatives rejected

- **A separate edit component on its own route.** It would need `items.get`, the loading state, "Item
  not found", the trashed case (`items.get` throws for a trashed row) and its own frame — all of which
  `ItemDetail.tsx:125-162` already is. A second copy is how this becomes two places to fix.
- **`?edit=1` on `/items/:id`.** Same diff size and the same guarantees, but a path is the better URL
  and keeps `/items/:id` meaning one thing.
- **Keeping the toggle.** No URL, plus the two bugs above.

## Related

- ADR-0005 (`0005-item-surface-is-a-page.md`) — the rule being applied, and the layout route the edit
  page joins.
- ADR-0012 (`0012-a-photo-cropped-at-create-is-the-photo.md`) — the other decision taken in the same
  session, about the photo.
