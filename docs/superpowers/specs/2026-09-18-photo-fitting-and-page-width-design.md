# Fitting a photo into a box, and where the page width lives — design

**Date:** 2026-09-18 · **Related:** ADR-0005 (the item surface is a page), ADR-0002 (the `full`
modal geometry), `2026-09-16-docker-packaging-design.md` (the image the thumbnails ship in).

*The `file:line` references were accurate when this was written. **The symbol names are the durable
anchor** — `ImageDto`, `Shell`, `DraftsPage`, `TrashPage`, `saveCrop`, `renderThumbnail` — and
grepping for one is how to read a citation that no longer lands. `CONTEXT.md` is the living
glossary, and this phase edits one line of it (§7).*

## Problem

**Every photo in the app is cropped or stretched, and none of them shows what it contains.**

Four surfaces show a photo smaller than the pane they put it in, and all four fill that pane by
destroying the shape of the photo:

- the catalog card, the drafts list and the trash list all use `object-cover`, which crops the
  photo to the box;
- the manual-unpack row is worse — it is a CSS crop of the *source* photo, and its maths map
  `box.width → 64px` and `box.height → 48px` **independently**, so any rectangle that is not 4:3
  is stretched as well as cropped.

Alongside that, the catalog is pinned at four columns by a global width cap that leaves roughly
**730px of a wide window empty** — measured, not estimated — while the drafts and trash pages spend
a whole full-width row on a single 64px thumbnail. And **Clear Filters** drops keyboard focus
instead of putting it in the search field it just cleared.

## Facts this design rests on

Established by reading the code, inspecting the files on disk, and measuring the running app. Each
one changed a decision.

- **Every stored thumbnail already preserves its source's aspect ratio.** All four generation sites
  call `resize({ width: 400 }).jpeg({ quality: 80 })` — width only, no `height`, no `fit`
  (`uploads.ts:136`, `uploads.ts:190`, `unpack/service.ts:25`, `scripts/seed.ts:245`). Confirmed on
  disk: `400x271`, `400x566`, `400x622` from sources of `1001x677`, `595x842`, `445x692`.
- **The crop-to-square happens entirely in CSS.** Nothing in the pipeline crops, pads, letterboxes
  or flattens; `.extract()` in `saveCrop` is the only geometric operation and it is the user's own
  rectangle. **This is why no file on disk has to change**, and why a "regenerate the thumbnails"
  step is *not* required to fix the display.
- **Thumbnails are written eagerly, at upload/edit/unpack. There is no lazy path.** `GET /file/*`
  only reads (`uploads.ts:225`). **Deleting `uploads/thumbs/` would not trigger regeneration — it
  would 404 every thumbnail permanently.**
- **`withoutEnlargement` is left at its default `false`**, and only the width is constrained, so any
  image narrower than 400px is **upscaled**: `332x1557 → 400x1876`, `264x969 → 400x1468`,
  `276x702 → 400x1017`, `242x983 → 400x1625`. Four files in the development data are larger than
  their originals in both axes.
- **`ImageDto` carries no dimensions** — `id, originalPath, editedPath, thumbPath, isPrimary`
  (`modules/items/service.ts:18`). A layout that needed to know a photo's shape before loading it
  would have to add a column; one that fits by aspect ratio needs nothing.
- **Nothing asserts thumbnail dimensions anywhere**, and the e2e assertion that used to inspect a
  thumbnail was deliberately deleted. The 400 and the aspect preservation are unguarded.
- **The shell caps every page at `max-w-6xl`** — `Shell.tsx:71`, `<main className="mx-auto w-full
  max-w-6xl px-4 py-6">`. 1152px, minus `px-4`, is 1120px of content.
- **Measured grid widths** on the running app: 1024 → 721px, and **864px at 1280, 1440 and 1920**.
  It stops growing. The sidebar is 240px plus a 16px gap, so `lg:grid-cols-4` yields tracks of
  168–204px.
- **The nine narrow containers are not centred.** `ItemForm`, `ItemTypesPage`, `TagsPage`,
  `LocationsPage`, `LoginPage`, `SetupPage`, `ChangePasswordPage` use `max-w-[30rem]` and
  `SettingsPage` uses `max-w-[32rem]` — with **no `mx-auto`**. They are pinned left inside the
  capped shell. (`ItemDetail` is the exception: `max-w-3xl mx-auto`, already correct.)
- **Drafts and trash paginate at 20 rows each** (`DraftsPage.tsx:10`, `TrashPage.tsx:8`), so twenty
  items is the case to design the height against.
- **`Field`'s `required` asterisk renders inside the `<label>`**, so asking for one renames the
  control for screen readers (`ui/Field.tsx`). Learned the hard way in this session.
- **`Button` and `Input` accept no `ref`.** React 19 passes `ref` as an ordinary prop, so it only
  has to be declared; `Button` already declares it (added in this session for the unpack row).

## Design

### 1. The rule: the pipeline never crops; the box fits the photo

**A stored thumbnail is a faithful rendition of the whole photo, and nothing downstream may assume
its shape.** Fitting it into a box is a display decision made by whoever draws the box:

- **`object-contain`** on a **black** box. The photo is shown whole at its own aspect ratio; the box
  mat shows through wherever it does not reach, which is what the owner asked for ("black boxes
  around", landscape or portrait).
- **Black, not a theme token.** This is the one place a raw colour is right: a photo mat is black in
  every palette, exactly as the manual-unpack canvas already is (`bg-black/90`). It is a deliberate
  exception to "never put a raw palette hex in markup", and this is the comment that says so.
- **The box is square wherever a photo stands for itself** — the catalog card, the drafts card, the
  trash card. A square is the shape that treats portrait and landscape alike, and it is what the
  owner asked for by name. Portrait photos will therefore sit in wide black margins; that is the
  honest consequence of "show the whole thing", not a defect to tune away.

### 2. The manual-unpack row

It keeps its 64x48 box — it is a dense list row and widening it costs vertical space for no gain —
and its maths becomes a fit-and-centre instead of a stretch:

```ts
const s = Math.min(64 / box.width, 48 / box.height)
// the whole photo, scaled so the drawn region fits inside the box…
backgroundSize: `${natural.width * s}px ${natural.height * s}px`
// …and the region itself centred, so the mat is even on both sides.
backgroundPosition: `${(64 - box.width * s) / 2 - box.x * s}px ${(48 - box.height * s) / 2 - box.y * s}px`
```

Plus `bg-black`. The old maths mapped the region's two axes to 64 and 48 separately, which is the
stretch being removed.

### 3. The catalog grid

`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` → **`grid-cols-[repeat(auto-fill,minmax(200px,1fr))]`**.

Phase 4 introduced the ladder as a by-product of migrating plain-CSS classes
(`2026-09-06-phase4-settings-responsive-design.md:187`; the plan lists it in a "old class →
replacement utilities" table) and recorded no reason for four. The rule it replaced —
`minmax(200px, 1fr)` — was already self-adjusting; the ladder approximated it at three breakpoints
and, at `lg` with the sidebar visible, made cards *smaller* than the space allowed. Auto-fill
restores the behaviour, removes three breakpoints to maintain, and adapts to the sidebar for free.

The card's photo: `w-full h-32 object-cover` → **`w-full aspect-square object-contain`** plus the
mat. `h-32` is a fixed 128px strip at *every* column count, which is why the catalog crops just as
badly at six columns as at one.

**One minimum for the whole app: 200px.** Not a per-page number — see §5.

### 4. Drafts and trash become card grids

Both pages spend a full-width row on one 64px thumbnail, with the name field absorbing all the
slack. Both become the same card grid as the catalog:

```
┌──────────────────┐
│  [ square photo ]│   drafts:  checkbox · name input · Publish · Move to trash
│ [ name          ]│   trash:   name · kind · when · Restore · Delete forever
│ ☐ Publish Trash  │
└──────────────────┘
```

`repeat(auto-fill, minmax(200px, 1fr))`, the same number as the catalog. **This makes both pages
shorter, not taller**, which is worth stating because it is counter-intuitive: at 20 items per page
the list is ~2150px today, and the grid is ~960px at 200px minimum (~1830px at 300px, ~2740px at
400px). Per-card height grows; the row count collapses by more. The break-even is around 300px.

**The `<ul>`/`<li>` structure stays** — `Card` renders a `<div>`, and a `<div>` child of a `<ul>`
drops the list semantics the rows currently have. The grid classes go on the `<ul>`.

Bulk actions, the select-all checkbox, pagination and every mutation are untouched.

### 5. Where the page width lives

**`<main>`'s global cap is removed, and each page declares its own width.** A page that wants the
full width says nothing; a page that reads best narrow keeps a `max-w-` *and* gains `mx-auto` so it
centres in whatever room it has.

This is the arrangement `ItemDetail` already uses, and it is why removing the cap is not "the four
pages get wider" but "every page states its intent":

| route | after |
|---|---|
| `/items`, `/drafts`, `/trash`, `/locations` | full width — the grid/tree absorbs it |
| `/login`, `/setup`, `/change-password`, `/settings`, `/tags`, `/types` | keep their `max-w-`, **add `mx-auto`** |
| `/items/:id` | unchanged (`max-w-3xl mx-auto`) |
| `/admin` | **gains** `max-w-[64rem] mx-auto` — it has no cap today, so it would otherwise sprawl |

Nine containers gain one class. The alternative — keeping the shell capped and letting four pages
opt out — was rejected because the exception would then live in the layout rather than in the page
that wants it, and `/admin` needs its own cap either way.

### 6. The resize rule, extracted — and a script that applies it

`resize({ width: 400 })` → **`resize({ width: 400, height: 400, fit: 'inside' })`**, which caps the
*long* edge instead of the width. This does not change how anything looks (same aspect ratio, and
`object-contain` fits by ratio regardless of pixel dimensions); it stops the pipeline inflating
small images, and it shrinks very tall ones a lot.

This is the same shape of fix as the detection model's cache directory: **one rule, written once.**
The rule moves into `apps/api/src/modules/images/thumbnail.ts` as `renderThumbnail(buffer)`, and the
four call sites import it. The four copies are how the upscaling went unnoticed.

`apps/api/scripts/regenerate-thumbnails.ts` then applies that rule to files that already exist: for
every `images` row, re-render from `originalPath` and overwrite `thumbPath` **in place** — the path
is already known and already unique, so no row changes and the script is idempotent and re-runnable.
It follows `scripts/detection-model.ts`'s conventions (reads `DATA_DIR` directly, not via `loadEnv`,
so it needs no `SESSION_SECRET`) and prints what it did.

It is **not** required by this phase — the display fix changes no file — but it is the only way to
correct the four upscaled thumbnails already on disk, and it is the tool for any future change to
the rule. **Deleting thumbnails instead is never the answer**: there is no lazy generation, so it
would 404 every photo until each one is re-uploaded.

### 7. Clear Filters returns focus to the search field

`Input` gains a declared `ref` prop, the same one-line change `Button` already has (React 19 passes
`ref` as an ordinary prop; only the type needs writing, because `InputHTMLAttributes` does not carry
it). `ItemsPage` holds a ref on the search input and `clearFilters` focuses it after clearing.

Rejected: `document.getElementById('item-search')?.focus()`. The id exists (it is `Field`'s
`htmlFor` target), but reaching into the DOM from a handler when a ref is available is a habit that
spreads.

### 8. Glossary

One line of `CONTEXT.md` becomes wrong when §4 lands: **primary photo** is currently "the one a
catalog card, **a drafts row or a trash row** shows in place of the rest". There will be no drafts or
trash rows. The wording becomes "a catalog card, a drafts card or a trash card".

No new term is needed. This phase establishes a *principle* — the stored thumbnail is never cropped
— which is a data invariant rather than vocabulary, and belongs beside "the original is never
overwritten" in the rationale, not in the glossary.

## Testing

- **The manual-unpack fit.** The background-size maths is pure and worth pinning directly: a wide
  region and a tall region must both scale by the smaller factor and centre, where the old maths
  scaled the axes independently. The existing suite already drives this modal with a known image
  size, so the numbers are available.
- **The card grids.** `drafts.test.tsx` and `trash.test.tsx` already assert by role and content, so
  they should survive the markup change — which is exactly what makes them worth running rather
  than rewriting. The assertions that matter are semantic (the name field, the two buttons, the
  checkbox), not positional.
- **Clear Filters focus.** `toHaveFocus()` after the click, in `catalog.test.tsx`.
- **`renderThumbnail`.** A wide and a tall fixture, asserting the long edge is 400 and the aspect is
  preserved — the first test anywhere to pin this, and the reason it is worth extracting the rule.
- **The regenerate script.** Run it against a temp dir with one known image; assert the file is
  rewritten, the path is unchanged, and a second run is a no-op.
- **Not tested:** column counts and card heights. jsdom has no layout, and the e2e suite asserts
  content rather than grid geometry. The numbers in §4 are measurements of the current app plus
  arithmetic, and the real check is looking at it.

## What does NOT change

- **No file on disk.** Every thumbnail already preserves its aspect ratio, so nothing is
  regenerated, moved or deleted for the display fix.
- **The API contract.** `ImageDto` gains nothing; no dimensions are needed by a fit-by-ratio box.
- **Every mutation.** Publish, trash, restore, purge, pagination, select-all, unpack — untouched.
- **`/items/:id`.** Already self-capped and already fits its photo.

## Open, deliberately

- **Whether this deserves an ADR.** "The stored thumbnail is never cropped; the box fits the photo"
  is hard to reverse (it would mean re-rendering every thumbnail into a letterboxed square),
  surprising (most apps store square thumbnails and save the bytes), and a real trade-off (bytes and
  simplicity against a faithful file that any future layout can use). That is the shape of an ADR,
  but it is *one sentence of principle*, so it may read better as the header of §1 than as ADR-0008.
- **Whether 200px is the right minimum** for the card grids. It is the same number as the catalog so
  the app has one rule, and the page heights in §4 say everything up to 300px is shorter than today.
  If the photos look too small, this is the single number to change.
- **The four upscaled files already on disk** stay upscaled unless the script is run. ~400 KB and a
  slight softness on four of forty dev images; the new rule applies to everything uploaded after.
- **An edit orphans its previous thumbnail.** `uploads.ts:200-206` mints a new uuid `thumbPath` and
  never unlinks the old file. Pre-existing, out of scope, and a candidate for the script's
  attention later.
- **Transparency becomes black.** JPEG output with no `flatten` composites transparent pixels to
  black. Now consistent with the mat, so less visible than it was, and not addressed here.
