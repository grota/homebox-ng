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

  // The card is two targets: the **card body picks the item, the title opens
  // it**. The reverse was tried first and read wrong in the hand — the body is
  // what you hit while scanning a catalog, and picking things while scanning is
  // the frequent job (ADR-0010); opening one is the deliberate one, and the
  // title is the part that names what it opens. It was a single link (ADR-0005)
  // while both halves led to the same page.
  const hasPhoto = Boolean(photo?.thumbPath)
  // The two ends of the toggle: the overlay label below, and the footer's own
  // label, which wraps the input and needs no `for`.
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
    <Card
      padding="none"
      data-testid="item-card"
      className="relative overflow-hidden hover:border-text-muted"
    >
      {/* One toggle per card, and it **covers** the card rather than wrapping
          anything in it: the body is the target, so the photo, the path, the
          tags, the blank space under a short card and the footer row all pick
          the item. The title opts out with a higher z-index, and opens it.

          Empty and absolutely positioned, so the card's layout is what it was
          with no overlay at all. An empty `<label for>` is legal and activates
          the footer's checkbox through the browser, the same way the footer's
          own label does — no click handler, and no second focus stop.

          `z-10` rather than `z-0` is load-bearing. The photo's wrapper below is
          `relative` — it has to be, the "1/2" badge is absolute inside it — and a
          positioned element with `z-index: auto` paints *after* a `z-0` one in
          tree order, so the photo came out on top of the overlay and took the
          click for itself. The title is `z-20` to beat the overlay. */}
      <label htmlFor={checkboxId} className="absolute inset-0 z-10 cursor-pointer" />
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
        {/* A photoless item has nothing above the title, so the path/tags go up
            there, where the photo would have been. */}
        {hasPhoto ? null : text}
        <h2 className="mt-0">
          {/* The one thing on the card that opens the item. A real link with the
              name as its text, so it is a text link to a screen reader and to
              every "open in new tab" the browser offers — which the overlay
              cannot be, having no content of its own. `relative z-20` lifts just
              the name: the space beside it still picks the item. */}
          <Link to={`/items/${item.id}`} className="relative z-20">
            {item.name}
          </Link>
        </h2>
        {hasPhoto ? text : null}
      </div>
      {/* The checkbox is a sibling of the overlay, not inside it, and the overlay
          would otherwise sit on top of it: `relative z-20` lifts the whole row,
          so the footer stays a selection target in its own right. A checkbox
          nested inside the title's anchor would be interactive content inside
          interactive content, which is why the three are separate elements. */}
      {/* The `<label>` wraps the box, so the whole footer row is the hit target
          rather than a 13px square — clicking a label activates the control it
          contains, and the `aria-label` below is the name it announces. */}
      <label className="relative z-20 flex cursor-pointer items-center border-t border-border px-3 py-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(item.id, event.target.checked)}
          aria-label={`Select ${item.name}`}
        />
      </label>
    </Card>
  )
}
