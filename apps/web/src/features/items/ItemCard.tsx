import { Link } from 'react-router-dom'
import { Badge, Card } from '../../ui'
import { locationPathLabel, type FlatLocation } from './locationPath'

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

  return (
    <Card padding="none" className="overflow-hidden hover:border-text-muted">
      <Link to={`/items/${item.id}`} aria-label={item.name} className="block p-3 no-underline text-inherit">
        {photo?.thumbPath ? (
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
        <h2 className="mt-0">{item.name}</h2>
        {/* Text, never a link: the card is one click target (ADR-0005), so a
            nested anchor would be invalid HTML and a keyboard trap. Truncated
            because a path is unbounded in width and a card is ~200px; `title`
            keeps the whole of it readable. */}
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
      </Link>
      {/* The checkbox lives **outside** the link, in the card's footer, and that is
          not cosmetic: the whole card above is one `<a>`, and a checkbox nested
          inside an anchor is interactive content inside interactive content —
          invalid, and different in every browser. The drafts card puts its own
          checkbox here for the same reason. */}
      <div className="flex items-center border-t border-border px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(item.id, event.target.checked)}
          // The card's visible name is inside the link and is not a `<label>` for
          // this, so the accessible name is stated outright.
          aria-label={`Select ${item.name}`}
        />
      </div>
    </Card>
  )
}
