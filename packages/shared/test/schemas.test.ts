import { describe, it, expect } from 'vitest'
import { loginInput, itemInput, locationInput } from '../src/schemas'

describe('shared schemas', () => {
  it('accepts a valid login', () => {
    expect(loginInput.safeParse({ email: 'a@b.co', password: 'x'.repeat(8) }).success).toBe(true)
  })
  it('rejects a short password', () => {
    expect(loginInput.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(false)
  })
  it('rejects an item with a negative quantity', () => {
    expect(itemInput.safeParse({
      name: 'Lamp', description: '', quantity: -1, unit: null,
      itemTypeId: 1, locationId: 1,
    }).success).toBe(false)
  })
  it('accepts a valid location', () => {
    expect(locationInput.safeParse({ name: 'Garage', parentId: null }).success).toBe(true)
  })
})
