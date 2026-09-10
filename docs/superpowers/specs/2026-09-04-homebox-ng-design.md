# HomeBox-BG — Design Spec

**Date:** 2026-09-04
**Status:** Draft for review
**Type:** Architectural design (greenfield)

## Overview

A self-hostable home-inventory app: catalog the items you own, each with photos, a
location, and a type. Built greenfield (not a fork of Homebox: Homebox is Go + AGPLv3,
lacks the image editor and per-user locale/theme we want, and includes features the user
doesn't use). Homebox is used only as a design reference for concepts and UX where useful.

The app is a **household catalog**: all users on an instance see the shared catalog and
collaborate on it, while each user keeps their own settings (language, locale, theme) and
their own account.

## Scope

**In (v1):**
- Accounts: name + email + password, login, admin-invited users, initial admin on first run.
- Items: name, long description, quantity (+ optional unit), multiple photos, documents (attachments).
- Item types: instance-wide, admin-managed, each with custom fields.
- Custom fields: text, number, currency, date, boolean, url (money via the currency type).
- Locations: nested tree.
- Tags: free-form labels on items, searchable.
- Photos: upload → rich client-side editor (crop/resize/text/draw) → **non-destructive** store
  (original + edited kept), re-editable from the original; auto-generated thumbnails.
- Documents: non-photo file attachments.
- Search: SQLite FTS5 full-text + facet filters (location tree, type, tags).
- Admin settings: max upload size (MB), backup/restore.
- **Unpack (multi-item photo import)**: unpack a photo of clustered items into separate draft
  items via object detection + auto-label + per-box crop. Available as a **root action** (standalone
  photo, discardable) and **on an item's photo** (unpack its contents; the original item stays).
  Detection provider is **pluggable** (remote cloud API default / local offline model) chosen in
  admin settings. Drafts (`published=false`) are reviewed on a **Drafts** page (thumbnail, editable
  label, select, publish / publish-all), then published into the inbox.
- Per-user: language (English bundled, pluggable i18n), locale (region → date/number/currency
  via `Intl`), theme (mode auto/light/dark + chosen light theme + chosen dark theme).
- **Responsive design**: fully usable on mobile and desktop — touch-friendly, adaptive
  navigation and grids, with the photo editor and all forms usable on narrow viewports
  (maintaining Homebox's responsive stance).

**Out (deferred / non-goals):**
- Purchase / maintenance / warranty tracking.
- Item assemblies ("item made of parts").
- Multi-tenancy (one deployment per instance).
- Per-user private catalogs (catalog is household-shared).
- Translation files beyond English (architecture ready, more languages added later).
- S3/object storage (images on local disk).

## Tech stack

- **Frontend:** React + TypeScript, built with Vite. `react-query`, `react-router`,
  `react-i18next`, Tailwind CSS, CSS variables theming. Image editor: **filerobot-image-editor**.
- **Backend:** Node + TypeScript, **Fastify**. ORM: **Drizzle** (SQLite-native).
  DB: **SQLite** (via `better-sqlite3`), **FTS5** for search. Image processing: **sharp**.
  Auth: **argon2id** password hashing; httpOnly session cookies.
  API contract: **tRPC** (E2E-type-safe), with raw Fastify routes for the multipart upload/download endpoints.
- **Workspace:** pnpm + Turborepo.
- **Deploy:** single Docker image serving the built SPA + the API; a volume for SQLite and a
  volume for uploads.

## Repo layout

```
homebox-ng/
├── apps/
│   ├── web/                       # React SPA
│   │   └── src/
│   │       ├── app/               # routing, providers, layout
│   │       ├── features/          # items, locations, item-types, tags, admin, search…
│   │       ├── settings/          # per-user language/locale/theme
│   │       └── lib/               # api client (tRPC), i18n, theme, intl helpers
│   └── api/                       # Fastify server
│       ├── src/
│       │   ├── modules/           # auth, users, items, locations, itemTypes, tags,
│       │   │                      #   images, attachments, search, settings, backup
│       │   ├── routes/            # tRPC router + upload/download routes
│       │   └── mount.ts
│       └── drizzle/               # schema, migrations, FTS sync
├── packages/
│   ├── shared/                    # zod schemas, shared types, constants (validators/schemas.ts)
│   └── db/                        # Drizzle schema + client + migration runner
├── docker/                        # Dockerfile, docker-compose.yml
├── data/                          # runtime SQLite + uploads (gitignored)
└── docs/
```

## Data model (SQLite via Drizzle)

> Paths are relative to a configurable `DATA_DIR`. Files live on disk, not as DB blobs.

- **users**: `id`, `name`, `email` (unique), `password_hash` (argon2id), `role`
  (`admin` | `user`), `created_at`.
- **sessions**: `id`, `user_id`, `token_hash` (unique), `expires_at`, `created_at`.
- **locations**: `id`, `parent_id` (nullable, self-FK), `name`, `description`, `created_at`.
  Forms a nested tree (`parent_id` → `locations`).
- **item_types**: `id`, `name` (unique), `description`, `created_at`. Instance-wide; managed by admins.
- **item_type_fields** (custom-field definitions): `id`, `item_type_id` → `item_types`,
  `name`, `field_type` (`text`|`number`|`currency`|`date`|`boolean`|`url`), `required`
  (bool), `config` (JSON: e.g. default currency code, unit), `sort_order`.
- **items**: `id`, `name`, `description` (long text), `quantity` (integer, default 1),
  `unit` (optional text), `item_type_id` → `item_types`, `location_id` → `locations`,
  `created_by` → `users` (attribution), `published` (bool, default **true** for normal items,
  **false** for unpacked drafts), `created_at`, `updated_at`.
  Shared catalog: every user can read all items. A draft is `published=false`;
  **inbox** = `published=true` AND `location_id IS NULL`.
- **item_custom_field_values**: `id`, `item_id` → `items`, `field_id` → `item_type_fields`,
  `value` (text). Typed at read time from `item_type_fields.field_type`; currency rendered via
  `Intl.NumberFormat` with the user's locale and the field's currency code.
- **tags**: `id`, `name` (unique), `color`, `created_at`. Instance-wide (shareable).
- **item_tags**: `item_id` → `items`, `tag_id` → `tags` (composite PK).
- **images** (non-destructive): `id`, `item_id` → `items`, `original_path`, `edited_path`
  (nullable — falls back to `original_path`), `thumb_path`, `width`, `height`, `format`,
  `size_bytes`, `sort_order`, `is_primary` (bool, one per item).
- **attachments**: `id`, `item_id` → `items`, `file_path`, `original_name`, `mime_type`,
  `size_bytes`, `created_at`.
- **instance_settings** (single row): `id` (fixed), `max_upload_mb` (int, default e.g. 10),
  `detection_provider` (`remote` | `local`, default `remote`),
  `detection_config` (JSON — remote: provider + model id + API-key reference; local: model path,
  device, confidence threshold).
- **user_settings**: `id`, `user_id` (unique) → `users`, `language` (default `en`),
  `locale` (default `en-US`), `theme_mode` (`auto`|`light`|`dark`), `light_theme_id`,
  `dark_theme_id` (keys into the theme registry).

### Search index
- **FTS5** virtual table `items_fts`: searchable blob = `name`, `description`, tags (joined),
  custom-field values, item-type name, and the item's location path. Tokenizer `unicode61`
  for case- and diacritic-insensitive matching.
- **Sync is application-layer** (not SQL triggers): each write path that touches an item's
  searchable content (`createItem`/`updateItem`/field, tag, type, location changes) calls
  `reindexItem(itemId)` **in the same DB transaction**, so the item write and its index update
  are atomic. A `rebuildFTS` admin action re-indexes everything if the index ever drifts.

## Auth & users

- **First run:** if no `users` exist, a setup screen creates the initial **admin**
  (name, email, password).
- **Invite / create:** admins create users (name, email, temp password). The user is prompted
  to change the password on first login. Roles: `admin` (manage users, item types, instance
  settings, backup/restore, rebuild index) and `user` (CRUD items/attachments/docs, own settings).
- **Login:** email + password → httpOnly, SameSite=Lax session cookie. argon2id hashing.
  Sessions expire; logout invalidates the session. Rate-limit login attempts.

## Item types & custom fields

- Item types are **instance-wide**. Admins create/edit types and their custom-field definitions.
- Supported field types: `text`, `number`, `currency`, `date`, `boolean`, `url`.
- When editing an item, its fields are rendered according to the selected type's custom-field
  definitions. Currency fields show the default currency code and format with the user's locale.

## Items, locations, tags

- Create/edit/delete items (name, description, quantity, unit, type, location).
- Multiple photos per item; one marked primary (used as the card image).
- Nested locations (create child under a location).
- Assign tags to items (create-on-the-fly with a color).

## Image & attachment pipeline

1. **Upload**: `POST /upload/image` (multipart) validates MIME (image/*) and size against
   `max_upload_mb`. Original saved to `data/uploads/originals/`.
2. **Edit**: the client opens **filerobot-image-editor** on the original; the user crops/resizes/
   adds text and draws. On export, the resulting blob is posted to `POST /upload/image/edit`,
   which saves it as the item photo's `edited_path`. The `original_path` is always preserved
   (non-destructive). Re-editing later reloads the `original_path` and replaces `edited_path`.
3. **Thumbnails**: `sharp` derives a ~400px thumbnail (`thumb_path`) for listing cards and
   search results. Full image loads only in the photo detail view. Thumbnails are regenerable.
4. **Documents**: uploaded as raw files to `data/uploads/documents/`, no editing, downloadable
   via a guarded route. Enforced against the same `max_upload_mb` cap in v1.

`DATA_DIR` layout: `uploads/originals/`, `uploads/edited/`, `uploads/thumbs/`,
`uploads/documents/`.

## Unpack (multi-item photo import)

Turns a photo of several closely-clustered items into individual items. Two entry points:

- **Root action**: upload a standalone clustered photo → unpack. The source photo is **discardable**.
- **Item-photo action**: from an existing item's photo → unpack its contents into new items. The
  original item (e.g. a bag) **stays as-is**, and its photo remains attached to it.

**Detection provider (pluggable):**
- Abstracted behind a `DetectionProvider` interface: `detectBoxes(image) → [{ box, label, confidence }]`.
- **Remote (default)**: a cloud vision API (e.g. GPT-4V-style or AWS/GCP Rekognition/Vision).
  Configured in admin (provider/model + API-key reference). Best accuracy on arbitrary clutter;
  sends the photo off the server.
- **Local (optional)**: an offline model (YOLO-family via ONNX Runtime / transformers.js) in the
  server or a small sidecar. Private, free; a generic vocabulary, so auto-labels are rougher.
- Admin settings expose a radio to choose the provider, with per-provider sub-options (remote:
  provider, model, API key; local: model path, device, confidence). Local is wired in later; the
  setting and the interface exist now.

**Flow:** select/upload image → detect boxes (which may **overlap**) → for each box, **crop** the
original → create a **draft item** with the cropped image as its primary photo, the auto **label**
as its `name`, `published=false`, and no location.

**Drafts & publishing lifecycle:**
- Draft items (`published=false`) are excluded from the catalog and appear on a **Drafts** page.
- Each draft shows a **thumbnail**, an **editable label** text field (pre-filled with the model's
  proposed label, saved to the item name), a **select** checkbox, and a per-item **Publish** button.
  A **Discard** action is also available.
- **Publish** (single) sets `published=true` immediately and removes the draft from the page;
  **Publish all** publishes every selected draft. Publishing lands the item in the catalog's
  **inbox** (no location).
- The `published` flag is surfaced only for these draft-originated items. Once published an item is
  edited/deleted normally; an **unpublish** action is a rare admin operation, deferred.

## Search

- `GET` via tRPC `search.query({ q?, locationId?, typeId?, tagIds? })`.
- Combines FTS5 `MATCH` (ranked) with facet filters on the location tree, item type, and tags.
- Redirects to the same service module used in item CRUD for consistency.
- Returns items with snippet text and the thumbnail path.

## i18n, locale, theme

- **i18n:** react-i18next. English strings bundled under `apps/web/public/locales/en/`.
  The per-user `language` selects the active resource; more languages added later without
  code changes.
- **Locale/format:** the user's `locale` string drives `Intl` formatting for dates and for
  currency-typed custom fields. A `useUserSettings()` hook exposes `formatDate`/`formatCurrency`.
- **Theme:** CSS-variable palette system + a theme registry.
  - `theme_mode`: `auto` (follow `prefers-color-scheme`), `light`, or `dark`.
  - `light_theme_id` / `dark_theme_id`: a palette chosen from the light set and the dark set.
  - Auto resolves to the user's chosen light or dark theme based on the OS preference.
  - **Palettes adapted from Homebox's bundled themes.** Each theme is a set of CSS custom
    properties (colors, surfaces, text, accents) defined per theme. As Homebox does, every theme
    carries an explicit **dark-group flag** (`dark: true`/`false`, or an equivalent group marker)
    rather than having light/dark inferred from its colors. The light set and the dark set are
    derived from that flag, so each theme belongs to exactly one set. v1 ships ~3 light + ~3 dark
    curated palettes, taken from Homebox's theme list and adapted to this repo's variable names.

## Responsive design

The app is responsive on mobile and desktop — Homebox's responsive UI is a baseline and we keep
that. Implementation notes: Tailwind breakpoints; adaptive layouts (item grids collapse, primary
navigation becomes a drawer on mobile); the photo editor, item forms, and admin pages stay usable
with touch and on narrow viewports; tables and long forms wrap rather than overflow; targeted
finger-friendly hit areas.

## Admin settings & backup/restore

- **Instance settings:** `max_upload_mb` (enforced on image + document uploads).
- **Back up:** admin action builds a single `.tar.gz` archive = SQL dump of the DB + the entire
  `data/uploads/` tree, and streams it as a download.
- **Restore:** admin uploads a backup archive; the app validates it, then replaces the DB + uploads
  after explicit confirmation (destructive; the app refuses a restore into a running busy DB).

## API contract

- **tRPC** router in `apps/api` with procedures grouped by module (`auth`, `users`, `locations`,
  `itemTypes`, `items`, `tags`, `images`, `attachments`, `search`, `settings`, `backup`,
  **`unpack`, `drafts`**).
- **Unpack/drafts procedures:** `unpack.run` (detect + crop + create drafts), `drafts.list`,
  `draft.update` (edit label), `draft.publish` (single), `drafts.publishAll`, `draft.discard`.
- **Multipart** upload/download routes are raw Fastify routes (tRPC doesn't handle multipart well):
  `POST /upload/image`, `POST /upload/image/edit`, `POST /upload/document`,
  `GET /download/<attachment-id>`, `GET /image/<image-id>/original|edited|thumb`, `GET /file/<path>`.
- Auth via httpOnly session cookie read by tRPC middleware. Validation via zod schemas in
  `packages/shared`, reused by client and server.

## Error handling & security

- Validation errors → typed `TRPCError` with per-field messages; one central error boundary.
- Rate-limit login. argon2id password hashing. httpOnly + SameSite=Lax cookies, CSRF origin
  checks for state-changing requests. Path-traversal protection on all file-serving routes.
- Role checks via tRPC middleware for admin-only procedures. Parameterized FTS `MATCH` queries.

## Testing

- **Backend** (Vitest, temp SQLite): API integration via Fastify `inject`; unit tests for
  custom-field validation, search query building + `reindexItem`, and the sharp/thumbnail pipeline.
  Repository pattern over Drizzle for testability. The `DetectionProvider` is **faked** in tests
  (interface contract tests + a fake returning fixed boxes); `unpack.run` integration test verifies
  the boxes become correctly-cropped draft items; the publish/discard flow is covered.
- **Frontend** (Vitest + React Testing Library): component tests for item forms, editor wrapper,
  settings, theme application; a thin Playwright E2E suite (auth, create item + edit photo,
  search, backup).
- **Migrations:** drizzle-kit, verified against a clean database.

## Deployment

- Single `Dockerfile` (multi-stage): build `packages/shared` + `packages/db` + `apps/api` +
  `apps/web`; runtime serves the static SPA and the API.
- `docker-compose.yml`: one service; bind mounts for `/data` (SQLite + uploads). `DATA_DIR`,
  `SECRET_KEY`, and DB path configurable via env.
- `.gitignore`: `node_modules`, `dist`, `.turbo`, `data/`, `.env`.

## Non-goals / future work

- Purchase/maintenance/warranty tracking; item assemblies; multi-tenancy; per-user private
  catalogs; object storage; more languages; REST external API (tRPC is the internal contract).
