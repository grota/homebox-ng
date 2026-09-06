import type { DrizzleDb } from '@homebox/db'
import type { InstanceSettingsDto, InstanceSettingsInput } from '@homebox/shared'
import * as repo from './repo.js'

export const getSettings = (db: DrizzleDb): InstanceSettingsDto => repo.getOrCreate(db)
export const updateSettings = (db: DrizzleDb, input: InstanceSettingsInput): InstanceSettingsDto =>
  repo.update(db, input)
