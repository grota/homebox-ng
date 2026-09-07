import type { DrizzleDb } from '@homebox/db'
import { getSettings } from '../instanceSettings/service.js'
import { detectionRegistry } from './provider.js'
import { DetectionProviderError } from './errors.js'
import type { DetectionProvider } from './provider.js'

export const resolveDetectionProvider = (db: DrizzleDb): DetectionProvider => {
  const { detectionProvider } = getSettings(db)
  const provider = detectionRegistry.get(detectionProvider)
  if (!provider) throw new DetectionProviderError('not-configured', `no detection provider named '${detectionProvider}'`)
  return provider
}
