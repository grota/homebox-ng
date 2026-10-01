import { Button } from '../../ui'

// Structurally compatible with the `LocationDto` returned by `locations.list`
// ({ id, name, parentId, description, depth, children? }).
export type LocationTreeItem = {
  id: number
  name: string
  parentId: number | null
  description: string | null
  depth: number
  children?: LocationTreeItem[]
}

type LocationTreeProps = {
  locations: LocationTreeItem[]
  onEdit: (location: LocationTreeItem) => void
  onDelete: (location: LocationTreeItem) => void
}

export function LocationTree({ locations, onEdit, onDelete }: LocationTreeProps) {
  if (locations.length === 0) return <p>No locations yet.</p>
  return (
    <ul className="list-none pl-0">
      {locations.map((loc) => (
        <li key={loc.id}>
          <div className="flex items-center gap-2">
            <div>
              <span>{loc.name}</span>
              {loc.description && <p className="text-sm text-text-muted">{loc.description}</p>}
            </div>
            <Button size="sm" onClick={() => onEdit(loc)}>
              Edit
            </Button>
            <Button size="sm" variant="danger" onClick={() => onDelete(loc)}>
              Delete
            </Button>
          </div>
          {loc.children && loc.children.length > 0 ? (
            <div className="pl-4">
              <LocationTree locations={loc.children} onEdit={onEdit} onDelete={onDelete} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
