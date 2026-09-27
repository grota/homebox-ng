# Photo workflow: the editor's tabs, create/edit as pages, and a crop at create

**Status:** Accepted (2026-09-25). Plan: `docs/superpowers/plans/2026-09-25-photo-workflow-pages-and-crop.md`.
Decisions recorded in ADR-0011 and ADR-0012.

## What this covers

Three asks, one session: (1) the photo editor's tabs are in the wrong order and it opens on the
wrong one; (2) the "new item" form is a hidden/shown thing on the catalog instead of a page;
(3) a photo picked while creating an item should be croppable before it is uploaded.

## Today, in facts

**The editor's tabs.** The "widgets" are Filerobot's tabs (`react-filerobot-image-editor@4.9.1`).
There is no group concept in the library or the repo. Order is one literal array,
`apps/web/src/features/upload/PhotoEditor.tsx:16` — `[FINETUNE, ADJUST, ANNOTATE, RESIZE]` — passed as
`tabsIds` at `:82`, and the array index *is* the slot. **The default tab is not ours**: the app has
never passed `defaultTabId`, so it inherits the library's `defaultConfig` (`defaultTabId: ADJUST`,
`defaultToolId: CROP`). No test asserts either the order or the default
(`apps/web/test/photoEditor.test.tsx:68-85` only does `toContain`/`not.toContain`). Annotate was
never first: before `ffe94e9` we passed no `tabsIds` at all and the library ordered the tabs, putting
Annotate fourth.

**The create form.** `ItemForm` (`apps/web/src/features/items/ItemForm.tsx:36`) is dual-mode — the
optional `item` prop flips the heading (`:165`) and the button (`:337`) — and has exactly two call
sites: create at `ItemsPage.tsx:306`, edit at `ItemDetail.tsx:151`. Create is a bare `useState` toggle
(`ItemsPage.tsx:48`, `:234`, `:306`), so it has no URL: refresh and Back discard the typing. Editing
already replaces the whole surface with its own frame (`ItemDetail.tsx:141-162`); only the URL is
missing. There is no unsaved-state handling anywhere in the form.

**The photo pipeline.** The create form holds the picked `File` until submit because
`POST /upload/image` needs a `itemId` that does not exist yet (`ItemForm.tsx:33-35`, `:139-148`);
`uploadImage` returns the inserted row's `{ id }` (`apps/web/src/features/upload/PhotoUpload.tsx:22-32`).
Filerobot already ships the crop tool (`TOOLS_IDS.CROP` is first in the ADJUST tab's tool list) and
`ItemDetail.tsx:236`/`:294` already opens it — **cropping works today, one click after the item
exists**. No cropper library is installed beyond Filerobot.

## Decisions

1. **Tab order `[Annotate, Adjust, Resize, Finetune]`, with the default derived from position.** The
   array is reordered and the editor is given `defaultTabId={TABS_IDS[0]}`, so reordering the array
   re-defaults the UI and there is no second place to disagree. `defaultToolId={TOOLS.TEXT}` is set
   too, and is **required**, not cosmetic: the library's `CROP` is not in
   `TABS_TOOLS[ANNOTATE] = [TEXT, IMAGE, RECT, ELLIPSE, POLYGON, PEN, LINE, ARROW]`, and `ToolsBar`
   gates the options panel on `TABS_TOOLS[tab].includes(tool)` — so the tab would open with no tool
   highlighted and no options, while the canvas still held a crop tool. `TEXT` is also the tab's own
   first tool and the one this app already customises (`TEXT_DEFAULTS`, `PhotoEditor.tsx:18-23`).
   Both the order and both defaults are pinned by assertions.

2. **Create is a page: `/items/new`, inside `Shell`.** The toggle is deleted; the "New item" button
   becomes a link. On save and on cancel the page goes back where the user came from —
   `navigate(-1)`, with `/items` as the cold-deep-link fallback — so a filtered catalog keeps its
   query string instead of resetting to a bare `/items`.

3. **Edit gets a URL: `/items/:id/edit`, rendered by the same `ItemDetail`.** It sits in the same
   nav-less layout route as `/items/:id` (`routes.tsx:27-37`), so the chrome does not change under
   the user. The `editingItem` state is deleted and "am I editing" is derived from the path. Edit
   navigates in; Close, Cancel, Save and Escape navigate back to `/items/:id` with `replace`.
   `ItemDetail`'s cold-deep-link test moves from `location.key === 'default'` (`:73-80`) to a `useRef`
   captured at mount, because the URL now changes while the surface is mounted and the key would
   otherwise report "not a deep link" for a deep link.

4. **The crop at create is Filerobot's ADJUST tab over the picked file, and the crop *is* the
   photo** (ADR-0012). It opens on pick, with `source` an object URL of the file and
   `tabsIds={[TABS.ADJUST]}` — which is crop/rotate/flip, no tab strip (the library returns none for
   a single tab), and the crop tool already armed by the library's own `defaultToolId`. Save yields
   a `Blob` that becomes the form's pending photo; Close keeps the un-cropped file. Upload is one
   `POST /upload/image`; there is no `/upload/image/edit` call and no second rendition, because the
   point of the step is removing garbage before the item exists, not a tentative edit.
   **Export settings matter here and differ from the edit flow's:** `savingPixelRatio` (measured, see below) and
   `defaultSavedImageType="jpeg"`. `savingPixelRatio` is measured from the photo over the stage (see `savingPixelRatioFor` — the export
   canvas is full-size either way; the ratio sizes the cache drawn into it), so a static `1` would store
   a stage-sized bitmap blown up to full-size pixels, and PNG is the wrong container for a photograph. The edit flow uses the same measured ratio.

5. **`PhotoEditor`'s blob conversion becomes shareable.** `toBlob` (`PhotoEditor.tsx:27-39`) is the
   piece both flows need; the posting stays where an `imageId` exists. The editor splits into the
   blob-producing half (shared) and the posting half (unchanged), rather than the crop step
   duplicating Filerobot wiring.

## Out of scope

Camera capture (`capture`) and drag-and-drop on the picker; client-side compression of uncropped
uploads; any change to the photo actions on the item surface; any server, schema or API change (this
whole spec is web-side); new dependencies — Filerobot, `sharp` and the existing test stack cover it.

## Notes and risks

- **Filerobot is unit-tested only, on policy.** `docs/superpowers/specs/2026-09-05-phase2-image-editor-design.md:112`:
  "Filerobot canvas interaction is brittle under Playwright, so editing stays covered by unit tests,
  not E2E." The crop dialog inherits that: its test asserts the props it is handed and the blob it
  hands back, not a canvas interaction.
- `imageData.mimeType` from the library is `'image/' + extension`, which for a JPEG source is the
  invalid `'image/jpg'`. `defaultSavedImageType="jpeg"` avoids the path that produces it; if the
  saved blob comes back as PNG anyway, the size is the symptom, not the cause.
- `apps/web/package.json` declares `react-konva@^19.2.6` directly but never imports it in
  `apps/web/src`; it is only a transitive requirement of Filerobot. Unrelated one-line cleanup,
  deliberately not in this plan.
