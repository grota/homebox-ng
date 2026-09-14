import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { hexColor } from '@homebox/shared'
import { trpc } from '../../api/trpc'
import { Badge, Button, Card, cn, Field, hoverScrim, Input, PageHeader, Pagination, Tooltip } from '../../ui'
import { ItemForm } from './ItemForm'

// Sent explicitly rather than left to the server's default, so the request that
// produced `total` and the Next guard that reads it cannot disagree about the
// window. The server defaults to this same number; this is the client's half of
// that agreement, in one place instead of inline in the guard as it was.
const PAGE_SIZE = 20

// URL param → tRPC input mapping lives in ONE place on this page. The URL uses
// `q` (Phase-3 spec) but the router input field is `search`; `typeId` maps to
// `itemTypeId`, and `tagIds[]` (repeated `tagIds` params) maps to `tagIds`.

const parseId = (v: string | null): number | undefined => {
  if (v == null) return undefined
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

// `tagIds[]` is serialized as repeated `tagIds` query params (a multi-select
// `or` dimension). Parse the string[] into a de-duplicated positive int[].
const parseTagIds = (params: URLSearchParams): number[] => {
  const seen = new Set<number>()
  for (const raw of params.getAll('tagIds')) {
    const n = Number(raw)
    if (Number.isInteger(n) && n > 0) seen.add(n)
  }
  return [...seen]
}

// `locations.list` returns a nested tree (each node carries `children?`). Flatten
// it so the breadcrumb can walk the `parentId` chain up from the selected
// location (or to the root), which the location facet says we need for the drill.
type FlatLocation = { id: number; name: string; parentId: number | null }
const flattenLocations = (nodes: any[]): FlatLocation[] =>
  nodes.flatMap((n) => [
    { id: n.id, name: n.name, parentId: (n.parentId as number | null) ?? null },
    ...(n.children ? flattenLocations(n.children) : []),
  ])

// Paginated catalog listing with FTS search + faceted filters. URL params are the
// single source of truth: `q`, `typeId`, `locationId`, `tagIds[]`, `page`.
// "New item" toggles an inline create form; clicking a card navigates to the item.
export function ItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showForm, setShowForm] = useState(false)
  const [facetsOpen, setFacetsOpen] = useState(false)
  const utils = trpc.useUtils()

  const q = searchParams.get('q') ?? ''
  const locationId = parseId(searchParams.get('locationId'))
  const itemTypeId = parseId(searchParams.get('typeId'))
  const tagIds = parseTagIds(searchParams)
  const page = parseId(searchParams.get('page')) ?? 1

  // The search box is bound to `q` but keeps its own draft value so typing feels
  // immediate; the draft is written back to `q` (debounced ~300ms).
  const [searchInput, setSearchInput] = useState(q)

  // Keep the box in sync when `q` changes externally (clear, back/forward).
  useEffect(() => {
    setSearchInput(q)
  }, [q])

  // Debounce the draft into the URL `q` and reset to page 1 on a real change.
  // Skipping the schedule when draft === current `q` avoids writing on mount.
  useEffect(() => {
    if ((searchParams.get('q') ?? '') === searchInput) return
    const t = setTimeout(() => {
      setSearchParams((prev) => {
        if ((prev.get('q') ?? '') === searchInput) return prev
        const next = new URLSearchParams(prev)
        if (searchInput.trim() === '') next.delete('q')
        else next.set('q', searchInput)
        next.set('page', '1')
        return next
      })
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, searchParams, setSearchParams])

  const { data, isLoading } = trpc.items.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    search: q.trim() || undefined,
    locationId,
    itemTypeId,
    tagIds: tagIds.length ? tagIds : undefined,
  })
  const items = data?.items ?? []
  const facets = data?.facets

  // Breadcrumb for the selected location (walk the `parentId` chain to root).
  const locationsQuery = trpc.locations.list.useQuery()
  const locationById = new Map(flattenLocations(locationsQuery.data ?? []).map((l) => [l.id, l]))
  const breadcrumb: FlatLocation[] = []
  let cursor = locationId != null ? locationById.get(locationId) : undefined
  while (cursor) {
    breadcrumb.unshift(cursor)
    cursor = cursor.parentId != null ? locationById.get(cursor.parentId) : undefined
  }

  // Every filter change resets `page` to 1.
  const applyAndResetPage = (mutate: (params: URLSearchParams) => void) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      mutate(next)
      next.set('page', '1')
      return next
    })
  }

  const setTypeFilter = (id: number | undefined) =>
    applyAndResetPage((next) => {
      if (id == null) next.delete('typeId')
      else next.set('typeId', String(id))
    })

  const setLocationFilter = (id: number | undefined) =>
    applyAndResetPage((next) => {
      if (id == null) next.delete('locationId')
      else next.set('locationId', String(id))
    })

  const toggleTag = (id: number) =>
    applyAndResetPage((next) => {
      next.delete('tagIds')
      const current = new Set(tagIds)
      if (current.has(id)) current.delete(id)
      else current.add(id)
      for (const tagId of current) next.append('tagIds', String(tagId))
    })

  const clearFilters = () => {
    setSearchInput('')
    setSearchParams(() => {
      const next = new URLSearchParams()
      next.set('page', '1')
      return next
    })
  }

  const setPage = (p: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('page', String(p))
      return next
    })

  const handleSaved = () => {
    utils.items.list.invalidate()
    setShowForm(false)
  }

  return (
    <section>
      <PageHeader
        title="Items"
        actions={<Button onClick={() => setShowForm((open) => !open)}>New item</Button>}
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Field
          label="Search"
          htmlFor="item-search"
          className="flex-1 min-w-0 max-w-[26rem]"
          // The search has two modes and nothing on screen said so: words match
          // from their start as you type, and quotes ask for the word itself.
          // Someone who never learns the second can't search precisely at all —
          // every search would drag in "background" when they wanted "back".
          labelAdornment={
            <Tooltip
              label={
                <ul className="list-disc space-y-1 pl-4">
                  <li>Words are <code>AND</code>ed together.</li>
                  <li>
                    Only the last word has <code>*</code> appended (it is considered a prefix), so word order
                    matters.
                  </li>
                  <li>
                    Wrap a word in <code>"quotes"</code> to match exactly.
                  </li>
                  <li>
                    Uppercase <code>NOT</code>, <code>AND</code> and <code>OR</code> (in order of precedence)
                    are operators rather than words to find. In lower case they are ordinary words.
                  </li>
                  <li>
                    Parentheses group the operators: <code>(oak OR pine) wooden</code>.
                  </li>
                </ul>
              }
            >
              <Button size="sm" variant="ghost" aria-label="Search syntax help">
                <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M8 7.2v4" strokeLinecap="round" />
                  <circle cx="8" cy="4.9" r="0.9" fill="currentColor" stroke="none" />
                </svg>
              </Button>
            </Tooltip>
          }
        >
          <Input
            id="item-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search items"
            className="w-full"
          />
        </Field>
        <Button onClick={clearFilters} className="self-end">Clear filters</Button>
      </div>

      {showForm && <ItemForm onSaved={handleSaved} onCancel={() => setShowForm(false)} />}

      <div className="flex gap-4 items-start">
        {facets && (
          <>
            <Button
              size="sm"
              className="relative z-[60] lg:hidden"
              onClick={() => setFacetsOpen((v) => !v)}
              aria-expanded={facetsOpen}
            >
              {facetsOpen ? 'Close' : 'Filters'}
            </Button>
            <aside
              className={`${facetsOpen ? 'fixed inset-0 z-50 bg-bg p-4 overflow-y-auto' : 'hidden'} lg:static lg:z-auto lg:block lg:bg-transparent lg:p-0 lg:overflow-visible lg:flex lg:flex-col lg:gap-4 lg:w-60 lg:flex-shrink-0`}
            >
              {facets.types.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <h2 className="w-full mb-0">Types</h2>
                  {facets.types.map((f) => (
                    <Button
                      key={f.id}
                      size="sm"
                      variant={itemTypeId === f.id ? 'primary' : 'ghost'}
                      // `aria-pressed` is what a facet chip actually is — a toggle
                      // — and it is also the only way a test can see the selection
                      // without reading a Tailwind class back out.
                      aria-pressed={itemTypeId === f.id}
                      onClick={() => setTypeFilter(itemTypeId === f.id ? undefined : f.id)}
                    >
                      {f.name} ({f.count})
                    </Button>
                  ))}
                </div>
              )}

              {facets.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <h2 className="w-full mb-0">Tags</h2>
                  {facets.tags.map((f) => {
                    // Same sink and same guard as `ui/Badge.tsx`: defence in depth for
                    // rows written before `hexColor` on `tagInput` existed. A non-hex
                    // value is ignored rather than sanitised.
                    const color = f.color && hexColor.test(f.color) ? f.color : null
                    return (
                      // A facet chip must stay a real <button> — `searchFacets.test.tsx`
                      // clicks it by role — so the tag colour rides on the ghost Button
                      // rather than on a <Badge> (a span, not interactive).
                      <Button
                        key={f.id}
                        size="sm"
                        variant="ghost"
                        aria-pressed={tagIds.includes(f.id)}
                        // A ring rather than the `primary` variant the other facets
                        // use: this chip's background is the *tag's own colour*, so
                        // swapping it for the accent would hide the one thing the
                        // chip exists to show. A ring is a box-shadow, so unlike a
                        // `border-accent` class it also cannot lose to the variant's
                        // `border-transparent` — `cn` is a plain join and cannot
                        // resolve same-property conflicts.
                        className={cn('relative group', tagIds.includes(f.id) && 'ring-2 ring-accent')}
                        style={color ? { background: color } : undefined}
                        onClick={() => toggleTag(f.id)}
                      >
                        {/* That inline `background` beats the ghost variant's
                            `hover:bg-surface-raised`, so the chip's hover state has to
                            be its own element: a wash derived from the tag's colour
                            (`ui/scrim`), revealed on group-hover. Absolutely positioned,
                            so adding it does not move the chip's box. */}
                        {color && (
                          <span
                            aria-hidden
                            className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: hoverScrim(color) }}
                          />
                        )}
                        <span className="relative">{f.name} ({f.count})</span>
                      </Button>
                    )
                  })}
                </div>
              )}

              {/* Shown when there is a location to pick *or* one already chosen.
                  The chip list holds the selected location's children, so at a
                  leaf it is empty — and gating this whole block on that list
                  deleted the section the moment you filtered, taking the path and
                  the way back to "All locations" with it. Which is precisely the
                  "choosing a location gives no feedback" this fixes. */}
              {(facets.locations.length > 0 || locationId != null) && (
                <div className="flex flex-wrap gap-2">
                  <h2 className="w-full mb-0">Locations</h2>
                  <Button
                    size="sm"
                    variant={locationId == null ? 'primary' : 'ghost'}
                    aria-pressed={locationId == null}
                    onClick={() => setLocationFilter(undefined)}
                  >
                    All locations
                  </Button>
                  {/* The path down to what is selected, root first, ending in the
                      selection itself — which is the *only* place it appears: the
                      chip list below shows the selected location's **children**
                      (that is the drill-down), so without this the current
                      location would be nowhere on the page. Ancestors are plain
                      and clickable to go back up; the last chip carries the
                      selection's accent. */}
                  {breadcrumb.map((loc, i) => (
                    <span key={loc.id} className="inline-flex items-center gap-2">
                      {i > 0 && <span aria-hidden className="text-text-muted">›</span>}
                      <Button
                        size="sm"
                        variant={loc.id === locationId ? 'primary' : 'ghost'}
                        aria-pressed={loc.id === locationId}
                        onClick={() => setLocationFilter(loc.id)}
                      >
                        {loc.name}
                      </Button>
                    </span>
                  ))}
                  {facets.locations.map((f) => (
                    <Button
                      key={f.id}
                      size="sm"
                      variant={locationId === f.id ? 'primary' : 'ghost'}
                      aria-pressed={locationId === f.id}
                      onClick={() => setLocationFilter(f.id)}
                    >
                      {f.name} ({f.count})
                    </Button>
                  ))}
                </div>
              )}
            </aside>
          </>
        )}

        {isLoading ? (
          <p>Loading…</p>
        ) : (
          <div className="flex-1 min-w-0 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {/* One click target, and the whole card is it. The photo and the name
                used to be two — the image opened the lightbox, the name opened
                the item — because there were two places to go. There is one now,
                so the card went back to being one thing (ADR-0005). The heading
                stays a heading inside the link (the catalog tests query it by
                role) and the link keeps the item name as its accessible name via
                `aria-label`; the wrapped text would otherwise become the name. */}
            {items.map((item) => {
              // The card shows the PRIMARY photo — marking one primary is exactly
              // what that is for (2026-09-04 design: "one marked primary (used as
              // the card image)"), and it is what the drafts and trash rows do.
              // This card was the last place still taking `images[0]`, which had
              // no relationship to the primary at all: the primary became
              // settable in `ac33300` (item detail only, and this page is not in
              // that commit), so the card has been showing a photo the user never
              // chose ever since.
              const photo = item.images?.find((image) => image.isPrimary) ?? item.images?.[0]
              return (
                <Card key={item.id} padding="none" className="overflow-hidden hover:border-text-muted">
                  <Link to={`/items/${item.id}`} aria-label={item.name} className="block p-3 no-underline text-inherit">
                    {photo?.thumbPath ? (
                      <div className="relative mb-3">
                        <img
                          src={'/file/' + photo.thumbPath}
                          alt=""
                          className="w-full h-32 object-cover rounded-md"
                        />
                        {/* How many photos there are to look at, only when there is
                            more than one. It reads "1/" because a card shows the
                            primary, and the primary is position 1 of the order the
                            surface uses — so this is the number you land on when
                            you open the card. */}
                        {(item.images?.length ?? 0) > 1 && (
                          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white tabular-nums">
                            1/{item.images.length}
                          </span>
                        )}
                      </div>
                    ) : null}
                    <h2 className="mt-0">{item.name}</h2>
                    <p>{item.location?.name}</p>
                    {item.tags.map((tag) => (
                      <Badge key={tag.id} color={tag.color} className="mr-1">{tag.name}</Badge>
                    ))}
                    {q.trim() && item.snippet ? (
                      <p className="mt-2 text-text-muted text-sm" data-testid="item-snippet">{item.snippet}</p>
                    ) : null}
                  </Link>
                </Card>
              )
            })}
            {items.length === 0 && <p>No items yet.</p>}
          </div>
        )}
      </div>

      {data && <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onPage={setPage} />}
    </section>
  )
}
