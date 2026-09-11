# ADR-0002: `Modal` gains a full-viewport size rather than a second dialog or per-consumer Radix

**Status:** Accepted (2026-09-11).

## Context

ADR-0001 §3 recorded that `@radix-ui/react-dialog` was adopted for behaviour only, and that
`Modal` was **designed against one real consumer** (`PhotoEditor`) rather than two guesses —
with the explicit note that extending it was "available now that the primitive exists, but not
done".

The second consumer has arrived: the photo viewer, which needs the opposite of everything
`Modal`'s content box currently is.

| | `Modal` today | What the viewer needs |
|---|---|---|
| Size | centred, `w-[min(92vw,64rem)] max-h-[92vh]` | edge to edge, `inset-0` |
| Overflow | `overflow-auto` | `overflow-hidden` — a pan surface must not scroll |
| Chrome | `rounded-lg border p-4` | none |
| Backdrop clicks | deliberately swallowed (`onPointerDownOutside` → `preventDefault`) | the viewer closes on a background click |

So the trigger ADR-0001 named has fired, and the question is how to serve the second consumer.

## Decision

**Add `size?: 'md' | 'full'` to `Modal`, defaulting to `'md'` such that the default renders the
present box byte-identically.**

The viewer does **not** use Radix's outside-click: a full-viewport dialog has no exposed overlay
for Radix to fire on, so the viewer detects a background click itself by checking the click
target is the container rather than the image. `Modal` therefore needs no dismissal prop.

## Consequences

### Alternatives rejected

- **A second dialog primitive.** It would duplicate the focus trap, Escape handling, focus
  restore and `aria-modal` correctness that ADR-0001 exists to get right — and re-deriving
  those per consumer is precisely how the original bug (`aria-modal` on a plain `<div>` with no
  trap) got in. The tested behaviour lives in one place today.
- **Per-consumer Radix `Dialog` in the viewer.** Same duplication, plus two independent
  focus-restore implementations to keep correct.
- **Overriding `Modal`'s classes at the call site.** `Modal` accepts no `className`, and
  `cn` cannot resolve same-property conflicts (it is a plain join) — a caller's `inset-0` would
  lose to the primitive's positioning on scale order. This is the same trap that forced `Card`
  to grow a `padding` prop, and the answer is the same: a prop, not a class.

### Accepted costs

- **`Modal`'s API widens** for a consumer it was not designed for. Mitigated by the default
  being unchanged: the existing tests pass unmodified, which is what demonstrates it.
- **Two visual modes in one primitive**, so a future reader must check `size` to know which
  layout applies. The alternative — one mode per primitive — trades that for duplicated
  behaviour, which is the worse of the two.
- **The full-viewport case is not covered by the existing `Modal` tests.** The viewer's own
  tests must cover it, and the primitive's tests continue to pin `md`.

### When to revisit

If a third consumer needs a *third* geometry, stop widening `size` and reconsider whether
`Modal` should take a layout prop, a `className`, or whether the dialog should become a
composition of smaller pieces. Two geometries is a variant; three is a design that wants
decomposing.

## Related

- ADR-0001 (`0001-web-styling-primitives-and-radix.md`) §3 — the one-consumer decision this
  supersedes, and the behaviour `Modal` exists to provide.
- Design spec: `docs/superpowers/specs/2026-09-11-photo-viewer-and-bulk-discard-design.md`.
