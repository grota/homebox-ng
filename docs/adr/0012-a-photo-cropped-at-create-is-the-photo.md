# ADR-0012: A photo cropped while creating an item becomes that photo; the original is not kept

**Status:** Accepted (2026-09-25).

## Context

Everywhere else, this app refuses to destroy a photo it does not have to. `POST /upload/image/edit`
writes a fresh `uploads/edited/` rendition, regenerates the thumb, and leaves `originalPath`,
`sortOrder` and `isPrimary` untouched (`apps/api/src/uploads.ts:164-186`) — which is what makes
"Edit original photo" (`ItemDetail.tsx:237`) a real way back to the un-cropped frame. ADR-0003 is the
same principle applied to field values.

The new-item form is the one place a photo is met *before* it exists server-side: the picker holds a
`File` until `items.create` returns an id (`ItemForm.tsx:33-35`, `:139-148`). A crop there happens on
bytes the server has never seen, and the owner's framing for it is pre-cleaning — "remove the garbage
before the user actually starts working on the item" — not a tentative edit they may want to undo.

## Decision

**The cropped bytes are what gets uploaded, as the photo's original.** The un-cropped file is not
uploaded anywhere. Such a photo has no `original`/`edited` pair: one `POST /upload/image`, and no
`POST /upload/image/edit` call at all.

## Consequences

- On such an item, "Edit original photo" re-crops the crop, and recovering the wider frame means
  re-picking the file from the device.
- The consistent alternative — upload the raw file as the original and the crop as a new edited
  rendition — was rejected because it doubles the upload and leaves a second, full-size,
  never-displayed file on disk for every create-with-crop, for a photo the user has already decided
  they did not want.
- The crop is applied to the picked file, which is why the *dialogue* starts from the file: Filerobot
  opens on an object URL, and its saved blob replaces the pending photo in the form.
- **Revisit if the complaint actually arrives** ("I cropped too tight and there is no way back"). The
  fix is the two-upload version above; it needs no schema change and no server work.

## Related

- ADR-0003 (`0003-non-destructive-field-edits.md`) — the principle this deliberately departs from.
- ADR-0011 (`0011-create-and-edit-are-pages.md`) — the pages the crop step lives on.
