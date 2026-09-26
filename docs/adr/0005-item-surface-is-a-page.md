# ADR-0005: The item surface is a nav-less page at `/items/:id`, not an overlay

**Status:** Proposed (2026-09-13). Amended 2026-09-25: its "the card is one target again"
consequence is undone — see the amendment at the end.

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

## Amendment (2026-09-25): the catalog card is two targets again

The decision above stands — the item surface is a page. One consequence of it does not.

ADR-0005 undid the card's image/name split *because there was one destination*. But the card
gained a second job after this ADR: selection (ADR-0010). A 13px checkbox in the card's footer
was then the only thing that could pick an item, and the smallest thing on the card.

**The photo opens the item; the title toggles the checkbox.** The title is a `<label for>` the
footer's checkbox, so the browser does the toggling — no click handler, no second focus stop,
and the name is the hit target rather than the box. The location line, the tags and the search
snippet go back to being plain text beside the link.

The one exception is an item with **no photo**: nothing above the title would be clickable and
the title toggles, so there the text block rides inside the link and the card stays reachable.

This is the split ADR-0005 called an accident of two destinations, chosen deliberately for two
*jobs* instead. It is worth revisiting if a third affordance lands on the card.

## Amendment (2026-09-26): the link covers the card

The split above stands — the card still has two targets — but the exception it needed does not.

Wrapping the photo in the link made the link's box its **content's**, and that content can be
empty: an item with no photo, no location and no tags rendered a zero-height anchor, so such an
item could not be opened from the catalog at all. Its title toggles the checkbox, and that was
the only clickable thing left on the card. The leg that creates exactly that item found it.

The link is an empty box stretched over the card instead (`absolute inset-0`), with the photo and
the text block as ordinary content beside it. Nothing moves — an out-of-flow box takes no space —
so a photoless card needs no placeholder and no card changes shape, and there is no longer a
no-photo case to keep in step with the photo case.

Two details are load-bearing:

- **`z-10`, not `z-0`.** The photo's wrapper is `relative` (the "1/2" badge is absolute inside
  it), and a positioned `z-index: auto` element paints *after* a `z-0` one in tree order: the
  photo came out on top of the link and swallowed the click meant to open the item. The title's
  label and the footer's are `z-20`, above the link, so each keeps its own clicks.
- The card is the link's positioning context, and the unit tests cannot see any of this — they
  could not have seen the bug either, because what failed was the anchor's *size*.

Revisit if the card gains a third job, or if a non-link control joins the card body: it would
have to be lifted above `z-10` the way the two labels are.

## Amendment (2026-09-26, later): the body picks, the title opens

The two targets are the amendment above's. Which one does what is reversed, after using it.

Picking is what you do *while scanning* a list — it is the frequent gesture, and the one you make
without aiming. So it takes the whole body: the photo, the path, the tags, the blank space under a
short card, the footer row. Opening one item is the deliberate gesture, and it takes the part that
names what it opens.

Mechanically this is small: the body's target is the overlay label from the amendment above, with
the link moved back to the title. `z-20` on the title against the overlay's `z-10` is what keeps
them apart. The title is a link with the name as its *text* now rather than an `aria-label` on a
box, so it is a text link to a screen reader and a new-tab target to the browser.

The cost, stated plainly: a card's photo no longer opens the item, so opening a specific item
means aiming at its name — narrower than the photo. That is the price of the body meaning "pick",
and the reason to reverse this again would be finding that opening is the more frequent gesture.
