# ADR-0005: The item surface is a nav-less page at `/items/:id`, not an overlay

**Status:** Proposed (2026-09-13).

## Context

The item page and the photo viewer ended up as two places for one item: the page
(`ItemDetail`) listed the item's photos and carried the six actions that apply to each, while
the viewer (`apps/web/src/ui/PhotoViewer.tsx`) showed one photo large and carried none of them.
ADR-0002 had just given `Modal` a `full` size to serve the viewer, and the 2026-09-11 spec that
introduced it split the catalog card in two — image opens the viewer, name opens the item page —
because one card cannot be two destinations.

The owner's read is that this is the wrong shape: acting on a photo means leaving the viewer and
finding it again in the grid, moving between an item's photos means closing the viewer, and the
item is never seen as a set. The proposal is to make one surface that shows an item's photos and
acts on them, and to delete the page that duplicates it.

## Decision

**`/items/:id` renders the item surface: a full-screen page, mounted in its own layout route
outside `Shell`, so it keeps the overlay's fullscreen feel without being a dialog.**

- The route moves out of the `Shell` layout route into a second layout route that carries
  `SetupGate`/`RequireAuth` but no header and no `max-w-6xl` column
  (`apps/web/src/app/routes.tsx:24-47`, `apps/web/src/app/Shell.tsx:71`).
- `PhotoViewer` narrows to the **photo viewer** — one photo, zoom/pan/minimap, no `Modal`, no
  `onClose`, no "Open original". The surface owns the chrome: a top bar (position, prev/next,
  close), the viewer as its largest pane, a **read-only item panel** beside it, and a per-photo
  bar of the actions that apply to the photo on screen.
- The catalog and drafts pages lose their `PhotoViewer` overlays; their thumbnails navigate to
  the surface instead, and the catalog card returns to a **single** target.
- `TrashPage` keeps an overlay: a bare `Modal size="full"` peek, because a trash item is opened
  from a list you return to and cannot render a surface anyway — `items.get` throws for a
  trashed row (`apps/api/src/modules/items/service.ts:115-119`).

## Consequences

**`Modal size="full"` keeps exactly one consumer** for the item flow — `ManualUnpackModal` —
because nothing needs to be hosted over an overlay any more. `PhotoEditor` and
`ManualUnpackModal` open over a page exactly as they did before the merge, so there are no
stacked dialogs, no layered focus traps, and no close-the-viewer-and-reopen-it-at-the-same-photo
dance. ADR-0002's "two geometries, not three" still holds.

**The viewer's "click the background to close" rule is dropped.** On a page there is no
backdrop, and a click on empty space silently discarding the item you are looking at is hostile.
Escape and the close button remain. This removes a rule the 2026-09-11 spec argued for
deliberately, and that reasoning applied to an overlay, not to a surface.

**The catalog card's split is undone.** The image/name split existed only because the card had
two destinations. With one destination, the card is one target again.

**Overlay vs page is now a deliberate distinction, not an accident**: an overlay is for peeking
at something *from a list you are returning to* (the trash peek, the manual-unpack modal); the
item itself is a page with a URL. A future feature should pick on that basis.

### Alternatives rejected

- **The overlay over the catalog grid** — the route renders the grid with a `Modal size="full"`
  on top of it, as the viewer works today. Rejected: the editor and the manual-unpack modal would
  then stack inside it (two `fixed inset-0 z-[101]` dialogs ordered by DOM position, two focus
  traps, Escape ordering), and Radix's focus trap and Escape would have to be wired to a route.
- **A plain page inside `Shell`** — the smallest route change, and rejected on the owner's
  requirement: the shell's header and content column are what the overlay's fullscreen feel was
  buying, and the surface is "the only place an item is met in full".

### When to revisit

If the surface needs a second entry point that must *not* lose the page underneath — a
side-by-side compare, or opening an item from inside another item — that is the signal that a
page is the wrong container after all, and the overlay design should be revisited with the
stacking problem solved rather than avoided.

## Related

- ADR-0002 (`0002-modal-full-viewport-variant.md`) — the `full` geometry this keeps, now with
  one consumer instead of two.
- ADR-0004 (`0004-trash-and-recoverable-deletion.md`) — why a trashed item cannot render a
  surface, and why deleting a photo is permanent while deleting an item is not.
- Specs: `docs/superpowers/specs/2026-09-11-photo-viewer-and-bulk-discard-design.md` (the rules
  this narrows), `2026-09-13-manual-unpack-pagination-trash-design.md` (the modal this leaves
  untouched).
