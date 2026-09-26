import { Link } from 'react-router-dom'
import { Badge, Card } from '../../ui'
import { locationPathLabel, type FlatLocation } from '../../lib/locationPath'

// The fields a card reads, mirroring the server's `ItemDto` — the same
// hand-written-mirror convention the locations feature uses for
// `LocationTreeItem`. Naming only what the card uses keeps its contract visible:
// a field added to the DTO does not silently become card content, which is the
// restraint the card is built on (no type, no quantity, no description).
export type ItemCardItem = {
  id: number
  name: string
  locationId: number | null
  location: { id: number; name: string } | null
  images: { thumbPath: string; isPrimary: boolean | null }[]
  tags: { id: number; name: string; color: string | null }[]
  snippet?: string
}

type Props = {
  item: ItemCardItem
  // The location tree as a lookup: the location line is the item's *path*, and
  // the ancestors come from here.
  locationById: Map<number, FlatLocation>
  // The search term, which decides whether the FTS snippet is shown at all.
  searchTerm: string
  selected: boolean
  onSelect: (id: number, next: boolean) => void
}

export function ItemCard({ item, locationById, searchTerm, selected, onSelect }: Props) {
  // The card shows the PRIMARY photo — marking one primary is exactly what that
  // is for (2026-09-04 design: "one marked primary (used as the card image)"),
  // and it is what the drafts and trash rows do. This card was the last place
  // still taking `images[0]`, which had no relationship to the primary at all:
  // the primary became settable in `ac33300` (item detail only, and this page is
  // not in that commit), so the card had been showing a photo the user never
  // chose.
  const photo = item.images.find((image) => image.isPrimary) ?? item.images[0]

  // The location line is the item's whole path, not just the leaf: "shelf A"
  // alone does not say *which* shelf A, and the sidebar navigates the same
  // hierarchy. The tree supplies the ancestors; the DTO's leaf is what is left
  // while it is still loading.
  const locationLabel = locationPathLabel(item.locationId, item.location?.name, locationById)

  // The card is two targets again: the photo opens the item, the title picks it.
  // It was one (ADR-0005) while both halves led to the same page — the title took
  // over the toggle because a 13px box in the footer was the only way to select.
  const hasPhoto = Boolean(photo?.thumbPath)
  // Where the title's `<label>` points. The footer's own label wraps its input and
  // needs no `for`; this is the other end of that association.
  const checkboxId = `select-item-${item.id}`

  const text = (
    <>
      {/* Text, never a link: it is a path, and a nested anchor inside the card's
          link would be invalid HTML and a keyboard trap. Truncated because a path
          is unbounded in width and a card is ~200px; `title` keeps the whole of it
          readable. */}
      {item.location ? (
        <p className="truncate" title={locationLabel} data-testid="item-location">
          {locationLabel}
        </p>
      ) : null}
      {item.tags.map((tag) => (
        <Badge key={tag.id} color={tag.color} className="mr-1">
          {tag.name}
        </Badge>
      ))}
      {searchTerm.trim() && item.snippet ? (
        <p className="mt-2 text-text-muted text-sm" data-testid="item-snippet">
          {item.snippet}
        </p>
      ) : null}
    </>
  )

  return (
    <Card padding="none" className="relative overflow-hidden hover:border-text-muted">
      {/* One link per card, and it **covers** the card rather than wrapping
          anything in it. The card opens the item, so the target is the card body
          — the photo, or the space where a photo would have been.

          Before this, the link wrapped the photo, and (with no photo) the
          path/tag text. That has a hole: an item with no photo, no location and
          no tags put *nothing* in the link, leaving a zero-height anchor and no
          way to open the item from the catalog at all — the only clickable text
          left on such a card is the title, which selects. Moving the link out of
          the content also removes the reason the text had to be rendered inside
          it, and the two cases no longer have to be kept in step.

          It is out of flow, so the card's layout is unchanged; it is empty and
          transparent, so what it covers is unchanged. The two controls that are
          *not* "open the item" — the title's label and the footer's checkbox —
          sit above it with `relative z-20`, and claim their own clicks.

          `z-10` rather than `z-0` is load-bearing. The photo's wrapper below is
          `relative` — it has to be, the "1/2" badge is absolute inside it — and a
          positioned element with `z-index: auto` paints *after* a `z-0` one in
          tree order, so the photo came out on top of the link and swallowed the
          click that was meant to open the item. Only the labels need to beat
          `z-10`, which is why they are `z-20`. */}
      <Link
        to={`/items/${item.id}`}
        aria-label={item.name}
        className="absolute inset-0 z-10"
      />
      <div className="p-3">
        {hasPhoto ? (
          <div className="relative mb-3">
            {/* `aspect-square` rather than a fixed `h-32`: a fixed height is a
                4:1 strip at one column and a 1:1 box at six, so the photo was
                cropped by a different amount at every width. A square is the
                same shape everywhere, and `object-contain` shows the whole photo
                inside it with the mat filling what is left. */}
            <img
              src={'/file/' + photo.thumbPath}
              alt=""
              className="w-full aspect-square object-contain rounded-md bg-black"
            />
            {/* How many photos there are to look at, only when there is more than
                one. It reads "1/" because a card shows the primary, and the
                primary is position 1 of the order the surface uses — so this is
                the number you land on when you open the card. */}
            {item.images.length > 1 && (
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white tabular-nums">
                1/{item.images.length}
              </span>
            )}
          </div>
        ) : null}
        {/* A photoless item has nothing above the title, and the title toggles —
            so the path/tags go up there, where the photo would have been. */}
        {hasPhoto ? null : text}
        <h2 className="mt-0">
          {/* A `<label>`, so the toggle is the browser's own: clicking the name
              activates the checkbox in the footer. No click handler, no second
              focus stop, and it works on a dark card at 200px wide.
              `relative z-20` for the box above: only the name itself comes
              forward, so the space beside it still opens the item. */}
          <label htmlFor={checkboxId} className="relative z-20 cursor-pointer">
            {item.name}
          </label>
        </h2>
        {hasPhoto ? text : null}
      </div>
      {/* The checkbox lives outside the link's path in paint order, not outside
          one in the DOM: it is a sibling the link's box would otherwise sit on
          top of. `relative z-20` lifts the whole row above it, so the footer
          stays the selection target it is meant to be — a checkbox nested inside
          an anchor would be interactive content inside interactive content,
          which is why the two are separate elements at all. */}
      {/* A `<label>` wraps the box, so the whole footer row is the hit target
          rather than a 13px square — clicking a label activates the control it
          contains, and the `aria-label` below still gives it its name. */}
      <label className="relative z-20 flex cursor-pointer items-center border-t border-border px-3 py-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(item.id, event.target.checked)}
          // The title's label is the other hit target for this control, and this
          // is the name both of them announce it by.
          aria-label={`Select ${item.name}`}
        />
      </label>
    </Card>
  )
}
