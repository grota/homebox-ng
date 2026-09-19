# ADR-0008: `Popover` is a new primitive; `Modal` keeps two geometries

**Status:** Accepted (2026-09-19).

## Context

The catalog's batch-edit panels (the add/remove-from-selection criteria, and the mutate panel)
must sit **near the button that opened them** on a desktop viewport, and take the **whole screen**
on a phone. That is a third overlay geometry, and the app has exactly one overlay primitive.

ADR-0002 fixed `Modal` at two geometries, `md` (`w-[min(92vw,64rem)] max-h-[92vh]`, centred) and
`full` (`inset-0`), and its *when to revisit* clause is explicit about what a third consumer means:

> If a third consumer needs a *third* geometry, stop widening `size` and reconsider whether `Modal`
> should take a layout prop, a `className`, or whether the dialog should become a composition of
> smaller pieces.

So the third consumer is not an occasion to widen `Modal` — it is the occasion ADR-0002 named for
*not* widening it. The question is what the third consumer should use instead.

Three properties of the app shape the answer. `@radix-ui/react-popover` is **not installed** —
`apps/web/package.json` carries only `@radix-ui/react-dialog` and `@radix-ui/react-tabs`. There is
**no anchored-panel pattern** in the app: `Tooltip.tsx` is CSS-only (`absolute left-0 top-full`),
`pointer-events-none`, has no dismissal, and does not flip near a viewport edge. And the one
existing full-screen-on-mobile behaviour is a plain `lg:` class switch on the facet `<aside>`
(`ItemsPage.tsx:237-239`), not a primitive.

## Decision

**Add `@radix-ui/react-popover` and a `Popover` primitive in `apps/web/src/ui/`, adopted for its
behaviour exactly as ADR-0001 adopted `react-dialog`. `Modal` is not modified — it keeps two
geometries.**

The primitive takes a trigger and content, adopts Radix for the parts that are expensive to
re-derive (outside-click dismissal, Escape, focus trap and restore, `aria-modal`/`aria-expanded`
wiring), and styles the content responsively itself: an anchored panel from `md` up, `fixed
inset-0` below it. That responsive switch is the app's own, since the base primitive has no opinion
about it.

## Consequences

### Alternatives rejected

- **A third `size` on `Modal`.** Directly against ADR-0002's revisit clause, and it would put an
  anchored geometry and a centred geometry in one component whose positioning is a single class
  string per size — the anchored case needs to track its trigger, which is not a class.
- **Reusing `Modal size="md"` at both viewports.** Free, and `md` is already 92vw×92vh on a phone —
  effectively full screen. Rejected because it loses the whole point of the request: the panel
  belongs *next to* the button, and a centred dialog on a wide window is a different interaction.
- **A hand-rolled CSS anchored panel.** It would re-derive dismissal, Escape, focus trap and focus
  restore by hand. ADR-0001 exists because a hand-rolled overlay shipped `aria-modal` on a plain
  `<div>` with no trap; re-deriving per consumer is how that recurs.
- **Extending `Tooltip`.** It is `pointer-events-none` with no dismissal by design — it is a hint,
  not a surface that holds controls.

### Accepted costs

- **One more dependency**, small and from a family already in use.
- **Two overlay primitives to keep correct**, and therefore two focus-restore implementations. This
  is precisely the duplication ADR-0002 cited as its reason for *not* adding a second dialog — the
  trade is accepted here because the geometries are genuinely different interactions rather than
  two shapes of the same one.
- **The responsive anchored/full-screen switch is ours**, and it is the part with no test coverage
  from upstream. The primitive's tests must cover both viewports.
- **`Modal`'s API is not narrowed** — a future reader still has to know which primitive to reach
  for. The rule is: **a surface that must be dismissed before anything else, or that takes the
  viewport, is a `Modal`; a surface tied to a trigger the user is still looking at is a `Popover`.**

### When to revisit

If a third anchored consumer appears, or if two overlays ever need to be open at once, the
two-primitive split is worth re-examining as a single layering system.

## Related

- ADR-0001 (`0001-web-styling-primitives-and-radix.md`) — adopt-for-behaviour, and the bug that
  motivates it.
- ADR-0002 (`0002-modal-full-viewport-variant.md`) — the two geometries this leaves untouched, and
  the revisit clause it follows.
- Design spec: `docs/superpowers/specs/2026-09-19-catalog-batch-edit-design.md`.
