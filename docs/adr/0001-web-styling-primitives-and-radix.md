# ADR-0001: Styling primitives on Tailwind tokens, Radix for behavior, no shadcn

**Status:** Accepted (2026-09-10), **amended by ADR-0002** (2026-09-11) — `Modal` gained a
full-viewport size for a second consumer, so the one-consumer decision below is superseded.
Otherwise as accepted; revisit conditions in "When to revisit" below.

## Context

The web UI reads as unstyled despite a sound token layer. Investigation (2026-09-10)
found the cause is not the CSS framework but what sits above it:

- **Tailwind CSS v4** via `@tailwindcss/vite`, configured CSS-first in
  `apps/web/src/index.css` (`@theme`). There is no `tailwind.config.js`.
- **The token layer is correct and worth keeping.** 11 semantic tokens
  (`--color-bg`, `--color-surface`, `--color-text`, `--color-border`, `--color-accent`,
  `--color-danger`, …) with 6 curated palettes (Homebox Light/Dark, Catppuccin Latte,
  Nord, Dracula, Gruvbox). `ThemeProvider` applies the active palette by writing the
  variables inline on `document.documentElement` and setting `data-theme`.
- **Half the tokens are dead.** Measured across 29 `.tsx` files:
  `surface-raised` 0 uses, `text-danger`/`bg-danger` 0, `text-success` 0, `shadow` 0 —
  while `text-red-600` (raw Tailwind palette, bypassing tokens) appears 5 times. The
  palettes therefore do not affect destructive actions at all.
- **No primitives layer.** `px-2 py-1 border border-border rounded-md bg-surface text-text`
  is repeated 36 times and `px-3 py-1.5 rounded-md border border-border bg-surface text-text`
  26 times across 16 files. No `cn()`/clsx/cva helper exists. Every button — sign in, save,
  delete, nav — is the same grey outlined box; the app has no primary action anywhere.
- **No layout container and no type scale.** `Shell.tsx` is a bordered header plus
  `<main className="p-4">` with no `max-width`. `body` uses the stock `system-ui` stack;
  headings receive no treatment.
- **No accessible interaction primitives.** App-wide ARIA is `aria-label` ×2,
  `aria-expanded` ×2, `aria-modal` ×1. `PhotoEditor` puts `role="dialog" aria-modal="true"`
  on a plain `<div>` with no focus trap, no Escape handler and no focus restore — an
  `aria-modal` without a trap tells assistive tech the page is inert while it remains
  tabbable. `AdminPage` tabs have no `role="tablist"`/`aria-selected`/arrow-key navigation.
  `UnpackModal` has no dialog semantics. There is no `createPortal`, `onKeyDown` or Escape
  handling anywhere in the codebase.
- **One real bug:** `index.css` has `:root { color-scheme: light }` followed by
  `[data-theme] { color-scheme: dark }`. Equal specificity, later rule wins, and
  `ThemeProvider` sets `data-theme` unconditionally — so every *light* palette runs with
  dark `color-scheme`, darkening native selects, scrollbars and date pickers.

A component library (shadcn/ui) was evaluated as an alternative to building primitives.

## Decision

**1. Keep the existing token system.** It is the right architecture; the gap is above it,
not in it.

**2. Build a primitives layer over the tokens** (`apps/web/src/ui/`): `Button`
(`primary`/`secondary`/`danger`/`ghost`), `Field` + `Input`/`Select`/`Textarea`, `Card`,
`Badge`. No new styling dependency — the class strings already exist, they move into one
place. This is where the perceived improvement comes from: introducing a *primary* variant
gives the app a visual hierarchy it currently has zero of.

**3. Use Radix primitives (headless) for behavior**, styled with the existing tokens:
`@radix-ui/react-dialog` for `PhotoEditor`, `@radix-ui/react-tabs` for `AdminPage`. Radix
ships unstyled by design, so the token system and all 6 palettes are untouched, and focus
trapping, Escape handling, focus restore, roving tabindex and correct ARIA come for free.
Two packages, not a framework.

`PhotoEditor` was `Modal`'s only consumer when this was written — the primitive was designed
against one real consumer rather than two guesses. That held until the photo viewer arrived,
which ADR-0002 answered by widening `Modal` with a full-viewport `size` rather than adding a
second primitive. `UnpackModal` still has no dialog semantics: it is a `Card`, and extending
`Modal` to it remains available-but-undone. Nor does `Modal` serve the delete confirmations —
those are still `window.confirm` (`ItemDetail.tsx:83`, `:148`); replacing them is deferred
(design spec §3).

**4. Do not adopt shadcn/ui's styled layer.** Deferred, not rejected on principle — see
Consequences for the specific costs and the revisit trigger.

**5. Fix the `color-scheme` bug and rewire the dead tokens** regardless of the above:
replace the 5 `text-red-600` with `text-danger`, use `surface-raised` + elevation for
cards, add hover/active states. `--color-success` had no consumer after the conversion and
no page needed one, so it was deleted rather than invented into a use.

**6. Add a content container and page-header pattern to `Shell.tsx`.**

## Consequences

### Why not shadcn/ui

Its color mechanism is architecturally the *same* as ours (CSS variables in `:root`,
mapped through `@theme inline`), so the usual "it would fight our theming" objection does
not apply. It was rejected for these specific, verified reasons:

- **`--accent` means the opposite thing.** In shadcn `--accent` is a muted grey *hover*
  surface and the brand color is `--primary`. Here `--accent` **is** the brand color
  (`#2563eb`), already used for the active nav link and the selected facet chip. Mapping
  shadcn's `--accent` to ours turns every hover state bright blue; mapping it to a grey
  creates two conflicting meanings for one name.
- **shadcn is binary dark/light and we have 6 palettes.** It uses a `.dark` class with
  `@custom-variant dark (&:is(.dark *))`; we use `data-theme="<palette-id>"` with three
  light and three dark palettes chosen independently. Adaptable
  (`root.classList.toggle('dark', palette.dark)`), but it is an adapter we would own
  permanently.
- **It needs ~10 tokens we don't have** (`--card`, `--popover`, `--secondary`, `--muted`,
  `--ring`, `--input`, `--destructive`, …), defaulting to neutral greys that are wrong for
  Dracula, Gruvbox, Nord and Catppuccin. Filling them in is ~10 curated values × 6 palettes
  of design work — re-theming the thing that was supposed to save that effort.
- **The overlap is the part we're already building.** `Button`/`Input`/`Card` *are* shadcn's
  components minus styling, and they are the same ~62 call sites either way. Building them
  on Radix captures the behavioral dividend without the styling cost.

### Accepted costs

- Two new dependencies (`@radix-ui/react-dialog`, `@radix-ui/react-tabs`; a third,
  `@radix-ui/react-select`, is deferred). Roughly 15–25 KB gzip for the primitives
  actually used.
- The bundle is already 1,308 KB (382 KB gzip) and Vite warns about chunk size. This is
  pre-existing; a `manualChunks` pass was done in `4dca4be`, which splits the editor for
  caching but does not reduce the initial payload (the 500 kB warning persists) — deferring
  it needs a lazy `import()`.
- The 6 palettes need `--color-danger` to be *used* to be meaningful. If it stays dead,
  palette switching remains mostly a background-color change. (`--color-success` did stay
  dead and was deleted — see §5 of the Decision.)

### Accepted costs: accessibility

Measured, not estimated, at the end of this work. These are deliberate trades, recorded so
they are not rediscovered as bugs.

- **Two palettes keep a sub-AA primary label.** The `primary` variant's label sits at
  3.50:1 in `light-nord` and 3.48:1 in `dark-gruvbox`, below WCAG AA's 4.5:1. Accepted:
  re-hueing a third-party palette's accent to fix our button stops it being that palette.
  `dark-default` measured 3.68:1 and *was* fixed (→ 5.17:1), at the owner's request, because
  it is our own palette and not a borrowed one.
- **`danger` became harder to read on four of six palettes.** `text-danger` on `surface`
  measures 3.36:1 (`light-nord`), 3.82:1 (`dark-gruvbox`), 4.13:1 (`dark-default`) and
  4.46:1 (`light-catppuccin`). The hardcoded `text-red-600` on white it replaced passed at
  4.83:1 — so a destructive action's label lost contrast in most palettes. This is the cost
  of choosing an outline `danger` variant over adding a `--color-danger-contrast` token to
  all six palettes for one variant. Known and accepted; the revisit trigger is a filled
  `danger` variant actually being wanted.
- **Escape while typing a text annotation closes the photo editor.** "Escape closes the
  modal" is required behaviour and Radix listens in the capture phase, ahead of filerobot's
  text tool, so the annotation is lost with the editor. Adjudicated in Task 8: the modal
  contract wins. The alternative — letting the text tool swallow the first Escape — makes
  Escape's behaviour depend on which sub-control has focus.

### Accepted costs: the modal guarantee and third-party portals

Adopting Radix's `Dialog` bought a real modal contract: while it is open, Radix clamps
`pointer-events` on `<body>` and re-enables it only for its own content subtree, so nothing
behind the dialog can be clicked. It pairs with the `aria-hidden` Radix applies to siblings.

That guarantee assumes the dialog's DOM contains everything belonging to it. The image editor
breaks the assumption. Filerobot's popovers — the pen menus, the stroke slider, the "discard
changes?" confirm — are rendered by `@scaleflex/ui`, which does `createPortal(render(),
document.body)` into two hosts it appends to `<body>`: **`#SfxPopper`** and **`#SfxPopup`**.
Visually inside the dialog, structurally outside it. Every control in them was inert:
visible, unclickable, unfocusable.

**Decision: one global rule re-enables pointer events for `body`-level portals.**

```css
:where(body > :not(#root)) {
  pointer-events: auto;
}
```

In `index.css`. `:where()` gives it zero specificity, so it fills a gap no other rule declares
and any explicit `pointer-events` — our own `pointer-events-none` utilities included — still
wins. `#root` is excluded, so **the app itself stays inert**: no control behind the dialog
becomes clickable. The relaxation reaches only elements a library portals to `<body>`.

**Alternatives evaluated and rejected:**

- **Retarget the portal into the dialog's content.** Not reachable. `usePortal(id)` in
  `@scaleflex/ui` takes only an id and unconditionally appends to `document.body`; `Popper`
  has a `disablePortal` prop but filerobot uses it only for a `Drawer`, never the pen menus;
  `Popup` has no `disablePortal` at all. It would also trade inertness for **clipping** —
  `Modal`'s content is `overflow-auto`, and portalling to `<body>` is precisely what lets a
  popover escape that. Not a shortcut in the library; the point of it.
- **Name the two hosts** (`#SfxPopper, #SfxPopup`). Precisely scoped, but pinned to
  `@scaleflex/ui@2.10.27`'s internal naming. A version bump that renames them **silently
  resurrects the bug**, and no test can catch it — the committed regression test pins the CSS
  cascade, since jsdom cannot hit-test. A rule that fails loudly outranks one that fails
  silently.

**The breadth is latent, not active.** Outside a modal, `body` carries no clamp, so the rule
is a no-op. It acts only while a dialog is open, and in that window the only `body` portals
here are those two hosts — so today it behaves identically to the named version. The
difference is only what a future dependency might portal.

**When to revisit:** a dependency portalling something that must stay inert while a modal is
open. That, not the rule's existence, is the trigger to narrow it. Note also that `usePortal`
never removes its host — its cleanup checks `childNodes.length === -1`, never true, a typo for
`=== 0` — so the hosts persist as empty divs after the editor closes, and a rule naming them
would apply to a permanently-present element rather than only during editing.

### When to revisit

Adopt shadcn (or another styled library) for a **specific component whose design we do not
want to do** — a data table, a combobox, a date-range picker. That is where hand-rolling
stops being cheap and where the theming cost is finally worth paying. For a button, it is
not.

Revisit this ADR if: the primitives layer grows past what a few shared files can hold; a
7th palette makes the per-palette token burden untenable; or the Radix dependency proves to
be more maintenance than the behavior is worth.

## Related

- `CONTEXT.md` — domain glossary (this ADR introduces no new domain terms).
- Investigation evidence gathered 2026-09-10; all counts above are measured, not estimated.
