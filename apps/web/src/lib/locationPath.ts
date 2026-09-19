// Turning the location tree into the paths the catalog shows.
//
// `locations.list` returns a nested tree, and every surface that needs a
// location's *path* — the card's location line, the sidebar's breadcrumb — wants
// the same thing: the ancestors of one location, root first. Two copies of that
// walk is how the two would come to disagree about the separator or about what
// happens when the chain is broken, so there is one copy, here.

export type LocationTreeItem = {
  id: number
  name: string
  parentId: number | null
  depth: number
  children?: LocationTreeItem[]
}

export type FlatLocation = { id: number; name: string; parentId: number | null; depth: number }

// The separator between the names of a path, and between the sidebar's
// breadcrumb chips. One constant, because a reader comparing the card against
// the sidebar is comparing the same hierarchy twice.
export const LOCATION_PATH_SEPARATOR = ' › '

// Flatten the nested tree into a list, so a lookup by id does not recurse the
// tree once per item on the page — and so a `<select>` can be built from it.
export const flattenLocations = (nodes: LocationTreeItem[]): FlatLocation[] =>
  nodes.flatMap((node) => [
    { id: node.id, name: node.name, parentId: node.parentId ?? null, depth: node.depth },
    ...(node.children ? flattenLocations(node.children) : []),
  ])

// The label for one location in a flat list. `— ` per level, the convention the
// locations page's parent selector has always used: a `<select>` cannot nest, and
// a list of bare names would not say which `shelf A` is which.
export const locationOptionLabel = (location: Pick<FlatLocation, 'name' | 'depth'>): string =>
  `${'— '.repeat(Math.max(0, location.depth - 1))}${location.name}`

// The chain from the root down to `locationId`, root first. Empty when the
// location is unknown — which is the honest answer while `locations.list` is
// still in flight, or if the id names something that is not in the tree.
//
// **Cycle-guarded, and it has to be.** The data model permits a cyclic
// `parent_id` chain, and `locations.list` surfaces one as two roots pointing at
// each other (the server's `buildTree` makes an orphan a root rather than
// dropping it). An unguarded walk up `parentId` is therefore an infinite loop
// *inside a render* — it would hang the page, not fail a request.
export const locationPath = (
  locationId: number,
  byId: Map<number, FlatLocation>,
): FlatLocation[] => {
  const path: FlatLocation[] = []
  const seen = new Set<number>()
  let cursor = byId.get(locationId)
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    path.unshift(cursor)
    cursor = cursor.parentId != null ? byId.get(cursor.parentId) : undefined
  }
  return path
}

// The path as one string for display. Falls back to `leafName` — the only part
// of the path the item DTO carries — when the tree cannot place the location.
export const locationPathLabel = (
  locationId: number | null | undefined,
  leafName: string | undefined,
  byId: Map<number, FlatLocation>,
): string | undefined => {
  const path = locationId != null ? locationPath(locationId, byId) : []
  if (path.length > 0) return path.map((l) => l.name).join(LOCATION_PATH_SEPARATOR)
  return leafName
}
