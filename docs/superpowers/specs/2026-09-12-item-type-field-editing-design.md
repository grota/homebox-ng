# Item-type field editing — design

**Status:** Draft for review (2026-09-12)
**Related:** ADR-0003 (to be written) for the refuse-vs-destroy decision; ADR-0002
(`docs/adr/0002-modal-full-viewport-variant.md`) for the `Modal` this design reuses.

## Goal

Editing an item type's custom fields must be **non-destructive by default**. Today, changing
the field *set* at all — adding, renaming, reordering, retyping — deletes every stored value
for that type. `sortOrder`, `required` and `name` are not separate concerns, because the write
path treats the whole set as a single replaceable blob.

The goals, in order:

1. Adding a field is always possible and destroys nothing.
2. Renaming, reordering and toggling `required` on a field destroy nothing.
3. Changing a field's **type** is allowed only while every stored value still fits the new
   type. When it does not, the change is refused and the offending items are enumerated, so
   the user can repair them — or deliberately clear those values and convert.
4. Deleting a field is the one inherently destructive operation, and it is explicit,
   enumerated and acknowledged.

## Facts this design rests on

Established by reading the code and by two throwaway probes, not assumed. Each one changed a
decision.

- **The destructive mechanism is a delete-and-reinsert.** `replaceTypeFields`
  (`apps/api/src/modules/itemTypes/repo.ts:80`) runs `DELETE FROM item_type_fields WHERE
  item_type_id = ?` (`:82`) and re-inserts every field as a **new row with a new id**.
- **Values are keyed to those rows with a cascade.**
  `item_custom_field_values.field_id` references `itemTypeFields.id` with `onDelete: 'cascade'`
  (`packages/db/src/schema.ts:74`), and FK enforcement is on (`packages/db/src/client.ts:19`).
  So the re-insert destroys every value of the type — demonstrated: a type with `size` and
  `note`, an item holding `large` and `hello`, and adding a third field leaves the item with
  `[]`. A pure rename does the same.
- **A blank field still writes a value row.** `ItemForm` submits one entry per field of the
  selected type, using `''` for untouched ones, and `replaceFieldValues`
  (`apps/api/src/modules/items/repo.ts:338`) inserts every entry unconditionally. Probe: after
  a save with one field filled, the table holds `('large')` and `('')` — so counting rows, or
  counting non-NULL rows, both report data where there is none. Only `value <> ''` is correct,
  and it must be a length test: `'0'` in a number field is real data.
- **No index exists on any table.** No migration (`packages/db/drizzle/0000`–`0004`) contains a
  `CREATE INDEX`, and SQLite does not index FK columns — so `WHERE field_id = ?` is a scan.
- **Field definitions are written in exactly two places**, both in `itemTypes/repo.ts`: the
  insert inside `createType` (`:65`) and `replaceTypeFields` (`:82`,`:85`). Nothing else in the
  repo creates a field definition — not the unpack flow, not items. Definitions are owned
  solely by the item type.
- **An item does not inherit fields; it stores values.** Rows in `item_custom_field_values`
  keyed by `(item_id, field_id)`; the form renders one input per definition of the selected
  type.
- **Nothing validates that a value's `field_id` belongs to the item's type.**
  `replaceFieldValues` inserts whatever ids it is handed.
- **The failure mode of a bad value depends on the input type the form picks**
  (`apps/web/src/features/items/ItemForm.tsx:232`): `url` renders `type="url"`, so a value that
  is not a valid absolute URL fails constraint validation and **the browser blocks submit** —
  the item becomes uneditable. `number`/`currency`/`date` render `type="number"`/`type="date"`,
  whose value sanitization **blanks the display** while React state still holds the old value —
  worse, because it is silent. `text` and `boolean` (rendered as `text`) have no constraint.
- **The form has no `required` control.** `DraftField = { key, name, fieldType }`
  (`apps/web/src/features/itemTypes/ItemTypesPage.tsx:10`), so every field created through the
  UI is `required: false`. The column and the DTO support it; nothing exposes it.
- **`required` is not enforced server-side** anywhere. It only becomes the input's `required`
  attribute, which is a browser-level constraint on the item form.
- **The unpack flow bypasses the item service entirely.** `unpack/service.ts` calls
  `repo.createItem` directly with `fieldValues: []` and `published: false`, so drafts carry no
  values and never pass through any service-level validation.
- **`itemTypes.update` currently takes `fields`** and passes it to `replaceTypeFields`
  (`itemTypes/service.ts`). The web page is its only caller.
- **No test pins the destructive behaviour.** `apps/api/test/itemTypes.test.ts` covers create,
  delete and the admin gate; the replace semantics are unexamined.
- **Type deletion is already guarded**: `hasItemsReference` (`itemTypes/repo.ts:97`) makes
  `deleteItemType` answer `CONFLICT` while items reference the type.
- **`ui/Modal` exists** and is Radix-based, with a recorded focus-restore caveat
  (`github.com/grota/homebox-ng` issue #1): a closure that focuses inside the portalled content
  during mount leaves the opener capture null.

## Design

### 1. The invariant

**No write destroys stored values unless the request explicitly acknowledges it, and the server
re-validates that acknowledgment inside the transaction.**

Two acknowledgments, one mechanism: `clearIncompatible` (retype) and `acknowledgeValueLoss`
(field deletion). Each means "I know N non-empty values will be destroyed". Neither is
inferred from the shape of the request.

### 2. What counts as real data

`value IS NOT NULL AND value <> ''`, counted per field. Not "a row exists" and not "the value
is not null" — both are wrong per the probe above. A length test, not truthiness. The test
does **not** trim: a whitespace-only value counts as data, which errs toward not destroying it.

### 3. Field identity and the explicit diff

`ItemTypeFieldInputSchema` gains an optional `id`. `replaceTypeFields` is replaced by a diff:

- An upsert carrying an `id` **updates that row in place** — the id is unchanged, so its values
  survive. This is the fix for the actual bug.
- An upsert without an `id` **inserts** a field (a new field has no values by construction).
- `deletedIds` are deleted, cascading their values.

The diff is **explicit, never inferred from omission**. Inference would be a trap: an inline
"save just this row" that sends one upsert would silently delete every sibling. A client that
sends a single row must not be able to mean "delete the rest".

### 4. The compatibility predicate

One definition in `packages/shared`, `fitsFieldType(fieldType, value)`, mirroring the
**browser's** constraints — those are what actually break, and the server must agree with them
or the gate is wrong.

| type | fits when | if it does not |
|---|---|---|
| `text` | always | — |
| `boolean` | `true`/`false`/`0`/`1`, case-insensitive | rendered as text, no constraint |
| `number`, `currency` | the trimmed value parses as a finite number | input blanks the display |
| `date` | exactly `YYYY-MM-DD` and a real calendar date | input blanks the display |
| `url` | `new URL(v)` succeeds | **submit blocked** (typeMismatch) |

The predicate has two callers and they must not drift: the server's gate, and the web's
pre-warning. It is a **semantic** fit, deliberately stricter than "merely renderable": a
`boolean` field accepts only `true`/`false`/`0`/`1`, even though the form renders it as a text
input that would happily display `'yes'`. Being stricter costs a refusal in a case that is
semantically wrong anyway, and it means the predicate does not have to change if `boolean`
ever gets a real checkbox.

### 5. Rules per attribute

| change | rule |
|---|---|
| `sortOrder` (reorder) | always allowed — presentational |
| `required` | always allowed — touches no stored value |
| `name` | always allowed — values key by id |
| `config` | always allowed |
| add a field | always allowed |
| **`fieldType`** | allowed only while every non-empty value of that field fits the new type; otherwise refused, with the offenders enumerated |
| **delete a field** | allowed, but requires `acknowledgeValueLoss` while any non-empty value exists |

The distinction matters in both directions. Blocking `name`/`sortOrder`/`required` because
"data exists" would be arbitrary; allowing `fieldType` freely would ship a form that blanks
values or refuses to submit.

### 6. API surface

- **`itemTypes.update`** keeps `name`/`description` and **drops `fields`**. The web page is the
  only caller.
- **`itemTypes.updateFields({ id, upserts, deletedIds, clearIncompatible?,
  acknowledgeValueLoss?, acknowledgedValueCount? })`** → the hydrated type. `id` names the type,
  matching `itemTypes.update`. One transaction: validate that every id belongs to the type →
  clear the acknowledged values → apply the deletes → apply the upserts. That is the order the
  code runs in; the clears are computed from the pre-write field rows, and no field may be both
  deleted and upserted (refused, below), so the last two steps cannot interact. A dedicated procedure
  rather than overloading `update`, because the field set now carries its own validation, refusal
  rules and destructive flags — that is an interface, not a parameter.
- **`itemTypes.fieldValueUsage({ typeId, fieldId, fieldType? })`** →
  `{ total, missing, items: [{ itemId, name, value }] }`, non-empty values only. `fieldType`
  narrows to values that do not fit it. `missing` counts **published** items of the type with
  no non-empty value — drafts are excluded, since the unpack flow creates them value-less and
  nobody can edit them (see §9). One endpoint serves three jobs: the retype pre-warning, the
  modal's list, and the delete-field count. (`typeId` rather than `id` here only because
  `fieldId` sits beside it.)
- **`create` is unchanged** — insert-only `fields`, as today.
- **Errors.** `PRECONDITION_FAILED` when a required acknowledgment is absent.
  `CONFLICT` when `acknowledgedValueCount` no longer matches (§7). Messages are user-facing
  sentences, since the UI displays them. Three `BAD_REQUEST`s:
  - an id that does not belong to the type (an upsert's or a `deletedIds` entry's);
  - an id that appears in **both** `upserts` and `deletedIds`. Refused rather than resolved:
    the delete removes the row the upsert claims to keep, so the upsert would silently hit zero
    rows. Nothing in this diff is inferred, so an ambiguous intent is an error, not a
    precedence rule;
  - a request in which **more than one field would need its values cleared** — "Only one field
    can be converted at a time." A request-level count cannot be satisfied for two dirty fields
    (§7), and making it a total would let a client attest to the one field's casualties while
    silently clearing another's unseen ones.

### 7. Atomicity, the count pin, and the stale-list hole

The destructive retype is **one** request: *"retype field F to T, clearing the values of F that
do not fit T, of which I saw N."* `N` is the number of non-fitting **values** the client was
shown — one per affected item, since a value is unique per `(item, field)`. Inside the
transaction the server recomputes the non-fitting set and:

- **recomputed count ≠ N** → `CONFLICT`, "the values changed — re-check". Nothing written.
- **equal** → clear exactly the non-fitting values of F and retype, atomically.

Without the pin, a value added between opening the modal and clicking the button would be
destroyed without ever being shown. Splitting "clear" and "retype" into two requests is
rejected outright: a failure between them leaves values destroyed and the type unchanged — the
worst outcome, data gone with nothing gained.

`N` describes exactly one field, which is why a request may carry **at most one field that needs
its values cleared** (§6). A request whose number would be the sum of two fields' casualties can
never be satisfied: the modal showed one field's list, so the client could not have seen the
other's. Retyping several fields at once stays allowed while at most one of them strands
anything.

### 8. UI

- **Item types page.** The type's name/description keeps its own form. The field set becomes a
  list of independently editable rows — name, type select, `required` checkbox, a Delete, and a
  Save that appears when the row is dirty — plus an "Add field" row. Because the diff is
  explicit, saving one row cannot touch its siblings.
- **Retype flow.** Changing a row's type queries `fieldValueUsage({ typeId, fieldId, fieldType: T })`.
  If `total > 0` the row shows an inline warning ("3 values don't fit number") and Save opens
  the modal below. If `total` is 0 the row saves normally, with no round trip the user notices.
- **The modal** reuses `ui/Modal`: the number of values about to be cleared, a list capped at
  **50** of `Lamp — 'large'` each linking to `/items/:id` with `target="_blank"
  rel="noreferrer"`, a "+ N more" line, a destructive *Clear N values and convert* behind a
  second confirm, and a Cancel that leaves everything untouched. The count is of values, not of
  listed rows — the list is a sample for judgement, the count is the commitment. It re-checks
  on window focus, because editing in another tab is the point of the links. Per issue #1, do
  not autofocus inside the portalled content.
- **Delete-field flow.** The house-style `window.confirm` (as in `ItemDetail.tsx`) naming the
  count of values destroyed, then `updateFields` with `acknowledgeValueLoss`.
- **Reordering is not exposed in this iteration.** `sortOrder` stays settable through the API
  and existing order is preserved; new fields append. No drag handles.

### 9. `required` becomes a real control

The field row, the add-field row and the create-type form gain a `required` checkbox —
otherwise the column is dead weight and the form's `required` attribute stays permanently
false. The add-field row's payload carries it (`{ name, fieldType, required }`), so a field added
to an existing type can start required instead of costing a second save.

- Toggling it is non-destructive and always allowed.
- **It is not enforced server-side, deliberately.** `required` stays a browser-level constraint
  on the item form. Enforcing it in the item service would fight the unpack flow, which creates
  drafts with no values at all (`repo.createItem(..., fieldValues: [])`) and would then be
  unsaveable. Drafts publish through `publishAll` without field validation either.
- Turning it on for a type in use strands catalog items: the item form renders `required` on
  the input, so those items cannot be saved until each is filled. That is what "required"
  means, but it must not arrive silently — so the toggle shows an inline warning using
  `fieldValueUsage(...).missing` ("12 items have no value for this field and can't be saved
  until they do"). Informational and non-blocking.

### 10. Dev fixtures

A new `apps/api/scripts/seed.ts`, sibling to `detection-model.ts`:

- an admin user `a@a.com` / `aaaaaaaa` (valid: `password` is `z.string().min(8)`,
  `packages/shared/src/schemas.ts:6`),
- a handful of locations,
- two or three item types with fields, one of which has `required` set,
- ~10 published items carrying values, **including two or three deliberately incompatible with
  a plausible target type**, so the refusal and modal paths are exercisable by hand rather than
  only in tests.

Photos are optional and not needed for this feature.

## Testing

**API**

- The regression that started this: **values survive a field rename, a reorder and a `required`
  toggle.**
- `fitsFieldType` as a table test, both directions, including the browser-matching cases
  (`'120 cm'` not a number, `'2026-13-01'` not a date, `'not a url'` not a url, `'0'` *is* a
  number).
- Retype refused, with the offenders and count reported.
- Acknowledged retype clears the non-fitting values and converts, in one transaction — and a
  `CONFLICT` on a stale count writes **nothing** (assert the values are still there).
- `deletedIds` requires `acknowledgeValueLoss` while values exist; an id from another type is
  `BAD_REQUEST`; a single upsert leaves siblings and their values intact.
- `fieldValueUsage` counts under the non-empty predicate — specifically that a blank field
  (`''`) is not counted, and that `missing` excludes drafts.
- The index migration applies to an existing database.

**Web**

- Inline row ops: editing one row's name does not disturb another's.
- The modal lists offenders with their values and links, caps at 50 with "+ N more", and
  Cancel is inert.
- *Clear N values and convert* sends `clearIncompatible` and the count.
- The `required` toggle shows the `missing` warning only when `missing > 0`.

## To validate in use

- Seed, then rename a field that has values and confirm the values are still there in the item
  form and in search.
- Seed, then retype the deliberately-incompatible field and confirm the modal names the right
  items with the right values, that opening one in a new tab works, that fixing it and
  re-checking shrinks the list, and that *Clear and convert* leaves the form usable.
- Confirm the field *type* being changed to `url` on a field with a non-URL value is refused —
  that case would otherwise produce an item form that cannot be submitted.

## Out of scope

- **Server-side `required` enforcement** — it would make unpack-created drafts unsaveable
  (§9).
- **Reordering in the UI** (no drag handles); `sortOrder` stays API-settable.
- **`valueCount` on the field DTO.** The count only matters at the destructive moment, and
  `fieldValueUsage` covers that.
- **A "`field_id` must belong to the item's type" guard** on the item value-write path. It
  closes a silent-loss door for one extra query per item save; worth doing, deliberately not
  bundled here.
- **Changing `updateItem`'s wholesale `fieldValues` replacement.** Same shape as the bug this
  fixes, but the form submits every field of the selected type, so its blast radius is the
  unvalidated-cross-type case above.
