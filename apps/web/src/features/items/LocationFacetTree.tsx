import { useState } from 'react'
import { Button } from '../../ui'

// Mirrors the server's `LocationFacet` (see `apps/api/src/modules/items/repo.ts`) —
// the same hand-written-mirror convention the rest of the web uses for DTOs.
export type LocationFacetNode = {
  id: number | 'none'
  name: string
  parentId: number | null
  ownCount: number
  subtreeCount: number
  unlocated?: true
  children?: LocationFacetNode[]
}

// `'none'` is the **Unlocated** bucket, a legal `locationId` filter value.
export type LocationFacetId = number | 'none'

type Props = {
  nodes: LocationFacetNode[]
  selected: LocationFacetId | undefined
  onSelect: (id: LocationFacetId | undefined) => void
}

// The ids from the root down to the selection, so the branch leading to the
// grid's filter is always open. Otherwise you can select `garage`, collapse
// `home`, and end up filtering the list by something that is not on screen.
const pathToSelection = (
  nodes: LocationFacetNode[],
  selected: LocationFacetId | undefined,
): Set<LocationFacetId> => {
  if (selected == null) return new Set()
  const walk = (list: LocationFacetNode[], trail: LocationFacetId[]): LocationFacetId[] | null => {
    for (const node of list) {
      const next = [...trail, node.id]
      if (node.id === selected) return next
      const found = walk(node.children ?? [], next)
      if (found) return found
    }
    return null
  }
  return new Set(walk(nodes, []) ?? [])
}

// `home 4 (12)` — what sits in the node, then what its whole subtree holds. The
// second number is dropped when it is the same one: a leaf reading `5 (5)` is
// noise, and the parenthetical is only interesting when the two disagree.
const label = (node: LocationFacetNode): string =>
  node.ownCount === node.subtreeCount
    ? `${node.name} (${node.subtreeCount})`
    : `${node.name} ${node.ownCount} (${node.subtreeCount})`

// The location facet as the tree it is (ADR-0009). Two gestures on one row, and
// they mean different things: the **name** filters the grid, the **chevron** only
// opens the branch — so looking inside a location does not require filtering by it.
export function LocationFacetTree({ nodes, selected, onSelect }: Props) {
  // Which branches are open. View state, deliberately not in the URL: it is not a
  // link, and it is fine for it to reset on reload.
  const [open, setOpen] = useState<Set<LocationFacetId>>(new Set())
  const forced = pathToSelection(nodes, selected)

  const toggle = (id: LocationFacetId) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Plain nested lists with disclosure buttons, not `role="tree"`: full tree
  // semantics bring roving tabindex and arrow-key navigation, which a filter
  // sidebar does not use and would then have to keep correct.
  const level = (list: LocationFacetNode[], depth: number) => (
    <ul className="flex flex-col gap-1">
      {list.map((node) => {
        const children = node.children ?? []
        // A node on the path to the selection cannot be closed: the chevron's
        // click is recorded but `forced` keeps it open. Its own children can be
        // closed as usual.
        const expanded = open.has(node.id) || forced.has(node.id)
        return (
          <li key={String(node.id)}>
            <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
              {children.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
                  onClick={() => toggle(node.id)}
                  className="w-4 text-text-muted"
                >
                  {expanded ? '▾' : '▸'}
                </button>
              ) : (
                <span aria-hidden className="w-4" />
              )}
              <Button
                size="sm"
                variant={selected === node.id ? 'primary' : 'ghost'}
                aria-pressed={selected === node.id}
                // Clicking what is already selected clears it, so the one control
                // both narrows and widens.
                onClick={() => onSelect(selected === node.id ? undefined : node.id)}
              >
                {label(node)}
              </Button>
            </div>
            {children.length > 0 && expanded ? level(children, depth + 1) : null}
          </li>
        )
      })}
    </ul>
  )

  return level(nodes, 0)
}
