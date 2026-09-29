# ADR-0013: The card's photo opens the item and its title selects it, and the swap is a user setting

**Status:** Accepted (2026-09-29).

## Context

The **catalog card** is two targets, and until now they were decided in code: an empty overlay
`<label>` covering the whole card toggled the **selection**, and only the name opened the item
(`ItemCard.tsx`). The comment beside it argued the case — "the reverse was tried first and read wrong
in the hand: the body is what you hit while scanning a catalog, and picking things while scanning is
the frequent job (ADR-0010)".

That is a preference, not a fact. One owner reads the card the other way: the photo is what they aim
at when they mean "show me this", and the name is where they put a tick while scanning. Both readings
are defensible and they are cheap to support either way.

## Decision

**`photoOpensItem: boolean` in **user settings**, default `true`.** Checked, the card's photo opens the
**item surface** and its title toggles the **selection**; unchecked, the two swap, which is exactly the
behaviour that shipped first. An item with no photo is unaffected either way — with no photo to click,
the body stays the selection target and the name stays the link.

The drafts and trash cards get no setting: their thumbnails already open something (the surface, the
**trash peek**) and neither page has a title that opens anything, so there is nothing to swap.

## Consequences

- The card now branches on a user setting, and the two branches are not a mirror image: the selection
  target is a `<label for>` in both, but the open target is a real `<Link>` (photo) or a real `<Link>`
  (title) in opposite branches. Keyboard reach follows the setting — the thing that opens is the thing
  that is focusable, and in the checked default the photo becomes the link.
- The card's rationale comment was wrong after this, and was replaced: neither default is self-evident
  once the other exists.
- **Card photo cycling** (wheel over a thumbnail, single-finger swipe, wrapping) and the wrapping
  carousel both shipped with this and are separate decisions, recorded where they are made —
  `photoIndex.ts` and the card components.

## Related

- ADR-0010 (`0010-catalog-selection-and-count-pinned-bulk-edit.md`) — what a **selection** is; silent on
  which part of a card produces one.
- ADR-0005 (`0005-item-surface-is-a-page.md`) — the page the open target leads to.
