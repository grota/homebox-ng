# Photo viewer and bulk discard — design

**Status:** Draft for review (2026-09-11)
**Related:** ADR-0002 (`docs/adr/0002-modal-full-viewport-variant.md`) for the `Modal` decision.

Two independent features, shipped together because they touch the same two surfaces
(the drafts page and the item detail page) and both need a small API addition.

## Goal

1. **Bulk discard** — a "Discard selected" action beside "Publish selected" on the drafts page.
2. **Photo viewer** — clicking any thumbnail opens the full photo in an overlay, fit to the
   viewport first, 1:1 on click, with a minimap for orienting within an image that does not fit.

## Facts this design rests on

Established by reading the code, not assumed. Each one changed a decision.

- **No bulk-discard procedure exists.** `publishAll({ ids?: number[] })`
  (`apps/api/src/modules/drafts/service.ts:19`) is the only plural procedure, and it already
  has an "omitted ids means all drafts" fallback. Discard takes a single positive id.
- **Per-row draft discard has no confirmation** — `DraftsPage.tsx:58` calls the mutation
  straight from `onClick`, and `features/drafts/` contains no `confirm(` at all. The only two
  `confirm()` calls in the app are in `ItemDetail.tsx` (`:72`, `:124`). This is deliberate and
  stays (see Decisions).
- **Discard is not transactional.** `discardDraft` (`drafts/service.ts:26`) reads the images,
  calls `deleteItem`, then best-effort `unlink`s up to three files. The row delete and the FTS
  reindex are separate statements; children go by FK cascade.
- **`deleteItem` throws on a missing row** (`items/service.ts:159`) rather than returning a
  falsy value — so `discardDraft`'s `if (!deleted.ok) return false` guard is unreachable.
  This is what makes a stale id dangerous in a loop (see the selection-pruning note).
- **`ImageDto` carries no width or height.** `items.get`/`items.list` drop them
  (`items/service.ts:18,75`), even though the `images` table stores them.
- **Stored dimensions are unreliable anyway.** The API never normalises EXIF orientation, so
  the stored `width`/`height` are pre-rotation values. Measuring the loaded `<img>` in the
  browser via `naturalWidth`/`naturalHeight` is the *correct* source, not a workaround.
- **`/file/*` serves the raw file** (`apps/api/src/uploads.ts:225`): no cache headers, no
  range support, no auth, no resize on the way out.
- **The thumbnail is 400px wide and upscales** sources narrower than 400
  (`uploads.ts:136`) — so it is not a proxy for the original's dimensions.
- **No zoom/pan library is present.** Nothing in `apps/web/package.json` or the lockfile
  provides pan, zoom, pinch or a lightbox.
- **`Modal`'s content box is the wrong shape**: centred, capped at `min(92vw, 64rem)`,
  `overflow-auto`, and it swallows outside pointer-down (`apps/web/src/ui/Modal.tsx`).

## Design

### 1. Bulk discard

**API.** A new `discardAll({ ids?: number[] })` mirroring `publishAll` exactly — same input
shape, same "omitted means all drafts" fallback. The owner has accepted that an
argument-less call is a destructive "delete every draft", and the UI always sends an explicit
selection, so the fallback is unreachable from the app.

**Tolerance.** `discardAll` iterates `discardDraft`, which throws `NOT_FOUND` on a missing row.
Since `discardDraft` is not transactional, one stale id would throw mid-loop and leave the
operation half-applied — some drafts deleted, the rest untouched, no rollback. `discardAll`
must therefore **skip a row that no longer exists** rather than propagate the throw. The API
should not be breakable by a stale id regardless of what the client sends.

**UI.** A "Discard selected" button beside "Publish selected" in the same toolbar
(`DraftsPage.tsx:35-43`), acting on the same `selected` set, disabled at zero selected,
styled `variant="danger"`. It confirms with `window.confirm` naming the count — e.g.
"Discard 3 drafts and their photos?" — before mutating.

**Selection pruning.** `selected` is never pruned when the list refetches, so a discarded
draft's id survives in the set. Today this is benign because `publishAll`'s loop silently
no-ops on a missing row; with bulk discard it becomes the half-applied failure above. Fix in
both layers: clear the selection after a successful bulk action, and rely on `discardAll`'s
tolerance for anything that slips through.

**Not changing:** per-row discard stays immediate and unconfirmed, matching the drafts page's
existing behaviour. The page is treated as a power tool.

### 2. Photo viewer

**Where.** Every thumbnail, in all three places they render: `ItemDetail.tsx:92`,
`ItemsPage.tsx:274`, `DraftsPage.tsx:51`.

On `/items` the whole card is currently a `<Link>`, so the image would have two jobs. The card
**splits**: the image becomes a button that opens the viewer, and the item *name* becomes the
link to the item. Both are siblings with unambiguous accessible names; nesting an interactive
element inside an anchor would be invalid HTML and ambiguous to assistive tech. The visual
result is nearly unchanged — the title is already where the eye goes to navigate.

**What it shows.** `editedPath ?? originalPath` — the same rendition as the grid thumbnail, and
the same href the removed "View" link used.

**Removed:** the per-photo "View" anchor on the item detail card. Its one unique capability —
opening the file in a new tab, which is how you save or share it — moves into the viewer as an
"open original" affordance. That takes the photo card from six controls to five.

**Initial zoom.**

| Image vs viewport | Initial state |
|---|---|
| Larger than the viewport | **Fit** — scaled down so the whole image is visible |
| Fits already | **Natural size (1:1), centred** — never upscaled, because enlarging a small photo only shows blur |

Because the decision needs the image's real dimensions, and those are only knowable after the
image loads, the viewer shows a loading state and applies the zoom on `load`. The initial
frame is therefore fit-or-loading, never a wrong-zoom flash.

**Interaction.**

| Gesture | Effect |
|---|---|
| Click the **image** | Toggle fit ↔ 1:1. A no-op when the image already fits (there is no second state) |
| Click the **background** | Close — see the chrome carve-out below |
| Drag | Pan |
| Wheel / pinch | Zoom |
| Arrow keys | Pan, for keyboard users |
| Escape | Close (already supplied by `Modal`) |
| Close button | Close, always visible |

**One rule, not two modes.** "Click the image toggles; click the background closes" holds in
every state. The tempting alternative — outside-click closes when the image fits, close button
when it doesn't — makes the same gesture mean different things depending on image size, viewport
aspect ratio *and* current zoom, none of which the user is tracking. With one rule, when the
image covers the viewport the background rule simply never fires, which is exactly the
close-button case.

**"Background" excludes the chrome.** The close button and the minimap are *not* background —
clicking either must not close the viewer. The rule is therefore "the click target is the
backdrop container itself", not "the click target is not the image", which is why it is
implemented as a target check on the container rather than a negative test. Anyone tempted to
simplify it to "not the image" would make the minimap dismiss the viewer on first use.

**Drag is not a click.** Pointer-up is only treated as a click if the pointer moved less than a
small threshold since pointer-down, so a pan that ends on the background does not close the
viewer.

**Minimap.** A small navigator in the lower-right showing the whole image with the visible
region outlined; clicking or dragging inside it jumps the view there. It appears **only when
something is off-screen** — at fit it would be a second copy of an image with nothing to
navigate. On narrow viewports it is smaller and more transparent rather than absent.

**Accessibility.** The dialog keeps `Modal`'s focus trap, Escape handling and focus restore.
The viewer supplies its own close button (the primitive's `Dialog.Title` is `sr-only`), the
image carries the item's name as alt text, and arrow keys pan so the feature is usable without
a pointer.

### 3. `Modal` gains a full-viewport size

`Modal` needs `size?: 'md' | 'full'`. The default keeps today's box **byte-identical**, so the
existing tests continue to pin the current behaviour and nothing else that uses `Modal` shifts.

`size="full"` renders `fixed inset-0` with no radius, border or padding, and `overflow-hidden`
rather than `overflow-auto` — a pan surface must not scroll. See ADR-0002 for why this is a
variant on the existing primitive rather than a second dialog.

Crucially, the viewer does **not** use Radix's outside-click: a full-viewport dialog has no
exposed overlay for Radix to fire on. The viewer detects a background click itself, by checking
that the click target is the container rather than the image.

## Testing

- **`discardAll`** — a bulk discard removes exactly the named drafts and their files; a stale
  id is skipped rather than aborting the batch; omitting `ids` discards all drafts.
- **Drafts UI** — "Discard selected" is disabled at zero selected, confirms before mutating,
  and the selection is cleared afterwards.
- **Viewer** — opens from each of the three thumbnail sites; shows the edited rendition when one
  exists; fit-vs-natural initial state for an image larger and smaller than the viewport; click
  toggles; background click closes; a drag ending on the background does **not** close; the
  minimap appears only when the image overflows.
- **`Modal`** — the existing tests must pass **unmodified**, which is what proves `size`
  defaulted to the old behaviour.
- The zoom/pan geometry is the one piece of real logic here and should be extracted into a
  pure, unit-tested module rather than living inside the component.

## To validate in use

Two decisions were taken provisionally, to be judged against the running app rather than argued
further on paper. Neither blocks implementation; both are cheap to change afterwards.

- **The `/items` card split** — the image becomes a viewer button and the item name becomes the
  link. This is the one place the feature changes an existing interaction, and it trades a
  one-click card for two explicit targets.
- **Fit-first opening for extreme aspect ratios.** A panorama on a phone fits to a thin strip,
  because fit satisfies the narrower dimension; the navigator correctly stays hidden (nothing is
  off-screen) and only appears once the photo is tapped to 1:1. The alternative considered — a
  floor on how far fit may shrink a photo — was rejected because it makes "fit" sometimes not
  fit, a rule the user would have to learn. Revisit if shooting panoramas makes the opening view
  feel useless in practice.

## Out of scope

- Comparing the original and edited renditions side by side inside the viewer.
- Zoom presets or a zoom-percentage readout.
- EXIF orientation normalisation on the server. The viewer measures in the browser, which
  sidesteps it; normalising stored files is a separate concern with a migration attached.
- Any change to how `/file/*` serves bytes (cache headers, range requests), which a viewer
  would benefit from but does not need to work.
