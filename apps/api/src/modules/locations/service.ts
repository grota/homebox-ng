import { TRPCError } from '@trpc/server'
import type { DrizzleDb } from '@homebox/db'
import type { LocationInput } from '@homebox/shared'
import { reindexLocationSubtree } from '../items/fts.js'
import * as repo from './repo.js'
import type { LocationRow } from './repo.js'

// A location tree may not exceed this depth. Root = 1, so the deepest legal
// chain is 8 levels. Enforced on create and on update-moves.
export const LOCATION_DEPTH_MAX = 8

export type LocationDto = {
  id: number
  name: string
  parentId: number | null
  description: string | null
  depth: number
  children?: LocationDto[]
}

export type UpdateLocationInput = {
  id: number
  name?: string
  description?: string | null
  parentId?: number | null
}

// Depth is computed by walking the `parentId` chain (never stored). Root = 1,
// each level deeper increments by one. Throws `CONFLICT` if the chain cycles.
const computeDepth = (byId: Map<number, LocationRow>, row: LocationRow): number => {
  let depth = 1
  let cur: LocationRow | undefined = row
  const seen = new Set<number>()
  while (cur?.parentId != null) {
    if (seen.has(cur.parentId)) throw new TRPCError({ code: 'CONFLICT' })
    seen.add(cur.parentId)
    const parent = byId.get(cur.parentId)
    if (!parent) break // orphan reference; treat as a root for depth purposes
    depth++
    cur = parent
  }
  return depth
}

const toDto = (row: LocationRow, depth: number): LocationDto => ({
  id: row.id,
  name: row.name,
  parentId: row.parentId,
  description: row.description,
  depth,
})

// True when `candidateId` is `rootId` or a descendant of `rootId` (i.e. walking
// up towards the root passes through `rootId`). Used to reject moving a
// location under itself or one of its own descendants (a cycle).
const isDescendantOrSelf = (rows: LocationRow[], candidateId: number, rootId: number): boolean => {
  const byId = new Map(rows.map((r) => [r.id, r]))
  let cur = byId.get(candidateId)
  const seen = new Set<number>()
  while (cur) {
    if (cur.id === rootId) return true
    if (seen.has(cur.id)) break
    seen.add(cur.id)
    if (cur.parentId == null) break
    cur = byId.get(cur.parentId)
  }
  return false
}

const buildIndex = (rows: LocationRow[]): Map<number, LocationRow> => new Map(rows.map((r) => [r.id, r]))

// Assemble the flat rows into a tree. Top-level locations are rows with
// `parentId === null`; every other row is attached to its parent's `children`
// array in list order. Leaves carry no `children` key.
const buildTree = (rows: LocationRow[]): LocationDto[] => {
  const byId = buildIndex(rows)
  const nodes = new Map<number, LocationDto>()
  for (const row of rows) {
    nodes.set(row.id, toDto(row, computeDepth(byId, row)))
  }

  const roots: LocationDto[] = []
  for (const row of rows) {
    const node = nodes.get(row.id)!
    if (row.parentId == null) {
      roots.push(node)
      continue
    }
    const parent = nodes.get(row.parentId)
    if (!parent) {
      // Orphan reference (shouldn't happen when referential integrity holds);
      // surface it as a root rather than dropping data.
      roots.push(node)
      continue
    }
    ;(parent.children ??= []).push(node)
  }
  return roots
}

export const listLocations = (db: DrizzleDb): LocationDto[] => buildTree(repo.listLocations(db))

export const createLocation = (db: DrizzleDb, input: LocationInput): LocationDto => {
  if (input.parentId != null) {
    const parent = repo.getParent(db, input.parentId)
    if (!parent) throw new TRPCError({ code: 'NOT_FOUND' })
    const rows = repo.listLocations(db)
    const parentDepth = computeDepth(buildIndex(rows), parent)
    if (parentDepth + 1 > LOCATION_DEPTH_MAX) throw new TRPCError({ code: 'BAD_REQUEST' })
  }

  const row = repo.createLocation(db, { name: input.name, parentId: input.parentId, description: null })
  const depth = computeDepth(buildIndex(repo.listLocations(db)), row)
  return toDto(row, depth)
}

export const updateLocation = (db: DrizzleDb, input: UpdateLocationInput): LocationDto => {
  const existing = repo.getLocation(db, input.id)
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })

  const nextParentId = input.parentId !== undefined ? input.parentId : existing.parentId

  // A move that targets a parent must be cycle-free and depth-legal.
  if (nextParentId != null) {
    if (nextParentId === input.id) throw new TRPCError({ code: 'CONFLICT' })
    const parent = repo.getParent(db, nextParentId)
    if (!parent) throw new TRPCError({ code: 'NOT_FOUND' })
    const rows = repo.listLocations(db)
    if (isDescendantOrSelf(rows, nextParentId, input.id)) throw new TRPCError({ code: 'CONFLICT' })
    const parentDepth = computeDepth(buildIndex(rows), parent)
    if (parentDepth + 1 > LOCATION_DEPTH_MAX) throw new TRPCError({ code: 'BAD_REQUEST' })
  }

  const data: repo.UpdateLocationData = {}
  if (input.name !== undefined) data.name = input.name
  if (input.description !== undefined) data.description = input.description
  if (input.parentId !== undefined) data.parentId = input.parentId

  const row = Object.keys(data).length > 0 ? repo.updateLocation(db, input.id, data) : existing

  // A location rename OR move changes `location_path` for every item in its
  // subtree (the blob encodes the full ancestor chain), so re-index those items
  // after the write. The searchable blob only carries the name (not the
  // description), so reindex when the name or the parent changed.
  if (input.name !== undefined || input.parentId !== undefined) reindexLocationSubtree(db, input.id)

  const depth = computeDepth(buildIndex(repo.listLocations(db)), row)
  return toDto(row, depth)
}

export const deleteLocation = (db: DrizzleDb, id: number): { ok: true } => {
  if (!repo.getLocation(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  if (repo.countChildren(db, id) > 0) throw new TRPCError({ code: 'CONFLICT' })
  if (!repo.deleteLocation(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  return { ok: true }
}
