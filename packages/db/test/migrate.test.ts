import { describe, it, expect, beforeAll } from 'vitest'
import { createDb, runMigrations } from '../src/index'

let db: ReturnType<typeof createDb>
beforeAll(() => {
  db = createDb(':memory:')
  runMigrations(db)
})

describe('db schema', () => {
  it('creates the core tables', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const set = new Set(names.map(n => n.name))
    expect(['users','sessions','locations','item_types','items','tags','item_tags','images'].every(t => set.has(t))).toBe(true)
  })
  it('enforces a non-null item name', () => {
    expect(() => db.prepare('INSERT INTO items (name) VALUES (NULL)').run()).toThrow()
  })
})
