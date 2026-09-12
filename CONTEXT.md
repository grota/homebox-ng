# Context

**homebox-ng** ("*ng*" = **next generation**, per the upstream repo `grota/homebox-ng`)
is a self-hosted, household-shared inventory manager — a Homebox-inspired rebuild as a 
type-safe pnpm/Turbo monorepo. One Fastify server serves both the tRPC API and the built 
SPA over one SQLite DB. Every user shares one catalog of items.
Its distinctive feature is a background object-detection path that turns a photo into proposed **drafts**.

This is the project's **domain glossary** — the vocabulary the code already uses. When you name
a domain concept (an issue title, a spec, a test name, a refactor proposal), use these terms;
don't drift to synonyms. A `(file:line)` back-reference is the canonical home of each term.
Terms that don't exist yet are created lazily by `/domain-modeling`, not pre-invented here.

## Catalog

- **item** — a catalogued physical thing, the unit of the shared inventory. Every row is a
  row in `items`; `published` decides whether it's on the catalog or the drafts page.
  `(packages/db/src/schema.ts:57)`
- **location** — a place where items live, hierarchical through `parentId` (a room can be
  under a building). `(packages/db/src/schema.ts:30)`
- **item type** — a category an item belongs to, chosen at creation. Each item type owns its
  own set of custom fields. `(packages/db/src/schema.ts:38)`
- **item type field** — a typed attribute *definition* on an item type; its per-item *value*
  is a row in `item_custom_field_values` (surfaced on the DTO as `customFields`).
  Field types: `text`,`number`,`currency`,`date`,`boolean`,`url`, plus `required`,`config`,`sortOrder`.
  `(packages/db/src/schema.ts:45)` `(packages/db/src/schema.ts:71)`
- **tag** — a free-form label (unique name + color), attachable to many items via the
  `item_tags` join. `(packages/db/src/schema.ts:82)`
- **image / photo** — an item's photo, the fork's analog of an attachment (there is no separate
  `attachments` entity). `originalPath` is always preserved; `editedPath` is set only after a
  non-destructive edit; `thumbPath` is always present; `isPrimary` marks the cover.
  `(packages/db/src/schema.ts:116)`
- **non-destructive editor** — crop/rotate/resize writes a new `editedPath` and leaves the
  original buffer intact; the original is never overwritten.
- **photo viewer** — opens any thumbnail's photo in a full-viewport overlay, showing the same
  rendition as the grid (`editedPath` when one exists, else `originalPath`). Starts fit to the
  viewport when the photo is larger than it and at natural size when it is not; clicking the
  photo toggles between the two, and a **navigator** shows which region of an oversized photo
  is on screen and jumps to another. `(apps/web/src/ui/PhotoViewer.tsx:59)`

## Unpack → drafts → publish (the background flow)

- **unpack** — run object detection over an uploaded photo for a chosen item type, then create
  one **draft** per detected box, each with a cropped photo (original + thumb) written to disk.
  Returns `{ detected, drafts }`. `(apps/api/src/modules/unpack/service.ts:35)`
- **draft** — an item with `published=false`. There is **no separate drafts table**; it is the
  same `items` row, filtered by the flag. Drafts sit on the drafts page, not the shared catalog.
  `(packages/db/src/schema.ts:66)` `(apps/api/src/modules/unpack/service.ts:62)`
- **publish** — flip a draft's `published` to `true` so it joins the shared catalog.
  `publishDraft` (one) / `publishAll` (all, or a subset of ids). `(apps/api/src/modules/drafts/service.ts:15)`
- **rename** a draft gives it a real name before publishing; **discard** a draft deletes the
  row (cascade) and best-effort removes its images. `(apps/api/src/modules/drafts/service.ts:12)` `(apps/api/src/modules/drafts/service.ts:45)`

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
  state. The catalog's `published=true` guard keeps drafts out of every result and count.
  `(packages/db/src/schema.ts:137)` `(apps/api/src/modules/items/repo.ts:96)`

## Auth & provisioning

- **role** — `admin` | `user` on a user row; admins reach instance settings and admin actions.
  `(packages/db/src/schema.ts:17)`
- **mustChangePassword** — a per-user flag forcing a password change on next sign-in (e.g. after
  an admin reset). `(packages/db/src/schema.ts:18)`
- **setup / first run** — a fresh DB has no admin, so the app routes to `/setup`; the
  `requiresSetup` query returns `setupRequired` until the first admin exists. Auth is argon2id
  password hashing with httpOnly session cookies.
