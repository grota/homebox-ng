# Context

**homebox-ng** ("*ng*" = **next generation**, per the upstream repo `grota/homebox-ng`)
is a self-hosted, household-shared inventory manager — a Homebox-inspired rebuild as a 
type-safe pnpm/Turbo monorepo. One Fastify server serves both the tRPC API and the built 
SPA over one SQLite DB. Every user shares one catalog of items.
Its distinctive feature is the **unpack** path that turns a photo into proposed **drafts** —
either by object detection or by hand.

This is the project's **domain glossary** — the vocabulary the code already uses. When you name
a domain concept (an issue title, a spec, a test name, a refactor proposal), use these terms;
don't drift to synonyms. A `(file:line)` back-reference is the canonical home of each term.
Terms that don't exist yet are created lazily by `/domain-modeling`, not pre-invented here.

## Catalog

- **item** — a catalogued physical thing, the unit of the shared inventory. Every row is a
  row in `items`; `published` decides whether it's on the catalog or the drafts page, and a
  **trashed** item is on neither. `(packages/db/src/schema.ts:57)`
- **location** — a place where items live, hierarchical through `parentId` (a room can be
  under a building). `(packages/db/src/schema.ts:30)`
- **unlocated item** — an item with no **location**, a legitimate state rather than a defect. The
  **location facet** carries an **Unlocated** node so these items are reachable, and a location's
  **subtree count** never includes them.
- **item type** — a category an item belongs to, chosen at creation. Each item type owns its
  own set of custom fields. `(packages/db/src/schema.ts:38)`
- **item type field** — a typed attribute *definition* on an item type; its per-item *value*
  is a row in `item_custom_field_values` (surfaced on the DTO as `customFields`).
  Field types: `text`,`number`,`currency`,`date`,`boolean`,`url`, plus `required`,`config`,`sortOrder`.
  `(packages/db/src/schema.ts:45)` `(packages/db/src/schema.ts:71)`
- **tag** — a free-form label (unique name + color), attachable to many items via the
  `item_tags` join. `(packages/db/src/schema.ts:82)`
- **image / photo** — an item's photo, the fork's analog of an attachment and the only one:
  attachments were dropped, so there is no separate `attachments` entity (v1 spec, non-goals).
  `originalPath` is always preserved; `editedPath` is set only after a
  non-destructive edit; `thumbPath` is always present; `isPrimary` marks the **primary photo** —
  the one a catalog card, a drafts card or a trash card shows in place of the rest, and the one an
  **item surface** opens on. At most one per item. `(packages/db/src/schema.ts:116)`
- **non-destructive editor** — crop/rotate/resize writes a new `editedPath` and leaves the
  original buffer intact; the original is never overwritten. **Edit photo** opens the *current*
  rendition — `editedPath` when one exists, else the original — so a re-edit builds on the last
  one rather than starting over; **Edit original photo**, offered only once an edit exists,
  restarts from the original. The **per-photo bar**'s **Open original** is the UI's only route
  to the unedited file, which is why the **photo viewer** is handed that path separately from
  the one it displays.
- **photo viewer** — the pane showing **one** photo of an **item surface**, in the same
  rendition as the grid (`editedPath` when one exists, else `originalPath`). Starts fit when
  the photo is larger than the pane and at natural size when it is not; clicking the photo
  toggles between the two, and a **navigator** shows which region of an oversized photo is on
  screen and jumps to another. It owns no chrome: the surface decides which photo it is handed
  and where the controls live. `(apps/web/src/ui/PhotoViewer.tsx:59)`
- **item surface** — where an item is met in full, and the only place its photos are both
  browsed and acted on: a top bar (position, prev/next, close), the **photo viewer** as its
  largest pane, the **item panel**, and the **per-photo bar**. One surface serves every item
  state; only the panel's item-level actions differ. `(apps/web/src/features/items/ItemDetail.tsx:15)`
- **item panel** — the read-only account of an item on an **item surface**: name, type,
  description, quantity, location, tags and custom-field values, plus the item-level actions
  and the control that adds a photo. Reading is the panel's job; **Edit item** hands off to the
  form, which is the only place an item is edited.
- **per-photo bar** — the **item surface**'s actions on the photo currently shown: edit, edit
  original, open original, set primary, auto unpack, manual unpack, delete.

## Unpack → drafts → publish (the background flow)

- **unpack** — turn a photo into **drafts**, one per box, each with a cropped photo
  (original + thumb) written to disk, for a chosen item type. Returns `{ detected, drafts }`.
  The pipeline sees only boxes and their labels; where the boxes came from is the *source*.
  `(apps/api/src/modules/unpack/service.ts:34)`
- **auto unpack** — unpack whose box source is a **detection provider**. This is what "unpack"
  alone used to mean, and the rename exists so it no longer has to.
- **manual unpack** — unpack whose box source is a rectangle the user drew on the photo and
  named. The name becomes the draft's name, exactly as a detected box's label does. Reached
  from the drafts page (with an uploaded photo) and from an item's photo.
- **draft** — an item with `published=false`. There is **no separate drafts table**; it is the
  same `items` row, filtered by the flag. Drafts sit on the drafts page, not the shared catalog.
  `(packages/db/src/schema.ts:66)` `(apps/api/src/modules/unpack/service.ts:61)`
- **publish** — flip a draft's `published` to `true` so it joins the shared catalog.
  `publishDraft` (one) / `publishAll` (all, or a subset of ids). `(apps/api/src/modules/drafts/service.ts:18)`
- **rename** a draft gives it a real name before publishing.
  `(apps/api/src/modules/drafts/service.ts:15)`

## Trash

- **trash** — the holding state for something deleted but not destroyed. **Items and drafts are
  the only things that can be trashed** (locations, item types and tags are not). A trashed
  thing keeps its row and its photo files, is on neither the catalog nor the drafts page, and
  is reachable only from the trash page.
- **move to trash** — the recoverable delete. This is what **discard** used to mean; the word
  went with the behaviour, so the two verbs are now unambiguous.
  `(apps/api/src/modules/trash/service.ts:27)`
- **restore** — put a trashed thing back where it came from: a trashed draft returns to the
  drafts page, a trashed catalog item to the catalog. It keeps whatever it had, so an item
  trashed with no location comes back with no location.
- **purge** — the irreversible one: the row, its cascaded children and its photo files all go.
  Per row the UI calls it *Delete forever*; for the whole trash, *Empty trash*. **Purging is
  the only operation that destroys an item's photos.**
  _Avoid_: discard (for the recoverable action — it means the irreversible one now)

_Avoid_: orphan — for a **location**'s items when the location is deleted, which keep their
rows and simply end up with no location.

## Detection

- **detection** — object detection over a photo, producing detection boxes. The feature the
  "_ng_" (next-generation) fork adds on top of Homebox.
- **detection box** — one detected object: `{ box:{x,y,width,height}, label, confidence }`,
  in pixel space with a top-left origin. `(apps/api/src/modules/detection/provider.ts:1)`
- **detection provider** — a named implementation of the `DetectionProvider` interface
  (`detectBoxes(image, bounds) → DetectionBox[]`), registered at startup. Built-ins:
  `local` (transformers.js), `google` (Gemini vision), `openai` (OpenAI vision), plus `mock`
  (returned when `DETECTION_MOCK=1`, fixed boxes for a reproducible flow).
  `(apps/api/src/modules/detection/provider.ts:7)` `(apps/api/src/modules/detection/mock.ts:5)`
  Manual unpack also satisfies this interface — boxes handed in rather than detected — but it
  is **not registered and never selectable**; it exists for the length of one request.
- Selected at the **instance settings** level. Every box is guaranteed in-bounds for cropping:
  providers clamp here, and `createItemsFromImage` only drops 0-area boxes.
  `(apps/api/src/modules/detection/coords.ts:7)`

## Settings

- **instance settings** — instance-wide admin configuration, a single fixed row (`id=1`):
  `maxUploadMb`, `detectionProvider`, `detectionConfig`. `(packages/db/src/schema.ts:99)`
- **user settings** — per-user one-to-one preferences: `language`, `locale`, `themeMode`
  (`auto`/`light`/`dark`), `lightThemeId`, `darkThemeId`. `(packages/db/src/schema.ts:89)`

## Search

- **facet search** — ranked full-text search over an FTS5 virtual table (`items_fts`, columns:
  name, description, tags, customFields, typeName, locationPath), with live **facet** counts per
  dimension (types/tags/locations), FTS **snippets** when a search term is set, and URL-param
  state. The catalog's `published=true` guard keeps drafts out of every result and count, and
  the trash guard keeps trashed items out of both the catalog and the drafts list.
  `(packages/db/src/schema.ts:137)` `(apps/api/src/modules/items/repo.ts:96)`
- **location facet** — the location dimension of **facet search**, laid out as a tree: children nest
  inside their parents and the roots stack vertically. Which branches are open is view state;
  clicking a name filters, clicking the chevron beside it only opens or closes that branch. A
  root-level leaf-facet beside the roots, **Unlocated**, holds the **unlocated items**.
  `(apps/api/src/modules/items/repo.ts:181)`
- **own count** / **subtree count** — the two numbers a **location facet** node can carry: items
  located directly in it, and that node plus every descendant. Both are shown when they differ —
  `home 4 (12)` — and one alone when they are equal.
- **subtree-inclusive filter** — selecting a **location** in the **location facet** matches its
  whole subtree rather than the node alone, so a facet's count and the results it yields agree.
  Selecting **Unlocated** is the exception: it matches the items with no location.
  `(apps/api/src/modules/locations/repo.ts:54)`
- **relevance** — the FTS rank order, which is what a search term is ordered by until the user picks
  another order. It is a consequence of searching rather than a preference: it is never stored, and
  clearing the term returns the list to the stored order.

## Batch edit

- **selection** — a set of catalog **item** ids chosen on the items page, independent of the view
  that produced it: it survives a change of search term, filter or page, and is lost on reload.
  **Select all** means everything the current search and filters match — never the twenty rows on
  screen — and an empty selection is refused rather than read as "everything".
  `(docs/adr/0010-catalog-selection-and-count-pinned-bulk-edit.md)`
- **criteria clause** — a tag, **location** or creation-date condition that adds items to, or
  removes them from, a **selection**. Its parts are AND-ed, its values are drawn only from data that
  exists, and tags and locations are unions within their own dimension, matching the **facet
  search** rules.
- **bulk edit** — one write applied to every item in a **selection**: its **location**, its **tags**
  (added or removed, never replaced wholesale) and its **item type field** values. The item's **item
  type** is deliberately not editable in bulk: changing it strands the values of the fields the old
  type owned.
- **count pin** — the counts a **bulk edit**'s owner was shown, carried by the request so the server
  can re-derive them immediately before writing and refuse if either moved. An edit therefore cannot
  land on a **selection** that changed while the user was reading it. Generalised from **item type
  field** retyping, where it began as `acknowledgedValueCount`.
  `(docs/adr/0003-non-destructive-field-edits.md)`

## Auth & provisioning

- **role** — `admin` | `user` on a user row; admins reach instance settings and admin actions.
  `(packages/db/src/schema.ts:17)`
- **mustChangePassword** — a per-user flag forcing a password change on next sign-in (e.g. after
  an admin reset). `(packages/db/src/schema.ts:18)`
- **setup / first run** — a fresh DB has no admin, so the app routes to `/setup`; the
  `requiresSetup` query returns `setupRequired` until the first admin exists. Auth is argon2id
  password hashing with httpOnly session cookies.
