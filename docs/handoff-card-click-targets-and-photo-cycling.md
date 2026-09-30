# Handoff: card click targets, card photo cycling, and the wrapping carousel

**Status:** complete and committed. `7799f8a` on `main`, unmerged. All suites green at time
of writing: 425 web unit, 290 package unit (shared + db + api), 19 Playwright e2e, `tsc
--noEmit` clean on `apps/web`.

**Do not re-derive the requirements from this file.** The authoritative sources are the
commit `7799f8a`, the decision record `docs/adr/0013-card-click-targets-are-a-user-setting.md`,
and the glossary entries this work added to `CONTEXT.md` (**card click target**, **card
photo cycling**, **trash peek**, plus the `photoOpensItem` row under **user settings**). This
document exists to route a fresh agent, not to restate the design.

## Where the code lives

| Concern | Path |
| --- | --- |
| The setting, wire schema and default | `packages/shared/src/settings.ts` |
| The column and its migration | `packages/db/src/schema.ts`, `packages/db/drizzle/0012_ambitious_blue_shield.sql` |
| Round-trip through the API | `apps/api/src/modules/settings/{repo,service}.ts` |
| The setting's checkbox | `apps/web/src/features/settings/SettingsPage.tsx`, label in `apps/web/src/locales/en/translation.json` |
| Carousel wrap, card cycling hook | `apps/web/src/lib/photoIndex.ts` |
| The three cards that cycle | `apps/web/src/features/items/ItemCard.tsx`, `.../drafts/DraftsPage.tsx` (`DraftCard`), `.../trash/TrashPage.tsx` (`TrashCard`) |
| The surface bar and its badge | `apps/web/src/features/items/ItemDetail.tsx` |

## Non-obvious things a fresh agent will get wrong

- **`DraftCard` and `TrashCard` are separate components, not inline in the page body's
  `.map`.** Cycling is per-card state, so it cannot live in a map. Do not inline them back.
- **The wheel listener on a card is attached natively and non-passively.** React's own
  `onWheel` is passive and a passive listener cannot `preventDefault`, which is what stops a
  horizontal notch from being browser history navigation. It is a `useState`-held node plus a
  callback ref, not a ref object — the first effect run has to see a real node.
- **The catalogue card's photo wrapper gets `z-20` only while the photo is the link.** With
  the setting off it must fall *below* the `z-10` overlay label, or it swallows every
  selection click. This was a real bug caught in review.
- **There is deliberately no `pointerup` handler** in the cycling hook. The browser fires
  `click` *after* `pointerup`; clearing the swipe flag there clears it before the click it
  exists to cancel, and a swipe would also open the item.
- **The `Primary` badge shows only when there is more than one photo** (surface and trash
  peek alike — with a single photo there is nothing to distinguish). It reads `Primary` from
  `sm` up and a labelled `★` below it, so the narrow bar never pays for the word.
- **`usePhotoIndex` grew a `startIndex` third parameter** for the trash peek, which must open
  on whatever photo its card was showing.
- **The `Primary` badge in the surface bar is `absolute left-full`** inside a `relative`
  wrapper. It is out of the flow on purpose: in the flow it widens the centred run and shoves
  the counter left, so the arrows sat in one place on the primary photo and another elsewhere.

## Open questions the user has not yet answered

1. **Arrow keys on the item surface do not cycle photos, deliberately.** `PhotoViewer.tsx`
   claims `ArrowLeft/Right/Up/Down` for panning with `preventDefault()`; the surface uses
   `PageUp`/`PageDown` for stepping. The user reported this as "not able to cycle with the
   arrow keys" and it was explained, not fixed. If they ask for it, the natural split is
   arrows-pan-when-zoomed / arrows-cycle-when-fit — but that takes panning away from the
   viewer for the fit case, so confirm before doing it.
2. **Card cycling is pointer-only when the setting is off.** With `photoOpensItem` false the
   thumbnail is not focusable, so there is no element to hang a keydown on. Skipped rather
   than adding `tabIndex={0}` to a non-interactive element (WCAG 2.4.3). Recorded in ADR-0013's
   consequences. Revisit only if asked.
3. **The surface badge could collide with Close on a very narrow bar.** The e2e pins the
   current geometry; if the bar ever wraps on mobile, that assertion is the tripwire.

## Verification that must not be dropped

`apps/web/e2e/cardPhotos.spec.ts` exists because jsdom has no layout, no wheel dispatch and no
paint order. It is the only place these can be checked: wheel stepping and wrapping,
vertical-notch pass-through, a drag not navigating, the setting swap, and the counter's `x`
staying within 1px across primary → non-primary → wrapped. There is a matching unit test
(`apps/web/test/cardPhotoCycling.test.tsx`) but it is deliberately a weaker structural claim.

If any of this is refactored, `pnpm test:e2e` is the gate, not `pnpm vitest run`.
