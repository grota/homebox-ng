import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { hexColor, ITEM_SORT_PREFERENCES, type ItemSort } from '@homebox/shared'
import { trpc } from '../../api/trpc'
import { Button, cn, Field, hoverScrim, Input, PageHeader, Pagination, Popover, Select, Tooltip } from '../../ui'
import { ITEM_SORT_LABELS } from '../../lib/itemSort'
import { useUserSettings } from '../../lib/settings/useUserSettings'
import { ItemCard } from './ItemCard'
import { BulkEditPanel } from './BulkEditPanel'
import { ItemForm } from './ItemForm'
import { LocationFacetTree, type LocationFacetId } from './LocationFacetTree'
import { SelectionCriteria } from './SelectionCriteria'
// Flattening the location tree, so a card's location path can walk up it.
import { flattenLocations } from '../../lib/locationPath'

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

// Paginated catalog listing with FTS search + faceted filters. URL params are the
// single source of truth: `q`, `typeId`, `locationId`, `tagIds[]`, `page`.
// "New item" toggles an inline create form; clicking a card navigates to the item.
export function ItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showForm, setShowForm] = useState(false)
  const [facetsOpen, setFacetsOpen] = useState(false)
  const utils = trpc.useUtils()

  const q = searchParams.get('q') ?? ''
  // A location id, or `none` for the Unlocated bucket (ADR-0009), which is not a
  // location and so has no id to carry.
  const rawLocationId = searchParams.get('locationId')
  const locationId: LocationFacetId | undefined = rawLocationId === 'none' ? 'none' : parseId(rawLocationId)
  const itemTypeId = parseId(searchParams.get('typeId'))
  const tagIds = parseTagIds(searchParams)
  const page = parseId(searchParams.get('page')) ?? 1

  // The search box is bound to `q` but keeps its own draft value so typing feels
  // immediate; the draft is written back to `q` (debounced ~300ms).
  const searchRef = useRef<HTMLInputElement>(null)
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

  // The catalog's order. It is a stored per-user preference, so the control lives
  // with the list as well as on `/settings` — a sort is something you change
  // while looking at what you are sorting.
  //
  // Relevance is the one case that is not a preference: it is what a search is
  // ordered by until the user says otherwise, and it is never written down (there
  // is no rank to order by without a term). So the only thing remembered here is
  // a choice made *while searching* — otherwise the stored value is the answer.
  const { itemsSort, updateSettings } = useUserSettings()
  // Holds a pick made on this page, including `relevance`, which is a legal pick
  // while searching and is not a stored preference.
  const [chosenSort, setChosenSort] = useState<ItemSort | null>(null)
  const searching = q.trim().length > 0
  // The pick wins as soon as it is made, in both modes: it does not wait for the
  // optimistic settings write to land, and with nothing picked it is the stored
  // preference — or relevance, while there is a term to rank.
  const sort: ItemSort = chosenSort ?? (searching ? 'relevance' : itemsSort)

  const chooseSort = (value: ItemSort) => {
    setChosenSort(value)
    // `relevance` is not storable: it means "rank", which only exists while a
    // term is matched.
    if (value !== 'relevance') void updateSettings({ itemsSort: value })
  }

  // ---------------------------------------------------------------------------
  // Selection (ADR-0010). A set of catalog item ids that is independent of the
  // view: changing the search, a filter or the page does not touch it, and it is
  // lost on reload. "Select all" resolves what the *view* matches, so the server is
  // asked rather than the page's twenty rows being assumed to be all of it.
  //
  // Declared above the query below, because the query carries the selection when
  // "Selected only" is on.
  // ---------------------------------------------------------------------------
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [onlySelected, setOnlySelected] = useState(false)
  const [criteria, setCriteria] = useState<'add' | 'remove' | 'apply' | null>(null)

  const toggleSelected = (id: number, next: boolean) =>
    setSelected((prev) => {
      const set = new Set(prev)
      if (next) set.add(id)
      else set.delete(id)
      return set
    })

  const clearSelection = () => {
    setSelected(new Set())
    // A view showing nothing but the selection has nothing left to show.
    setOnlySelected(false)
  }

  const selectAllMatching = async () => {
    const { ids } = await utils.items.resolveSelection.fetch({
      search: q.trim() || undefined,
      itemTypeId,
      tagIds: tagIds.length ? tagIds : undefined,
      locationIds: locationId != null ? [locationId] : undefined,
    })
    setSelected((prev) => new Set([...prev, ...ids]))
  }

  const resolveInto = (ids: number[], mode: 'add' | 'remove') => {
    setSelected((prev) => (mode === 'add' ? new Set([...prev, ...ids]) : new Set([...prev].filter((id) => !ids.includes(id)))))
    setCriteria(null)
  }

  const { data, isLoading } = trpc.items.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    search: q.trim() || undefined,
    locationId,
    itemTypeId,
    tagIds: tagIds.length ? tagIds : undefined,
    sort,
    // "Selected only": the selection outlives the view that made it, so showing
    // just it is an ordinary filter.
    ids: onlySelected ? [...selected] : undefined,
  })
  const items = data?.items ?? []
  const facets = data?.facets

  // The location tree, as a lookup: the card's location path is a walk up
  // `parentId` from here.
  const locationsQuery = trpc.locations.list.useQuery()
  const locationById = new Map(flattenLocations(locationsQuery.data ?? []).map((l) => [l.id, l]))

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

  const setLocationFilter = (id: LocationFacetId | undefined) =>
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
    // Focus follows the action: the point of clearing is to type something else,
    // and the button that did the clearing is now the wrong place to be.
    searchRef.current?.focus()
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
            ref={searchRef}
            id="item-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search items"
            className="w-full"
          />
        </Field>
        {/* The order lives with the list, not only on `/settings`: a sort is
            something you change while looking at what you are sorting. The
            control shows the *effective* order — while a search term is active
            that is relevance, which is not stored anywhere, so picking anything
            else is also what makes it a preference. */}
        <Field label="Order" htmlFor="items-sort">
          <Select id="items-sort" value={sort} onChange={(e) => chooseSort(e.target.value as ItemSort)}>
            {searching && <option value="relevance">{ITEM_SORT_LABELS.relevance}</option>}
            {ITEM_SORT_PREFERENCES.map((value) => (
              <option key={value} value={value}>
                {ITEM_SORT_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={clearFilters} className="self-end">Clear filters</Button>
      </div>

      {showForm && <ItemForm onSaved={handleSaved} onCancel={() => setShowForm(false)} />}

      {/* The selection bar. Always present, because "select all" is how a
          selection *starts* — a bar that only appeared once something was
          selected could never be used to select anything. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {selected.size > 0 && (
          <span className="text-sm text-text-muted" aria-live="polite">
            {selected.size} selected
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={(data?.total ?? 0) === 0}
          onClick={() => void selectAllMatching()}
        >
          Select all {data?.total ?? 0} matching
        </Button>
        <Button size="sm" variant="ghost" disabled={selected.size === 0} onClick={clearSelection}>
          Deselect all
        </Button>
        <Popover
          open={criteria === 'add'}
          onOpenChange={(open) => setCriteria(open ? 'add' : null)}
          title="Add to selection criteria"
          trigger={<Button size="sm" variant="ghost">Add to selection</Button>}
        >
          <SelectionCriteria
            mode="add"
            locations={facets?.locations ?? []}
            onApply={(ids) => resolveInto(ids, 'add')}
          />
        </Popover>
        <Popover
          open={criteria === 'remove'}
          onOpenChange={(open) => setCriteria(open ? 'remove' : null)}
          title="Remove from selection criteria"
          trigger={<Button size="sm" variant="ghost">Remove from selection</Button>}
        >
          <SelectionCriteria
            mode="remove"
            locations={facets?.locations ?? []}
            onApply={(ids) => resolveInto(ids, 'remove')}
          />
        </Popover>
        {selected.size > 0 && (
          <>
            <Popover
              open={criteria === 'apply'}
              onOpenChange={(open) => setCriteria(open ? 'apply' : null)}
              title="Apply to the selection"
              trigger={<Button size="sm">Apply to selection</Button>}
            >
              <BulkEditPanel
                ids={[...selected]}
                locations={locationsQuery.data ?? []}
                onApplied={() => {
                  clearSelection()
                  setCriteria(null)
                  utils.items.list.invalidate()
                }}
              />
            </Popover>
            <Button
              size="sm"
              variant={onlySelected ? 'primary' : 'ghost'}
              aria-pressed={onlySelected}
              onClick={() => setOnlySelected((on) => !on)}
            >
              Selected only
            </Button>
          </>
        )}
      </div>

      <div className="flex gap-4 items-start">
        {/* Hidden while "Selected only" is on: the facet counts describe the
            catalog under the current filters, and the grid would be describing the
            selection. Two panels disagreeing about the same list is worse than one
            panel missing. */}
        {facets && !onlySelected && (
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
              {/* The tree replaced the two flat chip runs it used to be — one for
                  the path down to the selection, one for the current level. The
                  hierarchy is visible now instead of being implied by chips
                  appearing and disappearing, and the path to the selection is
                  simply the open branch. */}
              {(facets.locations.some((node) => !node.unlocated) || locationId != null) && (
                <div className="flex flex-col gap-2">
                  <h2 className="mb-0">Locations</h2>
                  <Button
                    size="sm"
                    className="self-start"
                    variant={locationId == null ? 'primary' : 'ghost'}
                    aria-pressed={locationId == null}
                    onClick={() => setLocationFilter(undefined)}
                  >
                    All locations
                  </Button>
                  <LocationFacetTree
                    nodes={facets.locations}
                    selected={locationId}
                    onSelect={setLocationFilter}
                  />
                </div>
              )}
            </aside>
          </>
        )}

        {isLoading ? (
          <p>Loading…</p>
        ) : (
          <div className="flex-1 min-w-0 grid gap-4 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
            {/* One click target, and the whole card is it. The photo and the name
                used to be two — the image opened the lightbox, the name opened
                the item — because there were two places to go. There is one now,
                so the card went back to being one thing (ADR-0005). The heading
                stays a heading inside the link (the catalog tests query it by
                role) and the link keeps the item name as its accessible name via
                `aria-label`; the wrapped text would otherwise become the name. */}
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                locationById={locationById}
                searchTerm={q}
                selected={selected.has(item.id)}
                onSelect={toggleSelected}
              />
            ))}
            {items.length === 0 && <p>No items yet.</p>}
          </div>
        )}
      </div>

      {data && <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onPage={setPage} />}
    </section>
  )
}
