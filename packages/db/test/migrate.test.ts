import { describe, it, expect, beforeAll } from 'vitest'
import { createDb, runMigrations, instanceSettings, users } from '../src/index'

let db: ReturnType<typeof createDb>
beforeAll(() => {
  db = createDb(':memory:')
  runMigrations(db)
})

describe('db schema', () => {
  it('creates the core tables', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const set = new Set(names.map(n => n.name))
    expect(['users','sessions','locations','item_types','items','tags','item_tags','images','user_settings'].every(t => set.has(t))).toBe(true)
  })
  it('enforces a non-null item name', () => {
    expect(() => db.prepare('INSERT INTO items (name) VALUES (NULL)').run()).toThrow()
  })
  it('new migration adds instance_settings + users.must_change_password', () => {
    const db = createDb(':memory:')
    runMigrations(db)
    // instance_settings row is not auto-seeded here (the api layer seeds it); the
    // table is just queryable.
    expect(() => db.select().from(instanceSettings).all()).not.toThrow()
    const name = 'Alice'
    const email = 'alice@example.com'
    const passwordHash = 'a'.repeat(64)
    const insert = db.insert(users).values({ name, email, passwordHash, role: 'user' }).returning().get()
    expect(insert.mustChangePassword).toBe(false)
  })
  it('indexes the custom-field value lookups', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]
    const set = new Set(names.map(n => n.name))
    // `field_id` answers "how many values does this field hold", which gates
    // every destructive field operation; `item_id` answers the per-item read.
    expect(set.has('idx_icfv_field_id')).toBe(true)
    expect(set.has('idx_icfv_item_id')).toBe(true)
  })
})
