# Web styling: primitives, layout and behavior — design

**Status:** Draft for review (2026-09-10)
**Related:** `docs/adr/0001-web-styling-primitives-and-radix.md` (the decision this implements)

## Goal

Make the web UI look designed without replacing the styling stack. The token
system stays; what goes above it changes.

## Evidence

Measured in the running dev server on 2026-09-10 (`light-default` palette), plus
counts across the 29 `.tsx` files in `apps/web/src`:

| Finding | Value |
|---|---|
| Page `<h1>` computed size / weight / margins | `16px` / `400` / `0px 0px` |
| Sign-in button background + border vs. the email input beside it | **identical** (`rgb(255,255,255)` / `rgb(229,231,235)`) |
| `data-theme` set to `light-default`, root `color-scheme` | set to `dark` (bug) |
| `px-2 py-1 border border-border rounded-md bg-surface text-text` occurrences | 36 |
| `px-3 py-1.5 rounded-md border border-border bg-surface text-text` occurrences | 26 |
| `text-red-600` (raw palette, bypasses tokens) occurrences | 5 |
| `text-danger` / `bg-danger` / `text-success` / `surface-raised` / `shadow` | 0 each |
| App-wide ARIA surface | `aria-label` ×2, `aria-expanded` ×2, `aria-modal` ×1 |
| `onKeyDown` / Escape handling / `createPortal` anywhere | none |

Two conclusions. First, an `<h1>` that computes to 16px/400 with zero margins is
not a styling preference — Tailwind Preflight resets heading styles and nothing
re-applies them, so *every* page title in the app is body text. Second, no
button anywhere in the app is visually distinguishable from an input, which is
why there is no sense of hierarchy.

## Design

### 1. Tokens (`apps/web/src/index.css`, `lib/theme/`)

Small, surgical. No new color tokens.

- **Fix `color-scheme`.** Delete `[data-theme] { color-scheme: dark }` — it has
  the same specificity as `:root` and is always applied, so every light palette
  runs dark. `ThemeProvider` sets `root.style.colorScheme = palette.dark ? 'dark' : 'light'`
  instead, taking it from the palette's own `dark` flag, which is already the
  single source of truth.
- **Base typography.** An `@layer base` block giving `h1`/`h2`/`h3` a real scale
  and margins, so pages stop being the place that decides what a title looks
  like. This is the root-cause fix for the `16px/400/0 0` finding.
- **Keep the `system-ui` stack.** It is fast, has no FOUT and costs nothing. A
  custom webfont is a separate decision with a performance budget attached;
  nothing here depends on it.
- **No new tokens for radius or elevation** — Tailwind v4 already ships
  `rounded-*` and `shadow-*`; they were simply never used.
- **Dead-token cleanup.** `--color-surface-raised` gets used (cards). If
  `--color-success` still has no consumer after this work, delete it from the
  registry and all 6 palettes rather than inventing a use for it.

### 2. Primitives (`apps/web/src/ui/`)

A new directory. No new styling dependency.

```ts
// ui/cn.ts — the entire helper. No clsx, no tailwind-merge.
export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')
```

| File | API |
|---|---|
| `Button.tsx` | `variant: 'primary' \| 'secondary' \| 'danger' \| 'ghost'`, `size: 'sm' \| 'md'`. Renders `<button>`. |
| `Field.tsx` | `{ label, htmlFor, required, children }` — owns the `flex flex-col gap-1` wrapper and the `<label>`. |
| `Input.tsx`, `Select.tsx`, `Textarea.tsx` | The element with `inputClass` baked in, props forwarded. |
| `Card.tsx` | `bg-surface border border-border rounded-lg shadow-sm p-4`. |
| `Badge.tsx` | Small pill for tags, facet chips, the photo "Primary" marker. |
| `PageHeader.tsx` | `{ title, actions }` — the page-title row. |

**The hard contract: element semantics do not change.** `Button` renders a real
`<button>`, `Field` a real `<label htmlFor>`, `Input` a real `<input id>`. The 39
unit tests and both e2e specs query by `role` and accessible name, so they must
keep passing without edits. Any primitive that breaks that is wrong.

`danger` is an **outline** variant (border + `text-danger`), not a filled one.
A filled variant would need a `--color-danger-contrast` token added to all 6
palettes for no real gain. `secondary` stays the existing grey box, which
becomes the *non*-primary choice rather than the only one.

### 3. Radix (behavior only)

Two packages now, a third deferred. All styled with the existing tokens:

- `@radix-ui/react-dialog` → `ui/Modal.tsx`, used by `PhotoEditor` — and by
  nothing else. It is **not** used by the delete confirmations, which stay on
  `window.confirm`. `PhotoEditor` currently puts `role="dialog"
  aria-modal="true"` on a plain `<div>` with no focus trap, no Escape handler and
  no focus restore — an `aria-modal` without a trap is worse than omitting it.
- `@radix-ui/react-tabs` → `ui/Tabs.tsx`, used by `AdminPage`, whose tabs
  currently have no `role="tablist"`, no `aria-selected` and no arrow-key
  navigation.
- `@radix-ui/react-select` — **deferred.** Native `<select>` works and is
  accessible; Radix Select is a large component with a portal and a lot of
  behaviour to style. Revisit only if a native select proves inadequate.

Replacing `window.confirm` is **deferred, not rejected.** Two call sites exist
(`ItemDetail.tsx:72`, `:124`). Its real weakness is not mobile — iOS and Android
render it as a native platform alert with proper touch targets, which is arguably
better than a hand-rolled dialog — but that it offers only generic *OK / Cancel*:
no way to label the destructive action, default to Cancel, or style it as danger.
That matters for a destructive action. Deferring means `Modal` is designed
against one real consumer (`PhotoEditor`) instead of two guesses, and swapping
these two call sites later is ~20 lines once the primitive exists.

### 4. Layout (`app/Shell.tsx`)

`<main>` currently has `p-4` and no `max-width`, so on a 1440px display the item
grid stretches edge to edge while forms sit pinned at `max-w-[30rem]`. Add a
centered container (`mx-auto max-w-6xl px-4 py-6` — 1152px, which holds the
4-column item grid at `lg` with room to spare) and give the header a
`bg-surface` treatment so it reads as chrome rather than a hairline.

The page-title row is `PageHeader`, but not every page opens with it: three do
(`ItemsPage`, `ItemDetail`, `AdminPage`, the ones with an actions slot or a tab
row to place). The rest keep a plain `<h1>` and inherit the same visible result
from the base heading scale in `@layer base` (index.css) — which is where the
size, weight and margin live in either case, since `PageHeader`'s own heading
carries no classes. The two are indistinguishable on screen; only the actions
slot differs.

### 5. Page conversion

All pages in one pass, with one checkpoint: convert the first page, show it in
the running dev server, and continue through the rest once it reads right.
Roughly 16 files, mechanical.

## Order of work

Each step is independently shippable and reviewable.

1. Tokens: `color-scheme` fix, base typography, `text-red-600` → `text-danger`.
2. `ui/` primitives: `cn`, `Button`, `Field`, `Input`/`Select`/`Textarea`, `Card`, `Badge`.
3. Convert pages to the primitives (checkpoint after the first).
4. `Shell` container + `PageHeader`.
5. Radix: `Modal` (`PhotoEditor`), `Tabs` (`AdminPage`). Confirmations stay on
   `window.confirm` for now — see §3.

## Testing

- **Primary contract:** the existing 39 unit tests and both e2e specs pass
  **unmodified**. That is the check that semantics survived.
- New: one test per primitive that has real logic (Button variant → class,
  Field → label association, Modal → Escape closes and focus returns).
- No existing test needs editing: the `window.confirm` spies in
  `apps/web/test/itemDetail.test.tsx` stay valid while confirmations remain native.
- Visual: before/after screenshots from the running dev server at 1440px in a
  light and a dark palette.

## Risks

- **Radix Dialog around filerobot.** `PhotoEditor` embeds filerobot's own editor
  UI, which manages its own internal focus. Radix will portal and trap around it.
  Verify Escape and focus restore behave; if they fight, keep filerobot outside
  the trap and wrap only the container.
- **Six palettes × new components.** Every variant must be legible in Dracula and
  Gruvbox, not just the default. Check the `primary` button against
  `--color-accent-contrast` in all 6 before calling it done.
- **Bundle.** Currently 1,308 KB (382 KB gzip) with an existing Vite chunk-size
  warning. Radix dialog + tabs adds ~15–25 KB gzip. A `manualChunks` pass is
  worthwhile but is not part of this work.

## Explicitly not doing

- shadcn/ui's styled layer, or any styled component library — see ADR-0001.
- A custom webfont or a full brand identity.
- Dark-mode-specific component overrides beyond what the tokens already give.
- Converting every native `<select>` to a styled listbox.
