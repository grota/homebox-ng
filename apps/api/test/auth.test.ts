import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password'
import { createDb, runMigrations, users, sessions } from '@homebox/db'
import { createSession, getSessionUser, invalidateSession } from '../src/auth/sessions'

it('hashes and verifies a password', async () => {
  const h = await hashPassword('password123')
  expect(h).not.toBe('password123')
  expect(await verifyPassword('password123', h)).toBe(true)
  expect(await verifyPassword('wrong', h)).toBe(false)
})
it('creates a session and resolves the user', async () => {
  const db = createDb(':memory:'); runMigrations(db)
  db.insert(users).values({ name: 'A', email: 'a@b.c', passwordHash: await hashPassword('password123'), role: 'admin' }).run()
  const user = db.select({ id: users.id, role: users.role }).from(users).get()!
  const { token } = createSession(db, user.id, 'sec')
  const got = getSessionUser(db, token, 'sec')
  expect(got?.id).toBe(user.id)
  invalidateSession(db, token, 'sec')
  expect(getSessionUser(db, token, 'sec')).toBeNull()
})
