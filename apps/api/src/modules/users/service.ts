import { TRPCError } from '@trpc/server'
import type { DrizzleDb } from '@homebox/db'
import type { UserInput, UserUpdateInput } from '@homebox/shared'
import { hashPassword } from '../../auth/password.js'
import * as repo from './repo.js'
import type { Role, UserRow } from './repo.js'

export type UserDto = { id: number; name: string; email: string; role: Role; mustChangePassword: boolean }

const toDto = (row: UserRow): UserDto => ({ id: row.id, name: row.name, email: row.email, role: row.role, mustChangePassword: row.mustChangePassword })

export const listUsers = (db: DrizzleDb): UserDto[] => repo.listUsers(db).map(toDto)

export const createUser = async (db: DrizzleDb, input: UserInput): Promise<UserDto> => {
  if (repo.findByEmail(db, input.email)) throw new TRPCError({ code: 'CONFLICT' })
  const row = repo.createUser(db, {
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    mustChangePassword: true,
  })
  return toDto(row)
}

export const updateUser = async (db: DrizzleDb, id: number, input: UserUpdateInput): Promise<UserDto> => {
  const existing = repo.findById(db, id)
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })
  if (input.email && input.email !== existing.email && repo.findByEmail(db, input.email)) {
    throw new TRPCError({ code: 'CONFLICT' })
  }

  const data: repo.UpdateUserData = {}
  if (input.name !== undefined) data.name = input.name
  if (input.email !== undefined) data.email = input.email
  if (input.role !== undefined) data.role = input.role
  if (input.password !== undefined) {
    data.passwordHash = await hashPassword(input.password)
    data.mustChangePassword = true
  }

  const row = Object.keys(data).length > 0 ? repo.updateUser(db, id, data) : existing
  return toDto(row)
}

export const deleteUser = (db: DrizzleDb, id: number): { ok: true } => {
  if (!repo.deleteUser(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  return { ok: true }
}
