# Item surface — design

**Date:** 2026-09-13 · **Decisions:** ADR-0005 (`docs/adr/0005-item-surface-is-a-page.md`)
· **Related:** ADR-0002 (the `full` modal geometry), ADR-0004 (trash), and the two specs this
one narrows — `2026-09-11-photo-viewer-and-bulk-discard-design.md`,
`2026-09-13-manual-unpack-pagination-trash-design.md`.

*The `file:line` references were accurate when this was written. **The symbol names are the
durable anchor** — `ItemDetail`, `PhotoViewer`, `getImagesForItem`, `createItemsFromImage` — and
grepping for one is how to read a citation that no longer lands. `CONTEXT.md` is the living
glossary.*

## Problem

**One item, two places.** `ItemDetail` lists an item's photos and carries six actions per photo;
`PhotoViewer` shows one photo large and carries none of them. So acting on a photo means closing
the viewer, finding the thumbnail again and using the right button in a card; moving between an
item's photos means closing the viewer; and the photos are never seen as a set. The catalog card
is split in two — thumbnail opens the viewer, name opens the page — because one card cannot have
two destinations.

The owner's requirement is a single place where an item is met in full: its photos browsed and
acted on, its fields read, with no second location that duplicates either half.

## Facts this design rests on

Established by reading the code, not assumed. Each one changed a decision.

- **`ItemDetail` prints five things**: name, description, `Qty: N unit`, type, location
  (`ItemDetail.tsx:101-106`). Tags and custom fields are on the item DTO and consumed by
  `ItemForm` (`ItemForm.tsx:17-18`) but never rendered by the page — so the read-only panel is
  *adding* them, and needs **no API change**.
- **`PhotoViewer` takes two path strings and nothing else** (`PhotoViewer.tsx:47-59`). It has no
  notion of a photo list, so a carousel is a props change, not a rearrangement.
- **`PhotoViewer` has three consumers** — `ItemDetail.tsx:189`, `ItemsPage.tsx:323`,
  `DraftsPage.tsx:216`. **`TrashPage` has none**: its thumbnails are inert, so Q22(b) adds a
  viewer there rather than preserving one.
- **`Modal size="full"` is `fixed inset-0 z-[101]`** (`Modal.tsx:10`). Two stacked dialogs share
  that z-index and are ordered by DOM position — which is why nothing nests in this design.
- **`Shell` is a layout route**: a header plus a `max-w-6xl` content column wrapping `<Outlet/>`
  (`Shell.tsx:71`). Leaving it is a routing change, not a CSS one.
- **`ItemForm` is a view swap in both its call sites, not a route** (`ItemDetail.tsx:65`,
  `ItemsPage.tsx:181`). "Edit item" needs no routing work.
- **`images[0]` is the newest photo, not the primary.** `getImagesForItem` orders by
  `sortOrder desc` (`images/repo.ts:59`) and upload assigns `max+1` (`uploads.ts:142`) — while
  `ItemsPage.tsx:286-299` builds its card from `images[0]` and `DraftsPage.tsx:179` /
  `TrashPage.tsx:72` use `find(isPrimary) ?? images[0]`. The two conventions already disagree;
  `isPrimary` is a badge, not an order.
- **`items.get` throws `NOT_FOUND` for a trashed row** (`items/service.ts:115-119`) — so a
  trashed item cannot render a surface, and the trash peek cannot have an item panel.
- **Both unpack paths leave the page on success**, to `/drafts?detected=n` (`ItemDetail.tsx:26-31`,
  `:203-208`), and **detection is slow** (transformers.js, Gemini, OpenAI) with nothing shown
  during it. `unpack.error` is rendered once, on the item page only (`ItemDetail.tsx:114-118`).
- **Upload assigns `sortOrder = max+1` and makes the very first image primary**
  (`uploads.ts:142`, `:153`).
- **The catalog keeps its facet state in the URL** (`?q=`, `?page=`), so "close" must be
  history-aware to avoid silently resetting a search.
- **Backdrop-close is a positive target check on the container** (`PhotoViewer.tsx:133`,
  `:186-189`), not a negative test — any new chrome must be added to that set or clicking a
  control dismisses the surface.

## Design

### 1. The surface and its route

1. **`/items/:id` moves out of the `Shell` layout route** into a second layout route that
   carries `SetupGate`/`RequireAuth` and nothing else, so the surface is full-screen with no
   header (`routes.tsx:24-47`). This is what buys the overlay's fullscreen feel without being a
   dialog; see ADR-0005 for why a page beat an overlay.
2. **The surface is the only place an item's photos are browsed and acted on.** Its parts, top
   to bottom: a **top bar** (`‹ 3 of 7 ›`, `Primary` when the shown photo is the primary, and
   `Close`), the **photo viewer** as the largest pane, the **item panel** beside it, and the
   **per-photo bar**.
3. **One close control, not two.** `Close` navigates back when there is in-app history and to
   `/items` on a cold deep link (`location.key === 'default'`). A separate "← Items" would do the
   same thing twice. This is also what keeps a facet-filtered catalog from resetting to an
   unfiltered one.
4. **Escape closes; a click on empty space does not.** On a page there is no backdrop, and
   discarding the item you are reading because you missed the photo is hostile. This **removes**
   the 2026-09-11 rule "click the background → close" and its test; that rule was written for an
   overlay and does not survive the move.

   **Escape belongs to the topmost layer, and only to it** — while a modal is open, Escape
   dismisses that and leaves the surface underneath it alone. Getting this right is subtler than
   it looks and the naive version is wrong: Radix handles Escape on the *document*, so the dialog
   is already unmounted by the time the event bubbles back out to `window`, and by then the
   surface has re-rendered with no overlay in its state. A guard that asked React "is an overlay
   open?" therefore read *no* and closed the surface underneath the dialog it had just dismissed.
   So the check is made in the capture phase, of the DOM (`[role="dialog"]`), which is the
   earliest point in the event's life and the only one where the answer is still true. Pinned by
   an e2e rather than a unit test, because in jsdom testing-library flushes inside `act` and the
   race cannot occur at all.
5. **A trashed or absent id renders "Item not found" inside the surface's layout**, with the same
   `Close`, rather than a bare paragraph with no way out (`ItemDetail.tsx:60`).

### 2. Photos, order, and the index

6. **One order**: the primary photo first, then the rest by `sortOrder desc`. The counter reports
   the displayed order, so `1 of 7` is the primary. This resolves the disagreement in fact 7 by
   picking the convention the drafts and trash pages already use.
7. **The surface opens on the primary**, falling back to `images[0]` when nothing is primary.
8. **Prev/next do not wrap.** The buttons disable at the ends, which is self-describing; a wrap
   would move `7 of 7` to `1 of 7` with no signal. The same keys as the 2026-09-11 viewer —
   PageUp/PageDown — plus the buttons, which is what makes the surface usable on a phone.
9. **`Primary` shows beside the counter** for the primary photo. The badge died with the photo
   cards; `Set primary` is already hidden when the photo is primary, so the bar stays honest.
10. **The index is a hook, not a component** — `usePhotoIndex(images)` returns the ordered list
    and the current position, and owns the two rules that follow. There are two consumers (the
    surface and the trash peek, Q22(b)), which is where sharing pays. It is not a `PhotoCarousel`
    component: the two hosts' chrome differs (the peek has no per-photo bar and no panel) and
    nothing else is shared.
11. **Deleting the shown photo lands on the next one**, or the previous if it was the last, and
    the surface closes only when no photos remain. The index is **clamped against the refetched
    list** rather than remembered blindly, because every mutation invalidates `items.get` and the
    list can come back shorter than the index.

### 3. The per-photo bar

12. **The actions that apply to the photo on screen**: `Edit photo`, `Edit original photo`,
    `Open original`, `Set primary`, `Auto unpack`, `Manual unpack`, `Delete photo` — with
    `Edit original photo` and `Open original` rendered only once an edit exists, and
    `Set primary` only when the photo is not already primary. Five controls in the common case.
13. **`Open original` is not dropped.** It was not in the original list, but `CONTEXT.md` calls
    it the UI's only route to the unedited file. It stays an `<a target="_blank">` styled with
    `buttonClasses()` (`Button.tsx:32-37`) — it opens a tab, so it is not a button.
14. **Edit photo and Edit original photo open `PhotoEditor` over the surface**, unchanged. Because
    the surface is a page rather than a dialog, the editor mounts exactly as it does today and
    the index survives with no close-and-reopen dance.
15. **Manual unpack opens `ManualUnpackModal` unchanged** — still `Modal size="full"`, still the
    `Move photo` mode that keeps drawing-drag from colliding with moving-drag.
16. **Delete photo stays permanent and confirmed.** A photo is not trashable (ADR-0004 §26); the
    native `confirm()` stays.

### 4. The item panel

17. **Read-only**, in this order: name, type, description, quantity + unit, location, tag chips,
    custom-field values. Nothing here edits in place — that is the form's job (ADR-0003).
18. **Item-level actions live here**: `Edit item` (the `ItemForm` view swap) and `Move to trash`
    (confirm, then `navigate('/items')`). For a **draft**, the panel offers `Publish` where a
    catalog item offers `Edit item` — otherwise opening a draft from the drafts page would be a
    poorer experience than the page it came from.
19. **The control that adds a photo lives here**, reusing `PhotoUpload` / `uploadImage`
    (`PhotoUpload.tsx:14-21`). After a successful upload the carousel **jumps to the new photo**
    so the user sees what they added; no `sortOrder` renumbering is needed, because a new photo
    is the newest and lands immediately after the primary under rule 6 anyway.
20. **One panel, two presentations**: docked right from `lg` up, behind a toggle in the top bar
    below it. Below `lg` the stage is the whole screen and the panel slides over it.

### 5. Unpacking

21. **Auto unpack is no longer silent.** `unpack.isPending` disables the button, labels it
    `Unpacking…` and puts a non-blocking busy overlay on the stage. Detection through any
    provider takes seconds and today shows nothing at all.
22. **The drafts page gets the same treatment** for its root unpack (`UnpackModal.tsx:34`), which
    runs the same pipeline through `/upload/unpack` and has the same dead air.
23. **`unpack.error` surfaces on the surface.** It is currently an alert paragraph on the item
    page (`ItemDetail.tsx:114-118`); if it does not move, a failed unpack becomes silent.
24. **On success the surface closes and `/drafts?detected=n` is followed**, as today. The
    `?detected=` count is the drafts page's convention and is not duplicated here.

### 6. The trash peek

25. **`/trash` gains a viewer** — `Modal size="full"` wrapping `PhotoViewer`, with the counter,
    prev/next and a `Close`, inline in `TrashPage`. No new component for one host.
26. **Count and navigate, but nothing else**: no panel (`items.get` throws for a trashed row),
    no per-photo bar, and — because a photo is only destroyed by **purge** — no delete. Prev/next
    covers a trashed catalog item's several photos; a trashed draft has exactly one.
27. **The same order rule (6) and the same keys (8) apply here**, since it is the same index hook.
28. **The overlay/page split is deliberate.** An overlay is for peeking at something from a list
    you are returning to — the trash peek, the manual-unpack modal. The item itself is a page
    with a URL.

### 7. What the merge deletes

- The `PhotoViewer` overlays and their `viewing` state in `ItemsPage.tsx:323` and
  `DraftsPage.tsx:216`; both pages' thumbnails navigate to the surface instead.
- `PhotoViewer`'s `Modal`, `onClose`, close button and `Open original` — it becomes the stage.
  `Modal size="full"` keeps `ManualUnpackModal` and gains the trash peek.
- The catalog card's split: the card is **one** target again (`ItemsPage.tsx:286-302`).
- `ItemDetail`'s per-photo `Card` grid and its six buttons.

## Testing

- **The index hook** — ordering primary-first; opening on the primary and falling back to
  `images[0]`; delete-the-shown-photo landing next, then previous, then closing; the index
  clamping when the refetched list is shorter; no wrap at either end. This is the one piece of
  real logic and it is pure, so it is unit-tested rather than driven through the DOM.
- **The surface** — renders the five field groups and the tags; `Close` goes back with history
  and to `/items` without it; Escape closes and a click on empty space does not; the not-found
  case renders with a way out; the adjacent photo keys and buttons move one step; `Primary`
  shows for the primary photo only.
- **The per-photo bar** — `Edit original photo` and `Open original` appear only once an edit
  exists; `Set primary` is absent on the primary; the editor opens over the surface and returns
  to the same index.
- **Unpacking** — the button is disabled and says `Unpacking…` while pending; a failure shows the
  error on the surface; success navigates to the drafts page.
- **The panel** — a draft offers `Publish` and a catalog item offers `Edit item`; adding a photo
  jumps the carousel to it.
- **The trash peek** — opens, counts, navigates, and offers no destructive action.
- **Updated, not deleted**: `itemDetail.test.tsx` (the actions moved to the bar), and
  `catalogCard.test.tsx:84` / `catalog.test.tsx:134` (one target per card). The viewer's
  background-click case is **removed** with the rule.
- The route move must be verified through `AppRoutes`, since `itemDetail.test.tsx` mounts
  `ItemDetail` in its own `MemoryRouter` (`itemDetail.test.tsx:122-123`) and cannot see whether
  the surface still sits under `Shell`.

## What does NOT change

- `PhotoViewer`'s zoom and pan geometry, `zoom.ts`, and its fit↔1:1 and navigator behaviour — the
  stage keeps everything the 2026-09-11 spec gave it except the background-click rule.
- `ManualUnpackModal` in any respect, including its `Move photo` mode and Escape semantics.
- `ItemForm` and the create path on the catalog (`ItemsPage.tsx:181`).
- The unpack pipeline: `createItemsFromImage`, `saveCrop`, `UnpackResult`, the box sources, and
  the `?detected=<n>` convention.
- `items.get`'s `NOT_FOUND` for trashed rows, and `images.setPrimary`'s clear-then-set
  transaction (`images/repo.ts:63-68`).
- Trash, restore and purge (ADR-0004), and the fact that deleting a photo is permanent.
- The panel's read-only discipline (ADR-0003).

## Open, deliberately

- ~~**The `images[0]` vs `isPrimary` disagreement outside this surface.**~~ **Closed.** The
  catalog card was the last surface taking `images[0]`, which was never the primary — the card
  was written before a primary could be set and was not revisited when `ac33300` made it
  settable, so marking a primary changed nothing the catalog could see. It now takes
  `find(isPrimary) ?? images[0]`, like the drafts and trash rows always have, which is what the
  2026-09-04 design asked for in the first place ("one marked primary (used as the card image)").
  The ordering fix in Rule 6 also changed which photo the card shows as a side effect (newest
  rather than the arbitrary one an unordered `SELECT` returned); both changes land together.
- **The trash peek's usefulness.** It is being added to a page that has never had one, on the
  guess that a thumbnail you cannot enlarge is worse than one you can. If it goes unused, it is
  the first thing to delete.
- **`react-konva` is a declared dependency that nothing imports** (`apps/web/src/index.css:57`
  is its only mention). Free to drop, unrelated to this change.
