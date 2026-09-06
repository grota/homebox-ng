import { eq } from 'drizzle-orm'
import { instanceSettings } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import type { InstanceSettingsDto, InstanceSettingsInput } from '@homebox/shared'
import { DEFAULT_INSTANCE_SETTINGS } from '@homebox/shared'

const FIRST_ID = 1

const toDto = (row: typeof instanceSettings.$inferSelect): InstanceSettingsDto => ({
  maxUploadMb: row.maxUploadMb,
  detectionProvider: row.detectionProvider,
  detectionConfig: (row.detectionConfig as Record<string, unknown>) ?? null,
})

// Read the single row, seeding defaults (with the fixed id) on first access.
export const getOrCreate = (db: DrizzleDb): InstanceSettingsDto => {
  const row = db.select().from(instanceSettings).where(eq(instanceSettings.id, FIRST_ID)).get()
  if (row) return toDto(row)
  const inserted = db.insert(instanceSettings).values({ id: FIRST_ID }).returning().get()
  return toDto(inserted)
}

// Partial update; always operates on the seeded row.
export const update = (db: DrizzleDb, input: InstanceSettingsInput): InstanceSettingsDto => {
  getOrCreate(db)
  const data: Partial<InstanceSettingsDto> = {}
  if (input.maxUploadMb !== undefined) data.maxUploadMb = input.maxUploadMb
  if (input.detectionProvider !== undefined) data.detectionProvider = input.detectionProvider
  if (input.detectionConfig !== undefined) data.detectionConfig = input.detectionConfig
  const row = db.update(instanceSettings).set(data).where(eq(instanceSettings.id, FIRST_ID)).returning().get()
  return toDto(row)
}

// Escape hatch persisted defaults for callers (e.g. uploads) that must not
// depend on `repo`.
export { DEFAULT_INSTANCE_SETTINGS }
