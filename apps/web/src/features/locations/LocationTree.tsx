// Structurally compatible with the `LocationDto` returned by `locations.list`
// ({ id, name, parentId, description, depth, children? }).
type LocationTreeItem = {
  id: number
  name: string
  parentId: number | null
  description: string | null
  depth: number
  children?: LocationTreeItem[]
}

export function LocationTree({ locations }: { locations: LocationTreeItem[] }) {
  if (locations.length === 0) return <p>No locations yet.</p>
  return (
    <ul className="location-tree">
      {locations.map((loc) => (
        <LocationBranch key={loc.id} location={loc} />
      ))}
    </ul>
  )
}

function LocationBranch({ location }: { location: LocationTreeItem }) {
  return (
    <li>
      <span>{location.name}</span>
      {location.children && location.children.length > 0 ? (
        <LocationTree locations={location.children} />
      ) : null}
    </li>
  )
}
