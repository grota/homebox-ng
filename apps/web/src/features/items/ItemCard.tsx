import { Link } from 'react-router-dom'
import { Badge, Card, cn } from '../../ui'
import { locationPathLabel, type FlatLocation } from '../../lib/locationPath'
import { useCardPhotoCycling } from '../../lib/photoIndex'
import { useUserSettings } from '../../lib/settings/useUserSettings'

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
  // Which half of the card opens the item and which half picks it. The default is
  // the photo opening and the title picking (ADR-0013); turning it off restores
  // the split this card shipped with. Both readings of a card are defensible —
  // the photo is what you aim at when you mean "show me this", the title is where
  // you put a tick while scanning — so it is a user setting, not a decision the
  // code makes for everyone.
  const { photoOpensItem } = useUserSettings()

  // The card shows the PRIMARY photo — marking one primary is exactly what that
  // is for (2026-09-04 design: "one marked primary (used as the card image)"),
  // and it is what the drafts and trash rows do. It is also where cycling starts,
  // so `n/N` is the position you land on when you open the card.
  const cycle = useCardPhotoCycling(item.images, item.id)
  const photo = cycle.current

  // The location line is the item's whole path, not just the leaf: "shelf A"
  // alone does not say *which* shelf A, and the sidebar navigates the same
  // hierarchy. The tree supplies the ancestors; the DTO's leaf is what is left
  // while it is still loading.
  const locationLabel = locationPathLabel(item.locationId, item.location?.name, locationById)

  const hasPhoto = Boolean(photo?.thumbPath)
  // Without a photo there is no photo target to swap, so the card is the same card
  // under either setting: the body picks, the title opens. Only the branch that
  // has a photo reads the setting.
  const photoIsTheLink = photoOpensItem && hasPhoto
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

  // `aspect-square` rather than a fixed `h-32`: a fixed height is a 4:1 strip at
  // one column and a 1:1 box at six, so the photo was cropped by a different amount
  // at every width. A square is the same shape everywhere, and `object-contain`
  // shows the whole photo inside it with the mat filling what is left.
  //
  // `alt=""` because the card names the item right beneath it, so the image is
  // decorative rather than a second place to read the name.
  const thumbnail = photo && (
    <img
      src={'/file/' + photo.thumbPath}
      alt=""
      className="w-full aspect-square object-contain rounded-md bg-black"
    />
  )

  return (
    <Card
      padding="none"
      data-testid="item-card"
      className="relative overflow-hidden hover:border-text-muted"
    >
      {/* One toggle per card, and it **covers** the card rather than wrapping
          anything in it: everything below the photo — the title, the path, the
          tags, the blank space under a short card and the footer row — picks the
          item. The title opts out with a higher z-index, and does the same job
          directly.

          Empty and absolutely positioned, so the card's layout is what it was
          with no overlay at all. An empty `<label for>` is legal and activates
          the footer's checkbox through the browser, the same way the footer's
          own label does — no click handler, and no second focus stop.

          `z-10` rather than `z-0` is load-bearing. The photo's wrapper below is
          `relative` — it has to be, the "1/2" badge is absolute inside it — and a
          positioned element with `z-index: auto` paints *after* a `z-0` one in
          tree order, so the photo came out on top of the overlay and took the
          click for itself. `z-20` is for the photo when it is the link, and for
          the title when it is not. */}
      <label htmlFor={checkboxId} className="absolute inset-0 z-10 cursor-pointer" />
      <div className="p-3">
        {/* `z-20` only while the photo is the link: it has to beat the overlay to
            be clickable, and with the setting swapped it must *not* — then the
            overlay is what the photo is for, and a wrapper above it swallows
            every pick. */}
        {hasPhoto ? (
          <div
            className={cn('relative mb-3', photoIsTheLink && 'z-20')}
            ref={cycle.ref}
            onPointerDown={cycle.onPointerDown}
            onPointerMove={cycle.onPointerMove}
            onKeyDown={cycle.onKeyDown}
            onClickCapture={cycle.onClickCapture}
          >
            {/* The thumbnail, wrapped or not: under the default it is the one thing
                on the card that opens the item, and it needs to be a real link for
                that to mean anything to a screen reader or to "open in new tab". */}
            {photoIsTheLink ? (
              <Link to={`/items/${item.id}`} aria-label={`Open ${item.name}`} className="block">
                {thumbnail}
              </Link>
            ) : (
              thumbnail
            )}
            {/* Where the cycling has got to, and only while there is somewhere to
                go: `1/1` on every card would be noise. */}
            {cycle.indicator && (
              <span className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white tabular-nums">
                {cycle.indicator}
              </span>
            )}
          </div>
        ) : null}
        {/* A photoless item has nothing above the title, so the path/tags go up
            there, where the photo would have been. */}
        {hasPhoto ? null : text}
        <h2 className="mt-0">
          {/* Under the default the title picks rather than opens, so it is a label
              for the footer's checkbox rather than an anchor: one control, driven
              from two places, which cannot drift apart the way a second checkbox
              would. When the setting is swapped it is a real link instead, and the
              card is back to being "the body picks, the title opens". */}
          {photoIsTheLink ? (
            <span className="relative z-20 block cursor-pointer">
              <label htmlFor={checkboxId}>{item.name}</label>
            </span>
          ) : (
            <Link to={`/items/${item.id}`} className="relative z-20">
              {item.name}
            </Link>
          )}
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
