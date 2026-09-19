import { useState } from 'react'
import { trpc } from '../../api/trpc'
import { Button, Field, Input } from '../../ui'
import { LocationFacetTree, type LocationFacetId, type LocationFacetNode } from './LocationFacetTree'

// A **criteria clause**: a tag / location / creation-date condition that adds items
// to, or removes them from, a selection. Its three sections are AND-ed, its values
// are drawn only from data that exists, and it never shows an empty result as
// something you can apply — the count is what makes that visible.
//
// One component for both directions. Adding and removing are the same query with
// the opposite sign, so building them twice would be two places to fix a bug.
type Props = {
  mode: 'add' | 'remove'
  locations: LocationFacetNode[]
  onApply: (ids: number[]) => void
}

export function SelectionCriteria({ mode, locations, onApply }: Props) {
  const [tagIds, setTagIds] = useState<number[]>([])
  const [locationIds, setLocationIds] = useState<LocationFacetId[]>([])
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')

  const tags = trpc.tags.list.useQuery()
  // Bounded by the catalog's real span, so the picker cannot offer a range that
  // matches nothing. `undefined` while it loads — the inputs take no bounds then,
  // which is a moment of looseness rather than a wrong bound.
  const range = trpc.items.createdAtRange.useQuery().data ?? undefined

  const clause = {
    tagIds: tagIds.length ? tagIds : undefined,
    locationIds: locationIds.length ? locationIds : undefined,
    createdFrom: createdFrom || undefined,
    createdTo: createdTo || undefined,
  }
  const { data } = trpc.items.resolveSelection.useQuery(clause)
  const count = data?.total ?? 0

  const toggleTag = (id: number) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))

  return (
    <div className="flex flex-col gap-3">
      {(tags.data?.length ?? 0) > 0 && (
        <Field label="Tags" htmlFor="criteria-tags">
          <div id="criteria-tags" className="flex flex-col gap-1">
            {tags.data?.map((tag) => (
              <label key={tag.id} className="flex items-center gap-2">
                <input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} />
                <span>{tag.name}</span>
              </label>
            ))}
          </div>
        </Field>
      )}

      {locations.length > 0 && (
        <Field label="Locations" htmlFor="criteria-locations">
          {/* Multi-select: this is a query, not the sidebar's single filter. */}
          <div id="criteria-locations">
            <LocationFacetTree multi nodes={locations} selected={locationIds} onSelect={setLocationIds} />
          </div>
        </Field>
      )}

      <Field label="Created between" htmlFor="criteria-from">
        <div className="flex items-center gap-2">
          <Input
            id="criteria-from"
            type="date"
            aria-label="Created from"
            min={range?.min}
            max={range?.max}
            value={createdFrom}
            onChange={(e) => setCreatedFrom(e.target.value)}
          />
          <Input
            type="date"
            aria-label="Created to"
            min={range?.min}
            max={range?.max}
            value={createdTo}
            onChange={(e) => setCreatedTo(e.target.value)}
          />
        </div>
      </Field>

      <div className="flex justify-end">
        <Button
          size="sm"
          // Nothing resolves → nothing to apply. A no-op that looks like it worked
          // is worse than a disabled button.
          disabled={count === 0}
          onClick={() => onApply(data?.ids ?? [])}
        >
          {mode === 'add' ? 'Add' : 'Remove'} {count} {count === 1 ? 'item' : 'items'}
        </Button>
      </div>
    </div>
  )
}
