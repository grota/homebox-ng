import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { ItemForm } from './ItemForm'

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
      <header className="flex items-center justify-between mb-4">
        <h1>Items</h1>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
          onClick={() => setShowForm((open) => !open)}
        >
          New item
        </button>
      </header>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <label htmlFor="item-search">Search</label>
        <input
          id="item-search"
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search items"
          className="flex-1 min-w-0 max-w-[26rem] px-2 py-1 border border-border rounded-md bg-surface text-text"
        />
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
          onClick={clearFilters}
        >
          Clear filters
        </button>
      </div>

      {showForm && <ItemForm onSaved={handleSaved} onCancel={() => setShowForm(false)} />}

      <div className="flex gap-4 items-start">
        {facets && (
          <>
            <button
              type="button"
              className="relative z-[60] lg:hidden px-2 py-1 rounded border border-border bg-surface text-text"
              onClick={() => setFacetsOpen((v) => !v)}
              aria-expanded={facetsOpen}
            >
              {facetsOpen ? 'Close' : 'Filters'}
            </button>
            <aside
              className={`${facetsOpen ? 'fixed inset-0 z-50 bg-bg p-4 overflow-y-auto' : 'hidden'} lg:static lg:z-auto lg:block lg:bg-transparent lg:p-0 lg:overflow-visible lg:flex lg:flex-col lg:gap-4 lg:w-60 lg:flex-shrink-0`}
            >
              {facets.types.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <h2 className="w-full mb-0">Types</h2>
                  {facets.types.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`inline-block rounded px-1.5 py-0.5 mr-1 text-xs${itemTypeId === f.id ? ' bg-accent text-accent-contrast' : ''}`}
                      onClick={() => setTypeFilter(itemTypeId === f.id ? undefined : f.id)}
                    >
                      {f.name} ({f.count})
                    </button>
                  ))}
                </div>
              )}

              {facets.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <h2 className="w-full mb-0">Tags</h2>
                  {facets.tags.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="inline-block rounded px-1.5 py-0.5 mr-1 text-xs"
                      style={f.color ? { background: f.color } : undefined}
                      onClick={() => toggleTag(f.id)}
                    >
                      {f.name} ({f.count})
                    </button>
                  ))}
                </div>
              )}

              {facets.locations.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <h2 className="w-full mb-0">Locations</h2>
                  <button type="button" className="inline-block rounded px-1.5 py-0.5 mr-1 text-xs" onClick={() => setLocationFilter(undefined)}>
                    All locations
                  </button>
                  {breadcrumb.map((loc) => (
                    <button key={loc.id} type="button" className="inline-block rounded px-1.5 py-0.5 mr-1 text-xs" onClick={() => setLocationFilter(loc.id)}>
                      {loc.name}
                    </button>
                  ))}
                  {facets.locations.map((f) => (
                    <button key={f.id} type="button" className="inline-block rounded px-1.5 py-0.5 mr-1 text-xs" onClick={() => setLocationFilter(f.id)}>
                      {f.name} ({f.count})
                    </button>
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
            {items.map((item) => (
              <Link
                key={item.id}
                to={`/items/${item.id}`}
                className="block rounded-lg border border-border p-3 no-underline text-inherit hover:border-text-muted"
              >
                {item.images?.[0]?.thumbPath ? (
                  <img src={'/file/' + item.images[0].thumbPath} alt={item.name} className="w-full h-32 object-cover rounded-md mb-2" />
                ) : null}
                <h2>{item.name}</h2>
                <p>{item.location?.name}</p>
                <p>{item.type?.name}</p>
                {item.tags.map((tag) => (
                  <span key={tag.id} className="inline-block rounded px-1.5 py-0.5 mr-1 text-xs">
                    {tag.name}
                  </span>
                ))}
                {q.trim() && item.snippet ? (
                  <p className="mt-2 text-text-muted text-sm" data-testid="item-snippet">
                    {item.snippet}
                  </p>
                ) : null}
              </Link>
            ))}
            {items.length === 0 && <p>No items yet.</p>}
          </div>
        )}
      </div>

      {data && data.total > 1 && (
        <div className="flex gap-2 items-center mt-4">
          <button
            type="button"
            className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            Prev
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
            onClick={() => setPage(page + 1)}
            disabled={page * 20 >= data.total}
          >
            Next
          </button>
        </div>
      )}
    </section>
  )
}
