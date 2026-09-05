import { eq } from 'drizzle-orm'
import { users } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

// Row shape surfaced by the app layer (never the password hash or timestamps).
export type UserRow = {
  id: number
  name: string
  email: string
  role: 'admin' | 'user'
}

export type Role = 'admin' | 'user'

// Select only the DTO columns so `passwordHash` stays out of every read.
const DTO_FIELDS = { id: users.id, name: users.name, email: users.email, role: users.role } as const

export const listUsers = (db: DrizzleDb): UserRow[] => db.select(DTO_FIELDS).from(users).all()

export const findById = (db: DrizzleDb, id: number): UserRow | undefined =>
  db.select(DTO_FIELDS).from(users).where(eq(users.id, id)).get()

export const findByEmail = (db: DrizzleDb, email: string): UserRow | undefined =>
  db.select(DTO_FIELDS).from(users).where(eq(users.email, email)).get()

export type CreateUserData = { name: string; email: string; passwordHash: string; role: Role }

export const createUser = (db: DrizzleDb, data: CreateUserData): UserRow =>
  db.insert(users).values(data).returning(DTO_FIELDS).get()

export type UpdateUserData = Partial<Pick<CreateUserData, 'name' | 'email' | 'passwordHash' | 'role'>>

export const updateUser = (db: DrizzleDb, id: number, data: UpdateUserData): UserRow =>
  db.update(users).set(data).where(eq(users.id, id)).returning(DTO_FIELDS).get()

export const deleteUser = (db: DrizzleDb, id: number): boolean =>
  db.delete(users).where(eq(users.id, id)).run().changes > 0
