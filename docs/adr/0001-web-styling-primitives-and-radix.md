# ADR-0001: Styling primitives on Tailwind tokens, Radix for behavior, no shadcn

**Status:** Accepted (2026-09-10). Revisit conditions in "When to revisit" below.

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
`@radix-ui/react-dialog` for `PhotoEditor` and `UnpackModal`, `@radix-ui/react-tabs` for
`AdminPage`. Radix ships unstyled by design, so the token system and all 6 palettes are
untouched, and focus trapping, Escape handling, focus restore, roving tabindex and correct
ARIA come for free. Three packages, not a framework.

**4. Do not adopt shadcn/ui's styled layer.** Deferred, not rejected on principle — see
Consequences for the specific costs and the revisit trigger.

**5. Fix the `color-scheme` bug and rewire the dead tokens** regardless of the above:
replace the 5 `text-red-600` with `text-danger`, use `surface-raised` + elevation for
cards, add hover/active states, use `text-success` where a positive state exists.

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

- Three new dependencies (`@radix-ui/react-dialog`, `@radix-ui/react-tabs`, and later
  `@radix-ui/react-select`). Roughly 15–25 KB gzip for the primitives actually used.
- The bundle is already 1,308 KB (382 KB gzip) and Vite warns about chunk size. This is
  pre-existing; a `manualChunks` pass is worth doing independently of this ADR.
- The 6 palettes need `--color-danger`/`--color-success` to be *used* to be meaningful. If
  they stay dead, palette switching remains mostly a background-color change.

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
