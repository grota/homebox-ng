import { describe, it, expect } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { detectionRegistry } from '../../src/modules/detection/provider'
import { resolveDetectionProvider } from '../../src/modules/detection/resolve'
import { updateSettings } from '../../src/modules/instanceSettings/service'

describe('resolveDetectionProvider', () => {
  it('returns the registered provider for the configured detectionProvider', () => {
    detectionRegistry.clear()
    const registeredProvider = {
      name: 'google',
      detectBoxes: async () => [],
    }
    detectionRegistry.register(registeredProvider)

    const db = createDb(':memory:')
    runMigrations(db)
    updateSettings(db, { detectionProvider: 'google' })

    expect(resolveDetectionProvider(db)).toBe(registeredProvider)
  })

  it('throws not-configured when the configured provider is not registered', () => {
    detectionRegistry.clear()

    const db = createDb(':memory:')
    runMigrations(db)
    updateSettings(db, { detectionProvider: 'local' })

    let thrown: unknown
    try {
      resolveDetectionProvider(db)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toMatchObject({ code: 'not-configured' })
  })
})
