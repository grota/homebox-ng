import { useState } from 'react'
import { trpc } from '../../api/trpc'
import { Button, Field, Input, Select } from '../../ui'
import { flattenLocations, locationOptionLabel, type LocationTreeItem } from '../../lib/locationPath'

// One edit, applied to a whole selection. Every property shows what the selection
// currently holds — the distribution, not a "Mixed" label — and the count of items
// the edit would touch.
//
// Those counts come from `selectionSummary` rather than from arithmetic here,
// because they are the numbers the write **pins** (ADR-0010): what this panel
// promises and what the server checks have to be one implementation, or a refusal
// would be a disagreement rather than a guard.
type Props = {
  ids: number[]
  // The location tree as `locations.list` returns it, nested — flattened here, for
  // the same reason the item form flattens it: a `<select>` over the tree mapped
  // flat offers only the roots.
  locations: LocationTreeItem[]
  onApplied: () => void
}

// A field's value that means "set it to nothing", distinct from "leave it alone".
// A sentinel is unavoidable: the alternative is a separate control per field, and
// the odds of an item's real value colliding with this string are not worth the
// extra UI.
const SET_EMPTY = '__empty__'
const LEAVE = ''

export function BulkEditPanel({ ids, locations, onApplied }: Props) {
  const utils = trpc.useUtils()
  const [locationSet, setLocationSet] = useState('')
  // The tags the user has unchecked: they are in the selection, and the edit
  // removes them. Absent from this list means untouched.
  const [removed, setRemoved] = useState<number[]>([])
  const [added, setAdded] = useState<number[]>([])
  const [pickTag, setPickTag] = useState('')
  const [newTag, setNewTag] = useState('')
  const [fieldPicks, setFieldPicks] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)

  const pending = {
    location: locationSet === LEAVE ? undefined : { set: locationSet === 'none' ? null : Number(locationSet) },
    tags: added.length || removed.length ? { add: added, remove: removed } : undefined,
    fieldValues: Object.entries(fieldPicks)
      .filter(([, picked]) => picked !== LEAVE)
      .map(([fieldId, picked]) => ({ fieldId: Number(fieldId), value: picked === SET_EMPTY ? null : picked })),
  }

  const summary = trpc.items.selectionSummary.useQuery({ ids, pending })
  const data = summary.data
  const allTags = trpc.tags.list.useQuery().data ?? []
  const bulkUpdate = trpc.items.bulkUpdate.useMutation()
  const createTag = trpc.tags.create.useMutation()

  const changes = data?.changes ?? {}
  const note = (key: string) =>
    changes[key] ? (
      <span className="text-xs text-text-muted">
        changes {changes[key]} of {data?.total ?? 0}
      </span>
    ) : null

  const apply = async () => {
    setError(null)
    try {
      await bulkUpdate.mutateAsync({
        ids,
        ...pending,
        acknowledgedItemCount: data?.total ?? 0,
        acknowledgedOverwriteCounts: changes,
      })
      utils.items.list.invalidate()
      onApplied()
    } catch (e) {
      // A refusal is the pin doing its job, so the panel stays open with the
      // reason rather than closing as though it had worked.
      setError((e as { message?: string })?.message ?? 'The edit was refused.')
    }
  }

  const addTag = (id: number) => setAdded((prev) => (prev.includes(id) ? prev : [...prev, id]))

  return (
    <div className="flex flex-col gap-3">
      <Field label="Set location" htmlFor="bulk-location">
        <div className="flex flex-col gap-1">
          <Select id="bulk-location" value={locationSet} onChange={(e) => setLocationSet(e.target.value)}>
            <option value={LEAVE}>Leave as is</option>
            <option value="none">No location</option>
            {flattenLocations(locations).map((loc) => (
              <option key={loc.id} value={String(loc.id)}>
                {locationOptionLabel(loc)}
              </option>
            ))}
          </Select>
          {note('location')}
        </div>
      </Field>

      {/* What the selection holds now, as a distribution rather than a "Mixed"
          label: the point of showing it is to know what the edit is about to
          overwrite. */}
      <p className="text-xs text-text-muted">
        Now: {(data?.locations ?? []).map((loc) => `${loc.name ?? 'no location'} ×${loc.count}`).join(' · ')}
      </p>

      {(data?.tags.length ?? 0) > 0 && (
        <Field label="Tags" htmlFor="bulk-tags">
          <div id="bulk-tags" className="flex flex-col gap-1">
            {/* The selection's own tags, with how many items carry each. Unchecking
                one removes it from every selected item; the ones left alone are not
                touched, which is why this is not "the resulting set". */}
            {data?.tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!removed.includes(tag.id)}
                  onChange={(e) =>
                    setRemoved((prev) => (e.target.checked ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]))
                  }
                />
                <span>
                  {tag.name} ×{tag.count}
                </span>
              </label>
            ))}
            {note('tags.remove')}
          </div>
        </Field>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Add a tag" htmlFor="bulk-add-tag">
          <Select id="bulk-add-tag" value={pickTag} onChange={(e) => setPickTag(e.target.value)}>
            <option value="">Choose…</option>
            {allTags
              .filter((tag) => !(data?.tags ?? []).some((present) => present.id === tag.id))
              .map((tag) => (
                <option key={tag.id} value={String(tag.id)}>
                  {tag.name}
                </option>
              ))}
          </Select>
        </Field>
        <Button
          size="sm"
          variant="ghost"
          disabled={pickTag === ''}
          onClick={() => {
            addTag(Number(pickTag))
            setPickTag('')
          }}
        >
          Add tag
        </Button>
        {note('tags.add')}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Or create a tag" htmlFor="bulk-new-tag">
          <Input id="bulk-new-tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
        </Field>
        <Button
          size="sm"
          variant="ghost"
          disabled={newTag.trim() === ''}
          onClick={async () => {
            const tag = await createTag.mutateAsync({ name: newTag.trim() })
            addTag(tag.id)
            setNewTag('')
          }}
        >
          Create tag
        </Button>
      </div>

      {/* Only the fields every selected item shares, and only when that is all of
          them — a field belongs to one type, so a mixed selection has none. */}
      {(data?.fields ?? []).map((field) => (
        <Field key={field.fieldId} label={field.fieldName} htmlFor={`bulk-field-${field.fieldId}`}>
          <div className="flex flex-col gap-1">
            <Select
              id={`bulk-field-${field.fieldId}`}
              value={fieldPicks[field.fieldId] ?? LEAVE}
              onChange={(e) => setFieldPicks((prev) => ({ ...prev, [field.fieldId]: e.target.value }))}
            >
              <option value={LEAVE}>Leave as is</option>
              <option value={SET_EMPTY}>(empty)</option>
              {field.values
                .filter((value) => value.value != null)
                .map((value) => (
                  <option key={value.value} value={value.value ?? ''}>
                    {value.value} ×{value.count}
                  </option>
                ))}
            </Select>
            {note(`field:${field.fieldId}`)}
          </div>
        </Field>
      ))}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end">
        <Button size="sm" disabled={Object.keys(changes).length === 0} onClick={() => void apply()}>
          Apply to {data?.total ?? 0} items
        </Button>
      </div>
    </div>
  )
}
