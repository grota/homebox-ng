import { describe, it, expect } from 'vitest'
import { detectionRegistry } from '../src/modules/detection/provider'
import { registerDetectionProviders } from '../src/modules/detection/register'
import { DEFAULT_INSTANCE_SETTINGS } from '@homebox/shared'

describe('detectionRegistry', () => {
  it('registers the three built-in providers', () => {
    registerDetectionProviders(() => DEFAULT_INSTANCE_SETTINGS, { mock: false })
    expect(detectionRegistry.get('local')).toBeDefined()
    expect(detectionRegistry.get('google')).toBeDefined()
    expect(detectionRegistry.get('openai')).toBeDefined()
  })
  it('registers a mock provider when mock is set', () => {
    registerDetectionProviders(() => DEFAULT_INSTANCE_SETTINGS, { mock: true })
    expect(detectionRegistry.get('mock')).toBeDefined()
    expect(detectionRegistry.names()).toEqual(['mock'])
  })
})
