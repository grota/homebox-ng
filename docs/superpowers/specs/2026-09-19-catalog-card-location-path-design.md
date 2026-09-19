# The card shows the item's location path — design

**Date:** 2026-09-19 · **Related:** `2026-09-19-location-facet-tree-design.md` (the same hierarchy,
in the sidebar), `2026-09-19-catalog-batch-edit-design.md` (which restructures this same card).

*The `file:line` references were accurate when this was written. **The symbol names are the durable
anchor** — `ItemsPage`, `flattenLocations`, `LocationRefDto`, `locations.list` — and grepping for one
is how to read a citation that no longer lands.*

## Problem

**A catalog card shows only the leaf name of its location, so two items in different rooms of the
same name are indistinguishable.**

The card renders `item.location?.name` (`ItemsPage.tsx:411`) directly below the item name — a single
`<p>` with a `LocationRefDto`'s `name` and nothing else (`items/service.ts:16`). An item in
`home / garage / shelf A` reads `shelf A`; so does an item in `shed / shelf A`. The card was built
when the location line was a hint, and the hierarchy has since become the main way the catalog is
navigated — the facet sidebar drills into it, and the item panel shows the leaf only.

## Facts this design rests on

- **The card already has the slot.** `ItemsPage.tsx:411` renders the location below the name, inside
  the card's single `<Link>` (`:384`). There is nothing to add to the markup — only to what the
  expression produces.
- **The API gives no path, and does not need to.** `LocationRefDto` is `{ id, name }`
  (`items/service.ts:16`). But the page **already fetches the full location tree**
  (`trpc.locations.list.useQuery()`, `ItemsPage.tsx:99`) and already flattens it into an id-keyed map
  (`flattenLocations`, `:39-44`), then **already walks `parentId` up to the root** to build the
  breadcrumb (`:101-106`). The path for any location id is therefore computable today, from data
  already in the cache, with **no API change, no migration and no DTO change**.
- **The path walk must be cycle-tolerant.** The data model permits a cyclic `parent_id` chain — the
  facet CTEs guard against it with `UNION` rather than `UNION ALL` (`repo.ts:181-204`), and
  `computeDepth` throws on one (`locations/service.ts:34-58`). The client-side walk needs the same
  guard, or a cycle becomes an infinite loop in a render.
- **Depth is capped at 8** (`LOCATION_DEPTH_MAX`, `locations/service.ts:11`), so a path is short —
  but names are free text, so the rendered string is not bounded in width.
- **The card is one `<Link>` wrapping everything** (`ItemsPage.tsx:384`), and tests click the card to
  navigate to the item (`apps/web/test/catalogCard.test.tsx:125-131`). Anything added inside it must
  not be independently interactive.
- **The card is also asserted to *not* show** type, quantity or description
  (`catalogCard.test.tsx:94-103`) — the card's restraint is deliberate, so this change fills an
  existing line rather than adding a new one.

## Design

**One line changes: `item.location?.name` becomes the joined path.**

```
home › garage › shelf A
```

- **The separator is `›`**, matching the one the items page already uses between location chips
  (`ItemsPage.tsx:333`). A tree is also being built in this work that renders the same hierarchy —
  the two must not use different separators for the same concept.
- **Omitted entirely when the item has no location**, like today's optional `item.location?.name`
  renders nothing.
- **Plain text, not a link.** The whole card is one `<Link>`; a nested link is invalid HTML and a
  keyboard trap, and clicking the path would have to mean "filter by this location", which is a
  second behaviour on a card whose first behaviour is "open this item". The sidebar is where you
  filter by location.
- **One line, truncated, with the full path in `title`.** `truncate` on the `<p>`, since names are
  unbounded and the card is ~200px wide. The path is the item's *context*, not its identity — the
  name above it is the thing being read, and a path that wraps to three lines would push the tags
  and the photo out of the card's rhythm.
- **A shared helper, not an inline walk.** The path-from-a-flattened-map computation is now wanted in
  two places — the card, and whatever remains of the breadcrumb logic after the facet tree lands.
  It goes next to `flattenLocations` (`ItemsPage.tsx:39`) or into the shared lib, cycle-guarded, and
  the breadcrumb's inline walk (`:101-106`) is replaced by it.

**Not done:** a click-to-filter affordance on the path, an icon, a tooltip, and a path column in the
drafts or trash lists. The last one is the only one that may be genuinely missed — a drafts card has
the same information gap — and it is left until the draft page's own rework (see the batch-edit
spec's follow-ups).

## Testing

**Web (`apps/web/test/catalogCard.test.tsx`)**:

- a leaf location renders as its full path, `A › B › C`;
- an item whose location is a root renders just the root name, with no separator;
- an item with **no** location renders no location line (not an empty paragraph, not a stray
  separator);
- a location inside a cyclic `parent_id` chain renders a bounded path instead of hanging;
- a path longer than the card truncates, with the full text in `title`;
- the path is **not** a link and does not stop the card's click from opening the item — the existing
  click-to-navigate assertion (`:125-131`) must still pass unchanged, which is the evidence this
  stayed inside the link safely.

## What does NOT change

- **`ItemDto` and `LocationRefDto`.** No API change at all — the path is derived from
  `locations.list`, which the page already has.
- **The item panel** (`ItemPanel.tsx:81`), which deliberately shows the leaf name of the location
  with the rest of the item's own field values. Reading an item *in context* now happens on the
  card; the panel describes the item itself.
- **The photo, the name, the tags, the snippet, and the card's deliberate omission of type,
  quantity and description.**
- **`items_fts.location_path`**, which stays a space-joined string for search matching. The card's
  path is display, the index's is a search token — same hierarchy, different jobs, and joining them
  would be a mistake.

## Open, deliberately

- **Whether the separator should be `›` or `> `.** `›` matches the existing chip breadcrumb; the
  request was written as `A > B > C`. Going with `›` for internal consistency — trivial to change,
  and worth a single check against the app once it renders.
- **Whether a long path is better truncated in the middle** (keeping the leaf, which is the
  identifying part) rather than the end. End-truncation keeps the root and loses the leaf, which is
  the worse half to lose. Left as-is because a 200px card with a three-level path will rarely
  truncate in practice; revisit if it does.
- **Whether the drafts and trash cards follow.** Yes, eventually — same gap, and the component
  extracted in this work makes it cheap. Not now.
