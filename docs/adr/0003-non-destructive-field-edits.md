# ADR-0003: Item-type field edits are non-destructive; destruction is enumerated and acknowledged

**Status:** Accepted (2026-09-12).

## Context

Editing an item type's custom fields destroyed data, and silently. `replaceTypeFields`
(`apps/api/src/modules/itemTypes/repo.ts:80`) implemented "update the field set" as
`DELETE FROM item_type_fields WHERE item_type_id = ?` followed by re-inserting every field as a
new row. Because `item_custom_field_values.field_id` references those rows with
`onDelete: 'cascade'` (`packages/db/src/schema.ts:74`) and FK enforcement is on
(`packages/db/src/client.ts:19`), the re-insert took every stored value with it.

The trigger was not "changing a field's type" — it was **any** change to the set. Measured on
the real path: a type with `size` and `note` and an item holding `large` and `hello` came back
with `[]` after *adding a third field*, and `[]` again after *renaming one field*. No test
pinned this: `apps/api/test/itemTypes.test.ts` covered create, delete and the admin gate only.

Two further facts shaped the decision. A blank field still writes a row — the item form submits
one entry per field of the selected type using `''` for untouched ones — so "a value row
exists" is not evidence of user data; only a non-empty value is. And the form's failure mode on
a bad value depends on the input type it picks (`ItemForm.tsx:232`): for `url` the browser
blocks submit outright (typeMismatch), while for `number`/`date` the display is blanked while
the old value stays in React state — a silent failure.

So the question was what an edit *should* do. Three shapes were on the table: keep the
replace-and-destroy and warn; let a type change through with a warning when values would no
longer fit; or refuse and enumerate what is in the way.

## Decision

**A field-set edit never destroys a stored value unless the request explicitly acknowledges it,
and the server re-validates that acknowledgment inside the transaction.**

1. **Field identity, with an explicit diff.** `ItemTypeFieldInputSchema` gains an optional
   `id`; an upsert carrying an `id` updates that row in place — same id, so its values survive.
   Entries without an `id` insert. `deletedIds` delete. **Omission never means deletion**: an
   inline "save this row" that sends one upsert must not be able to mean "delete the rest".
2. **Only `fieldType` is gated.** `name`, `sortOrder`, `config`, `required` and adding a field
   are always allowed, because none of them can destroy or invalidate a value. A type change is
   allowed only while every non-empty value of that field **semantically fits** the new type.
3. **A refused type change enumerates the offenders** — item name and current value, each
   linking to the item — so the refusal is a task, not a wall.
4. **Destroying is one request.** The retype request carries `clearIncompatible` plus
   `acknowledgedValueCount`; the server recomputes the non-fitting set inside the transaction,
   refuses with `CONFLICT` if the count moved, and otherwise clears and retypes atomically.
   Deleting a field requires the same shape of acknowledgment (`acknowledgeValueLoss`). The
   count describes **one** field, so a request in which two fields would need clearing is
   refused (`BAD_REQUEST`, "Only one field can be converted at a time") rather than summed: a
   request-level total cannot be satisfied against a modal that showed one field's list.
5. **One compatibility predicate, in `packages/shared`.** It mirrors the browser's constraints,
   since those are what actually break, and it has two callers — the server's gate and the
   web's pre-warning — which must not drift.

## Consequences

### Alternatives rejected

- **Keep the replace, add a confirm to the UI.** The data loss would become deliberate rather
  than accidental, but it stays total: renaming a field in a type with 200 items would offer to
  destroy 200 values, when a rename need not touch a single one.
- **Allow a type change with a warning.** A warning that lets you proceed ships the broken
  state it warned about: an item form that blanks the value (`number`, `date`) or refuses to
  submit (`url`). A warning is the wrong instrument when the outcome is a form that cannot be
  saved.
- **Refuse a type change outright, with deletion as the only way through.** The "safe" rule
  then forces the destructive path for a change that may be entirely lossless — every value
  already a valid URL, say — which is how a guard against data loss becomes its most reliable
  cause.
- **Clear the values in a separate request from the retype.** A failure between the two leaves
  values destroyed *and* the type unchanged: data gone with nothing gained. Likewise, pinning by
  row ids instead of a count would let a value added while the modal was open be cleared without
  ever being shown.
- **Three field-level procedures (add/update/remove) instead of one `updateFields`.** Same
  behaviour, three endpoints, and `sortOrder` left without an owner — ordering is a property of
  the set, not of one field.

### Accepted costs

- **The predicate is coupled to the form's rendering.** `url` must stay `new URL(v)` and `date`
  must stay `YYYY-MM-DD` for as long as those are the input types. If the form gains a real
  checkbox for `boolean` or a new `fieldType`, the predicate changes in the same commit or the
  gate starts lying.
- **`required` remains a UI-level constraint**, unenforced server-side. Enforcing it in the
  item service would fight the unpack flow, which creates drafts with no values at all and
  would then be unsaveable. It is therefore a soft guarantee, and explicitly not a validation
  boundary.
- **A legitimate operation now has a refusal path.** Retyping a field that has data may be
  refused. Mitigated by enumerating the offenders and offering the clear-and-convert action, so
  the user is never without a next step — but it is a new stopping point in a flow that used to
  always succeed.
- **The count pin can cost a re-check.** If a value changes between the modal opening and the
  button being pressed, the retype is refused and the user looks again. That is the intended
  trade: a stale list is cheap, a destroyed value is not.
- **One field per request.** Because the pin is a single count, a request may carry at most one
  field whose values need clearing; retyping two such fields at once is refused and has to be
  split into two requests, each with its own count and its own confirmation. Retyping several
  fields in one request stays allowed while at most one of them strands anything.
- **One more procedure and one more query** (`updateFields`, `fieldValueUsage`) rather than
  folding both into `itemTypes.update`. Chosen because the field set now has its own validation,
  refusal rules and destructive flags; the alternative overloads one procedure's error contract.

### When to revisit

If a third destructive field operation appears, or values become editable in bulk, stop adding
per-operation acknowledgment flags and generalise the mechanism — one shape for "here is what
will be destroyed, confirm it", reused. Two flags is a pattern; three wants a design.

## Related

- Design spec: `docs/superpowers/specs/2026-09-12-item-type-field-editing-design.md`.
- ADR-0002 (`0002-modal-full-viewport-variant.md`) — the `Modal` the offenders dialog reuses.
- `grota/homebox-ng` issue #1 — the `Modal` focus-restore caveat the dialog must respect.
