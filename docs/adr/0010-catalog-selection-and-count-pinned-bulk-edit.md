# ADR-0010: A catalog selection is an id set, and a bulk mutation is count-pinned

**Status:** Accepted (2026-09-19).

## Context

The drafts page has selection, and it made two decisions on purpose, both documented in its own
comments: selection is **page-scoped** (`DraftsPage.tsx:76` clears it on page change, with the
rationale "Selection is page-scoped… would be the same hazard with more reach" at `:72-75`), and
whole-dataset operations are a **separate verb pair** sending `{}` rather than a checkbox that spans
pages (`:154-169`). In both of those verbs, an **omitted or empty** id array means *every* draft
(`apps/api/src/modules/drafts/service.ts:22-25, 42-48`).

The catalog wants the opposite of the first decision: *select all* must mean everything the current
search and filters match, not the twenty rows on screen. That is the whole point of the feature — a
bulk retag or relocation of 300 items is the task, and doing it 20 rows at a time is not the task.

The second thing this decision inherits is ADR-0003's closing instruction. Its *when to revisit*
clause reads:

> If a third destructive field operation appears, or values become editable in bulk, stop adding
> per-operation acknowledgment flags and generalise the mechanism — one shape for "here is what will
> be destroyed, confirm it", reused.

Bulk-editing custom-field values across a selection is exactly that case. ADR-0003 built
`acknowledgedValueCount`: the request carries the count the user was shown, the server re-derives it
immediately before writing, and refuses with `CONFLICT` if it moved — with the comparison made
before the transaction, so a refusal writes nothing.

A catalog selection has *more* reach than the single-field case that mechanism was built for, not
less: the set is chosen from a view the user then navigates away from, it can hold hundreds of ids,
and the mutation is a write rather than a publish. The stale-view hazard is larger, so the
acknowledgment has to be at least as strong.

## Decision

**A selection is a set of catalog item ids, independent of the view; a bulk mutation takes those ids
explicitly and is count-pinned.**

1. **Selection is a `Set<number>` of catalog item ids.** It survives changes to the search term,
   the filters and the page — an id set is not a view — and it is lost on reload or on leaving the
   page. It is not persisted in the URL.
2. **"Select all" means everything the current search and filters match**, resolved server-side, and
   the control says so ("Select all 47 matching") rather than "Select all". The whole catalog is
   still reachable: clear the filters, then select all.
3. **The mutation takes explicit ids and rejects an empty list.** It does **not** inherit the drafts
   convention where empty means everything: a checkbox UI that can produce an empty array and a verb
   that reads it as "the whole catalog" is one click from rewriting everything. A whole-catalog
   operation, if ever wanted, gets its own named verb.
4. **The catalog predicate governs resolution.** Ids are resolved through the same
   `published AND not trashed` base every facet count composes through, at the moment the modal
   computes what it shows *and* at the moment of the write. So a trashed item is neither silently
   written nor silently dropped — it is simply not in the count the user was shown. "Silently
   skipping" is not a separate behaviour, and adopting it would contradict the pin below.
5. **The write is count-pinned.** The request carries the target item count and the per-property
   overwrite counts that the modal displayed; the server re-derives both immediately before writing
   and refuses with `CONFLICT` if either moved. The comparison precedes the transaction.

## Consequences

### Alternatives rejected

- **Selection as predicate clauses** (include/exclude clauses evaluated per card). Scales without
  bound, but makes "is this card checked?" a computed property, requires the client to carry the
  fields the clause tests, and turns union-then-subtract into a small logic problem of its own. At
  household scale an id set is both simpler and exactly accurate.
- **Page-scoped selection, following the drafts precedent.** Would not deliver the requested
  feature: "all items, not just the ones on the page" is the requirement.
- **Empty ids meaning all items, copying `idsInput`.** Rejected for the reason in §3 — the drafts
  verbs are driven by buttons that say "Every draft:", which is where that convention belongs.
- **Skipping ids that are no longer catalog items.** Silent divergence between the count shown and
  the count written, and it defeats the pin: the user is told 400 will change and 399 do.
- **No pin, because the user typed the new value on purpose.** The intent argument covers *what* is
  written, not *how many*. The count is the only thing that can move without the user acting, and it
  is the thing the modal claims to know.
- **An undo stack.** The honest fix for a bulk overwrite, and a much bigger feature: it needs a
  change log to reverse against. Out of scope, and recorded here as an accepted cost rather than
  quietly omitted.

### Accepted costs

- **A documented drafts-page decision is reversed for the catalog.** The drafts page keeps its
  page-scoped behaviour until it adopts the shared selection (a deliberate follow-up, not this
  work), so the app has two selection models in the interim.
- **A latent drafts-page hazard is now carried further.** Ids are never pruned when the list
  refetches, so a set can hold ids that have been trashed, moved or published since. It is cosmetic
  on the drafts page; with mutating reach the predicate in §4 is what keeps it correct, and it is
  load-bearing rather than defensive.
- **ADR-0003's "two flags is a pattern; three wants a design" now fires one operation early.** The
  mechanism is generalised while there are two destructive bulk-capable operations rather than
  three, because the bulk case is a superset of the field-retype case rather than a sibling.
- **A refusal path on a flow that could always succeed.** Retagging 300 items can be refused if the
  catalog moved while the modal was open, and the user looks again. Intended trade, matching
  ADR-0003's.
- **An unbounded set size.** Nothing caps how many ids a selection may hold. Bounded at household
  scale (hundreds, low thousands); a cap would have to be chosen against a real catalog.
- **No undo for a bulk overwrite.** Mitigated by the count in the modal and the pin behind it, which
  make the operation deliberate but not reversible.

### When to revisit

If a third bulk-destructive operation appears, or if undo is seriously wanted, both point at the
same answer: a change log. That is the point at which "one shape for *here is what will be
destroyed*, confirm it" stops being sufficient and reversal has to be designed.

## Related

- ADR-0003 (`0003-non-destructive-field-edits.md`) — `acknowledgedValueCount`, the mechanism this
  generalises, and the revisit clause that asked for it.
- ADR-0004 (`0004-trash-and-recoverable-deletion.md`) — the recoverability model bulk edits do not
  have.
- ADR-0008 (`0008-popover-primitive-for-anchored-panels.md`) — the panels these selections are made
  and applied in.
- Design spec: `docs/superpowers/specs/2026-09-19-catalog-batch-edit-design.md`.
